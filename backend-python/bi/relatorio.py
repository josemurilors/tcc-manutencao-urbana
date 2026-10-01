"""
Relatório mensal em PDF (GET /api/v1/bi/relatorio/?mes=AAAA-MM).

Peça de prestação de contas — vai anexada a ofício, à câmara, à ouvidoria —,
então é texto e tabela legíveis em preto e branco, com as definições das
métricas no rodapé. Usa só reportlab (platypus para o fluxo, graphics para o
gráfico de barras): nada de navegador nem de matplotlib na imagem.
"""
import io
from calendar import monthrange
from datetime import date
from xml.sax.saxutils import escape

from django.utils import timezone
from reportlab.graphics.charts.barcharts import VerticalBarChart
from reportlab.graphics.charts.legends import Legend
from reportlab.graphics.shapes import Drawing, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
)

from . import consultas

MESES = (
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
    'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
)

COR_DESTAQUE = colors.HexColor('#1F4E79')
COR_SECUNDARIA = colors.HexColor('#9DB7D5')
COR_GRADE = colors.HexColor('#C9CED6')
COR_FUNDO_CABECALHO = colors.HexColor('#E8EDF3')

# (chave do KPI, rótulo, formato, maior é melhor?) — o "melhor" decide a
# palavra da variação, para o leitor não ter de adivinhar se subir é bom.
KPIS_RELATORIO = (
    ('recebidos', 'Chamados recebidos', 'int', None),
    ('resolvidos', 'Chamados resolvidos', 'int', True),
    ('rejeitados', 'Chamados não procedentes', 'int', None),
    ('backlog', 'Em aberto no fim do mês', 'int', False),
    ('backlog_vencido', 'Em aberto com prazo vencido', 'int', False),
    ('pct_no_prazo', 'Resolvidos dentro do prazo', 'pct', True),
    ('lead_time_p50_h', 'Tempo mediano até resolver', 'horas', False),
    ('lead_time_p90_h', 'Tempo até resolver (90% dos casos)', 'horas', False),
    ('primeira_resposta_p50_h', 'Tempo mediano até a 1ª resposta', 'horas', False),
    ('taxa_resolucao', 'Recebidos no mês já resolvidos', 'pct', True),
    ('reabertura_pct', 'Resolvidos que precisaram reabrir', 'pct', False),
    ('csat_media', 'Satisfação média (1 a 5)', 'nota', True),
    ('csat_respostas', 'Avaliações recebidas', 'int', None),
    ('cidadaos_ativos', 'Cidadãos participantes', 'int', True),
)


def escopo_do_mes(base, ano, mes):
    """Escopo do mês civil (os filtros de `base` são mantidos)."""
    from dataclasses import replace
    return replace(base, inicio=date(ano, mes, 1), fim=date(ano, mes, monthrange(ano, mes)[1]))


def mes_anterior(ano, mes):
    return (ano - 1, 12) if mes == 1 else (ano, mes - 1)


def _fmt(valor, formato):
    if valor is None:
        return '—'
    if formato == 'int':
        return f'{int(valor):,}'.replace(',', '.')
    if formato == 'pct':
        return f'{valor:.1f}%'.replace('.', ',')
    if formato == 'nota':
        return f'{valor:.2f}'.replace('.', ',')
    if formato == 'horas':
        # Chamado urbano se mede em dias; hora só abaixo de 2 dias.
        if valor >= 48:
            return f'{valor / 24:.1f} dias'.replace('.', ',')
        return f'{valor:.1f} h'.replace('.', ',')
    return str(valor)


def _variacao(atual, anterior, formato, maior_melhor):
    if atual is None or anterior is None:
        return '—'
    delta = atual - anterior
    if abs(delta) < 1e-9:
        return 'estável'
    if formato == 'pct':
        texto = f'{delta:+.1f} p.p.'.replace('.', ',')
    elif anterior:
        texto = f'{100.0 * delta / anterior:+.0f}%'
    else:
        texto = 'novo'
    if maior_melhor is None:
        return texto
    melhorou = (delta > 0) == maior_melhor
    return f'{texto} ({"melhor" if melhorou else "pior"})'


def _estilos():
    base = getSampleStyleSheet()
    return {
        'capa_titulo': ParagraphStyle('capa_titulo', parent=base['Title'], fontSize=26, leading=32,
                                      textColor=COR_DESTAQUE, alignment=TA_CENTER),
        'capa_sub': ParagraphStyle('capa_sub', parent=base['Normal'], fontSize=15, leading=20,
                                   alignment=TA_CENTER),
        'capa_info': ParagraphStyle('capa_info', parent=base['Normal'], fontSize=10, leading=14,
                                    alignment=TA_CENTER, textColor=colors.HexColor('#4B5563')),
        'h2': ParagraphStyle('h2', parent=base['Heading2'], textColor=COR_DESTAQUE, spaceBefore=10),
        'texto': ParagraphStyle('texto', parent=base['Normal'], fontSize=9.5, leading=13),
        'nota': ParagraphStyle('nota', parent=base['Normal'], fontSize=8, leading=11,
                               textColor=colors.HexColor('#4B5563')),
    }


def _tabela(cabecalho, linhas, larguras, alinhar_numeros_de=1):
    tabela = Table([cabecalho] + linhas, colWidths=larguras, repeatRows=1)
    tabela.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('BACKGROUND', (0, 0), (-1, 0), COR_FUNDO_CABECALHO),
        ('LINEBELOW', (0, 0), (-1, 0), 0.8, COR_DESTAQUE),
        ('LINEBELOW', (0, 1), (-1, -1), 0.25, COR_GRADE),
        ('ALIGN', (alinhar_numeros_de, 0), (-1, -1), 'RIGHT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]))
    return tabela


def _grafico_fluxo(serie):
    """Barras agrupadas por semana: recebidos × resolvidos."""
    largura, altura = 170 * mm, 70 * mm
    desenho = Drawing(largura, altura)
    if not serie:
        desenho.add(String(largura / 2, altura / 2, 'Sem dados no período', textAnchor='middle'))
        return desenho
    grafico = VerticalBarChart()
    grafico.x, grafico.y = 30, 30
    grafico.width, grafico.height = largura - 50, altura - 55
    grafico.data = [
        [p['recebidos'] for p in serie],
        [p['resolvidos'] for p in serie],
    ]
    maximo = max(max(grafico.data[0]), max(grafico.data[1]), 1)
    grafico.valueAxis.valueMin = 0
    grafico.valueAxis.valueMax = maximo + max(1, round(maximo * 0.15))
    grafico.valueAxis.valueStep = max(1, round(grafico.valueAxis.valueMax / 5))
    grafico.valueAxis.labels.fontSize = 7
    grafico.categoryAxis.categoryNames = [
        'sem. ' + date.fromisoformat(p['periodo']).strftime('%d/%m') for p in serie
    ]
    grafico.categoryAxis.labels.fontSize = 7
    grafico.bars[0].fillColor = COR_DESTAQUE
    grafico.bars[1].fillColor = COR_SECUNDARIA
    grafico.barLabelFormat = '%d'
    grafico.barLabels.fontSize = 6
    grafico.barLabels.nudge = 6
    grafico.groupSpacing = 8
    desenho.add(grafico)

    legenda = Legend()
    legenda.x, legenda.y = 30, altura - 8
    legenda.alignment = 'right'
    legenda.columnMaximum = 1
    legenda.fontSize = 8
    legenda.colorNamePairs = [(COR_DESTAQUE, 'Recebidos'), (COR_SECUNDARIA, 'Resolvidos')]
    legenda.deltax = 80
    legenda.dx = legenda.dy = 7
    desenho.add(legenda)
    return desenho


def gerar_relatorio_mensal(base, ano, mes, municipio, filtros_texto=''):
    """
    Bytes do PDF do mês `ano`/`mes` para o escopo `base` (município e filtros).
    Compara com o mês civil anterior. `municipio` = {codigo, nome, uf_sigla}.
    """
    escopo = escopo_do_mes(base, ano, mes)
    ano_ant, mes_ant = mes_anterior(ano, mes)
    escopo_ant = escopo_do_mes(base, ano_ant, mes_ant)

    kpis = consultas.kpis(escopo)
    kpis_ant = consultas.kpis(escopo_ant)
    fluxo = consultas.serie(escopo, 'semana')
    categorias = consultas.distribuicao(escopo, 'categoria')[:10]
    bairros = consultas.distribuicao(escopo, 'bairro')[:10]
    faixas = consultas.aging(escopo)

    e = _estilos()
    nome_cidade = municipio.get('nome') or f'Município {municipio.get("codigo")}'
    uf = municipio.get('uf_sigla') or ''
    titulo_mes = f'{MESES[mes - 1].capitalize()} de {ano}'
    gerado = timezone.localtime(timezone.now(), consultas.fuso()).strftime('%d/%m/%Y às %H:%M')

    historia = [
        Spacer(1, 60 * mm),
        Paragraph('Relatório mensal de zeladoria urbana', e['capa_titulo']),
        Spacer(1, 8 * mm),
        Paragraph(escape(f'{nome_cidade}{" / " + uf if uf else ""}'), e['capa_sub']),
        Paragraph(titulo_mes, e['capa_sub']),
        Spacer(1, 30 * mm),
        Paragraph('Central de Inteligência Urbana', e['capa_info']),
        Paragraph(f'Gerado em {gerado}', e['capa_info']),
    ]
    if filtros_texto:
        historia.append(Paragraph(f'Filtros aplicados: {escape(filtros_texto)}', e['capa_info']))
    historia.append(PageBreak())

    # Indicadores
    historia.append(Paragraph('Indicadores do mês', e['h2']))
    historia.append(Paragraph(
        f'Comparação com {MESES[mes_ant - 1]} de {ano_ant}. A coluna “Variação” diz '
        'se o número melhorou ou piorou, e não só se subiu.', e['texto']))
    historia.append(Spacer(1, 3 * mm))
    linhas = [
        [rotulo, _fmt(kpis[chave], fmt), _fmt(kpis_ant[chave], fmt),
         _variacao(kpis[chave], kpis_ant[chave], fmt, melhor)]
        for chave, rotulo, fmt, melhor in KPIS_RELATORIO
    ]
    historia.append(_tabela(['Indicador', titulo_mes, 'Mês anterior', 'Variação'], linhas,
                            [72 * mm, 32 * mm, 32 * mm, 34 * mm]))

    # Fluxo semanal
    historia.append(KeepTogether([
        Paragraph('Entrada e saída por semana', e['h2']),
        Paragraph('Quando os recebidos superam os resolvidos por semanas seguidas, '
                  'a fila de chamados abertos cresce.', e['texto']),
        Spacer(1, 2 * mm),
        _grafico_fluxo(fluxo),
    ]))

    # Top categorias e bairros
    def linhas_dist(itens):
        return [
            # O rótulo do bairro é texto livre do cidadão: Paragraph interpreta
            # markup (tags inválidas derrubam o PDF; <img> busca recurso).
            [Paragraph(escape(str(i['rotulo'])), e['texto']), _fmt(i['recebidos'], 'int'),
             _fmt(i['resolvidos'], 'int'), _fmt(i['abertos'], 'int'),
             _fmt(i['pct_no_prazo'], 'pct'), _fmt(i['lead_time_p50_h'], 'horas')]
            for i in itens
        ] or [['Sem chamados no período', '', '', '', '', '']]

    cab_dist = ['', 'Recebidos', 'Resolvidos', 'Em aberto', 'No prazo', 'Mediana']
    larg_dist = [56 * mm, 22 * mm, 22 * mm, 22 * mm, 22 * mm, 26 * mm]
    historia.append(KeepTogether([
        Paragraph('Categorias com mais chamados', e['h2']),
        _tabela(['Categoria'] + cab_dist[1:], linhas_dist(categorias), larg_dist),
    ]))
    historia.append(KeepTogether([
        Paragraph('Bairros com mais chamados', e['h2']),
        _tabela(['Bairro'] + cab_dist[1:], linhas_dist(bairros), larg_dist),
    ]))

    # Aging
    historia.append(KeepTogether([
        Paragraph('Idade dos chamados em aberto no fim do mês', e['h2']),
        _tabela(['Há quanto tempo aberto', 'Chamados', 'Com prazo vencido'],
                [[f['faixa'].replace('d', ' dias').replace('>30 dias', 'mais de 30 dias'),
                  _fmt(f['total'], 'int'), _fmt(f['vencidos'], 'int')] for f in faixas],
                [70 * mm, 40 * mm, 50 * mm]),
    ]))

    historia.append(Spacer(1, 6 * mm))
    historia.append(Paragraph(
        'Como os números são calculados: resolvidos são chamados concluídos no mês e que '
        'continuam concluídos; o prazo é o da categoria no município; o tempo até resolver '
        'vai da abertura à conclusão (mediana e percentil 90, que não se deixam distorcer '
        'pelos poucos casos extremos); a 1ª resposta é a primeira manifestação pública da '
        'equipe ou a triagem, o que vier antes; “em aberto no fim do mês” conta o que estava '
        'aberto no último instante do mês. Nenhum dado pessoal de cidadão consta neste relatório.',
        e['nota']))

    def rodape(canvas, doc):
        if doc.page == 1:
            return
        canvas.saveState()
        canvas.setFont('Helvetica', 7.5)
        canvas.setFillColor(colors.HexColor('#6B7280'))
        canvas.drawString(18 * mm, 10 * mm, f'{nome_cidade} — {titulo_mes}')
        canvas.drawRightString(A4[0] - 18 * mm, 10 * mm, f'Página {doc.page}')
        canvas.restoreState()

    saida = io.BytesIO()
    doc = SimpleDocTemplate(
        saida, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=18 * mm, bottomMargin=18 * mm,
        title=f'Relatório mensal — {nome_cidade} — {titulo_mes}',
        author='Central de Inteligência Urbana',
    )
    doc.build(historia, onFirstPage=rodape, onLaterPages=rodape)
    return saida.getvalue()
