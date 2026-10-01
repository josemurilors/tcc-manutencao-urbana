import base64
import html
import io

import qrcode
from django.utils import timezone
from xhtml2pdf import pisa


ROTULOS_PRIORIDADE = {'urgente': 'Urgente', 'alta': 'Alta', 'media': 'Média', 'baixa': 'Baixa'}


def _thumbnail_data_url(defeito):
    if not defeito.imagem_thumbnail:
        return None
    b64 = base64.b64encode(defeito.imagem_thumbnail).decode('ascii')
    return f'data:image/webp;base64,{b64}'


def _qr_code_data_url(lat, lng):
    if lat is None or lng is None:
        return None
    url = f'https://maps.google.com/?q={lat},{lng}'
    img = qrcode.make(url, box_size=6, border=2)
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return f'data:image/png;base64,{base64.b64encode(buf.getvalue()).decode("ascii")}'


def _e(valor):
    """Escapa texto vindo do cidadão/equipe antes de entrar no HTML do PDF.

    Sem isso um título com `<img src="http://interno/...">` faria o xhtml2pdf
    buscar a URL (SSRF) e um simples `&` ou `<` quebrava o documento.
    """
    return html.escape(str(valor or ''), quote=True)


def _somente_data_uri(uri, rel):
    """`link_callback` do xhtml2pdf: só imagens embutidas (data:) — nada de rede ou disco."""
    if isinstance(uri, str) and uri.startswith('data:'):
        return uri
    return ''


def _checklist(defeito):
    """Itens do checklist da categoria no município (`categoria_municipio.checklist`)."""
    if not defeito.municipio_id or not defeito.categoria_id:
        return []
    from gestao.models import CategoriaMunicipio

    itens = (
        CategoriaMunicipio.objects
        .filter(municipio_id=str(defeito.municipio_id), categoria_id=defeito.categoria_id, ativo=True)
        .values_list('checklist', flat=True).first()
    ) or []
    return [str(i) for i in itens if str(i).strip()]


def gerar_ordem_servico(defeito):
    """Gera o PDF da Ordem de Serviço e retorna os bytes."""
    from defeitos.fluxo import ROTULOS_OPERACAO

    titulo = _e(defeito.titulo)
    categoria = _e(defeito.categoria)
    prioridade = _e(ROTULOS_PRIORIDADE.get(defeito.prioridade or '', defeito.prioridade) or 'Não definida')
    status = _e(ROTULOS_OPERACAO.get(defeito.status, defeito.status))
    rua = _e(defeito.rua)
    bairro = _e(defeito.bairro)
    # Quebras de linha da descrição viram <br/> depois do escape.
    descricao = _e(defeito.descricao).replace('\n', '<br/>')
    protocolo = _e(defeito.protocolo or str(defeito.id)[:8])
    equipe = _e(defeito.equipe.nome) if defeito.equipe_id and defeito.equipe else '—'
    atendente = _e(defeito.atendente.nome) if defeito.atendente_id and defeito.atendente else '—'
    prazo = timezone.localtime(defeito.prazo_em).strftime('%d/%m/%Y %H:%M') if defeito.prazo_em else '—'
    lat = defeito.latitude
    lng = defeito.longitude
    gerado_em = timezone.localtime().strftime('%d/%m/%Y %H:%M')

    html_os = f'''
    <html>
    <head>
    <style>
      @page {{ size: A4; margin: 18mm; }}
      body {{ font-family: Helvetica, Arial, sans-serif; color: #111; font-size: 11px; }}
      h1 {{ font-size: 20px; color: #1a1a1a; letter-spacing: 2px; text-transform: uppercase; margin: 0 0 4px 0; }}
      .sub {{ color: #666; font-size: 10px; margin-bottom: 14px; }}
      .bar {{ border-bottom: 3px solid #B8860B; margin-bottom: 16px; }}
      h2 {{ font-size: 13px; color: #8B6914; text-transform: uppercase; letter-spacing: 1px; margin: 14px 0 6px 0; }}
      table.data {{ width: 100%; border-collapse: collapse; }}
      table.data td {{ padding: 4px 0; }}
      .label {{ color: #666; width: 30%; }}
      .caixa {{ width: 8%; font-weight: bold; }}
      .valor {{ font-weight: bold; }}
      .foto {{ width: 100%; margin: 8px 0; }}
      .qr {{ margin: 8px 0; }}
      .assinatura {{ margin-top: 40px; }}
      .assinatura hr {{ border: 0; border-top: 1px dashed #999; margin: 8px 0; }}
      .rodape {{ margin-top: 30px; color: #888; font-size: 9px; text-align: center; }}
    </style>
    </head>
    <body>
      <h1>Ordem de Serviço</h1>
      <div class="sub">Central de Inteligência Urbana &bull; Protocolo {protocolo}</div>
      <div class="bar"></div>

      <h2>Dados do Chamado</h2>
      <table class="data">
        <tr><td class="label">Protocolo</td><td class="valor">{protocolo}</td></tr>
        <tr><td class="label">Título</td><td class="valor">{titulo}</td></tr>
        <tr><td class="label">Categoria</td><td class="valor">{categoria}</td></tr>
        <tr><td class="label">Prioridade</td><td class="valor">{prioridade}</td></tr>
        <tr><td class="label">Status</td><td class="valor">{status}</td></tr>
        <tr><td class="label">Endereço</td><td class="valor">{rua}{" - " if rua and bairro else ""}{bairro}</td></tr>
        <tr><td class="label">Prazo (SLA)</td><td class="valor">{prazo}</td></tr>
        <tr><td class="label">Equipe</td><td class="valor">{equipe}</td></tr>
        <tr><td class="label">Responsável</td><td class="valor">{atendente}</td></tr>
        <tr><td class="label">Gerado em</td><td class="valor">{gerado_em}</td></tr>
      </table>

      <h2>Descrição</h2>
      <p>{descricao}</p>
    '''

    itens = _checklist(defeito)
    if itens:
        linhas = ''.join(f'<tr><td class="caixa">[&nbsp;&nbsp;]</td><td>{_e(i)}</td></tr>' for i in itens)
        html_os += f'<h2>Checklist de execução</h2><table class="data">{linhas}</table>'

    foto = _thumbnail_data_url(defeito)
    if foto:
        html_os += f'<h2>Foto do Local</h2><img class="foto" src="{foto}" />'

    qr_img = _qr_code_data_url(lat, lng)
    if qr_img:
        coords = f'{lat}, {lng}' if lat is not None and lng is not None else ''
        html_os += f'''
        <h2>Localização &amp; QR Code</h2>
        <table class="data">
          <tr><td class="label">Coordenadas</td><td class="valor">{coords}</td></tr>
        </table>
        <img class="qr" src="{qr_img}" width="120" height="120" />
        <div class="sub">Escanear para abrir no Google Maps</div>
        '''

    html_os += '''
      <div class="assinatura">
        <h2>Parecer Técnico</h2>
        <hr />
        <hr />
      </div>
      <div class="rodape">Documento gerado automaticamente pela Central de Inteligência Urbana em {gerado}</div>
    </body>
    </html>
    '''.replace('{gerado}', gerado_em)

    buf = io.BytesIO()
    pisa.CreatePDF(html_os, dest=buf, encoding='utf-8', link_callback=_somente_data_uri)
    return buf.getvalue()
