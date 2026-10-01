"""
Transporte de push pelo Expo Push API.

O app (Expo) registra um `ExponentPushToken[...]` por aparelho em
`push_tokens`; aqui só montamos os lotes e falamos com a Expo, que entrega no
FCM/APNs. Regras que importam:

- Lotes de até 100 mensagens (limite da API) e timeout curto: um push
  atrasado não pode segurar a request de quem mudou o status.
- Token que a Expo devolve como `DeviceNotRegistered` (app desinstalado,
  permissão revogada) é apagado — insistir nele só gasta cota.
- Desligável por `settings.EXPO_PUSH_ENABLED`; sem o setting, segue a
  variável de ambiente de mesmo nome (padrão ligado) e fica sempre desligado
  sob pytest, para a suíte nunca sair para a internet.
- Por padrão o envio roda num pool de threads (`EXPO_PUSH_ASYNC`), fora do
  caminho da request; os management commands pedem envio síncrono.
"""
import json
import logging
import os
import re
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from django.conf import settings

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
TAMANHO_LOTE = 100
TIMEOUT_S = 5

# Formato dos tokens do Expo (o antigo `ExponentPushToken` e o novo `ExpoPushToken`).
_TOKEN_RE = re.compile(r'^Expo(nent)?PushToken\[[A-Za-z0-9_\-:.]+\]$')

_VERDADEIROS = ('1', 'true', 'sim', 'yes', 'on')

# Duas threads bastam: cada envio é um POST curto; o pool só evita que a
# request espere a Expo. Threads não-daemon: o interpretador espera os envios
# pendentes ao sair (útil nos management commands).
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix='expo-push')


def _flag(nome, padrao):
    valor = getattr(settings, nome, None)
    if valor is None:
        valor = os.environ.get(nome, padrao)
    if isinstance(valor, str):
        return valor.strip().lower() in _VERDADEIROS
    return bool(valor)


def habilitado():
    # Sob pytest, só liga se o teste pedir explicitamente via settings.
    if getattr(settings, 'EXPO_PUSH_ENABLED', None) is None and 'pytest' in sys.modules:
        return False
    return _flag('EXPO_PUSH_ENABLED', '1')


def assincrono():
    return _flag('EXPO_PUSH_ASYNC', '1')


def token_valido(token):
    return isinstance(token, str) and len(token) <= 255 and bool(_TOKEN_RE.match(token))


def _post(lote):
    """POST de um lote; devolve a lista de tickets (mesma ordem das mensagens)."""
    cabecalhos = {
        'Accept': 'application/json',
        'Accept-Encoding': 'identity',
        'Content-Type': 'application/json',
    }
    # Com "Enhanced security" ligado no projeto Expo, só envia quem tem o token de acesso.
    acesso = getattr(settings, 'EXPO_ACCESS_TOKEN', None) or os.environ.get('EXPO_ACCESS_TOKEN', '')
    if acesso:
        cabecalhos['Authorization'] = f'Bearer {acesso}'
    req = urllib.request.Request(
        EXPO_PUSH_URL, data=json.dumps(lote).encode('utf-8'), headers=cabecalhos, method='POST',
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
        corpo = json.loads(resp.read().decode('utf-8') or '{}')
    tickets = corpo.get('data')
    if not isinstance(tickets, list):
        raise ValueError(f'resposta inesperada da Expo: {corpo.get("errors") or corpo}')
    return tickets


def enviar(mensagens):
    """
    Envia `mensagens` ([{to, title, body, data, ...}]) e devolve
    `{enviadas, falhas, removidos}`. Nunca levanta: falha de rede ou da Expo
    vira log e conta em `falhas` (o aviso in-app já foi gravado).
    """
    resultado = {'enviadas': 0, 'falhas': 0, 'removidos': 0}
    if not mensagens or not habilitado():
        return resultado
    invalidos = []
    for inicio in range(0, len(mensagens), TAMANHO_LOTE):
        lote = mensagens[inicio:inicio + TAMANHO_LOTE]
        try:
            tickets = _post(lote)
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
            logger.warning('Expo Push falhou para um lote de %d: %s', len(lote), exc)
            resultado['falhas'] += len(lote)
            continue
        for mensagem, ticket in zip(lote, tickets):
            if (ticket or {}).get('status') == 'ok':
                resultado['enviadas'] += 1
                continue
            resultado['falhas'] += 1
            erro = ((ticket or {}).get('details') or {}).get('error')
            if erro == 'DeviceNotRegistered':
                invalidos.append(mensagem['to'])
            else:
                logger.info('Expo recusou push (%s): %s', erro, (ticket or {}).get('message'))
    if invalidos:
        from .models import PushToken

        resultado['removidos'], _ = PushToken.objects.filter(token__in=invalidos).delete()
    return resultado


def _enviar_em_thread(mensagens):
    from django.db import connections

    try:
        return enviar(mensagens)
    except Exception:
        # Thread sem ninguém esperando o resultado: sem este log o erro sumiria.
        logger.exception('Erro inesperado no envio de push')
        return None
    finally:
        # A thread abriu a própria conexão (remoção de tokens); fecha para não vazar.
        connections.close_all()


def despachar(mensagens, *, aguardar=False):
    """Envia agora (`aguardar` ou `EXPO_PUSH_ASYNC` desligado) ou no pool de threads."""
    if not mensagens or not habilitado():
        return None
    if aguardar or not assincrono():
        return enviar(mensagens)
    _executor.submit(_enviar_em_thread, mensagens)
    return None
