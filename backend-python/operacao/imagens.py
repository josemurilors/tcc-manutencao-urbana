"""
Evidência fotográfica da equipe (antes/depois) em `defeito_anexos`.

A foto vai como JPEG de no máximo 1280 px no maior lado: é o que um celular
de entrada abre rápido em 3G no campo e ainda mostra o serviço com nitidez
no PDF e no painel. O EXIF é descartado (a posição de captura já vem nos
campos `latitude`/`longitude`; o resto — modelo do aparelho, hora local —
não interessa ao cidadão), mas a orientação é aplicada antes, senão a foto
de celular em pé chega deitada.
"""
import io

from PIL import Image, ImageOps, UnidentifiedImageError

LADO_MAXIMO = 1280
QUALIDADE = 80
# Teto do arquivo recebido: uma foto de 50 MP em JPEG fica perto de 20 MB.
TAMANHO_MAXIMO_BYTES = 20 * 1024 * 1024
# Teto de pixels antes de decodificar, contra "bomba" de descompressão.
PIXELS_MAXIMOS = 60_000_000


class ImagemInvalida(ValueError):
    pass


def comprimir_jpeg(arquivo):
    """`arquivo` (UploadedFile ou bytes) -> bytes JPEG ≤ 1280 px. Levanta `ImagemInvalida`."""
    if hasattr(arquivo, 'size') and arquivo.size and arquivo.size > TAMANHO_MAXIMO_BYTES:
        raise ImagemInvalida('Foto muito grande (máximo de 20 MB).')
    dados = arquivo.read() if hasattr(arquivo, 'read') else arquivo
    if not dados:
        raise ImagemInvalida('Foto vazia.')
    if len(dados) > TAMANHO_MAXIMO_BYTES:
        raise ImagemInvalida('Foto muito grande (máximo de 20 MB).')
    try:
        img = Image.open(io.BytesIO(dados))
        largura, altura = img.size
        if largura * altura > PIXELS_MAXIMOS:
            raise ImagemInvalida('Foto com resolução grande demais.')
        img = ImageOps.exif_transpose(img)
        if img.mode not in ('RGB', 'L'):
            # PNG com transparência: fundo branco em vez de preto no JPEG.
            fundo = Image.new('RGB', img.size, (255, 255, 255))
            rgba = img.convert('RGBA')
            fundo.paste(rgba, mask=rgba.split()[-1])
            img = fundo
        img.thumbnail((LADO_MAXIMO, LADO_MAXIMO), Image.LANCZOS)
        saida = io.BytesIO()
        img.save(saida, 'JPEG', quality=QUALIDADE, optimize=True, progressive=True)
    except ImagemInvalida:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as e:
        raise ImagemInvalida('Não foi possível ler a foto enviada.') from e
    return saida.getvalue()


def tipo_mime(dados):
    """Content-Type pelo cabeçalho: anexos antigos (rota `anexar`) são WebP."""
    dados = bytes(dados[:12])
    if dados.startswith(b'\xff\xd8'):
        return 'image/jpeg'
    if dados[:4] == b'RIFF' and dados[8:12] == b'WEBP':
        return 'image/webp'
    if dados.startswith(b'\x89PNG'):
        return 'image/png'
    return 'application/octet-stream'
