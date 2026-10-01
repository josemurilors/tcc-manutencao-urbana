"""
Cidadão (contrato v3, seção 7.2): avaliar, reabrir, "já reportaram aqui?"
(`proximos`), consulta por protocolo, mapa por situação/categoria, bloqueio
de conta suspensa, upload de imagem endurecido e limite de abertura de
chamados.
"""
import io
import itertools
import uuid
from datetime import timedelta

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from defeitos import gamificacao, regras
from defeitos.models import Defeito, DefeitoEvento
from defeitos.test_fluxo import CIDADE, _chamado, _cidades, _status, _usuario
from defeitos.tests import _PNG_1X1, com_foto

pytestmark = pytest.mark.django_db(transaction=True)

# As tabelas são managed=False: o flush entre testes não as limpa. Cada teste
# geográfico usa um ponto próprio para não enxergar chamados de outro teste.
_PONTO = itertools.count()
_PONTO_PROXIMOS = itertools.count()


def _concluido(autor_cli=None):
    """(cli do autor, user autor, cli do gestor, chamado concluído pela prefeitura)."""
    if autor_cli is None:
        autor_cli, autor = _usuario()
    else:
        autor = None
    gestor_cli, _ = _usuario('gestor', CIDADE)
    criado = _chamado(autor_cli)
    resp = _status(gestor_cli, criado['id'], status='concluido', resposta_publica='Tapamos o buraco.')
    assert resp.status_code == 200, resp.data
    return autor_cli, autor, gestor_cli, criado


def _avaliar(cli, defeito_id, **dados):
    return cli.post(reverse('defeitos-avaliar', args=[defeito_id]), dados, format='json')


def _reabrir(cli, defeito_id, **dados):
    return cli.post(reverse('defeitos-reabrir', args=[defeito_id]), dados, format='json')


class TestAvaliar:

    def test_autor_avalia_concluido(self):
        autor_cli, _, _, criado = _concluido()
        resp = _avaliar(autor_cli, criado['id'], nota=4, comentario='Rápido, obrigado!')
        assert resp.status_code == 200, resp.data
        assert resp.data['avaliacao_nota'] == 4
        assert resp.data['avaliacao_comentario'] == 'Rápido, obrigado!'
        assert resp.data['avaliado_em']
        ev = DefeitoEvento.objects.get(defeito_id=criado['id'], tipo='avaliacao')
        assert ev.publico and ev.papel == 'cidadao'
        assert ev.dados == {'nota': 4, 'edicao': False}

    def test_edita_dentro_de_7_dias(self):
        autor_cli, _, _, criado = _concluido()
        assert _avaliar(autor_cli, criado['id'], nota=2).status_code == 200
        resp = _avaliar(autor_cli, criado['id'], nota=5, comentario='Voltei e ficou ótimo')
        assert resp.status_code == 200
        assert resp.data['avaliacao_nota'] == 5
        eventos = DefeitoEvento.objects.filter(defeito_id=criado['id'], tipo='avaliacao').order_by('id')
        assert [e.dados['edicao'] for e in eventos] == [False, True]

    def test_edicao_fecha_depois_de_7_dias(self):
        autor_cli, _, _, criado = _concluido()
        assert _avaliar(autor_cli, criado['id'], nota=3).status_code == 200
        # Resolvido há 10 dias, avaliado há 8.
        agora = timezone.now()
        Defeito.objects.filter(pk=criado['id']).update(resolvido_em=agora - timedelta(days=10))
        DefeitoEvento.objects.filter(defeito_id=criado['id'], tipo='avaliacao').update(
            criado_em=agora - timedelta(days=8),
        )
        resp = _avaliar(autor_cli, criado['id'], nota=5)
        assert resp.status_code == 409
        assert Defeito.objects.get(pk=criado['id']).avaliacao_nota == 3

    def test_so_o_autor(self):
        _, _, _, criado = _concluido()
        outro, _ = _usuario()
        assert _avaliar(outro, criado['id'], nota=5).status_code == 403
        assert APIClient().post(
            reverse('defeitos-avaliar', args=[criado['id']]), {'nota': 5}, format='json',
        ).status_code == 401

    def test_so_concluido(self):
        cli, _ = _usuario()
        criado = _chamado(cli)
        resp = _avaliar(cli, criado['id'], nota=5)
        assert resp.status_code == 409
        assert 'resolvido' in resp.data['detail']

    @pytest.mark.parametrize('nota', [0, 6, 'abc', None, 3.5])
    def test_nota_invalida(self, nota):
        autor_cli, _, _, criado = _concluido()
        dados = {} if nota is None else {'nota': nota}
        assert _avaliar(autor_cli, criado['id'], **dados).status_code == 400

    def test_comentario_longo_demais(self):
        autor_cli, _, _, criado = _concluido()
        assert _avaliar(autor_cli, criado['id'], nota=5, comentario='x' * 1001).status_code == 400

    def test_avaliacao_da_xp_uma_vez(self):
        autor_cli, autor, _, criado = _concluido()
        antes = gamificacao.resumo_do_usuario(autor)['xp']
        _avaliar(autor_cli, criado['id'], nota=5)
        depois = gamificacao.resumo_do_usuario(autor)
        assert depois['xp'] == antes + gamificacao.XP_AVALIACAO
        assert depois['avaliacoes'] == 1
        _avaliar(autor_cli, criado['id'], nota=4)
        assert gamificacao.resumo_do_usuario(autor)['xp'] == depois['xp']

    def test_ranking_conta_avaliacao(self):
        autor_cli, autor, _, criado = _concluido()
        _avaliar(autor_cli, criado['id'], nota=5)
        linha = next(i for i in gamificacao.ranking_de(CIDADE) if i['usuario_id'] == str(autor.id))
        assert linha['avaliacoes'] == 1
        assert linha['xp'] == (gamificacao.XP_CHAMADO + gamificacao.XP_BONUS_RESOLVIDO
                               + gamificacao.XP_AVALIACAO)


class TestReabrir:

    def test_autor_reabre_com_motivo(self):
        autor_cli, _, _, criado = _concluido()
        resp = _reabrir(autor_cli, criado['id'], motivo='O buraco voltou depois da chuva')
        assert resp.status_code == 200, resp.data
        assert resp.data['status'] == 'pendente'
        assert resp.data['reaberturas'] == 1
        ev = DefeitoEvento.objects.get(defeito_id=criado['id'], tipo='reaberto')
        assert ev.texto == 'O buraco voltou depois da chuva'
        assert ev.de_status == 'concluido' and ev.para_status == 'pendente'

    def test_reabertura_renova_o_prazo(self):
        autor_cli, _, _, criado = _concluido()
        # Resolvido muito depois do prazo original: reabrir não pode nascer atrasado.
        Defeito.objects.filter(pk=criado['id']).update(
            prazo_em=timezone.now() - timedelta(days=20),
            resolvido_em=timezone.now() - timedelta(days=1),
            fechado_em=timezone.now() - timedelta(days=1),
        )
        resp = _reabrir(autor_cli, criado['id'], motivo='O buraco voltou depois da chuva')
        assert resp.status_code == 200, resp.data
        assert resp.data['sla_vencido'] is False
        assert resp.data['sla_restante_horas'] > 0

    def test_motivo_obrigatorio(self):
        autor_cli, _, _, criado = _concluido()
        assert _reabrir(autor_cli, criado['id']).status_code == 400
        assert _reabrir(autor_cli, criado['id'], motivo='  ').status_code == 400
        assert Defeito.objects.get(pk=criado['id']).status == 'concluido'

    def test_aberto_nao_reabre(self):
        cli, _ = _usuario()
        criado = _chamado(cli)
        assert _reabrir(cli, criado['id'], motivo='ainda está lá').status_code == 409

    def test_terceiro_nao_reabre(self):
        _, _, _, criado = _concluido()
        outro, _ = _usuario()
        assert _reabrir(outro, criado['id'], motivo='ainda está lá').status_code == 403

    def test_autor_fora_do_prazo(self):
        autor_cli, _, _, criado = _concluido()
        velho = timezone.now() - timedelta(days=31)
        Defeito.objects.filter(pk=criado['id']).update(resolvido_em=velho, fechado_em=velho)
        resp = _reabrir(autor_cli, criado['id'], motivo='ainda está lá')
        assert resp.status_code == 403
        assert 'prazo' in resp.data['detail']

    def test_autor_nao_reabre_rejeitado(self):
        autor_cli, _ = _usuario()
        gestor_cli, _ = _usuario('gestor', CIDADE)
        criado = _chamado(autor_cli)
        assert _status(gestor_cli, criado['id'], status='rejeitado', motivo='improcedente').status_code == 200
        assert _reabrir(autor_cli, criado['id'], motivo='mas existe sim').status_code == 403

    def test_gestor_reabre_rejeitado(self):
        autor_cli, _ = _usuario()
        gestor_cli, _ = _usuario('gestor', CIDADE)
        criado = _chamado(autor_cli)
        _status(gestor_cli, criado['id'], status='rejeitado', motivo='improcedente')
        resp = _reabrir(gestor_cli, criado['id'], motivo='Revisão da ouvidoria')
        assert resp.status_code == 200
        assert resp.data['status'] == 'pendente'

    def test_operador_nao_reabre(self):
        _, _, _, criado = _concluido()
        operador, _ = _usuario('operador', CIDADE)
        assert _reabrir(operador, criado['id'], motivo='voltou a quebrar').status_code == 403


class TestProximos:
    # Ponto isolado por teste (5,5 km entre um e outro, longe dos chamados
    # padrão de `_chamado`) para o raio não pegar chamados alheios.
    @pytest.fixture(autouse=True)
    def _ponto(self):
        self.LAT, self.LNG = -29.6 + next(_PONTO_PROXIMOS) * 0.05, -58.5

    def _em(self, cli, dlat=0.0, **extra):
        return _chamado(cli, latitude=self.LAT + dlat, longitude=self.LNG, **extra)

    def _proximos(self, **params):
        return APIClient().get(reverse('defeitos-proximos'), {'lat': self.LAT, 'lng': self.LNG, **params})

    def test_publico_ordenado_por_distancia(self):
        cli, _ = _usuario()
        longe = self._em(cli, dlat=0.0002)   # ~22 m
        perto = self._em(cli, dlat=0.00005, categoria='Buraco')  # ~5 m
        self._em(cli, dlat=0.01)  # ~1,1 km: fora
        resp = self._proximos()
        assert resp.status_code == 200
        assert [d['id'] for d in resp.data] == [perto['id'], longe['id']]
        item = resp.data[0]
        assert set(item) >= {'id', 'protocolo', 'titulo', 'categoria', 'status', 'distancia_m',
                             'criado_em', 'resolvido_em', 'total_apoios'}
        assert 3 < item['distancia_m'] < 8

    def test_raio_da_prefeitura_e_override(self):
        from gestao.models import MunicipioConfig
        _cidades()
        cli, _ = _usuario()
        self._em(cli, dlat=0.0004)  # ~44 m
        assert self._proximos().data == []  # padrão 30 m
        MunicipioConfig.objects.update_or_create(municipio_id=CIDADE, defaults={'raio_duplicado_m': 60})
        try:
            assert len(self._proximos().data) == 1
            assert self._proximos(raio=10).data == []
        finally:
            MunicipioConfig.objects.filter(municipio_id=CIDADE).delete()

    def test_resolvidos_recentes_entram_antigos_e_rejeitados_nao(self):
        cli, _ = _usuario()
        gestor_cli, _ = _usuario('gestor', CIDADE)
        # Categorias distintas: a mesma categoria a menos de 10 m é duplicado.
        recente = self._em(cli, dlat=0.00001, categoria='Buraco')
        antigo = self._em(cli, dlat=0.00002, categoria='Entulho')
        rejeitado = self._em(cli, dlat=0.00003, categoria='Iluminação')
        removido = self._em(cli, dlat=0.00004, categoria='Calçada')
        for c in (recente, antigo):
            assert _status(gestor_cli, c['id'], status='concluido').status_code == 200
        _status(gestor_cli, rejeitado['id'], status='rejeitado', motivo='improcedente')
        Defeito.objects.filter(pk=antigo['id']).update(resolvido_em=timezone.now() - timedelta(days=31))
        regras.remover(Defeito.objects.get(pk=removido['id']), None, 'teste')
        ids = [d['id'] for d in self._proximos().data]
        assert ids == [recente['id']]

    def test_filtra_categoria_por_nome_ou_id(self):
        cli, _ = _usuario()
        self._em(cli, dlat=0.00001, categoria='Buraco')
        entulho = self._em(cli, dlat=0.00002, categoria='Entulho')
        assert [d['id'] for d in self._proximos(categoria='entulho').data] == [entulho['id']]
        cat_id = Defeito.objects.get(pk=entulho['id']).categoria_id
        if cat_id:
            assert [d['id'] for d in self._proximos(categoria=cat_id).data] == [entulho['id']]

    def test_parametros(self):
        assert APIClient().get(reverse('defeitos-proximos')).status_code == 400
        assert self._proximos(raio='x').status_code == 400


class TestProtocolo:

    def test_consulta_publica(self):
        cli, _ = _usuario(nome='Joana Pereira')
        criado = _chamado(cli)
        resp = APIClient().get(reverse('defeitos-protocolo', args=[criado['protocolo']]))
        assert resp.status_code == 200
        assert resp.data['id'] == criado['id']
        assert resp.data['autor_nome'] == 'Joana P.'
        assert resp.data['atendente_id'] is None

    def test_minusculo_e_desconhecido(self):
        cli, _ = _usuario()
        criado = _chamado(cli)
        assert APIClient().get(
            reverse('defeitos-protocolo', args=[criado['protocolo'].lower()]),
        ).status_code == 200
        assert APIClient().get(reverse('defeitos-protocolo', args=['1999-000000'])).status_code == 404

    def test_removido_some(self):
        cli, _ = _usuario()
        criado = _chamado(cli)
        regras.remover(Defeito.objects.get(pk=criado['id']), None, 'teste')
        assert APIClient().get(reverse('defeitos-protocolo', args=[criado['protocolo']])).status_code == 404


class TestAreaSituacao:
    @pytest.fixture(autouse=True)
    def _ponto(self):
        self.LAT, self.LNG = -30.3 - next(_PONTO) * 0.03, -59.5

    def _area(self, cli=None, **params):
        return (cli or APIClient()).get(reverse('defeitos-area'), {
            'min_lat': self.LAT - 0.01, 'max_lat': self.LAT + 0.01,
            'min_lng': self.LNG - 0.01, 'max_lng': self.LNG + 0.01, **params,
        })

    def _cenario(self):
        cli, _ = _usuario()
        gestor_cli, _ = _usuario('gestor', CIDADE)
        aberto = _chamado(cli, latitude=self.LAT, longitude=self.LNG, categoria='Buraco')
        resolvido = _chamado(cli, latitude=self.LAT + 0.001, longitude=self.LNG, categoria='Entulho')
        velho = _chamado(cli, latitude=self.LAT + 0.002, longitude=self.LNG, categoria='Entulho')
        for c in (resolvido, velho):
            _status(gestor_cli, c['id'], status='concluido')
        Defeito.objects.filter(pk=velho['id']).update(resolvido_em=timezone.now() - timedelta(days=200))
        return aberto, resolvido

    def test_situacoes(self):
        aberto, resolvido = self._cenario()
        padrao = self._area()
        assert padrao.status_code == 200
        assert padrao.data['situacao'] == 'abertos'
        assert [d['id'] for d in padrao.data['defeitos']] == [aberto['id']]
        assert {d['id'] for d in self._area(situacao='resolvidos').data['defeitos']} == {resolvido['id']}
        todos = self._area(situacao='todos').data
        assert {d['id'] for d in todos['defeitos']} == {aberto['id'], resolvido['id']}
        # Células para todo mundo, inclusive anônimo, com a contagem real.
        assert todos['total'] == 2 and todos['celulas']

    def test_categorias(self):
        aberto, resolvido = self._cenario()
        cat_id = Defeito.objects.get(pk=resolvido['id']).categoria_id
        if cat_id is None:
            pytest.skip('categoria Entulho sem id no banco de teste')
        resp = self._area(situacao='todos', categorias=str(cat_id))
        assert {d['id'] for d in resp.data['defeitos']} == {resolvido['id']}

    def test_parametros_invalidos(self):
        assert self._area(situacao='rejeitados').status_code == 400
        assert self._area(categorias='a,b').status_code == 400


class TestContaSuspensa:

    def _suspender(self, user, dias=3):
        user.suspenso_ate = timezone.now() + timedelta(days=dias)
        user.save(update_fields=['suspenso_ate'])

    def test_bloqueia_criar_apoiar_sinalizar(self):
        dono, _ = _usuario()
        alheio = _chamado(dono)
        cli, user = _usuario()
        self._suspender(user)
        _cidades()
        resp = cli.post(reverse('defeitos-list'), com_foto({
            'titulo': 'x', 'descricao': 'y', 'categoria': 'Entulho',
            'latitude': -30.9, 'longitude': -59.9,
        }), format='multipart')
        assert resp.status_code == 403
        assert resp.data['codigo'] == 'conta_suspensa'
        assert 'suspensa até' in resp.data['detail']
        assert cli.post(reverse('defeitos-apoiar', args=[alheio['id']])).status_code == 403
        assert cli.post(
            reverse('defeitos-sinalizar', args=[alheio['id']]), {'tipo': 'resolvido'}, format='json',
        ).status_code == 403

    def test_suspensao_vencida_libera(self):
        dono, _ = _usuario()
        alheio = _chamado(dono)
        cli, user = _usuario()
        self._suspender(user, dias=-1)
        assert cli.post(reverse('defeitos-apoiar', args=[alheio['id']])).status_code == 201

    def test_continua_vendo(self):
        cli, user = _usuario()
        criado = _chamado(cli)
        self._suspender(user)
        assert cli.get(reverse('defeitos-detail', args=[criado['id']])).status_code == 200
        assert cli.get(reverse('defeitos-meus')).status_code == 200


def _arquivo(conteudo=_PNG_1X1, nome='foto.png', tipo='image/png'):
    return SimpleUploadedFile(nome, conteudo, content_type=tipo)


class TestUploadImagem:

    def test_imagem_exige_login(self):
        resp = APIClient().post(reverse('defeitos-imagem'), {'file': _arquivo()}, format='multipart')
        assert resp.status_code == 401

    def test_imagem_logado(self):
        cli, _ = _usuario()
        resp = cli.post(reverse('defeitos-imagem'), {'file': _arquivo()}, format='multipart')
        assert resp.status_code == 200
        assert resp.data['image'] and resp.data['thumbnail']

    def test_recusa_grande_demais(self, monkeypatch):
        from defeitos import views
        monkeypatch.setattr(views, 'MAX_IMAGEM_BYTES', 50)
        cli, _ = _usuario()
        resp = cli.post(reverse('defeitos-imagem'), {'file': _arquivo(b'\0' * 51)}, format='multipart')
        assert resp.status_code == 400
        assert 'MB' in resp.data['error']

    def test_recusa_nao_imagem(self):
        cli, _ = _usuario()
        pdf = _arquivo(b'%PDF-1.4 ...', 'doc.pdf', 'application/pdf')
        assert cli.post(reverse('defeitos-imagem'), {'file': pdf}, format='multipart').status_code == 400
        lixo = _arquivo(b'nao sou imagem', 'x.jpg', 'image/jpeg')
        assert cli.post(reverse('defeitos-imagem'), {'file': lixo}, format='multipart').status_code == 400

    def test_criar_com_arquivo_que_nao_e_imagem(self):
        cli, _ = _usuario()
        _cidades()
        resp = cli.post(reverse('defeitos-list'), {
            'titulo': 'x', 'descricao': 'y', 'categoria': 'Entulho',
            'latitude': -30.95, 'longitude': -59.95,
            'imagem': _arquivo(io.BytesIO(b'lixo').getvalue(), 'x.jpg', 'image/jpeg'),
        }, format='multipart')
        assert resp.status_code == 400


class TestLimiteCriarChamado:

    def test_criar_chamado_tem_teto_por_usuario(self, settings):
        settings.CIU_THROTTLE_TAXAS = {'criar_chamado': '1/h'}
        cli, _ = _usuario()
        _chamado(cli)
        _cidades()
        resp = cli.post(reverse('defeitos-list'), com_foto({
            'titulo': 'segundo', 'descricao': f'outro {uuid.uuid4()}', 'categoria': 'Entulho',
            'latitude': -30.2, 'longitude': -59.2,
        }), format='multipart')
        assert resp.status_code == 429
        # Outro usuário não é afetado.
        outro, _ = _usuario()
        _chamado(outro)
