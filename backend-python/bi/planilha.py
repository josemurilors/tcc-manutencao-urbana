"""
Exportação tabular: CSV para Excel pt-BR e XLSX mínimo.

O XLSX é escrito à mão (OOXML em zip, só biblioteca padrão): uma aba,
cabeçalho em negrito e congelado, números como número e o resto como texto.
É o que uma planilha de prestação de contas precisa, e evita mais uma
dependência na imagem do backend (openpyxl não está instalado nela).
"""
import csv
import io
import zipfile
from xml.sax.saxutils import escape


def gerar_csv(colunas, linhas):
    """
    Gera o CSV em pedaços (para StreamingHttpResponse). BOM UTF-8 e `;` como
    separador: é o que o Excel em português abre direto, sem assistente de
    importação nem acento quebrado.
    """
    buffer = io.StringIO()
    escritor = csv.writer(buffer, delimiter=';', lineterminator='\r\n')

    def descarregar():
        valor = buffer.getvalue()
        buffer.seek(0)
        buffer.truncate(0)
        return valor.encode('utf-8')

    escritor.writerow(colunas)
    yield b'\xef\xbb\xbf' + descarregar()
    for i, linha in enumerate(linhas, 1):
        escritor.writerow(['' if linha.get(c) is None else _texto_csv(linha.get(c)) for c in colunas])
        if i % 500 == 0:
            yield descarregar()
    resto = descarregar()
    if resto:
        yield resto


def _texto_csv(valor):
    if isinstance(valor, bool):
        return 'sim' if valor else 'não'
    if isinstance(valor, float):
        # Vírgula decimal: com `;` de separador o Excel pt-BR lê como número.
        return repr(valor).replace('.', ',')
    if isinstance(valor, str):
        return texto_seguro(valor)
    return valor


# Início que o Excel/LibreOffice interpreta como fórmula (ou DDE).
_GATILHOS_FORMULA = ('=', '+', '-', '@', '\t', '\r')


def texto_seguro(valor):
    """
    Neutraliza injeção de fórmula em CSV: rua, bairro e nome são texto livre
    de quem usa o app, e o arquivo é feito para abrir direto no Excel. Um
    apóstrofo na frente faz a planilha mostrar o texto em vez de avaliá-lo.
    """
    if isinstance(valor, str) and valor.startswith(_GATILHOS_FORMULA):
        return "'" + valor
    return valor


def _coluna(indice):
    """0 -> A, 25 -> Z, 26 -> AA."""
    letras = ''
    indice += 1
    while indice:
        indice, resto = divmod(indice - 1, 26)
        letras = chr(65 + resto) + letras
    return letras


def _celula(ref, valor, estilo=0):
    s = f' s="{estilo}"' if estilo else ''
    if valor is None or valor == '':
        return f'<c r="{ref}"{s}/>'
    if isinstance(valor, bool):
        valor = 'sim' if valor else 'não'
    if isinstance(valor, (int, float)):
        return f'<c r="{ref}"{s}><v>{valor}</v></c>'
    return f'<c r="{ref}"{s} t="inlineStr"><is><t xml:space="preserve">{escape(str(valor))}</t></is></c>'


_CONTENT_TYPES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Override PartName="/xl/workbook.xml" '
    'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    '<Override PartName="/xl/worksheets/sheet1.xml" '
    'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    '<Override PartName="/xl/styles.xml" '
    'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    '</Types>'
)

_RELS = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" '
    'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
    'Target="xl/workbook.xml"/>'
    '</Relationships>'
)

_WORKBOOK_RELS = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" '
    'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
    'Target="worksheets/sheet1.xml"/>'
    '<Relationship Id="rId2" '
    'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" '
    'Target="styles.xml"/>'
    '</Relationships>'
)

# Estilo 0 = padrão; 1 = negrito com fundo cinza (cabeçalho).
_STYLES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>'
    '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
    '<fills count="3"><fill><patternFill patternType="none"/></fill>'
    '<fill><patternFill patternType="gray125"/></fill>'
    '<fill><patternFill patternType="solid"><fgColor rgb="FFE5E7EB"/><bgColor indexed="64"/>'
    '</patternFill></fill></fills>'
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
    '</cellXfs>'
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    '</styleSheet>'
)


def gerar_xlsx(colunas, linhas, aba='Chamados'):
    """Bytes de um .xlsx com uma aba: cabeçalho `colunas` e uma linha por dict."""
    corpo = []
    corpo.append('<row r="1">' + ''.join(
        _celula(f'{_coluna(j)}1', nome, estilo=1) for j, nome in enumerate(colunas)
    ) + '</row>')
    n = 1
    for n, linha in enumerate(linhas, 2):
        corpo.append(f'<row r="{n}">' + ''.join(
            _celula(f'{_coluna(j)}{n}', linha.get(c)) for j, c in enumerate(colunas)
        ) + '</row>')
    ultima = f'{_coluna(max(len(colunas) - 1, 0))}{n}'
    planilha = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<dimension ref="A1:{ultima}"/>'
        '<sheetViews><sheetView workbookViewId="0">'
        '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
        '</sheetView></sheetViews>'
        '<sheetFormatPr defaultRowHeight="15"/>'
        f'<cols><col min="1" max="{max(len(colunas), 1)}" width="18" customWidth="1"/></cols>'
        '<sheetData>' + ''.join(corpo) + '</sheetData>'
        f'<autoFilter ref="A1:{ultima}"/>'
        '</worksheet>'
    )
    workbook = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<sheets><sheet name="{escape(aba[:31])}" sheetId="1" r:id="rId1"/></sheets>'
        '</workbook>'
    )
    saida = io.BytesIO()
    with zipfile.ZipFile(saida, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', _CONTENT_TYPES)
        z.writestr('_rels/.rels', _RELS)
        z.writestr('xl/workbook.xml', workbook)
        z.writestr('xl/_rels/workbook.xml.rels', _WORKBOOK_RELS)
        z.writestr('xl/styles.xml', _STYLES)
        z.writestr('xl/worksheets/sheet1.xml', planilha)
    return saida.getvalue()
