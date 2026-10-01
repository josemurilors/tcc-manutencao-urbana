"""
Dados públicos do município (contrato v3, seção 7.5): portal de
transparência, dados abertos (CSV/GeoJSON) e Open311 GeoReport v2 (leitura).

Tudo anônimo e sem dado pessoal: nada de nome, e-mail ou id de usuário, nem
descrição livre ou nota interna; chamados 'restrita' e removidos ficam de
fora; coordenadas com 4 casas (~11 m). É o que a LAI pede e o que dá para
linkar do site da prefeitura sem medo.
"""
import json
import logging
from datetime import datetime, timedelta

from django.core.cache import cache
from django.db.models import BooleanField, Exists, ExpressionWrapper, OuterRef, Q
from django.http import StreamingHttpResponse
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from defeitos.models import Defeito, DefeitoAnexo
from users.throttles import IpRealMixin

from . import consultas, planilha

logger = logging.getLogger(__name__)

CACHE_TRANSPARENCIA_S = 600
ULTIMOS_RESOLVIDOS = 10
LIMITE_DADOS_ABERTOS = 100000
OPEN311_LIMITE = 1000
OPEN311_JANELA_DIAS = 90  # padrão da especificação GeoReport v2


class LimitePublico(IpRealMixin, AnonRateThrottle):
    """Endpoints anônimos e pesados: freio por IP sem depender do settings."""
    scope = 'bi_publico'
    rate = '60/min'


class LimiteDadosAbertos(LimitePublico):
    """Exportação completa (até `LIMITE_DADOS_ABERTOS` linhas): freio mais curto."""
    scope = 'bi_dados_abertos'
    rate = '10/min'


def _geojson(linhas):
    """FeatureCollection em pedaços, uma feature por vez (StreamingHttpResponse)."""
    yield '{"type": "FeatureCollection", "features": ['
    primeira = True
    for l in linhas:
        feature = {
            'type': 'Feature',
            'geometry': (
                {'type': 'Point', 'coordinates': [l['longitude'], l['latitude']]}
                if l['latitude'] is not None and l['longitude'] is not None else None
            ),
            'properties': {k: v for k, v in l.items() if k not in ('latitude', 'longitude')},
        }
        yield ('' if primeira else ',') + json.dumps(feature, ensure_ascii=False)
        primeira = False
    yield ']}'


class PublicoView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [LimitePublico]


def _iso(valor):
    return valor.isoformat() if valor else None


def _cache_get(chave):
    # Cache é otimização: com o Redis fora, o portal continua respondendo.
    try:
        return cache.get(chave)
    except Exception:
        logger.warning('cache indisponível ao ler %s', chave, exc_info=True)
        return None


def _cache_set(chave, valor, ttl):
    try:
        cache.set(chave, valor, ttl)
    except Exception:
        logger.warning('cache indisponível ao gravar %s', chave, exc_info=True)


def _nao_encontrado():
    return Response({'detail': 'Município não encontrado.'}, status=404)


# --- transparência -----------------------------------------------------------

def _dias(horas):
    return None if horas is None else round(horas / 24.0, 1)


def montar_transparencia(municipio):
    codigo = municipio['codigo']
    hoje = consultas.hoje()
    escopo_90 = consultas.Escopo(municipio_id=codigo, inicio=hoje - timedelta(days=89), fim=hoje)
    k = consultas.kpis(escopo_90)

    from categorias.models import Categoria
    icones = dict(Categoria.objects.values_list('id', 'icone'))
    por_categoria = []
    for linha in consultas.distribuicao(escopo_90, 'categoria'):
        if not (linha['recebidos'] or linha['resolvidos']):
            continue
        cat_id = int(linha['chave']) if linha['chave'].isdigit() else None
        por_categoria.append({
            'categoria': linha['rotulo'],
            'icone': icones.get(cat_id, ''),
            'recebidos': linha['recebidos'],
            'resolvidos': linha['resolvidos'],
            'tempo_mediano_dias': _dias(linha['lead_time_p50_h']),
            'pct_no_prazo': linha['pct_no_prazo'],
        })

    # Doze meses civis, o corrente incluso.
    primeiro = hoje.replace(day=1)
    for _ in range(11):
        primeiro = (primeiro - timedelta(days=1)).replace(day=1)
    escopo_12m = consultas.Escopo(municipio_id=codigo, inicio=primeiro, fim=hoje)
    serie_mensal = [
        {'mes': p['periodo'], 'recebidos': p['recebidos'], 'resolvidos': p['resolvidos']}
        for p in consultas.serie(escopo_12m, 'mes')
    ]

    foto_depois = DefeitoAnexo.objects.filter(defeito=OuterRef('pk'), tipo='depois')
    ultimos = (
        Defeito.objects.ativos()
        .filter(municipio_id=codigo, status='concluido', visibilidade=Defeito.VISIBILIDADE_PUBLICA,
                resolvido_em__isnull=False)
        .annotate(
            tem_anexo_depois=Exists(foto_depois),
            tem_foto_resolucao=ExpressionWrapper(Q(foto_resolucao__isnull=False), output_field=BooleanField()),
        )
        .only('id', 'protocolo', 'titulo', 'categoria', 'bairro', 'resolvido_em')
        .order_by('-resolvido_em')[:ULTIMOS_RESOLVIDOS]
    )
    return {
        'municipio': {'codigo': codigo, 'nome': municipio['nome'], 'uf_sigla': municipio['uf_sigla']},
        'contratado': bool(municipio['contratado']),
        'kpis_90d': {
            'recebidos': k['recebidos'],
            'resolvidos': k['resolvidos'],
            'pct_no_prazo': k['pct_no_prazo'],
            'tempo_mediano_dias': _dias(k['lead_time_p50_h']),
            'csat_media': k['csat_media'],
        },
        'por_categoria': por_categoria,
        'serie_mensal': serie_mensal,
        'ultimos_resolvidos': [
            {
                'id': str(d.id),
                'protocolo': d.protocolo,
                'titulo': d.titulo,
                'categoria': d.categoria,
                'bairro': d.bairro,
                'resolvido_em': _iso(d.resolvido_em),
                'tem_foto_depois': bool(d.tem_anexo_depois or d.tem_foto_resolucao),
            }
            for d in ultimos
        ],
        'atualizado_em': timezone.now().isoformat(),
    }


class TransparenciaView(PublicoView):
    def get(self, request, codigo):
        chave = f'bi:transparencia:{codigo}'
        dados = _cache_get(chave)
        if dados is None:
            municipio = consultas.municipio_publico(codigo)
            if municipio is None:
                return _nao_encontrado()
            dados = montar_transparencia(municipio)
            _cache_set(chave, dados, CACHE_TRANSPARENCIA_S)
        return Response(dados)


# --- dados abertos -----------------------------------------------------------

COLUNAS_DADOS_ABERTOS = (
    'protocolo', 'categoria', 'status', 'situacao', 'orgao_responsavel', 'bairro', 'rua',
    'latitude', 'longitude', 'criado_em', 'prazo_em', 'resolvido_em', 'no_prazo', 'total_apoios',
)


def _periodo_publico(request):
    """`inicio`/`fim` opcionais (AAAA-MM-DD, `fim` inclusivo) sobre a data de abertura."""
    from datetime import date
    inicio = fim = None
    try:
        if request.query_params.get('inicio'):
            inicio = consultas.inicio_do_dia(date.fromisoformat(request.query_params['inicio']))
        if request.query_params.get('fim'):
            fim = consultas.inicio_do_dia(date.fromisoformat(request.query_params['fim']) + timedelta(days=1))
    except ValueError:
        return None, None, 'Datas no formato AAAA-MM-DD.'
    return inicio, fim, None


def _linha_aberta(linha):
    return {
        'protocolo': linha['protocolo'],
        'categoria': linha['categoria'],
        'status': linha['status'],
        'situacao': linha['situacao'],
        'orgao_responsavel': linha['orgao_responsavel'] or '',
        'bairro': linha['bairro'] or '',
        'rua': linha['rua'] or '',
        'latitude': linha['latitude'],
        'longitude': linha['longitude'],
        'criado_em': _iso(linha['criado_em']),
        'prazo_em': _iso(linha['prazo_em']),
        'resolvido_em': _iso(linha['resolvido_em']),
        'no_prazo': linha['no_prazo'],
        'total_apoios': linha['total_apoios'],
    }


class DadosAbertosView(PublicoView):
    throttle_classes = [LimiteDadosAbertos]

    def get(self, request, codigo, formato):
        if consultas.municipio_publico(codigo) is None:
            return _nao_encontrado()
        inicio, fim, erro = _periodo_publico(request)
        if erro:
            return Response({'detail': erro}, status=400)
        linhas = (
            _linha_aberta(l) for l in consultas.chamados_publicos(
                codigo, inicio=inicio, fim=fim, limite=LIMITE_DADOS_ABERTOS)
        )
        if formato == 'csv':
            resposta = StreamingHttpResponse(
                planilha.gerar_csv(COLUNAS_DADOS_ABERTOS, linhas),
                content_type='text/csv; charset=utf-8',
            )
        else:
            resposta = StreamingHttpResponse(
                _geojson(linhas), content_type='application/geo+json; charset=utf-8',
            )
        resposta['Content-Disposition'] = f'attachment; filename="chamados-{codigo}.{formato}"'
        # Dado aberto é para ser consumido de qualquer origem (painéis de terceiros).
        resposta['Access-Control-Allow-Origin'] = '*'
        return resposta


# --- Open311 GeoReport v2 (leitura) ------------------------------------------

def _erro_open311(codigo_http, descricao):
    # Formato de erro da especificação: lista de {code, description}.
    return Response([{'code': codigo_http, 'description': descricao}], status=codigo_http)


def _jurisdicao(request):
    codigo = (request.query_params.get('jurisdiction_id') or '').strip()
    if not codigo:
        return None, _erro_open311(400, 'jurisdiction_id (código IBGE do município) é obrigatório.')
    municipio = consultas.municipio_publico(codigo)
    if municipio is None:
        return None, _erro_open311(404, 'jurisdiction_id não encontrado.')
    return municipio, None


class Open311ServicesView(PublicoView):
    def get(self, request):
        municipio, erro = _jurisdicao(request)
        if erro:
            return erro
        from categorias.models import Categoria
        from gestao.models import CategoriaMunicipio
        desativadas = set(
            CategoriaMunicipio.objects.filter(municipio_id=municipio['codigo'], ativo=False)
            .values_list('categoria_id', flat=True)
        )
        prazos = dict(
            CategoriaMunicipio.objects.filter(municipio_id=municipio['codigo'], ativo=True,
                                              prazo_sla_dias__isnull=False)
            .values_list('categoria_id', 'prazo_sla_dias')
        )
        servicos = []
        for c in Categoria.objects.order_by('nome'):
            if c.id in desativadas:
                continue
            prazo = prazos.get(c.id) or c.prazo_sla_dias
            servicos.append({
                'service_code': str(c.id),
                'service_name': c.nome,
                'description': f'Prazo de atendimento: {prazo} dia(s).' if prazo else '',
                'metadata': False,
                'type': 'realtime',
                'keywords': '',
                'group': '',
            })
        return Response(servicos)


def _request_open311(linha):
    atualizado = linha['atualizado_em'] or linha['criado_em']
    return {
        'service_request_id': linha['protocolo'],
        'status': 'open' if linha['aberto'] else 'closed',
        'status_notes': linha['resposta_publica'] or linha['situacao'],
        'service_name': linha['categoria'],
        'service_code': str(linha['categoria_id']) if linha['categoria_id'] else '',
        'description': linha['titulo'],
        'agency_responsible': linha['orgao_responsavel'] or '',
        'service_notice': '',
        'requested_datetime': _iso(linha['criado_em']),
        'updated_datetime': _iso(atualizado),
        'expected_datetime': _iso(linha['prazo_em']),
        'address': ', '.join(p for p in (linha['rua'], linha['bairro']) if p),
        'address_id': '',
        'zipcode': '',
        'lat': linha['latitude'],
        'long': linha['longitude'],
        'media_url': '',
    }


def _instante(valor):
    dt = parse_datetime(valor)
    if dt is None:
        try:
            dt = datetime.fromisoformat(valor)
        except ValueError:
            return None
    if timezone.is_naive(dt):
        dt = timezone.make_aware(dt, consultas.fuso())
    return dt


class Open311RequestsView(PublicoView):
    def get(self, request):
        municipio, erro = _jurisdicao(request)
        if erro:
            return erro
        qp = request.query_params
        protocolos = [p.strip() for p in (qp.get('service_request_id') or '').split(',') if p.strip()]
        codigos = [c.strip() for c in (qp.get('service_code') or '').split(',') if c.strip()]
        if any(not c.isdigit() for c in codigos):
            return _erro_open311(400, 'service_code inválido.')
        situacao = (qp.get('status') or '').strip().lower() or None
        if situacao not in (None, 'open', 'closed'):
            return _erro_open311(400, 'status deve ser open ou closed.')

        inicio = fim = None
        if qp.get('start_date'):
            inicio = _instante(qp['start_date'])
            if inicio is None:
                return _erro_open311(400, 'start_date inválido (use ISO 8601).')
        if qp.get('end_date'):
            fim = _instante(qp['end_date'])
            if fim is None:
                return _erro_open311(400, 'end_date inválido (use ISO 8601).')
        # Sem filtro de data nem de id, a especificação manda os últimos 90 dias.
        if not protocolos and inicio is None and fim is None:
            inicio = timezone.now() - timedelta(days=OPEN311_JANELA_DIAS)

        linhas = consultas.chamados_publicos(
            municipio['codigo'], inicio=inicio, fim=fim, protocolos=protocolos or None,
            categoria_ids=[int(c) for c in codigos] or None, situacao=situacao,
            limite=OPEN311_LIMITE,
        )
        return Response([_request_open311(l) for l in linhas])


class Open311RequestView(PublicoView):
    """`requests/<id>.json`: um chamado pelo protocolo (sempre lista, como na especificação)."""

    def get(self, request, protocolo):
        municipio, erro = _jurisdicao(request)
        if erro:
            return erro
        linhas = list(consultas.chamados_publicos(municipio['codigo'], protocolos=[protocolo], limite=1))
        if not linhas:
            return _erro_open311(404, 'service_request_id não encontrado.')
        return Response([_request_open311(linhas[0])])
