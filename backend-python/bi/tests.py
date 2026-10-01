"""
Testes do BI e dos dados públicos com uma base sintética de números conhecidos.

Período de referência: março de 2026 (já encerrado, então o corte do
backlog é 01/04 00:00 em Brasília). Cada chamado abaixo existe para exercitar
uma regra; os comentários dizem qual.
"""
import csv
import io
import json
import uuid
import zipfile
from datetime import datetime, timedelta
from xml.etree import ElementTree
from zoneinfo import ZoneInfo

import pytest
from django.db import connection
from django.utils import timezone
from rest_framework.test import APIClient

from categorias.models import Categoria
from defeitos.models import Apoio, Defeito, DefeitoAnexo, DefeitoEvento
from users.models import User

SP = ZoneInfo('America/Sao_Paulo')
MUN = '9999801'
OUTRO_MUN = '9999802'
MUN_PUBLICO = '9999803'

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _sem_cache(settings):
    # O cache real é o Redis compartilhado: entre testes ele devolveria a
    # transparência de outro cenário (e o throttle contaria pedidos).
    settings.CACHES = {'default': {'BACKEND': 'django.core.cache.backends.dummy.DummyCache'}}


def _dt(mes, dia, hora=12):
    return datetime(2026, mes, dia, hora, tzinfo=SP)


def _municipio(codigo, nome):
    with connection.cursor() as cur:
        cur.execute("""
            INSERT INTO municipios (codigo, nome, uf, uf_sigla, min_lat, max_lat, min_lng, max_lng, polygon_geom)
            VALUES (%s, %s, '35', 'SP', -24.0, -23.0, -47.0, -44.0,
                    ST_Multi(ST_GeomFromText('POLYGON((-47 -24, -44 -24, -44 -23, -47 -23, -47 -24))', 4326)))
            ON CONFLICT (codigo) DO NOTHING
        """, [codigo, nome])


def _usuario(papel='cidadao', municipio=None, nome=None):
    uid = uuid.uuid4().hex[:8]
    return User.objects.create_user(
        f'bi-{uid}@example.com', nome or f'Usuário {uid}', 'Test@123456',
        papel=papel, municipio_id=municipio,
    )


def _cliente(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


def _cat(nome):
    return Categoria.objects.get(nome=nome).id


def _chamado(criado_em, *, municipio=MUN, categoria='Buraco', **campos):
    dados = {
        'titulo': f'Chamado {uuid.uuid4().hex[:6]}',
        'categoria': categoria,
        'categoria_id': _cat(categoria),
        'municipio_id': municipio,
        'criado_em': criado_em,
        'atualizado_em': campos.pop('atualizado_em', criado_em),
        'latitude': -23.5,
        'longitude': -46.6,
        'bairro': 'Jardim',
        'rua': 'Rua B',
        'status': 'pendente',
    }
    dados.update(campos)
    return Defeito.objects.create(**dados)


@pytest.fixture
def base():
    """
    Março/2026 no município MUN — números esperados:
      recebidos 4 (A, B, C, D); resolvidos 3 (A, B, J); rejeitados 1 (F);
      backlog no fim 4 (C, D, E, G), vencido 2 (C, E);
      lead time 48 h, 168 h, 670 h -> P50 168, P90 569,6;
      no prazo 1 de 2 com prazo (J não tem prazo) -> 50%;
      1ª resposta: A 2 h (triagem), B 1 h (evento público), D 6 h -> P50 2;
      reabertura 1/3; CSAT 5 e 2 -> 3,5; cidadãos ativos 3.
    """
    _municipio(MUN, 'Cidade BI')
    _municipio(OUTRO_MUN, 'Outra Cidade')
    cid1, cid2, cid3 = _usuario(), _usuario(), _usuario()
    operador = _usuario('operador', MUN, nome='Olga Operadora')
    gestor = _usuario('gestor', MUN, nome='Gil Gestor')

    a = _chamado(_dt(3, 2, 10), usuario=cid1, status='concluido', bairro='Centro', rua='Rua A',
                 prazo_em=_dt(3, 9), triado_em=_dt(3, 2, 12), resolvido_em=_dt(3, 4, 10),
                 fechado_em=_dt(3, 4, 10), atendente=operador, avaliacao_nota=5,
                 avaliacao_comentario='Ótimo, resolveram rápido', avaliado_em=_dt(3, 5))
    b = _chamado(_dt(3, 3, 8), usuario=cid1, status='concluido', bairro='Centro', rua='Rua A',
                 prazo_em=_dt(3, 5, 8), resolvido_em=_dt(3, 10, 8), fechado_em=_dt(3, 10, 8),
                 reaberturas=1, avaliacao_nota=2, avaliado_em=_dt(3, 11))
    DefeitoEvento.objects.create(defeito=b, tipo='resposta_publica', papel='operador', publico=True,
                                 texto='Equipe a caminho', criado_em=_dt(3, 3, 9))
    # Nota interna não conta como resposta ao cidadão.
    DefeitoEvento.objects.create(defeito=b, tipo='nota_interna', papel='operador', publico=False,
                                 criado_em=_dt(3, 3, 8, ) + timedelta(minutes=5))
    c = _chamado(_dt(3, 5), usuario=cid2, categoria='Iluminação', prazo_em=_dt(3, 6),
                 latitude=-23.4, longitude=-46.5)
    Apoio.objects.create(usuario=cid3, defeito=c, criado_em=_dt(3, 6))
    d = _chamado(_dt(3, 20), status='em_andamento', prazo_em=_dt(4, 30), triado_em=_dt(3, 20, 18),
                 atendente=operador, latitude=-23.3, longitude=-46.4)
    # Antes do período, ainda aberto e vencido.
    _chamado(_dt(2, 10), prazo_em=_dt(2, 12), latitude=-23.2, longitude=-46.3)
    # Rejeitado em março (aberto em fevereiro).
    _chamado(_dt(2, 15), status='rejeitado', motivo_rejeicao='improcedente', fechado_em=_dt(3, 3))
    # Resolvido só em abril: no fim de março estava aberto.
    _chamado(_dt(2, 25), categoria='Iluminação', status='concluido', resolvido_em=_dt(4, 2),
             fechado_em=_dt(4, 2))
    # Removido (soft delete) e de outro município: fora de tudo.
    _chamado(_dt(3, 15), removido_em=_dt(3, 16))
    _chamado(_dt(3, 10), municipio=OUTRO_MUN)
    # Resolvido em março, aberto em fevereiro, sem prazo de SLA.
    _chamado(_dt(2, 1), status='concluido', resolvido_em=_dt(3, 1, 10), fechado_em=_dt(3, 1, 10))
    return {'gestor': gestor, 'operador': operador, 'cidadao': cid1, 'a': a, 'b': b, 'c': c, 'd': d}


MARCO = {'inicio': '2026-03-01', 'fim': '2026-03-31'}


class TestKpis:
    def test_numeros_do_periodo(self, base):
        resp = _cliente(base['gestor']).get('/api/v1/bi/kpis/', MARCO)
        assert resp.status_code == 200, resp.data
        k = resp.data['kpis']
        assert resp.data['periodo'] == {'inicio': '2026-03-01', 'fim': '2026-03-31'}
        assert resp.data['anterior'] is None and resp.data['kpis_anterior'] is None
        assert k['recebidos'] == 4
        assert k['resolvidos'] == 3
        assert k['rejeitados'] == 1
        assert k['backlog'] == 4
        assert k['backlog_vencido'] == 2
        assert k['pct_no_prazo'] == 50.0
        assert k['lead_time_p50_h'] == 168.0
        assert k['lead_time_p90_h'] == 569.6
        assert k['primeira_resposta_p50_h'] == 2.0
        assert k['taxa_resolucao'] == 50.0
        assert k['reabertura_pct'] == 33.3
        assert k['csat_media'] == 3.5
        assert k['csat_respostas'] == 2
        assert k['cidadaos_ativos'] == 3

    def test_comparacao_com_periodo_anterior_de_mesmo_tamanho(self, base):
        resp = _cliente(base['gestor']).get('/api/v1/bi/kpis/', {**MARCO, 'comparar': '1'})
        assert resp.data['anterior'] == {'inicio': '2026-01-29', 'fim': '2026-02-28'}
        ant = resp.data['kpis_anterior']
        # Abertos em fevereiro: E, F, G e J; nenhum fechado até 28/02.
        assert ant['recebidos'] == 4
        assert ant['resolvidos'] == 0
        assert ant['rejeitados'] == 0
        assert ant['backlog'] == 4
        assert ant['lead_time_p50_h'] is None
        assert ant['pct_no_prazo'] is None

    def test_filtros(self, base):
        g = _cliente(base['gestor'])
        k = g.get('/api/v1/bi/kpis/', {**MARCO, 'bairro': ' centro '}).data['kpis']
        assert (k['recebidos'], k['resolvidos'], k['backlog']) == (2, 2, 0)
        k = g.get('/api/v1/bi/kpis/', {**MARCO, 'categoria_id': _cat('Iluminação')}).data['kpis']
        assert (k['recebidos'], k['resolvidos'], k['backlog'], k['backlog_vencido']) == (1, 0, 2, 1)

    def test_periodo_padrao_e_validacao(self, base):
        g = _cliente(base['gestor'])
        resp = g.get('/api/v1/bi/kpis/')
        assert resp.status_code == 200
        ini = datetime.fromisoformat(resp.data['periodo']['inicio'])
        fim = datetime.fromisoformat(resp.data['periodo']['fim'])
        assert (fim - ini).days == 29
        assert g.get('/api/v1/bi/kpis/', {'inicio': '2026-04-01', 'fim': '2026-03-01'}).status_code == 400
        assert g.get('/api/v1/bi/kpis/', {'inicio': '01/03/2026'}).status_code == 400
        assert g.get('/api/v1/bi/kpis/', {'inicio': '2020-01-01', 'fim': '2026-01-01'}).status_code == 400
        assert g.get('/api/v1/bi/kpis/', {'categoria_id': 'x'}).status_code == 400


class TestPermissoes:
    def test_cidadao_e_operador_nao_veem(self, base):
        assert _cliente(base['cidadao']).get('/api/v1/bi/kpis/').status_code == 403
        assert _cliente(base['operador']).get('/api/v1/bi/kpis/').status_code == 403
        assert APIClient().get('/api/v1/bi/kpis/').status_code == 401

    def test_gestor_nao_le_outro_municipio(self, base):
        resp = _cliente(base['gestor']).get('/api/v1/bi/kpis/', {'municipio': OUTRO_MUN})
        assert resp.status_code == 403
        assert 'detail' in resp.data

    def test_gestor_sem_municipio(self, base):
        assert _cliente(_usuario('gestor', None)).get('/api/v1/bi/kpis/').status_code == 403

    def test_super_admin_escolhe_municipio(self, base):
        sa = _cliente(_usuario('super_admin', None))
        assert sa.get('/api/v1/bi/kpis/', MARCO).status_code == 400
        resp = sa.get('/api/v1/bi/kpis/', {**MARCO, 'municipio': MUN})
        assert resp.status_code == 200
        assert resp.data['kpis']['recebidos'] == 4
        resp = sa.get('/api/v1/bi/kpis/', {**MARCO, 'municipio': OUTRO_MUN})
        assert resp.data['kpis']['recebidos'] == 1


class TestSeries:
    def test_semanal_com_buckets_cortados_no_periodo(self, base):
        resp = _cliente(base['gestor']).get('/api/v1/bi/series/', {**MARCO, 'granularidade': 'semana'})
        assert resp.status_code == 200
        por = {p['periodo']: p for p in resp.data}
        assert list(por) == ['2026-03-01', '2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23', '2026-03-30']
        assert [p['recebidos'] for p in resp.data] == [0, 3, 0, 1, 0, 0]
        assert [p['resolvidos'] for p in resp.data] == [1, 1, 1, 0, 0, 0]
        # Fim do 1º bucket (02/03 00:00): E, F (rejeitado só em 03/03) e G.
        assert por['2026-03-01']['backlog'] == 3
        assert por['2026-03-30']['backlog'] == 4

    def test_diaria_preenche_zeros(self, base):
        resp = _cliente(base['gestor']).get('/api/v1/bi/series/', {**MARCO, 'granularidade': 'dia'})
        assert len(resp.data) == 31
        assert sum(p['recebidos'] for p in resp.data) == 4
        assert resp.data[0]['periodo'] == '2026-03-01'

    def test_mensal(self, base):
        resp = _cliente(base['gestor']).get(
            '/api/v1/bi/series/', {'inicio': '2026-02-01', 'fim': '2026-03-31', 'granularidade': 'mes'})
        assert [(p['periodo'], p['recebidos'], p['resolvidos']) for p in resp.data] == [
            ('2026-02', 4, 0), ('2026-03', 4, 3)]

    def test_granularidade_invalida(self, base):
        assert _cliente(base['gestor']).get('/api/v1/bi/series/', {'granularidade': 'ano'}).status_code == 400


class TestDistribuicao:
    def test_por_categoria(self, base):
        resp = _cliente(base['gestor']).get('/api/v1/bi/distribuicao/', {**MARCO, 'dimensao': 'categoria'})
        por = {l['rotulo']: l for l in resp.data}
        assert por['Buraco'] == {
            'chave': str(_cat('Buraco')), 'rotulo': 'Buraco', 'recebidos': 3, 'abertos': 2,
            'resolvidos': 3, 'vencidos': 1, 'pct_no_prazo': 50.0, 'lead_time_p50_h': 168.0,
        }
        assert por['Iluminação']['recebidos'] == 1
        assert por['Iluminação']['abertos'] == 2
        assert por['Iluminação']['vencidos'] == 1
        assert por['Iluminação']['lead_time_p50_h'] is None

    def test_por_status_e_bairro(self, base):
        g = _cliente(base['gestor'])
        status = {l['chave']: l for l in g.get('/api/v1/bi/distribuicao/', {**MARCO, 'dimensao': 'status'}).data}
        assert status['concluido']['rotulo'] == 'Concluído'
        assert status['em_andamento']['recebidos'] == 1
        bairros = {l['rotulo']: l for l in g.get('/api/v1/bi/distribuicao/', {**MARCO, 'dimensao': 'bairro'}).data}
        assert bairros['Centro']['recebidos'] == 2
        assert bairros['Jardim']['abertos'] == 4

    def test_dimensao_invalida(self, base):
        assert _cliente(base['gestor']).get('/api/v1/bi/distribuicao/', {'dimensao': 'cpf'}).status_code == 400


class TestAgingProdutividadeHotspotsSatisfacao:
    def test_aging(self, base):
        resp = _cliente(base['gestor']).get('/api/v1/bi/aging/', MARCO)
        assert resp.data == [
            {'faixa': '0-2d', 'total': 0, 'vencidos': 0},
            {'faixa': '3-7d', 'total': 0, 'vencidos': 0},
            {'faixa': '8-15d', 'total': 1, 'vencidos': 0},
            {'faixa': '16-30d', 'total': 1, 'vencidos': 1},
            {'faixa': '>30d', 'total': 2, 'vencidos': 1},
        ]

    def test_produtividade(self, base):
        resp = _cliente(base['gestor']).get('/api/v1/bi/produtividade/', MARCO)
        por = {l['nome']: l for l in resp.data}
        assert por['Olga Operadora']['concluidos'] == 1
        assert por['Olga Operadora']['lead_time_p50_h'] == 48.0
        assert por['Olga Operadora']['em_andamento'] == 1
        assert por['Olga Operadora']['usuario_id'] == str(base['operador'].id)
        assert por['Gil Gestor']['concluidos'] == 0
        assert resp.data[0]['nome'] == 'Olga Operadora'

    def test_hotspots(self, base):
        resp = _cliente(base['gestor']).get('/api/v1/bi/hotspots/', MARCO)
        topo = resp.data['celulas'][0]
        assert topo['total'] == 2 and topo['categoria_top'] == 'Buraco'
        assert abs(topo['lat'] - -23.5) < 0.002 and abs(topo['lng'] - -46.6) < 0.002
        assert sum(c['total'] for c in resp.data['celulas']) == 4
        assert topo['bairro_top'] == 'Centro'
        assert resp.data['reincidencia'] == [
            {'bairro': 'Centro', 'rua': 'Rua A', 'categoria': 'Buraco', 'categoria_id': _cat('Buraco'),
             'ocorrencias': 2}]

    def test_satisfacao(self, base):
        resp = _cliente(base['gestor']).get('/api/v1/bi/satisfacao/', MARCO)
        assert resp.data['media'] == 3.5
        assert resp.data['respostas'] == 2
        assert resp.data['distribuicao'] == {'1': 0, '2': 1, '3': 0, '4': 0, '5': 1}
        assert len(resp.data['comentarios']) == 1
        assert resp.data['comentarios'][0]['protocolo'] == base['a'].protocolo
        assert resp.data['comentarios'][0]['nota'] == 5


class TestRecortes:
    """Chaves da distribuição voltam como filtro (secretaria pela regra da categoria, grupos vazios, legado)."""

    def test_secretaria_pela_regra_da_categoria(self, base):
        from gestao.models import CategoriaMunicipio, Secretaria
        obras = Secretaria.objects.create(municipio_id=MUN, nome='Secretaria de Obras', sigla='SO')
        CategoriaMunicipio.objects.create(municipio_id=MUN, categoria_id=_cat('Buraco'), secretaria=obras)
        g = _cliente(base['gestor'])
        linhas = g.get('/api/v1/bi/distribuicao/', {**MARCO, 'dimensao': 'secretaria'}).data
        por = {l['chave']: l for l in linhas}
        assert por[str(obras.id)]['rotulo'] == 'Secretaria de Obras'
        assert por[str(obras.id)]['recebidos'] == 3
        assert por['nenhum']['rotulo'] == 'Sem secretaria'
        k = g.get('/api/v1/bi/kpis/', {**MARCO, 'secretaria_id': obras.id}).data['kpis']
        assert (k['recebidos'], k['resolvidos']) == (3, 3)
        k = g.get('/api/v1/bi/kpis/', {**MARCO, 'secretaria_id': 'nenhum'}).data['kpis']
        assert k['recebidos'] == 1

    def test_grupo_sem_valor_e_legado_por_nome(self, base):
        g = _cliente(base['gestor'])
        equipes = g.get('/api/v1/bi/distribuicao/', {**MARCO, 'dimensao': 'equipe'}).data
        assert [l['chave'] for l in equipes] == ['nenhum']
        k = g.get('/api/v1/bi/kpis/', {**MARCO, 'equipe_id': 'nenhum'}).data['kpis']
        assert k['recebidos'] == 4
        _chamado(_dt(3, 7), categoria='Buraco', categoria_id=None, secretaria_responsavel='Zeladoria Antiga')
        linhas = g.get('/api/v1/bi/distribuicao/', {**MARCO, 'dimensao': 'secretaria'}).data
        chave = next(l['chave'] for l in linhas if l['rotulo'] == 'Zeladoria Antiga')
        assert chave == 'nome:zeladoria antiga'
        assert g.get('/api/v1/bi/kpis/', {**MARCO, 'secretaria_id': chave}).data['kpis']['recebidos'] == 1
        assert g.get('/api/v1/bi/kpis/', {**MARCO, 'categoria_id': 'nome:buraco'}).data['kpis']['recebidos'] == 1
        assert g.get('/api/v1/bi/kpis/', {**MARCO, 'equipe_id': 'nome:x'}).status_code == 400


class TestChamados:
    def test_lista_bate_com_os_numeros(self, base):
        g = _cliente(base['gestor'])
        url = '/api/v1/bi/chamados/'
        assert g.get(url, MARCO).data['count'] == 4
        vencidos = g.get(url, {**MARCO, 'recorte': 'vencidos'}).data
        assert vencidos['count'] == 2
        assert {c['id'] for c in vencidos['results']} >= {str(base['c'].id)}
        assert g.get(url, {**MARCO, 'recorte': 'recebidos'}).data['count'] == 4
        assert g.get(url, {**MARCO, 'recorte': 'resolvidos'}).data['count'] == 3
        assert g.get(url, {**MARCO, 'recorte': 'rejeitados'}).data['count'] == 1
        r = g.get(url, {**MARCO, 'recorte': 'recebidos', 'status': 'em_andamento'}).data
        assert [c['id'] for c in r['results']] == [str(base['d'].id)]
        item = r['results'][0]
        assert item['status_rotulo'] and item['atendente_nome'] == 'Olga Operadora'
        assert item['categoria_nome'] == 'Buraco'
        bairro = g.get(url, {**MARCO, 'recorte': 'recebidos', 'bairro': 'centro'}).data
        assert bairro['count'] == 2

    def test_paginacao_e_validacao(self, base):
        g = _cliente(base['gestor'])
        url = '/api/v1/bi/chamados/'
        p1 = g.get(url, {**MARCO, 'page_size': 3}).data
        assert len(p1['results']) == 3 and p1['next'] and p1['previous'] is None
        p2 = g.get(url, {**MARCO, 'page_size': 3, 'page': 2}).data
        assert len(p2['results']) == 1 and p2['next'] is None and p2['previous']
        assert not {c['id'] for c in p1['results']} & {c['id'] for c in p2['results']}
        assert g.get(url, {'recorte': 'todos'}).status_code == 400
        assert g.get(url, {'status': 'xyz'}).status_code == 400
        assert g.get(url, {'page': 0}).status_code == 400
        assert _cliente(base['operador']).get(url).status_code == 403


class TestExportacao:
    def test_csv(self, base):
        resp = _cliente(base['gestor']).get('/api/v1/bi/exportar/', {**MARCO, 'formato': 'csv'})
        assert resp.status_code == 200
        assert resp['Content-Type'].startswith('text/csv')
        assert 'attachment' in resp['Content-Disposition']
        corpo = b''.join(resp.streaming_content)
        assert corpo.startswith(b'\xef\xbb\xbf')
        linhas = list(csv.DictReader(io.StringIO(corpo.decode('utf-8-sig')), delimiter=';'))
        assert len(linhas) == 4
        a = next(l for l in linhas if l['protocolo'] == base['a'].protocolo)
        assert a['no_prazo'] == 'sim'
        assert a['lead_time_h'] == '48,0'
        assert a['atendente_nome'] == 'Olga Operadora'
        assert a['criado_em'] == '2026-03-02 10:00'
        texto = corpo.decode('utf-8-sig')
        assert base['cidadao'].email not in texto
        assert base['cidadao'].nome not in texto
        assert 'usuario' not in linhas[0]
        from gestao.models import AuditLog
        assert AuditLog.objects.filter(acao='bi.exportar', municipio_id=MUN).exists()

    def test_xlsx(self, base):
        resp = _cliente(base['gestor']).get('/api/v1/bi/exportar/', {**MARCO, 'formato': 'xlsx'})
        assert resp.status_code == 200
        assert 'spreadsheetml' in resp['Content-Type']
        z = zipfile.ZipFile(io.BytesIO(resp.content))
        assert {'[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml'} <= set(z.namelist())
        for nome in z.namelist():
            ElementTree.fromstring(z.read(nome))  # todo XML bem formado
        ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
        folha = ElementTree.fromstring(z.read('xl/worksheets/sheet1.xml'))
        linhas = folha.findall('.//s:sheetData/s:row', ns)
        assert len(linhas) == 5
        cabecalho = [c.find('.//s:t', ns).text for c in linhas[0]]
        assert cabecalho[0] == 'protocolo' and 'atendente_nome' in cabecalho

    def test_formato_invalido(self, base):
        assert _cliente(base['gestor']).get('/api/v1/bi/exportar/', {'formato': 'pdf'}).status_code == 400


class TestRelatorio:
    def test_pdf_mensal(self, base):
        from pypdf import PdfReader
        resp = _cliente(base['gestor']).get('/api/v1/bi/relatorio/', {'mes': '2026-03'})
        assert resp.status_code == 200
        assert resp['Content-Type'] == 'application/pdf'
        assert resp.content.startswith(b'%PDF')
        leitor = PdfReader(io.BytesIO(resp.content))
        texto = '\n'.join(p.extract_text() for p in leitor.pages)
        assert 'Cidade BI' in texto
        assert 'Março de 2026' in texto
        assert 'Buraco' in texto
        assert 'Chamados recebidos' in texto
        from gestao.models import AuditLog
        assert AuditLog.objects.filter(acao='bi.relatorio', municipio_id=MUN).exists()

    def test_mes_invalido(self, base):
        assert _cliente(base['gestor']).get('/api/v1/bi/relatorio/', {'mes': '2026-13'}).status_code == 400

    def test_mes_padrao_sem_dados(self, base):
        resp = _cliente(base['gestor']).get('/api/v1/bi/relatorio/')
        assert resp.status_code == 200 and resp.content.startswith(b'%PDF')


# --- públicos ----------------------------------------------------------------

CHAVES_PII = ('usuario', 'usuario_id', 'usuario_email', 'email', 'autor', 'autor_id', 'atendente_id',
              'atendente_nome', 'autor_nome')


def _sem_pii(obj):
    if isinstance(obj, dict):
        for k, v in obj.items():
            assert k not in CHAVES_PII, k
            _sem_pii(v)
    elif isinstance(obj, list):
        for v in obj:
            _sem_pii(v)


@pytest.fixture
def publico():
    """Município com dados recentes (as rotas públicas olham os últimos 90 dias)."""
    _municipio(MUN_PUBLICO, 'Cidade Aberta')
    agora = timezone.now()
    autor = _usuario(nome='Maria Cidadã Secreta')
    resolvido = _chamado(agora - timedelta(days=10), municipio=MUN_PUBLICO, usuario=autor,
                         status='concluido', resolvido_em=agora - timedelta(days=8),
                         fechado_em=agora - timedelta(days=8), prazo_em=agora - timedelta(days=5),
                         latitude=-23.123456, longitude=-46.654321, bairro='Vila Nova',
                         descricao='meu telefone é 9999-9999', resposta_publica='Buraco tapado')
    DefeitoAnexo.objects.create(defeito=resolvido, tipo='depois', imagem=b'x')
    aberto = _chamado(agora - timedelta(days=3), municipio=MUN_PUBLICO, usuario=autor,
                      categoria='Iluminação', latitude=-23.2, longitude=-46.7)
    restrito = _chamado(agora - timedelta(days=2), municipio=MUN_PUBLICO, visibilidade='restrita')
    removido = _chamado(agora - timedelta(days=2), municipio=MUN_PUBLICO, removido_em=agora)
    return {'resolvido': resolvido, 'aberto': aberto, 'restrito': restrito, 'removido': removido,
            'autor': autor}


class TestTransparencia:
    def test_portal(self, publico):
        resp = APIClient().get(f'/api/v1/transparencia/{MUN_PUBLICO}/')
        assert resp.status_code == 200
        d = resp.data
        assert d['municipio'] == {'codigo': MUN_PUBLICO, 'nome': 'Cidade Aberta', 'uf_sigla': 'SP'}
        assert d['contratado'] is False
        # Restrito entra no agregado (é um chamado real), mas nunca aparece na lista.
        assert d['kpis_90d']['recebidos'] == 3
        assert d['kpis_90d']['resolvidos'] == 1
        assert d['kpis_90d']['pct_no_prazo'] == 100.0
        assert d['kpis_90d']['tempo_mediano_dias'] == 2.0
        cats = {c['categoria']: c for c in d['por_categoria']}
        assert cats['Buraco']['resolvidos'] == 1 and cats['Buraco']['icone']
        assert len(d['serie_mensal']) == 12
        assert sum(m['recebidos'] for m in d['serie_mensal']) == 3
        assert [u['protocolo'] for u in d['ultimos_resolvidos']] == [publico['resolvido'].protocolo]
        assert d['ultimos_resolvidos'][0]['tem_foto_depois'] is True
        _sem_pii(d)
        assert 'Maria' not in json.dumps(d, default=str)

    def test_municipio_inexistente(self, publico):
        assert APIClient().get('/api/v1/transparencia/0000000/').status_code == 404


class TestDadosAbertos:
    def test_csv_sem_pii_e_coordenada_arredondada(self, publico):
        resp = APIClient().get(f'/api/v1/dados-abertos/{MUN_PUBLICO}/chamados.csv')
        assert resp.status_code == 200
        texto = b''.join(resp.streaming_content).decode('utf-8-sig')
        linhas = list(csv.DictReader(io.StringIO(texto), delimiter=';'))
        assert {l['protocolo'] for l in linhas} == {publico['resolvido'].protocolo, publico['aberto'].protocolo}
        r = next(l for l in linhas if l['protocolo'] == publico['resolvido'].protocolo)
        assert r['latitude'] == '-23,1235' and r['longitude'] == '-46,6543'
        assert r['no_prazo'] == 'sim'
        assert r['situacao'] == 'Resolvido'
        assert 'Maria' not in texto and '9999-9999' not in texto and publico['autor'].email not in texto

    def test_geojson(self, publico):
        resp = APIClient().get(f'/api/v1/dados-abertos/{MUN_PUBLICO}/chamados.geojson')
        assert resp.status_code == 200
        geo = json.loads(resp.content)
        assert geo['type'] == 'FeatureCollection' and len(geo['features']) == 2
        f = next(f for f in geo['features'] if f['properties']['protocolo'] == publico['resolvido'].protocolo)
        assert f['geometry'] == {'type': 'Point', 'coordinates': [-46.6543, -23.1235]}
        _sem_pii(geo)

    def test_filtro_de_periodo_e_404(self, publico):
        hoje = timezone.localtime(timezone.now(), SP).date()
        resp = APIClient().get(f'/api/v1/dados-abertos/{MUN_PUBLICO}/chamados.geojson',
                               {'inicio': (hoje - timedelta(days=5)).isoformat()})
        assert len(json.loads(resp.content)['features']) == 1
        assert APIClient().get(f'/api/v1/dados-abertos/{MUN_PUBLICO}/chamados.geojson',
                               {'inicio': 'ontem'}).status_code == 400
        assert APIClient().get('/api/v1/dados-abertos/0000000/chamados.csv').status_code == 404


class TestOpen311:
    def test_services(self, publico):
        assert APIClient().get('/api/v1/open311/v2/services.json').status_code == 400
        resp = APIClient().get('/api/v1/open311/v2/services.json', {'jurisdiction_id': MUN_PUBLICO})
        assert resp.status_code == 200
        buraco = next(s for s in resp.data if s['service_name'] == 'Buraco')
        assert buraco['service_code'] == str(_cat('Buraco'))
        assert buraco['type'] == 'realtime' and buraco['metadata'] is False

    def test_requests(self, publico):
        c = APIClient()
        resp = c.get('/api/v1/open311/v2/requests.json', {'jurisdiction_id': MUN_PUBLICO})
        assert resp.status_code == 200
        por = {r['service_request_id']: r for r in resp.data}
        assert set(por) == {publico['resolvido'].protocolo, publico['aberto'].protocolo}
        r = por[publico['resolvido'].protocolo]
        assert r['status'] == 'closed' and r['status_notes'] == 'Buraco tapado'
        assert r['lat'] == -23.1235 and r['long'] == -46.6543
        assert por[publico['aberto'].protocolo]['status'] == 'open'
        _sem_pii(resp.data)

        fechados = c.get('/api/v1/open311/v2/requests.json', {'jurisdiction_id': MUN_PUBLICO, 'status': 'closed'})
        assert [r['service_request_id'] for r in fechados.data] == [publico['resolvido'].protocolo]
        ilum = c.get('/api/v1/open311/v2/requests.json',
                     {'jurisdiction_id': MUN_PUBLICO, 'service_code': str(_cat('Iluminação'))})
        assert [r['service_request_id'] for r in ilum.data] == [publico['aberto'].protocolo]
        assert c.get('/api/v1/open311/v2/requests.json',
                     {'jurisdiction_id': MUN_PUBLICO, 'status': 'x'}).status_code == 400

    def test_request_por_protocolo(self, publico):
        c = APIClient()
        protocolo = publico['aberto'].protocolo
        resp = c.get(f'/api/v1/open311/v2/requests/{protocolo}.json', {'jurisdiction_id': MUN_PUBLICO})
        assert resp.status_code == 200 and resp.data[0]['service_request_id'] == protocolo
        restrito = publico['restrito'].protocolo
        assert c.get(f'/api/v1/open311/v2/requests/{restrito}.json',
                     {'jurisdiction_id': MUN_PUBLICO}).status_code == 404
