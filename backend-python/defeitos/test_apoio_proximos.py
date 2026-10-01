"""
Apoios no histórico (evento `apoio`, público e anônimo) e o raio de duplicado
da prefeitura exposto pelo "já reportaram aqui?" (`proximos`).
"""
import itertools

import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from defeitos.models import DefeitoEvento
from defeitos.test_fluxo import CIDADE, _chamado, _cidades, _usuario

pytestmark = pytest.mark.django_db(transaction=True)

# Pontos próprios, longe dos de `test_cidadao.TestProximos` (lng -58.5).
_PONTO = itertools.count()


def _apoiar(cli, defeito_id):
    return cli.post(reverse('defeitos-apoiar', args=[defeito_id]))


def _eventos(cli, defeito_id):
    resp = cli.get(reverse('defeitos-eventos', args=[defeito_id]))
    assert resp.status_code == 200, resp.data
    return resp.data


class TestApoioNoHistorico:

    def test_apoio_vira_evento_publico_sem_nome(self):
        autor_cli, _ = _usuario()
        apoiador_cli, apoiador = _usuario(nome='Joana Apoiadora')
        d = _chamado(autor_cli)

        assert _apoiar(apoiador_cli, d['id']).status_code == 201

        (apoio,) = [e for e in _eventos(autor_cli, d['id']) if e['tipo'] == 'apoio']
        assert apoio['publico'] is True
        assert apoio['autor_nome'] == ''
        # A equipe do município vê quem foi.
        gestor_cli, _ = _usuario('gestor', CIDADE)
        (para_equipe,) = [e for e in _eventos(gestor_cli, d['id']) if e['tipo'] == 'apoio']
        assert para_equipe['autor_nome'] == apoiador.nome

    def test_desfazer_apoio_apaga_o_evento(self):
        autor_cli, _ = _usuario()
        apoiador_cli, _ = _usuario()
        d = _chamado(autor_cli)

        _apoiar(apoiador_cli, d['id'])
        assert _apoiar(apoiador_cli, d['id']).data == {'apoiado': False}

        assert not DefeitoEvento.objects.filter(defeito_id=d['id'], tipo='apoio').exists()

    def test_varios_apoios_um_evento_por_pessoa(self):
        autor_cli, _ = _usuario()
        d = _chamado(autor_cli)
        for _ in range(3):
            cli, _ = _usuario()
            _apoiar(cli, d['id'])

        assert DefeitoEvento.objects.filter(defeito_id=d['id'], tipo='apoio').count() == 3

    def test_autor_apoiando_o_proprio_nao_vira_evento(self):
        autor_cli, _ = _usuario()
        d = _chamado(autor_cli)

        assert _apoiar(autor_cli, d['id']).status_code == 201

        assert not DefeitoEvento.objects.filter(defeito_id=d['id'], tipo='apoio').exists()


class TestRaioDuplicadoNosProximos:
    @pytest.fixture(autouse=True)
    def _ponto(self):
        self.LAT, self.LNG = -29.3 + next(_PONTO) * 0.05, -59.7

    def _proximos(self, **params):
        return APIClient().get(reverse('defeitos-proximos'), {'lat': self.LAT, 'lng': self.LNG, **params})

    def test_expoe_o_raio_da_prefeitura(self):
        from gestao.models import MunicipioConfig
        _cidades()
        cli, _ = _usuario()
        _chamado(cli, latitude=self.LAT + 0.0004, longitude=self.LNG)  # ~44 m

        resp = self._proximos()
        assert resp.data == []
        assert resp['X-Raio-Duplicado-M'] == '30'

        MunicipioConfig.objects.update_or_create(municipio_id=CIDADE, defaults={'raio_duplicado_m': 60})
        try:
            resp = self._proximos()
            (item,) = resp.data
            assert item['raio_duplicado_m'] == 60
            assert resp['X-Raio-Duplicado-M'] == '60'
            assert resp['X-Raio-M'] == '60'
            # ?raio= troca a busca, não o raio de duplicado informado.
            resp = self._proximos(raio=100)
            assert resp.data[0]['raio_duplicado_m'] == 60
            assert resp['X-Raio-M'] == '100'
        finally:
            MunicipioConfig.objects.filter(municipio_id=CIDADE).delete()
