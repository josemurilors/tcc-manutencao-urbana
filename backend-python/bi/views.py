"""
BI da gestão — `api/v1/bi/` (contrato v3, seção 7.4). Gestor+.

O município é sempre o do usuário; só o super admin escolhe outro com
`?municipio=`. Um gestor que tente apontar para outra cidade leva 403 em vez
de ver, em silêncio, a própria — assim o erro de integração aparece.
"""
from datetime import date, timedelta

from django.http import HttpResponse, StreamingHttpResponse
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.utils.urls import replace_query_param
from rest_framework.views import APIView

from core import auditoria, permissoes
from core.permissoes import EhGestor
from defeitos import fluxo

from . import consultas, planilha, relatorio

# Teto do período: dois anos cobrem "este ano × o anterior" e mantêm a
# série diária num tamanho que o app desenha.
MAX_DIAS_PERIODO = 731
PERIODO_PADRAO_DIAS = 30


def _data(valor, nome):
    try:
        return date.fromisoformat(valor)
    except (TypeError, ValueError):
        raise ValidationError({'detail': f'"{nome}" deve estar no formato AAAA-MM-DD.'})


def _inteiro(valor, nome):
    if valor in (None, ''):
        return None
    try:
        return int(valor)
    except (TypeError, ValueError):
        raise ValidationError({'detail': f'"{nome}" deve ser um número inteiro.'})


def _recorte(valor, nome, aceita_nome=False):
    """
    Filtro por id: o número, `nenhum` (o grupo "sem ...") ou, em categoria e
    secretaria, `nome:<texto>` dos chamados antigos — as chaves que
    `distribuicao/` devolve voltam como filtro sem tradução no app.
    """
    valor = (valor or '').strip()
    if not valor:
        return None
    if valor == consultas.SEM:
        return valor
    if aceita_nome and valor.startswith(consultas.PREFIXO_NOME):
        texto = valor[len(consultas.PREFIXO_NOME):].strip().lower()
        if texto:
            return consultas.PREFIXO_NOME + texto
    return _inteiro(valor, nome)


def municipio_do_pedido(request):
    user = request.user
    pedido = (request.query_params.get('municipio') or '').strip()
    if permissoes.papel(user) == 'super_admin':
        municipio = pedido or user.municipio_id
        if not municipio:
            raise ValidationError({'detail': 'Informe ?municipio=<código IBGE>.'})
    else:
        municipio = user.municipio_id
        if not municipio:
            raise PermissionDenied('Sua conta não está vinculada a um município.')
        if pedido and pedido != str(municipio):
            raise PermissionDenied('Você só acessa os indicadores do seu município.')
    if not permissoes.pode_gerir(user, municipio):
        raise PermissionDenied('Permissão negada')
    return str(municipio)


def escopo_do_pedido(request):
    """Município + período (`inicio`/`fim`, padrão últimos 30 dias) + filtros comuns."""
    qp = request.query_params
    fim = _data(qp['fim'], 'fim') if qp.get('fim') else consultas.hoje()
    if qp.get('inicio'):
        inicio = _data(qp['inicio'], 'inicio')
    else:
        inicio = fim - timedelta(days=PERIODO_PADRAO_DIAS - 1)
    if inicio > fim:
        raise ValidationError({'detail': '"inicio" não pode ser depois de "fim".'})
    if (fim - inicio).days + 1 > MAX_DIAS_PERIODO:
        raise ValidationError({'detail': f'O período pode ter no máximo {MAX_DIAS_PERIODO} dias.'})
    return consultas.Escopo(
        municipio_id=municipio_do_pedido(request),
        inicio=inicio,
        fim=fim,
        categoria_id=_recorte(qp.get('categoria_id'), 'categoria_id', aceita_nome=True),
        secretaria_id=_recorte(qp.get('secretaria_id'), 'secretaria_id', aceita_nome=True),
        equipe_id=_recorte(qp.get('equipe_id'), 'equipe_id'),
        bairro=(qp.get('bairro') or '').strip() or None,
    )


def _filtros_para_auditoria(escopo):
    return {
        'inicio': escopo.inicio.isoformat(), 'fim': escopo.fim.isoformat(),
        'categoria_id': escopo.categoria_id, 'secretaria_id': escopo.secretaria_id,
        'equipe_id': escopo.equipe_id, 'bairro': escopo.bairro,
    }


class BiView(APIView):
    permission_classes = [EhGestor]


class KpisView(BiView):
    def get(self, request):
        escopo = escopo_do_pedido(request)
        resposta = {
            'periodo': escopo.periodo(),
            'anterior': None,
            'kpis': consultas.kpis(escopo),
            'kpis_anterior': None,
        }
        if request.query_params.get('comparar') in ('1', 'true', 'sim'):
            anterior = escopo.anterior()
            resposta['anterior'] = anterior.periodo()
            resposta['kpis_anterior'] = consultas.kpis(anterior)
        return Response(resposta)


class SeriesView(BiView):
    def get(self, request):
        escopo = escopo_do_pedido(request)
        granularidade = request.query_params.get('granularidade') or 'dia'
        if granularidade not in consultas.GRANULARIDADES:
            raise ValidationError({'detail': 'granularidade deve ser dia, semana ou mes.'})
        return Response(consultas.serie(escopo, granularidade))


class DistribuicaoView(BiView):
    def get(self, request):
        escopo = escopo_do_pedido(request)
        dimensao = request.query_params.get('dimensao') or 'categoria'
        if dimensao not in consultas.DIMENSOES:
            raise ValidationError({'detail': 'dimensao deve ser categoria, bairro, secretaria, equipe ou status.'})
        return Response(consultas.distribuicao(escopo, dimensao))


class AgingView(BiView):
    def get(self, request):
        return Response(consultas.aging(escopo_do_pedido(request)))


class ProdutividadeView(BiView):
    def get(self, request):
        return Response(consultas.produtividade(escopo_do_pedido(request)))


class HotspotsView(BiView):
    def get(self, request):
        return Response(consultas.hotspots(escopo_do_pedido(request)))


class SatisfacaoView(BiView):
    def get(self, request):
        return Response(consultas.satisfacao(escopo_do_pedido(request)))


class ChamadosView(BiView):
    """
    Drill-down: os chamados por trás de um número do painel, com os mesmos
    filtros e a mesma regra de contagem (`recorte`), paginados.
    """
    TAMANHO_PADRAO = 20
    TAMANHO_MAX = 100

    def get(self, request):
        escopo = escopo_do_pedido(request)
        qp = request.query_params
        recorte = qp.get('recorte') or 'abertos'
        if recorte not in consultas.RECORTES_LISTA:
            raise ValidationError({'detail': 'recorte deve ser ' + ', '.join(consultas.RECORTES_LISTA) + '.'})
        status = (qp.get('status') or '').strip() or None
        if status and status not in fluxo.TRANSICOES:
            raise ValidationError({'detail': f'Status desconhecido: {status}.'})
        pagina = _inteiro(qp.get('page'), 'page')
        pagina = 1 if pagina is None else pagina
        tamanho = _inteiro(qp.get('page_size'), 'page_size')
        tamanho = self.TAMANHO_PADRAO if tamanho is None else tamanho
        if pagina < 1 or not 1 <= tamanho <= self.TAMANHO_MAX:
            raise ValidationError({'detail': f'page deve ser >= 1 e page_size entre 1 e {self.TAMANHO_MAX}.'})
        total, itens = consultas.chamados(
            escopo, recorte, status, limite=tamanho, deslocamento=(pagina - 1) * tamanho)
        url = request.build_absolute_uri()
        return Response({
            'count': total,
            'next': replace_query_param(url, 'page', pagina + 1) if pagina * tamanho < total else None,
            'previous': replace_query_param(url, 'page', pagina - 1) if pagina > 1 else None,
            'results': itens,
        })


class ExportarView(BiView):
    """Uma linha por chamado recebido no período, sem dado pessoal de cidadão."""

    def get(self, request):
        escopo = escopo_do_pedido(request)
        formato = (request.query_params.get('formato') or 'csv').lower()
        if formato not in ('csv', 'xlsx'):
            raise ValidationError({'detail': 'formato deve ser csv ou xlsx.'})
        nome = f'chamados-{escopo.municipio_id}-{escopo.inicio:%Y%m%d}-{escopo.fim:%Y%m%d}.{formato}'
        colunas = consultas.COLUNAS_EXPORTACAO
        # Exportação em massa é tratamento de dado público em lote: fica na
        # trilha de auditoria (quem, quando, quais filtros).
        auditoria.registrar(request, 'bi.exportar', 'municipio', escopo.municipio_id,
                            dados={'formato': formato, **_filtros_para_auditoria(escopo)},
                            municipio_id=escopo.municipio_id)
        if formato == 'csv':
            resposta = StreamingHttpResponse(
                planilha.gerar_csv(colunas, consultas.linhas_exportacao(escopo)),
                content_type='text/csv; charset=utf-8',
            )
        else:
            resposta = HttpResponse(
                planilha.gerar_xlsx(colunas, consultas.linhas_exportacao(escopo)),
                content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            )
        resposta['Content-Disposition'] = f'attachment; filename="{nome}"'
        return resposta


class RelatorioView(BiView):
    """PDF do mês (`mes=AAAA-MM`; padrão: o mês anterior, o último fechado)."""

    def get(self, request):
        escopo = escopo_do_pedido(request)
        mes_param = request.query_params.get('mes')
        if mes_param:
            try:
                ano, mes = (int(p) for p in mes_param.split('-'))
                date(ano, mes, 1)
            except (TypeError, ValueError):
                raise ValidationError({'detail': '"mes" deve estar no formato AAAA-MM.'})
        else:
            ano, mes = relatorio.mes_anterior(consultas.hoje().year, consultas.hoje().month)
        municipio = consultas.municipio_publico(escopo.municipio_id) or {'codigo': escopo.municipio_id}
        pdf = relatorio.gerar_relatorio_mensal(
            escopo, ano, mes, municipio, consultas.rotulos_dos_filtros(escopo))
        auditoria.registrar(request, 'bi.relatorio', 'municipio', escopo.municipio_id,
                            dados={'mes': f'{ano:04d}-{mes:02d}', **_filtros_para_auditoria(escopo)},
                            municipio_id=escopo.municipio_id)
        resposta = HttpResponse(pdf, content_type='application/pdf')
        resposta['Content-Disposition'] = (
            f'attachment; filename="relatorio-{escopo.municipio_id}-{ano:04d}-{mes:02d}.pdf"'
        )
        return resposta
