"""
Idempotência das ações da operação (contrato v3, 7.1).

O app de campo guarda as ações feitas sem rede e as reenvia depois com a
mesma chave. Quando a primeira tentativa chegou ao servidor mas a resposta
se perdeu no caminho (sinal ruim, túnel, elevador), o reenvio não pode
duplicar a nota, a foto ou a resposta ao cidadão. A chave vem no cabeçalho
`Idempotency-Key` ou, no navegador (onde um cabeçalho fora da lista do CORS
derrubaria a requisição no preflight), no parâmetro `?idempotency_key=`.

A primeira resposta de sucesso (2xx) fica no cache por 24 h, por usuário e
rota; a repetição recebe a mesma resposta, com `Idempotent-Replayed: true`,
sem executar nada. Erros não ficam guardados: repetir um 400/403 executa de
novo (o motivo pode ter mudado). Duas requisições simultâneas com a mesma
chave: a segunda recebe 409 enquanto a primeira não termina.

Sem cache (Redis fora do ar), a ação segue sem a proteção — melhor que
recusar o serviço da equipe por causa de um componente acessório.
"""
import logging
import re
from functools import wraps

from django.core.cache import cache
from django.http import HttpResponse
from rest_framework import status
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response

logger = logging.getLogger(__name__)

VALIDADE_S = 24 * 60 * 60
TRAVA_S = 60
_CHAVE_VALIDA = re.compile(r'^[A-Za-z0-9._:-]{8,100}$')


def chave_da_requisicao(request):
    chave = request.headers.get('Idempotency-Key') or request.query_params.get('idempotency_key') or ''
    chave = chave.strip()
    return chave if _CHAVE_VALIDA.match(chave) else None


def idempotente(view):
    """Decorador para views de função (por baixo de `@api_view`)."""

    @wraps(view)
    def envolvida(request, *args, **kwargs):
        chave = chave_da_requisicao(request)
        user = getattr(request, 'user', None)
        if not chave or not getattr(user, 'is_authenticated', False):
            return view(request, *args, **kwargs)
        base = f'operacao:idem:{user.pk}:{request.path}:{chave}'
        try:
            salvo = cache.get(base)
            if salvo is not None:
                resposta = HttpResponse(salvo['corpo'], status=salvo['status'],
                                        content_type='application/json')
                resposta['Idempotent-Replayed'] = 'true'
                return resposta
            if not cache.add(f'{base}:trava', 1, TRAVA_S):
                return Response(
                    {'detail': 'Esta ação já está sendo processada. Aguarde e atualize.'},
                    status=status.HTTP_409_CONFLICT,
                )
        except Exception:  # noqa: BLE001 — cache fora do ar não pode parar a operação
            logger.warning('Idempotência indisponível (cache); seguindo sem ela.', exc_info=True)
            return view(request, *args, **kwargs)

        try:
            resposta = view(request, *args, **kwargs)
            if 200 <= resposta.status_code < 300 and isinstance(resposta, Response):
                try:
                    corpo = JSONRenderer().render(resposta.data)
                    cache.set(base, {'status': resposta.status_code, 'corpo': corpo}, VALIDADE_S)
                except Exception:  # noqa: BLE001
                    logger.warning('Resposta idempotente não guardada.', exc_info=True)
            return resposta
        finally:
            try:
                cache.delete(f'{base}:trava')
            except Exception:  # noqa: BLE001
                pass

    return envolvida
