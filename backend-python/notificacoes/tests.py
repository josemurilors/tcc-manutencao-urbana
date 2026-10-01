"""
Notificações (contrato v3, seção 7.3): avisos gerados pelo histórico do
chamado, API da caixa de entrada, tokens de push, transporte Expo (sempre
com `_post` simulado — a suíte nunca sai para a internet) e os comandos
`alertas_sla` e `resumo_semanal`.
"""
import io
import urllib.error
import uuid
from datetime import timedelta

import pytest
from django.core.management import call_command
from django.urls import reverse
from django.utils import timezone

from defeitos import fluxo
from defeitos.models import Apoio, Defeito
from defeitos.test_fluxo import CIDADE, _chamado, _status, _usuario
from notificacoes import push, servico
from notificacoes.models import Notificacao, PushToken

pytestmark = pytest.mark.django_db(transaction=True)


def _token():
    return f'ExponentPushToken[{uuid.uuid4().hex[:22]}]'


def _avisos(user, **filtro):
    return list(Notificacao.objects.filter(usuario_id=user.id, **filtro).order_by('criado_em', 'id'))


@pytest.fixture
def expo(settings, monkeypatch):
    """Liga o push (síncrono) e captura os lotes que iriam para a Expo."""
    settings.EXPO_PUSH_ENABLED = True
    settings.EXPO_PUSH_ASYNC = False
    lotes = []

    def falso_post(lote):
        lotes.append(lote)
        return [{'status': 'ok', 'id': f'ticket-{i}'} for i in range(len(lote))]

    monkeypatch.setattr(push, '_post', falso_post)
    return lotes


class TestAvisosDoChamado:
    def test_status_avisa_autor_e_apoiador_com_texto_humano(self):
        cid, autor = _usuario()
        _, apoiador = _usuario()
        op, operador = _usuario('operador', CIDADE)
        d = _chamado(cid)
        Apoio.objects.create(usuario=apoiador, defeito_id=d['id'], criado_em=timezone.now())

        assert _status(op, d['id'], status='em_andamento').status_code == 200

        (aviso,) = _avisos(autor, tipo='status')
        assert aviso.titulo == f'Seu chamado {d["protocolo"]} (Entulho) está em execução'
        assert aviso.corpo == 'A equipe está trabalhando no local.'
        assert str(aviso.defeito_id) == d['id']
        (do_apoiador,) = _avisos(apoiador, tipo='status')
        assert 'que você apoia' in do_apoiador.titulo
        # Quem fez a ação não é avisado dela.
        assert _avisos(operador) == []

    def test_concluir_pede_avaliacao_ao_autor(self):
        cid, autor = _usuario()
        _, apoiador = _usuario()
        op, _ = _usuario('operador', CIDADE)
        d = _chamado(cid)
        Apoio.objects.create(usuario=apoiador, defeito_id=d['id'], criado_em=timezone.now())

        _status(op, d['id'], status='concluido', resposta_publica='Entulho recolhido.')

        (aviso,) = _avisos(autor)
        assert aviso.tipo == 'avaliar'
        assert 'foi resolvido' in aviso.titulo
        assert aviso.corpo.startswith('Entulho recolhido.')
        assert [a.tipo for a in _avisos(apoiador)] == ['status']

    def test_rejeicao_por_duplicado_explica_o_motivo(self):
        cid, autor = _usuario()
        gestor, _ = _usuario('gestor', CIDADE)
        original = _chamado(cid)
        d = _chamado(cid)

        resp = _status(gestor, d['id'], status='rejeitado', motivo='duplicado', duplicado_de=original['id'])
        assert resp.status_code == 200

        (aviso,) = _avisos(autor, defeito_id=d['id'])
        assert aviso.titulo.endswith('foi encerrado sem atendimento')
        assert 'Já existe um chamado' in aviso.corpo
        assert original['protocolo'] in aviso.corpo

    def test_nota_interna_nao_avisa_cidadao(self):
        cid, autor = _usuario()
        _, operador = _usuario('operador', CIDADE)
        d = _chamado(cid)
        defeito = Defeito.objects.get(pk=d['id'])

        fluxo.registrar_evento(defeito, 'nota_interna', operador, publico=False, texto='ver com obras')
        assert _avisos(autor) == []

        fluxo.registrar_evento(defeito, 'resposta_publica', operador, texto='Vistoria marcada para sexta.')
        (aviso,) = _avisos(autor)
        assert aviso.tipo == 'resposta'
        assert aviso.corpo == 'Vistoria marcada para sexta.'

    def test_atribuicao_avisa_o_operador(self):
        cid, _ = _usuario()
        _, gestor = _usuario('gestor', CIDADE)
        _, operador = _usuario('operador', CIDADE)
        defeito = Defeito.objects.get(pk=_chamado(cid)['id'])

        fluxo.atribuir(defeito, gestor, atendente_id=operador.id)

        (aviso,) = _avisos(operador)
        assert aviso.tipo == 'atribuido'
        assert aviso.titulo == f'Chamado {defeito.protocolo} (Entulho) atribuído a você'
        assert _avisos(gestor) == []

    def test_assumir_para_si_nao_gera_aviso(self):
        cid, _ = _usuario()
        _, operador = _usuario('operador', CIDADE)
        defeito = Defeito.objects.get(pk=_chamado(cid)['id'])

        fluxo.atribuir(defeito, operador, atendente_id=operador.id)
        assert _avisos(operador) == []

    def test_remocao_pela_moderacao_avisa_o_autor(self):
        cid, autor = _usuario()
        gestor, _ = _usuario('gestor', CIDADE)
        d = _chamado(cid)

        resp = gestor.delete(reverse('defeitos-detail', args=[d['id']]), {'motivo': 'Conteúdo ofensivo'},
                             format='json')
        assert resp.status_code in (200, 204)

        (aviso,) = _avisos(autor)
        assert aviso.tipo == 'moderacao'
        assert aviso.corpo == 'Conteúdo ofensivo'

    def test_erro_ao_notificar_nao_derruba_a_acao(self, monkeypatch):
        cid, _ = _usuario()
        op, _ = _usuario('operador', CIDADE)
        d = _chamado(cid)

        def explode(*a, **k):
            raise RuntimeError('fora do ar')

        monkeypatch.setattr(servico, 'notificar', explode)
        assert _status(op, d['id'], status='em_analise').status_code == 200


class TestMarcoDeApoios:
    def test_avisa_o_autor_uma_vez_por_marco(self):
        cid, autor = _usuario()
        d = _chamado(cid)
        apoiadores = [_usuario()[1] for _ in range(5)]
        for u in apoiadores[:4]:
            Apoio.objects.create(usuario=u, defeito_id=d['id'], criado_em=timezone.now())
        assert _avisos(autor, tipo='apoio_marco') == []

        Apoio.objects.create(usuario=apoiadores[4], defeito_id=d['id'], criado_em=timezone.now())
        (aviso,) = _avisos(autor, tipo='apoio_marco')
        assert aviso.titulo.startswith('5 pessoas apoiam seu chamado')

        # Tirar e repor o apoio não repete o aviso.
        Apoio.objects.filter(usuario=apoiadores[4], defeito_id=d['id']).delete()
        Apoio.objects.create(usuario=apoiadores[4], defeito_id=d['id'], criado_em=timezone.now())
        assert len(_avisos(autor, tipo='apoio_marco')) == 1

    def test_apoio_pela_api_dispara_o_marco(self):
        cid, autor = _usuario()
        d = _chamado(cid)
        for _ in range(4):
            Apoio.objects.create(usuario=_usuario()[1], defeito_id=d['id'], criado_em=timezone.now())
        cli, _ = _usuario()
        assert cli.post(reverse('defeitos-apoiar', args=[d['id']])).status_code == 201
        assert len(_avisos(autor, tipo='apoio_marco')) == 1


class TestApi:
    def _criar(self, user, n=3):
        return [
            Notificacao.objects.create(usuario=user, tipo='status', titulo=f'Aviso {i}', corpo='')
            for i in range(n)
        ]

    def test_lista_so_as_proprias_paginada(self):
        cli, user = _usuario()
        _, outro = _usuario()
        self._criar(user, 3)
        self._criar(outro, 2)

        resp = cli.get(reverse('notificacoes-list'))
        assert resp.status_code == 200
        assert resp.data['count'] == 3
        item = resp.data['results'][0]
        assert set(item) == {'id', 'tipo', 'titulo', 'corpo', 'defeito_id', 'lida_em', 'criado_em'}
        assert item['titulo'] == 'Aviso 2'  # mais recente primeiro

    def test_nao_lidas_lida_e_todas_lidas(self):
        cli, user = _usuario()
        avisos = self._criar(user, 3)
        url_total = reverse('notificacoes-nao-lidas')
        assert cli.get(url_total).data == {'total': 3}

        resp = cli.post(reverse('notificacoes-lida', args=[avisos[0].id]))
        assert resp.status_code == 200
        assert resp.data['lida_em'] is not None
        assert cli.get(url_total).data == {'total': 2}
        assert cli.get(reverse('notificacoes-list'), {'nao_lidas': 1}).data['count'] == 2

        assert cli.post(reverse('notificacoes-todas-lidas')).data == {'atualizadas': 2}
        assert cli.get(url_total).data == {'total': 0}

    def test_nao_marca_aviso_de_outra_pessoa(self):
        cli, _ = _usuario()
        _, outro = _usuario()
        (alheio,) = self._criar(outro, 1)
        resp = cli.post(reverse('notificacoes-lida', args=[alheio.id]))
        assert resp.status_code == 404
        # A mensagem chega na tela do app: em português, sem o nome do modelo.
        assert resp.data['detail'] == 'Notificação não encontrada.'

    def test_exige_login(self, client):
        assert client.get(reverse('notificacoes-list')).status_code == 401


class TestPushTokens:
    url = reverse('notificacoes-push-tokens')

    def test_registra_atualiza_e_remove(self):
        cli, user = _usuario()
        token = _token()
        resp = cli.post(self.url, {'token': token, 'plataforma': 'Android'}, format='json')
        assert resp.status_code == 201
        assert resp.data == {'token': token, 'plataforma': 'android'}
        assert cli.post(self.url, {'token': token, 'plataforma': 'android'}, format='json').status_code == 200
        assert PushToken.objects.filter(usuario=user).count() == 1

        assert cli.delete(self.url, {'token': token}, format='json').status_code == 204
        assert not PushToken.objects.filter(token=token).exists()
        # Idempotente.
        assert cli.delete(self.url, {'token': token}, format='json').status_code == 204

    def test_recusa_token_que_nao_e_do_expo(self):
        cli, _ = _usuario()
        for ruim in ('', 'abc', 'ExponentPushToken[]', 'x' * 300):
            assert cli.post(self.url, {'token': ruim}, format='json').status_code == 400

    def test_aparelho_passa_para_a_conta_que_logou(self):
        cli_a, a = _usuario()
        cli_b, b = _usuario()
        token = _token()
        cli_a.post(self.url, {'token': token}, format='json')
        cli_b.post(self.url, {'token': token}, format='json')
        assert PushToken.objects.get(token=token).usuario_id == b.id
        # A conta anterior não consegue mais apagar o token do aparelho.
        cli_a.delete(self.url, {'token': token}, format='json')
        assert PushToken.objects.filter(token=token).exists()


class TestTransporteExpo:
    def test_desligado_nao_chama_a_expo(self, settings, monkeypatch):
        settings.EXPO_PUSH_ENABLED = False
        chamadas = []
        monkeypatch.setattr(push, '_post', lambda lote: chamadas.append(lote) or [])
        assert push.enviar([{'to': _token(), 'title': 't', 'body': 'b'}])['enviadas'] == 0
        assert chamadas == []

    def test_sob_pytest_fica_desligado_por_padrao(self, settings):
        if hasattr(settings, 'EXPO_PUSH_ENABLED'):
            del settings.EXPO_PUSH_ENABLED
        assert push.habilitado() is False

    def test_lotes_de_100_e_remove_token_nao_registrado(self, settings, monkeypatch):
        settings.EXPO_PUSH_ENABLED = True
        _, user = _usuario()
        morto = PushToken.objects.create(usuario=user, token=_token())
        vivo = PushToken.objects.create(usuario=user, token=_token())
        mensagens = [{'to': _token(), 'title': 't', 'body': 'b'} for _ in range(248)]
        mensagens += [{'to': morto.token, 'title': 't', 'body': 'b'}, {'to': vivo.token, 'title': 't', 'body': 'b'}]
        lotes = []

        def falso_post(lote):
            lotes.append(len(lote))
            return [
                {'status': 'error', 'message': 'not registered', 'details': {'error': 'DeviceNotRegistered'}}
                if m['to'] == morto.token else {'status': 'ok', 'id': 'x'}
                for m in lote
            ]

        monkeypatch.setattr(push, '_post', falso_post)
        resultado = push.enviar(mensagens)

        assert lotes == [100, 100, 50]
        assert resultado == {'enviadas': 249, 'falhas': 1, 'removidos': 1}
        assert not PushToken.objects.filter(pk=morto.pk).exists()
        assert PushToken.objects.filter(pk=vivo.pk).exists()

    def test_falha_de_rede_nao_levanta(self, settings, monkeypatch):
        settings.EXPO_PUSH_ENABLED = True

        def fora_do_ar(lote):
            raise urllib.error.URLError('timeout')

        monkeypatch.setattr(push, '_post', fora_do_ar)
        assert push.enviar([{'to': _token(), 'title': 't', 'body': 'b'}]) == {
            'enviadas': 0, 'falhas': 1, 'removidos': 0,
        }

    def test_mudanca_de_status_vira_push_para_os_aparelhos_do_autor(self, expo):
        cid, autor = _usuario()
        op, _ = _usuario('operador', CIDADE)
        token = _token()
        cid.post(reverse('notificacoes-push-tokens'), {'token': token, 'plataforma': 'ios'}, format='json')
        d = _chamado(cid)

        _status(op, d['id'], status='agendado')

        (lote,) = expo
        (msg,) = lote
        assert msg['to'] == token
        assert msg['title'] == f'Seu chamado {d["protocolo"]} (Entulho) foi programado'
        assert msg['data'] == {'tipo': 'status', 'defeito_id': d['id'], 'protocolo': d['protocolo']}


def _municipio_isolado():
    """
    Município só deste teste: as tabelas do projeto são `managed=False` e não
    são esvaziadas entre testes, então chamados e gestores de outros testes
    da mesma cidade contaminariam as contagens dos comandos.
    """
    from django.db import connection

    codigo = f'97{uuid.uuid4().int % 100000:05d}'
    with connection.cursor() as cur:
        cur.execute("""
            INSERT INTO municipios (codigo, nome, uf, uf_sigla, min_lat, max_lat, min_lng, max_lng)
            VALUES (%s, 'Vila Isolada', '43', 'RS', 0, 0, 0, 0) ON CONFLICT (codigo) DO NOTHING
        """, [codigo])
    return codigo


def _defeito(municipio_id, *, prazo_em=None, status='pendente', criado_em=None, **extra):
    agora = timezone.now()
    return Defeito.objects.create(
        titulo='Buraco na via', categoria='Buraco', bairro='Centro', municipio_id=municipio_id,
        status=status, prazo_em=prazo_em, criado_em=criado_em or agora, atualizado_em=agora,
        latitude=-30.0, longitude=-59.0, **extra,
    )


class TestAlertasSla:
    def _cenario(self, prazo_em):
        municipio = _municipio_isolado()
        _, gestor = _usuario('gestor', municipio)
        _, operador = _usuario('operador', municipio)
        _, de_fora = _usuario('gestor', '9999921')
        defeito = _defeito(municipio, prazo_em=prazo_em, atendente=operador)
        return municipio, defeito, gestor, operador, de_fora

    def _rodar(self, municipio, *args):
        saida = io.StringIO()
        call_command('alertas_sla', '--municipio', municipio, *args, stdout=saida)
        return saida.getvalue()

    def test_vencendo_e_depois_vencido_sem_repetir(self):
        municipio, defeito, gestor, operador, de_fora = self._cenario(timezone.now() + timedelta(hours=10))

        self._rodar(municipio)
        (aviso,) = _avisos(gestor, tipo='sla_alerta')
        assert aviso.titulo == f'Prazo vence em 10 h: chamado {defeito.protocolo} (Buraco)'
        assert len(_avisos(operador, tipo='sla_alerta')) == 1
        assert _avisos(de_fora) == []

        self._rodar(municipio)
        assert len(_avisos(gestor, tipo='sla_alerta')) == 1

        # Dez horas depois o prazo passou: sai um (e só um) alerta de vencido.
        agora = timezone.now()
        Notificacao.objects.filter(defeito_id=defeito.pk).update(criado_em=agora - timedelta(hours=10))
        Defeito.objects.filter(pk=defeito.pk).update(prazo_em=agora - timedelta(minutes=5))
        self._rodar(municipio)
        self._rodar(municipio)
        avisos = _avisos(gestor, tipo='sla_alerta')
        assert len(avisos) == 2
        assert avisos[1].titulo.startswith('Prazo vencido')

    def test_gestor_de_outra_secretaria_nao_recebe(self):
        from gestao.models import Secretaria

        municipio, defeito, gestor, _, _ = self._cenario(timezone.now() + timedelta(hours=2))
        obras = Secretaria.objects.create(municipio_id=municipio, nome='Obras')
        saude = Secretaria.objects.create(municipio_id=municipio, nome='Saúde')
        Defeito.objects.filter(pk=defeito.pk).update(secretaria=obras)
        gestor.secretaria_id = saude.id
        gestor.save(update_fields=['secretaria_id'])

        self._rodar(municipio)
        assert _avisos(gestor) == []

    def test_ignora_prazo_distante_fechados_e_backlog_antigo(self):
        municipio, defeito, gestor, _, _ = self._cenario(timezone.now() + timedelta(days=3))
        self._rodar(municipio)
        assert _avisos(gestor) == []

        Defeito.objects.filter(pk=defeito.pk).update(prazo_em=timezone.now() - timedelta(days=30))
        self._rodar(municipio)
        assert _avisos(gestor) == []

        Defeito.objects.filter(pk=defeito.pk).update(
            prazo_em=timezone.now() - timedelta(hours=1), status='concluido',
        )
        self._rodar(municipio)
        assert _avisos(gestor) == []

    def test_push_agrupado_por_pessoa(self, expo):
        municipio, _, gestor, _, _ = self._cenario(timezone.now() + timedelta(hours=3))
        PushToken.objects.create(usuario=gestor, token=_token())
        _defeito(municipio, prazo_em=timezone.now() - timedelta(hours=2))

        self._rodar(municipio)

        assert len(_avisos(gestor, tipo='sla_alerta')) == 2
        (lote,) = expo
        (msg,) = lote
        assert msg['title'] == '2 chamados precisam de atenção'
        assert msg['body'] == '1 com prazo vencido e 1 vencendo nas próximas 24 h.'

    def test_dry_run_nao_grava(self):
        municipio, _, gestor, _, _ = self._cenario(timezone.now() + timedelta(hours=1))
        assert '[dry-run]' in self._rodar(municipio, '--dry-run')
        assert _avisos(gestor) == []


class TestResumoSemanal:
    def _rodar(self, municipio, *args):
        saida = io.StringIO()
        call_command('resumo_semanal', '--municipio', municipio, *args, stdout=saida)
        return saida.getvalue()

    def _cenario(self):
        municipio = _municipio_isolado()
        agora = timezone.now()
        _defeito(municipio, prazo_em=agora + timedelta(days=2))
        _defeito(municipio, prazo_em=agora - timedelta(days=1))
        _defeito(municipio, status='concluido', prazo_em=agora + timedelta(days=1),
                 resolvido_em=agora, avaliacao_nota=4, avaliado_em=agora)
        # Fora da semana: conta no backlog, não nos recebidos.
        _defeito(municipio, criado_em=agora - timedelta(days=20))
        return municipio

    def test_gestor_recebe_resumo_uma_vez_por_semana(self, settings):
        settings.RESEND_API_KEY = ''
        municipio = self._cenario()
        _, gestor = _usuario('gestor', municipio)
        _, operador = _usuario('operador', municipio)

        self._rodar(municipio)
        (aviso,) = _avisos(gestor, tipo='resumo')
        assert aviso.titulo == 'Resumo da semana em Vila Isolada/RS'
        assert aviso.corpo == (
            '3 chamados recebidos e 1 resolvido (100% no prazo). '
            '3 chamados em aberto, 1 com prazo vencido. '
            'Satisfação média 4,0/5 em 1 avaliação.'
        )
        assert _avisos(operador, tipo='resumo') == []

        self._rodar(municipio)
        assert len(_avisos(gestor, tipo='resumo')) == 1
        self._rodar(municipio, '--forcar')
        assert len(_avisos(gestor, tipo='resumo')) == 2

    def test_envia_email_quando_configurado(self, settings, monkeypatch):
        from notificacoes.management.commands import resumo_semanal

        settings.RESEND_API_KEY = 'chave-de-teste'
        municipio = self._cenario()
        _, gestor = _usuario('gestor', municipio)
        enviados = []

        def falso_email(destino, assunto, html):
            enviados.append((destino, assunto, html))
            return {'id': 'email-1'}

        monkeypatch.setattr(resumo_semanal, 'enviar_email', falso_email)
        assert '1 e-mail(s)' in self._rodar(municipio)
        ((destino, assunto, html),) = enviados
        assert destino == gestor.email
        assert assunto.startswith('Resumo da semana em Vila Isolada/RS')
        assert 'Com prazo vencido' in html
