"""
Sugestões de ação a partir da IA leve (serviço `ia/`, MiniLM em ONNX):

- **Temas**: relatos abertos com texto parecido (cosseno dos embeddings),
  perto uns dos outros e em ruas diferentes — o mesmo problema espalhado pela
  região, que a regra de reincidência (mesma rua + categoria) não vê. Pega
  também relatos marcados como "Outro".
- **Risco citado**: relatos abertos cuja descrição cita risco à pessoa
  ("fio partido", "criança", "desabou"...), pela prioridade por palavras-chave
  da IA.

A IA só mede semelhança e acha termos; o texto da sugestão sai daqui. Sem o
serviço de IA, a resposta vem vazia com `ia_disponivel: false` (o painel
continua com as sugestões por regra).
"""
import asyncio
import math
from collections import Counter
from datetime import timedelta

from django.core.cache import cache
from django.utils import timezone

from defeitos import fluxo
from defeitos.models import Defeito
from services import ia_client

JANELA_DIAS = 60
MAX_RELATOS = 150
# O serviço demora ~90 ms por texto e o cliente corta em 3 s: lotes de 20.
LOTE_IA = 20
# Mesmo limiar da detecção de duplicados (DUPLICATE_SIMILARITY_THRESHOLD).
LIMIAR_TEMA = 0.75
MIN_RELATOS_TEMA = 3
MIN_RUAS_TEMA = 2
# "Região": até esta distância do relato que abriu o grupo.
RAIO_TEMA_KM = 1.5
CACHE_SEGUNDOS = 6 * 60 * 60


def _cosseno(a, b):
    produto = sum(x * y for x, y in zip(a, b))
    norma = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    return produto / norma if norma else 0.0


def _distancia_km(a, b):
    if a['latitude'] is None or b['latitude'] is None:
        return math.inf
    lat1, lng1, lat2, lng2 = map(math.radians, (a['latitude'], a['longitude'], b['latitude'], b['longitude']))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def agrupar_temas(itens, embeddings, limiar=LIMIAR_TEMA, minimo=MIN_RELATOS_TEMA, min_ruas=MIN_RUAS_TEMA,
                  raio_km=RAIO_TEMA_KM):
    """
    Agrupa relatos parecidos e próximos. `itens` e `embeddings` andam em
    paralelo; cada item tem `rua`, `bairro`, `categoria`, `descricao`,
    `latitude` e `longitude`. Um relato entra no primeiro grupo cujo líder (o
    relato que abriu o grupo) é parecido o bastante e está a até `raio_km`.
    Só sobram grupos com `minimo` relatos em `min_ruas` ruas.
    """
    grupos = []  # (indice do lider, [indices])
    for i, emb in enumerate(embeddings):
        for lider, membros in grupos:
            if (_cosseno(embeddings[lider], emb) >= limiar
                    and _distancia_km(itens[lider], itens[i]) <= raio_km):
                membros.append(i)
                break
        else:
            grupos.append((i, [i]))

    temas = []
    for lider, membros in grupos:
        ruas = {(itens[m]['rua'] or '').strip().lower() for m in membros} - {''}
        if len(membros) < minimo or len(ruas) < min_ruas:
            continue
        # Exemplo: o relato mais parecido com os demais do grupo.
        exemplo = max(membros, key=lambda m: sum(_cosseno(embeddings[m], embeddings[o]) for o in membros))
        bairros = Counter((itens[m]['bairro'] or '').strip() for m in membros if (itens[m]['bairro'] or '').strip())
        categorias = Counter(itens[m]['categoria'] or 'Outro' for m in membros)
        temas.append({
            'total': len(membros),
            'ruas': len(ruas),
            'bairros': [b for b, _ in bairros.most_common(3)],
            'categoria': categorias.most_common(1)[0][0],
            'exemplo': (itens[exemplo]['descricao'] or '')[:140],
            'ids': [str(itens[m]['id']) for m in membros],
        })
    temas.sort(key=lambda t: t['total'], reverse=True)
    return temas


def _texto_tema(t):
    onde = ', '.join(t['bairros']) or 'vários bairros'
    exemplo = t['exemplo'].strip().rstrip('.!?;')
    return (f'{t["total"]} relatos parecidos em {t["ruas"]} ruas próximas ({onde}), como: "{exemplo}". '
            'Pode ser uma causa comum na região: avaliar com uma vistoria única.')


def _em_lotes(funcao, textos):
    """Chama a IA em lotes; None se qualquer lote falhar (serviço fora do ar)."""
    saida = []
    for i in range(0, len(textos), LOTE_IA):
        parte = asyncio.run(funcao(textos[i:i + LOTE_IA]))
        if parte is None or len(parte) != len(textos[i:i + LOTE_IA]):
            return None
        saida.extend(parte)
    return saida


def sugestoes_ia(municipio_id):
    chave = f'bi:sugestoes-ia:{municipio_id}'
    salvo = cache.get(chave)
    if salvo is not None:
        return salvo

    desde = timezone.now() - timedelta(days=JANELA_DIAS)
    itens = list(
        Defeito.objects.ativos()
        .filter(municipio_id=str(municipio_id), status__in=fluxo.STATUS_ABERTOS, criado_em__gte=desde)
        .exclude(descricao='')
        .order_by('-criado_em')
        .values('id', 'protocolo', 'descricao', 'rua', 'bairro', 'categoria', 'status', 'latitude', 'longitude')[:MAX_RELATOS]
    )
    vazio = {'ia_disponivel': True, 'analisados': 0, 'temas': [], 'riscos': []}
    if not itens:
        return vazio

    textos = [i['descricao'] for i in itens]
    embeddings = _em_lotes(ia_client.get_embeddings_batch, textos)
    prioridades = _em_lotes(ia_client.priority_batch, textos)
    if embeddings is None or prioridades is None:
        # Não guarda em cache: quando a IA voltar, a próxima abertura já calcula.
        return {**vazio, 'ia_disponivel': False}

    temas = [{**t, 'sugestao': _texto_tema(t)} for t in agrupar_temas(itens, embeddings)]
    riscos = [
        {
            'id': str(i['id']),
            'protocolo': i['protocolo'],
            'categoria': i['categoria'] or 'Outro',
            'rua': i['rua'],
            'bairro': i['bairro'],
            'status': i['status'],
            'termos': p['terms'],
        }
        for i, p in zip(itens, prioridades)
        if p['priority'] == 'urgente'
    ]
    resultado = {'ia_disponivel': True, 'analisados': len(itens), 'temas': temas, 'riscos': riscos}
    cache.set(chave, resultado, CACHE_SEGUNDOS)
    return resultado
