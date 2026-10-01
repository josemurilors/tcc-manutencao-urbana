import io
from PIL import Image, ImageFilter
from django.conf import settings

# Teto de pixels conferido ANTES de decodificar, contra "bomba" de
# descompressão: um PNG liso de 8 MB pode ter 13.000 x 13.000 px (~500 MB em
# RGB). Mesmo teto de `operacao.imagens.PIXELS_MAXIMOS`.
PIXELS_MAXIMOS = 60_000_000
LADO_MAXIMO = 1600


class ImagemGrandeDemais(ValueError):
    pass


def _abrir(input_bytes: bytes, lado: int) -> Image.Image:
    """Abre só o cabeçalho, recusa resolução absurda e pede ao JPEG uma escala reduzida."""
    img = Image.open(io.BytesIO(input_bytes))
    largura, altura = img.size
    if largura * altura > PIXELS_MAXIMOS:
        raise ImagemGrandeDemais('Foto com resolução grande demais.')
    if img.format == 'JPEG':
        # Decodifica já em 1/2, 1/4 ou 1/8 quando dá: menos memória e CPU.
        img.draft('RGB', (lado, lado))
    return img


def process_image(input_bytes: bytes) -> dict:
    img = _abrir(input_bytes, LADO_MAXIMO)

    # Reduz antes do blur: o filtro sobre a imagem cheia custava memória e
    # CPU proporcionais à resolução enviada, não à guardada.
    img.thumbnail((LADO_MAXIMO, LADO_MAXIMO), Image.LANCZOS)

    sigma = settings.PRIVACY_BLUR_SIGMA
    if sigma > 0:
        img = img.filter(ImageFilter.GaussianBlur(radius=sigma))

    output_buf = io.BytesIO()
    img.save(output_buf, 'WEBP', quality=90)
    output_buf.seek(0)

    thumb = img.copy()
    thumb.thumbnail((400, 400), Image.LANCZOS)
    thumb_buf = io.BytesIO()
    thumb.save(thumb_buf, 'WEBP', quality=75)
    thumb_buf.seek(0)

    return {
        'webp_bytes': output_buf.getvalue(),
        'thumbnail_bytes': thumb_buf.getvalue(),
    }


def make_thumbnail(input_bytes: bytes, size: tuple = (400, 400)) -> bytes:
    img = _abrir(input_bytes, max(size))
    img.thumbnail(size, Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, 'WEBP', quality=75)
    buf.seek(0)
    return buf.getvalue()
