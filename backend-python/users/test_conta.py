"""
Conta e LGPD (contrato v3, seção 7.7): recuperação de senha por código,
aceite de termos, exportação dos dados, payload do usuário, limites de
requisição nas rotas sensíveis e estatísticas sem chamados removidos.
"""
import random
import uuid
from datetime import timedelta
from unittest.mock import ANY

import pytest
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from users.models import User

pytestmark = pytest.mark.django_db(transaction=True)


def _ip():
    # IP único por teste: o contador do throttle vive no Redis e é por IP.
    return f'10.{random.randint(0, 255)}.{random.randint(0, 255)}.{random.randint(1, 254)}'


def _registrar(**extra):
    uid = uuid.uuid4().hex[:8]
    email = f'conta-{uid}@example.com'
    cli = APIClient()
    resp = cli.post(reverse('auth-register'), {
        'email': email, 'nome': f'Ana Souza {uid}', 'password': 'Senha@123',
        'confirm_password': 'Senha@123', **extra,
    }, format='json')
    assert resp.status_code == 201, resp.data
    cli.credentials(HTTP_AUTHORIZATION=f"Bearer {resp.data['access']}")
    return cli, User.objects.get(email=email), resp.data


@pytest.fixture
def codigos(monkeypatch):
    """Captura os códigos de redefinição enviados por e-mail: [(email, codigo)]."""
    enviados = []
    monkeypatch.setattr('users.views.send_password_reset_code', lambda e, c: enviados.append((e, c)))
    return enviados


class TestPayloadUsuario:

    def test_campos_v3(self):
        cli, _, dados = _registrar()
        for campo in ('papel', 'municipio_id', 'secretaria_id', 'equipe_id', 'aceite_termos_em', 'suspenso_ate'):
            assert campo in dados['user']
        perfil = cli.get(reverse('auth-profile')).data
        assert perfil['papel'] == 'cidadao'
        assert perfil['aceite_termos_em'] is None and perfil['suspenso_ate'] is None

    def test_suspenso_ate_e_somente_leitura(self):
        cli, user, _ = _registrar()
        futuro = (timezone.now() + timedelta(days=3)).isoformat()
        cli.patch(reverse('auth-profile'), {'suspenso_ate': None, 'aceite_termos_em': futuro}, format='json')
        user.suspenso_ate = timezone.now() + timedelta(days=3)
        user.save(update_fields=['suspenso_ate'])
        cli.patch(reverse('auth-profile'), {'suspenso_ate': None}, format='json')
        user.refresh_from_db()
        assert user.suspenso_ate is not None
        assert user.aceite_termos_em is None


class TestAceiteTermos:

    def test_aceite_no_cadastro(self):
        _, user, dados = _registrar(aceite_termos=True)
        assert user.aceite_termos_em is not None
        assert dados['user']['aceite_termos_em']

    def test_aceite_depois(self):
        cli, user, _ = _registrar()
        resp = cli.post(reverse('auth-aceite-termos'))
        assert resp.status_code == 200
        assert resp.data['user']['aceite_termos_em']
        user.refresh_from_db()
        assert user.aceite_termos_em is not None

    def test_exige_login(self):
        assert APIClient().post(reverse('auth-aceite-termos')).status_code == 401


class TestRecuperacaoSenha:

    def _esqueci(self, email, ip=None):
        return APIClient().post(reverse('auth-senha-esqueci'), {'email': email}, format='json',
                                REMOTE_ADDR=ip or _ip())

    def _redefinir(self, **dados):
        return APIClient().post(reverse('auth-senha-redefinir'), dados, format='json', REMOTE_ADDR=_ip())

    def test_fluxo_completo(self, codigos):
        _, user, _ = _registrar()
        resp = self._esqueci(user.email.upper())
        assert resp.status_code == 200
        assert codigos and codigos[-1][0] == user.email
        codigo = codigos[-1][1]
        resp = self._redefinir(email=user.email, codigo=codigo, nova_senha='NovaSenha#9')
        assert resp.status_code == 200, resp.data
        user.refresh_from_db()
        assert user.check_password('NovaSenha#9')
        assert user.codigo_2fa is None and user.email_verified == 1
        login = APIClient().post(reverse('auth-login'), {'email': user.email, 'password': 'NovaSenha#9'},
                                 format='json', REMOTE_ADDR=_ip())
        assert login.status_code == 200
        # Código é de uso único.
        assert self._redefinir(email=user.email, codigo=codigo, nova_senha='Outra#123').status_code == 400

    def test_email_desconhecido_responde_igual(self, codigos):
        _, user, _ = _registrar()
        existente = self._esqueci(user.email)
        inexistente = self._esqueci(f'ninguem-{uuid.uuid4().hex[:6]}@example.com')
        assert existente.status_code == inexistente.status_code == 200
        assert existente.data == inexistente.data
        assert len(codigos) == 1

    def test_email_invalido(self):
        assert self._esqueci('sem-arroba').status_code == 400

    def test_codigo_errado_ou_expirado(self, codigos):
        _, user, _ = _registrar()
        self._esqueci(user.email)
        codigo = codigos[-1][1]
        errado = '000000' if codigo != '000000' else '111111'
        assert self._redefinir(email=user.email, codigo=errado, nova_senha='NovaSenha#9').status_code == 400
        user.refresh_from_db()
        user.codigo_2fa_expira = (timezone.now() - timedelta(minutes=1)).isoformat()
        user.save(update_fields=['codigo_2fa_expira'])
        resp = self._redefinir(email=user.email, codigo=codigo, nova_senha='NovaSenha#9')
        assert resp.status_code == 400
        user.refresh_from_db()
        assert user.check_password('Senha@123')

    def test_validacoes(self, codigos):
        _, user, _ = _registrar()
        self._esqueci(user.email)
        codigo = codigos[-1][1]
        assert self._redefinir(email=user.email, codigo=codigo).status_code == 400
        assert self._redefinir(email=user.email, codigo=codigo, nova_senha='123').status_code == 400
        # Conta inexistente: mesmo erro do código errado.
        resp = self._redefinir(email='nao-existe@example.com', codigo='123456', nova_senha='NovaSenha#9')
        assert resp.status_code == 400

    def test_limite_de_envios_por_conta(self, codigos):
        _, user, _ = _registrar()
        user.requestsCount = 5
        user.requestsResetAt = (timezone.now() + timedelta(minutes=30)).isoformat()
        user.save(update_fields=['requestsCount', 'requestsResetAt'])
        assert self._esqueci(user.email).status_code == 200
        assert codigos == []
        # Janela vencida: volta a enviar.
        user.requestsResetAt = (timezone.now() - timedelta(minutes=1)).isoformat()
        user.save(update_fields=['requestsResetAt'])
        self._esqueci(user.email)
        assert len(codigos) == 1

    def test_throttle_redefinir_por_email(self, settings, codigos):
        settings.CIU_THROTTLE_TAXAS = {'senha_redefinir_email': '2/10m'}
        email = f'alvo-{uuid.uuid4().hex[:6]}@example.com'
        for _ in range(2):
            assert self._redefinir(email=email, codigo='123456', nova_senha='NovaSenha#9').status_code == 400
        # Mesmo trocando de IP (cada chamada usa um IP novo), a conta fica protegida.
        assert self._redefinir(email=email, codigo='123456', nova_senha='NovaSenha#9').status_code == 429


class TestThrottleEntrada:

    def test_login_por_ip(self, settings):
        settings.CIU_THROTTLE_TAXAS = {'login_ip': '2/m'}
        ip = _ip()
        cli = APIClient()
        for i in range(2):
            resp = cli.post(reverse('auth-login'), {'email': f'x{i}@example.com', 'password': 'x'},
                            format='json', REMOTE_ADDR=ip)
            assert resp.status_code == 401
        resp = cli.post(reverse('auth-login'), {'email': 'y@example.com', 'password': 'x'},
                        format='json', REMOTE_ADDR=ip)
        assert resp.status_code == 429
        # Outro IP segue livre.
        resp = cli.post(reverse('auth-login'), {'email': 'y@example.com', 'password': 'x'},
                        format='json', REMOTE_ADDR=_ip())
        assert resp.status_code == 401

    def test_login_por_email(self, settings):
        settings.CIU_THROTTLE_TAXAS = {'login_email': '2/h'}
        email = f'alvo-{uuid.uuid4().hex[:6]}@example.com'
        cli = APIClient()
        codigos = [cli.post(reverse('auth-login'), {'email': email, 'password': 'x'},
                            format='json', REMOTE_ADDR=_ip()).status_code for _ in range(3)]
        assert codigos == [401, 401, 429]

    def test_existe_por_ip(self, settings):
        settings.CIU_THROTTLE_TAXAS = {'existe_ip': '1/m'}
        ip = _ip()
        cli = APIClient()
        assert cli.post(reverse('auth-existe'), {'email': 'a@b.com'}, format='json', REMOTE_ADDR=ip).status_code == 200
        assert cli.post(reverse('auth-existe'), {'email': 'c@d.com'}, format='json', REMOTE_ADDR=ip).status_code == 429

    def test_xff_forjado_nao_fura_o_limite(self, settings):
        # O nginx sobrescreve X-Real-IP e só acrescenta ao X-Forwarded-For o que o
        # cliente mandou: trocar o prefixo do XFF não pode dar uma chave nova.
        settings.CIU_THROTTLE_TAXAS = {'existe_ip': '1/m'}
        ip = _ip()
        cli = APIClient()
        codigos = [cli.post(reverse('auth-existe'), {'email': 'a@b.com'}, format='json',
                            HTTP_X_REAL_IP=ip, HTTP_X_FORWARDED_FOR=f'{_ip()}, {ip}').status_code
                   for _ in range(2)]
        assert codigos == [200, 429]

    def test_verificar_email_por_usuario(self, settings):
        settings.CIU_THROTTLE_TAXAS = {'verificar_email': '2/10m'}
        cli, _, _ = _registrar()
        codigos = [cli.post(reverse('auth-verify-email'), {'codigo': '000000'}, format='json').status_code
                   for _ in range(3)]
        assert codigos[-1] == 429

    def test_taxa_com_multiplicador(self):
        from users.throttles import _Throttle
        assert _Throttle().parse_rate('5/10m') == (5, 600)
        assert _Throttle().parse_rate('30/h') == (30, 3600)
        assert _Throttle().parse_rate('3/day') == (3, 86400)

    def test_cache_fora_do_ar_nao_derruba(self, monkeypatch):
        from users import throttles

        class CacheQuebrado:
            def get(self, *a, **k):
                raise ConnectionError('redis fora')

        monkeypatch.setattr(throttles._Throttle, 'cache', CacheQuebrado())
        resp = APIClient().post(reverse('auth-existe'), {'email': 'a@b.com'}, format='json', REMOTE_ADDR=_ip())
        assert resp.status_code == 200


class TestMeusDados:

    def test_exporta_tudo_do_titular(self):
        from defeitos.models import Apoio, Defeito, Sinalizacao
        from defeitos.test_fluxo import _chamado, _status, _usuario
        from gestao.models import AuditLog

        cli, user, _ = _registrar(aceite_termos=True)
        meu = _chamado(cli)
        gestor_cli, _ = _usuario('gestor', '9999920')
        _status(gestor_cli, meu['id'], status='concluido')
        assert cli.post(reverse('defeitos-avaliar', args=[meu['id']]), {'nota': 5, 'comentario': 'Top'},
                        format='json').status_code == 200
        outro_cli, _ = _usuario()
        alheio = _chamado(outro_cli)
        cli.post(reverse('defeitos-apoiar', args=[alheio['id']]))
        cli.post(reverse('defeitos-sinalizar', args=[alheio['id']]), {'tipo': 'nao_existe'}, format='json')

        resp = cli.get(reverse('auth-meus-dados'))
        assert resp.status_code == 200
        assert 'attachment' in resp['Content-Disposition']
        dados = resp.data
        assert dados['usuario']['email'] == user.email
        assert [str(c['id']) for c in dados['chamados']] == [meu['id']]
        assert [str(a['defeito_id']) for a in dados['apoios']] == [alheio['id']]
        assert dados['sinalizacoes'][0]['tipo'] == 'nao_existe'
        assert dados['avaliacoes'] == [{
            'defeito_id': Defeito.objects.get(pk=meu['id']).pk, 'protocolo': meu['protocolo'],
            'titulo': meu['titulo'], 'nota': 5, 'comentario': 'Top',
            'avaliado_em': Defeito.objects.get(pk=meu['id']).avaliado_em,
        }]
        assert 'strikes' in dados and 'notificacoes' in dados
        assert {'criado', 'avaliacao'} <= {e['tipo'] for e in dados['eventos']}
        assert all(str(e['defeito_id']) in (meu['id'], alheio['id']) for e in dados['eventos'])

        # Fotos com GPS, aparelhos de push (sem o token) e IP da auditoria.
        from defeitos.models import DefeitoAnexo
        from notificacoes.models import PushToken
        DefeitoAnexo.objects.create(defeito_id=meu['id'], tipo='cidadao', imagem=b'x', autor=user,
                                    latitude=-30.5, longitude=-59.5)
        PushToken.objects.create(usuario=user, token=f'ExponentPushToken[{uuid.uuid4().hex}]', plataforma='android')
        dados = cli.get(reverse('auth-meus-dados'), REMOTE_ADDR='10.9.8.7').data
        (anexo,) = dados['anexos']
        assert (anexo['latitude'], anexo['longitude']) == (-30.5, -59.5)
        assert anexo['imagem_url'].endswith(f'/anexos/{anexo["id"]}/imagem/')
        assert dados['aparelhos_push'] == [{'tipo': 'expo', 'plataforma': 'android', 'criado_em': ANY,
                                            'ultimo_uso': ANY}]
        assert 'ExponentPushToken' not in str(dados)
        assert any(r['acao'] == 'lgpd.exportacao' and r['ip'] for r in dados['registros_tecnicos'])
        assert dados['convites'] == []
        # Nada de outra pessoa vaza na exportação.
        assert Apoio.objects.filter(usuario=user).count() == 1
        assert Sinalizacao.objects.filter(usuario=user).count() == 1
        assert AuditLog.objects.filter(acao='lgpd.exportacao', alvo_id=str(user.pk)).exists()

    def test_exige_login(self):
        assert APIClient().get(reverse('auth-meus-dados')).status_code == 401


class TestExcluirConta:

    def test_tira_nome_e_email_da_auditoria_e_dos_convites(self):
        from gestao.models import AuditLog, Convite

        cli, user, _ = _registrar()
        agora = timezone.now()
        aceito = Convite.objects.create(
            email=user.email, municipio_id='9999920', papel='operador', token=uuid.uuid4().hex,
            expira_em=agora + timedelta(days=7), aceito_em=agora, aceito_por=user,
        )
        pendente = Convite.objects.create(
            email=user.email.upper(), municipio_id='9999921', papel='operador', token=uuid.uuid4().hex,
            expira_em=agora + timedelta(days=7),
        )
        logs = [
            AuditLog.objects.create(acao='convite.aceitar', alvo_tipo='usuario', alvo_id=str(user.pk),
                                    dados={'nome': user.nome, 'email': user.email, 'antes': {'papel': 'cidadao'}}),
            AuditLog.objects.create(acao='membro.alterar', alvo_tipo='usuario', alvo_id=str(user.pk),
                                    dados={'nome': user.nome, 'antes': {}, 'depois': {}}),
            AuditLog.objects.create(acao='convite.criar', alvo_tipo='convite', alvo_id=str(aceito.pk),
                                    dados={'email': user.email, 'papel': 'operador'}),
        ]
        alheio = AuditLog.objects.create(acao='membro.alterar', alvo_tipo='usuario', alvo_id=str(uuid.uuid4()),
                                         dados={'nome': 'Outra Pessoa', 'email': 'outra@example.com'})

        assert cli.delete(reverse('auth-profile')).status_code == 204

        for log in logs:
            log.refresh_from_db()
            texto = str(log.dados)
            assert user.email not in texto and user.nome not in texto, log.acao
        logs[0].refresh_from_db()
        assert logs[0].dados['antes'] == {'papel': 'cidadao'}
        alheio.refresh_from_db()
        assert alheio.dados['nome'] == 'Outra Pessoa'
        aceito.refresh_from_db()
        assert aceito.email == '' and aceito.aceito_por_id is None
        assert not Convite.objects.filter(pk=pendente.pk).exists()
        saida = AuditLog.objects.get(acao='conta.excluir', alvo_id=str(user.pk))
        assert saida.dados == {}


class TestEstatisticasSemRemovidos:

    def test_removido_nao_conta(self, admin_client):
        from conftest import CIDADE_TESTES
        from defeitos import regras
        from defeitos.models import Defeito

        url = reverse('auth-admin-estatisticas')
        agora = timezone.now()
        d = Defeito.objects.create(
            municipio_id=CIDADE_TESTES, titulo='Vai sumir', categoria='Removivel',
            criado_em=agora, atualizado_em=agora, status='pendente',
        )
        antes = admin_client.get(url).data
        regras.remover(d, None, 'teste')
        depois = admin_client.get(url).data
        assert depois['total'] == antes['total'] - 1
        assert depois['pendentes'] == antes['pendentes'] - 1
        assert not any(c['categoria'] == 'Removivel' for c in depois['por_categoria'])
