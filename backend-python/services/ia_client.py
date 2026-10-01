import time
import logging
import httpx
import redis.asyncio as redis
from django.conf import settings

logger = logging.getLogger(__name__)

TIMEOUT = 3.0


class CircuitBreaker:
    KEY_TEMPLATE = 'ia:circuit:{name}'

    def __init__(self, name: str = 'main'):
        self.name = name

    async def is_open(self, redis_client=None) -> bool:
        if redis_client is None:
            return False
        key = self.KEY_TEMPLATE.format(name=self.name)
        state = await redis_client.hgetall(key)
        if not state:
            return False
        failures = int(state.get(b'failures', 0))
        if failures >= 3:
            cooldown_until = float(state.get(b'cooldown_until', 0))
            if time.time() < cooldown_until:
                return True
            await redis_client.delete(key)
        return False

    async def record_failure(self, redis_client=None):
        if redis_client is None:
            return
        key = self.KEY_TEMPLATE.format(name=self.name)
        pipe = redis_client.pipeline()
        pipe.hincrby(key, 'failures', 1)
        pipe.hset(key, 'cooldown_until', time.time() + 60)
        pipe.expire(key, 120)
        await pipe.execute()

    async def record_success(self, redis_client=None):
        if redis_client is None:
            return
        key = self.KEY_TEMPLATE.format(name=self.name)
        await redis_client.delete(key)


circuit_breaker = CircuitBreaker()


async def _call_ia(endpoint: str, payload: dict, redis_client=None) -> dict | None:
    ia_url = settings.IA_URL
    if await circuit_breaker.is_open(redis_client):
        logger.warning(f'Circuit breaker open for {endpoint}')
        return None
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f'{ia_url}{endpoint}',
                json=payload,
                timeout=TIMEOUT,
            )
            resp.raise_for_status()
            await circuit_breaker.record_success(redis_client)
            return resp.json()
    except (httpx.HTTPError, httpx.TimeoutException) as exc:
        logger.error(f'IA call failed: {exc}')
        await circuit_breaker.record_failure(redis_client)
        return None


async def classify(text: str, redis_client=None) -> dict | None:
    return await _call_ia('/classify', {'text': text}, redis_client)


async def classify_full(text: str, redis_client=None) -> dict | None:
    return await _call_ia('/classify-full', {'text': text}, redis_client)


async def classify_priority(text: str, redis_client=None) -> dict | None:
    return await _call_ia('/priority', {'text': text}, redis_client)


async def text_similarity(text1: str, text2: str, redis_client=None) -> dict | None:
    return await _call_ia('/text-similarity', {'text1': text1, 'text2': text2}, redis_client)


async def get_embeddings_batch(texts: list[str], redis_client=None) -> list[list[float]] | None:
    result = await _call_ia('/embeddings-batch', {'texts': texts}, redis_client)
    if result and 'embeddings' in result:
        return result['embeddings']
    return None


async def check_spam(text: str, redis_client=None) -> dict | None:
    return await _call_ia('/check-spam', {'text': text}, redis_client)


def routing(categoria: str, municipio_id=None) -> dict:
    """
    Secretaria e prazo da categoria. A regra mora em `defeitos.sla`, que casa
    o nome sem acento (antes as chaves daqui eram 'Iluminacao', 'Semafaro'...
    e as categorias com acento caíam todas em 'Outro').
    """
    from defeitos.sla import regra_para

    regra = regra_para(categoria, municipio_id)
    return {
        'secretaria': regra['secretaria_nome'],
        'prazo_sla_dias': regra['prazo_sla_dias'],
    }
