"""
Trilha de auditoria de ações administrativas e operacionais (`audit_log`).

O histórico do chamado mora em `defeito_eventos`; aqui vai o que muda o
sistema em si — papéis, vínculo de município, configuração, moderação —
com quem fez, de onde e os valores antes/depois em `dados`.
"""


def _ip(request):
    """
    IP de quem agiu. O nginx da frente grava `X-Real-IP` com o `$remote_addr`
    (sobrescreve o que o cliente mandar) e ACRESCENTA esse mesmo endereço ao
    fim do `X-Forwarded-For`. Por isso o primeiro item do XFF é forjável e não
    serve para trilha de auditoria; o último é o que o proxy viu.
    """
    real = (request.META.get('HTTP_X_REAL_IP') or '').strip()
    if real:
        return real[:45]
    encaminhado = request.META.get('HTTP_X_FORWARDED_FOR', '')
    if encaminhado:
        return encaminhado.split(',')[-1].strip()[:45]
    return request.META.get('REMOTE_ADDR', '') or ''


def registrar(request_ou_user, acao, alvo_tipo='', alvo_id='', dados=None, municipio_id=None):
    """Grava uma linha em `audit_log`. Aceita o request (pega usuário e IP) ou só o usuário."""
    from gestao.models import AuditLog

    ip = ''
    usuario = request_ou_user
    if hasattr(request_ou_user, 'META'):
        ip = _ip(request_ou_user)
        usuario = getattr(request_ou_user, 'user', None)
    if usuario is not None and not getattr(usuario, 'is_authenticated', False):
        usuario = None
    if municipio_id is None and usuario is not None:
        municipio_id = usuario.municipio_id
    return AuditLog.objects.create(
        usuario=usuario,
        municipio_id=municipio_id,
        acao=acao,
        alvo_tipo=alvo_tipo or '',
        alvo_id=str(alvo_id) if alvo_id is not None else '',
        dados=dados or {},
        ip=ip,
    )
