"""Sugestões da IA leve: agrupamento por embeddings, risco citado e o endpoint."""
from datetime import timedelta
from unittest import mock

import pytest
from django.utils import timezone

from bi import sugestoes_ia
from bi.tests import MUN, _chamado, _cliente, _municipio, _usuario


def _item(rua, descricao='', bairro='Centro', categoria='Outro', id_=None, lat=-23.55, lng=-46.63):
    return {'id': id_ or rua, 'rua': rua, 'bairro': bairro, 'categoria': categoria, 'descricao': descricao,
            'latitude': lat, 'longitude': lng}


def test_agrupa_relatos_parecidos_em_ruas_diferentes():
    esgoto = [1.0, 0.0, 0.0]
    quase_esgoto = [0.95, 0.05, 0.0]
    poste = [0.0, 1.0, 0.0]
    itens = [
        _item('Rua A', 'cheiro forte de esgoto', id_=1),
        _item('Rua B', 'esgoto vazando na calçada', id_=2),
        _item('Rua C', 'mau cheiro de esgoto', id_=3),
        _item('Rua D', 'poste apagado', id_=4),
    ]
    temas = sugestoes_ia.agrupar_temas(itens, [esgoto, quase_esgoto, esgoto, poste])
    assert len(temas) == 1
    assert temas[0]['total'] == 3 and temas[0]['ruas'] == 3
    assert temas[0]['ids'] == ['1', '2', '3']
    assert 'esgoto' in temas[0]['exemplo']


def test_relatos_parecidos_longe_nao_viram_tema():
    # Mesmo texto em pontos a ~10 km uns dos outros: não é uma causa comum da região.
    v = [1.0, 0.0]
    itens = [_item(f'Rua {i}', id_=i, lat=-23.55 + i * 0.09) for i in range(3)]
    assert sugestoes_ia.agrupar_temas(itens, [v] * 3) == []


def test_mesma_rua_nao_vira_tema():
    # O mesmo problema na mesma rua já aparece como reincidência no painel.
    v = [1.0, 0.0]
    itens = [_item('Rua A', id_=i) for i in range(4)]
    assert sugestoes_ia.agrupar_temas(itens, [v] * 4) == []


def test_grupo_pequeno_nao_vira_tema():
    v = [1.0, 0.0]
    assert sugestoes_ia.agrupar_temas([_item('Rua A'), _item('Rua B')], [v, v]) == []


@pytest.mark.django_db
class TestEndpoint:
    @pytest.fixture(autouse=True)
    def _sem_cache(self, settings):
        settings.CACHES = {'default': {'BACKEND': 'django.core.cache.backends.dummy.DummyCache'}}

    @pytest.fixture
    def cenario(self):
        _municipio(MUN, 'Cidade BI')
        agora = timezone.now()
        for i, rua in enumerate(['Rua A', 'Rua B', 'Rua C']):
            _chamado(agora - timedelta(days=i + 1), rua=rua, descricao=f'esgoto vazando {i}')
        _chamado(agora - timedelta(days=5), rua='Rua D', descricao='fio partido no chão, criança passa aqui')
        # Fora do recorte: concluído e antigo.
        _chamado(agora - timedelta(days=2), rua='Rua E', descricao='esgoto', status='concluido')
        _chamado(agora - timedelta(days=200), rua='Rua F', descricao='esgoto antigo')
        return _usuario('gestor', MUN)

    @staticmethod
    async def _embeddings(textos, redis_client=None):
        return [[1.0, 0.0] if 'esgoto' in t else [0.0, 1.0] for t in textos]

    @staticmethod
    async def _prioridades(textos, redis_client=None):
        return [
            {'priority': 'urgente', 'confidence': 0.9, 'terms': ['fio partido', 'crianca']}
            if 'fio partido' in t else {'priority': 'media', 'confidence': 0.5, 'terms': []}
            for t in textos
        ]

    def test_temas_e_riscos(self, cenario):
        with mock.patch('services.ia_client.get_embeddings_batch', self._embeddings), \
             mock.patch('services.ia_client.priority_batch', self._prioridades):
            r = _cliente(cenario).get('/api/v1/bi/sugestoes-ia/')
        assert r.status_code == 200
        dados = r.json()
        assert dados['ia_disponivel'] is True and dados['analisados'] == 4
        assert [t['total'] for t in dados['temas']] == [3]
        assert 'Pode ser uma causa comum' in dados['temas'][0]['sugestao']
        assert len(dados['riscos']) == 1 and dados['riscos'][0]['rua'] == 'Rua D'
        assert dados['riscos'][0]['termos'] == ['fio partido', 'crianca']

    def test_ia_fora_do_ar(self, cenario):
        async def falha(textos, redis_client=None):
            return None

        with mock.patch('services.ia_client.get_embeddings_batch', falha), \
             mock.patch('services.ia_client.priority_batch', falha):
            r = _cliente(cenario).get('/api/v1/bi/sugestoes-ia/')
        assert r.status_code == 200
        assert r.json() == {'ia_disponivel': False, 'analisados': 0, 'temas': [], 'riscos': []}

    def test_operador_nao_acessa(self, cenario):
        assert _cliente(_usuario('operador', MUN)).get('/api/v1/bi/sugestoes-ia/').status_code == 403
