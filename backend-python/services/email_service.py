import re
import logging
import asyncio
import httpx
from django.conf import settings

logger = logging.getLogger(__name__)


async def _send_email(to: str, subject: str, html: str) -> dict:
    if not settings.RESEND_API_KEY:
        logger.warning('RESEND_API_KEY not configured, skipping email')
        return {'id': None, 'fallback': True}

    code_match = re.search(r'>(\d{6})<', html)
    if code_match:
        logger.info(f'Verification code sent to {to}: {code_match.group(1)}')

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            'https://api.resend.com/emails',
            headers={
                'Authorization': f'Bearer {settings.RESEND_API_KEY}',
                'Content-Type': 'application/json',
            },
            json={
                'from': settings.FROM_EMAIL,
                'to': [to],
                'subject': subject,
                'html': html,
            },
            timeout=15.0,
        )

    if not resp.is_success:
        logger.error(f'Failed to send email to {to}: {resp.text}')
        if code_match:
            logger.info(f'Code {code_match.group(1)} available in logs')
        return {'id': None, 'fallback': True}

    return resp.json()


def _verification_html(code: str) -> str:
    return (
        '<div style="font-family:sans-serif;max-width:480px;margin:0 auto">'
        '<h2>Confirme seu email</h2>'
        '<p>Seu codigo de verificacao e:</p>'
        f'<p style="font-size:32px;letter-spacing:8px;font-weight:700;text-align:center;background:#f5f5f5;padding:16px;border-radius:8px">{code}</p>'
        '<p>Ele expira em 10 minutos.</p>'
        '<p style="color:#888;font-size:12px">Central de Inteligencia Urbana</p>'
        '</div>'
    )


def _twofa_html(code: str) -> str:
    return (
        '<div style="font-family:sans-serif;max-width:480px;margin:0 auto">'
        '<h2>Codigo de verificacao em duas etapas</h2>'
        '<p>Use o codigo abaixo para acessar sua conta:</p>'
        f'<p style="font-size:32px;letter-spacing:8px;font-weight:700;text-align:center;background:#f5f5f5;padding:16px;border-radius:8px">{code}</p>'
        '<p>Ele expira em 5 minutos.</p>'
        '<p style="color:#888;font-size:12px">Central de Inteligencia Urbana</p>'
        '</div>'
    )


def _reset_html(code: str) -> str:
    # Sem link clicável de propósito: o código é digitado no app, o que evita
    # phishing por e-mail falso imitando a prefeitura.
    return (
        '<div style="font-family:sans-serif;max-width:480px;margin:0 auto">'
        '<h2>Redefinir sua senha</h2>'
        '<p>Recebemos um pedido para redefinir a senha da sua conta. Digite este codigo no aplicativo:</p>'
        f'<p style="font-size:32px;letter-spacing:8px;font-weight:700;text-align:center;background:#f5f5f5;padding:16px;border-radius:8px">{code}</p>'
        '<p>Ele expira em 10 minutos.</p>'
        '<p>Se nao foi voce, ignore este e-mail: sua senha continua a mesma.</p>'
        '<p style="color:#888;font-size:12px">Central de Inteligencia Urbana</p>'
        '</div>'
    )


def send_verification_code(email: str, code: str) -> dict:
    return asyncio.run(_send_email(
        to=email,
        subject='Confirme seu email - Central de Inteligencia Urbana',
        html=_verification_html(code),
    ))


def send_2fa_code(email: str, code: str) -> dict:
    return asyncio.run(_send_email(
        to=email,
        subject='Seu codigo de acesso - Central de Inteligencia Urbana',
        html=_twofa_html(code),
    ))


def send_password_reset_code(email: str, code: str) -> dict:
    return asyncio.run(_send_email(
        to=email,
        subject='Redefinicao de senha - Central de Inteligencia Urbana',
        html=_reset_html(code),
    ))
