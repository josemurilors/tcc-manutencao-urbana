"""
Gamificação: nível, EXP e ranking por município.

Nada disso vive em coluna própria — o XP é **derivado** das tabelas que já
existem, então fica sempre coerente com a moderação comunitária (`regras.py`):

* chamado removido como "não existe" (soft delete) leva o XP junto;
* strike ativo desconta XP enquanto não expira;
* nenhum backfill/migração: contas antigas já nascem com o XP do histórico.

Fontes de XP:
* `XP_CHAMADO` por chamado aberto (que ainda existe);
* `XP_BONUS_RESOLVIDO` a mais quando um chamado seu é resolvido — problema
  real, comprovado;
* `XP_CONFIRMACAO` por apoio/confirmação em chamado **de outra pessoa**
  (apoiar o próprio chamado não pontua, como em `regras.aplicar_confirmacao`);
* `XP_AVALIACAO` por chamado seu resolvido que você avaliou — a nota é o
  que alimenta o índice de satisfação da prefeitura, então vale incentivar.
  Uma vez por chamado (editar a nota não soma de novo);
* `XP_STRIKE` (negativo) por strike ativo. O total nunca fica abaixo de zero.

Curva de nível: subir ao nível `n` custa `XP_BASE_NIVEL * n * (n-1)` de XP
acumulado — nível 2 aos 30 XP (3 chamados ou 5 confirmações), nível 3 aos 90,
nível 4 aos 180... Cada nível carrega um título (`TITULOS`).

O ranking é por município e mede **contribuição naquela cidade** (chamados
abertos lá + confirmações em chamados de lá); strikes são reputação global e
ficam de fora — o chamado removido já deixou de pontuar.
"""
import logging

from django.conf import settings
from django.core.cache import cache
from django.db import connection
from django.db.models import Count, F, Q

from . import regras
from .models import Apoio, Defeito

logger = logging.getLogger(__name__)

# O ranking agrega chamados e apoios da cidade (ou do país) inteira: a tela é
# pública e muito aberta, então o resultado fica alguns minutos em cache.
# `settings.CIU_RANKING_CACHE_S = 0` desliga (testes).
RANKING_CACHE_S = 120

XP_CHAMADO = 10
XP_CONFIRMACAO = 6
XP_BONUS_RESOLVIDO = 15
XP_AVALIACAO = 5
XP_STRIKE = -20

# XP acumulado para estar no nível n: XP_BASE_NIVEL * n * (n-1).
XP_BASE_NIVEL = 15

STATUS_RESOLVIDOS = ('concluido',)

# Título por nível; do último em diante o título não muda mais.
TITULOS = [
    'Novato',
    'Observador',
    'Vigia',
    'Fiscal',
    'Guardião',
    'Patrulheiro',
    'Sentinela',
    'Inspetor',
    'Protetor da Cidade',
    'Lenda da Cidade',
]


def xp_para_nivel(nivel):
    """XP acumulado necessário para estar no nível `nivel`."""
    return XP_BASE_NIVEL * nivel * (nivel - 1)


def titulo_do_nivel(nivel):
    return TITULOS[min(nivel, len(TITULOS)) - 1]


def progresso(xp):
    """Nível, título e as bordas do nível atual para a barra de progresso."""
    nivel = 1
    while xp >= xp_para_nivel(nivel + 1):
        nivel += 1
    return {
        'xp': xp,
        'nivel': nivel,
        'titulo': titulo_do_nivel(nivel),
        'xp_nivel': xp_para_nivel(nivel),
        'xp_proximo': xp_para_nivel(nivel + 1),
    }


def _xp_total(chamados, resolvidos, confirmacoes, strikes=0, avaliacoes=0):
    xp = (
        chamados * XP_CHAMADO
        + resolvidos * XP_BONUS_RESOLVIDO
        + confirmacoes * XP_CONFIRMACAO
        + avaliacoes * XP_AVALIACAO
        + strikes * XP_STRIKE
    )
    return max(xp, 0)


def resumo_do_usuario(usuario):
    """Progresso completo do usuário logado (tela de conta)."""
    chamados = Defeito.objects.ativos().filter(usuario=usuario)
    total = chamados.count()
    resolvidos = chamados.filter(status__in=STATUS_RESOLVIDOS).count()
    avaliacoes = chamados.filter(avaliacao_nota__isnull=False).count()
    confirmacoes = (
        Apoio.objects.filter(usuario=usuario, defeito__removido_em__isnull=True)
        .exclude(defeito__usuario=usuario)
        .count()
    )
    strikes = regras.strikes_ativos(usuario).count()
    dados = progresso(_xp_total(total, resolvidos, confirmacoes, strikes, avaliacoes))
    dados.update({
        'chamados': total,
        'resolvidos': resolvidos,
        'confirmacoes': confirmacoes,
        'avaliacoes': avaliacoes,
    })
    return dados


def ranking_de(municipio_id=None, desde=None):
    """
    Ranking completo (ordenado, com `posicao`): quem mais contribui com
    chamados e confirmações. `municipio_id=None` = geral (todas as cidades);
    `desde` limita ao que aconteceu a partir dali (chamados abertos e
    confirmações dadas no período).
    """
    linhas = {}

    def linha(usuario_id, nome):
        chave = str(usuario_id)
        if chave not in linhas:
            linhas[chave] = {
                'usuario_id': chave, 'nome': nome,
                'chamados': 0, 'resolvidos': 0, 'confirmacoes': 0, 'avaliacoes': 0,
            }
        return linhas[chave]

    reports = Defeito.objects.ativos().exclude(usuario=None)
    apoios = Apoio.objects.filter(defeito__removido_em__isnull=True).exclude(usuario=F('defeito__usuario'))
    if municipio_id is not None:
        reports = reports.filter(municipio_id=municipio_id)
        apoios = apoios.filter(defeito__municipio_id=municipio_id)
    if desde is not None:
        reports = reports.filter(criado_em__gte=desde)
        apoios = apoios.filter(criado_em__gte=desde)

    # Avaliações contam pela data em que foram feitas, não pela do chamado:
    # avaliar esta semana um chamado do mês passado pontua na semana.
    avaliados = Defeito.objects.ativos().exclude(usuario=None).filter(avaliacao_nota__isnull=False)
    if municipio_id is not None:
        avaliados = avaliados.filter(municipio_id=municipio_id)
    if desde is not None:
        avaliados = avaliados.filter(avaliado_em__gte=desde)

    reports = reports.values('usuario_id', 'usuario__nome').annotate(
        total=Count('id'),
        resolvidos=Count('id', filter=Q(status__in=STATUS_RESOLVIDOS)),
    )
    for r in reports:
        item = linha(r['usuario_id'], r['usuario__nome'])
        item['chamados'] = r['total']
        item['resolvidos'] = r['resolvidos']

    for a in avaliados.values('usuario_id', 'usuario__nome').annotate(total=Count('id')):
        linha(a['usuario_id'], a['usuario__nome'])['avaliacoes'] = a['total']

    confirmacoes = apoios.values('usuario_id', 'usuario__nome').annotate(total=Count('id'))
    for c in confirmacoes:
        linha(c['usuario_id'], c['usuario__nome'])['confirmacoes'] = c['total']

    itens = []
    for item in linhas.values():
        xp = _xp_total(item['chamados'], item['resolvidos'], item['confirmacoes'],
                       avaliacoes=item['avaliacoes'])
        dados = progresso(xp)
        itens.append({
            **item,
            'xp': xp,
            'nivel': dados['nivel'],
            'titulo': dados['titulo'],
        })

    itens.sort(key=lambda i: (-i['xp'], -i['chamados'], i['nome']))
    for posicao, item in enumerate(itens, start=1):
        item['posicao'] = posicao
    return itens


def ranking_em_cache(municipio_id, periodo, desde):
    """`ranking_de` com cache de `RANKING_CACHE_S` por (município, período); fail-open."""
    ttl = getattr(settings, 'CIU_RANKING_CACHE_S', RANKING_CACHE_S)
    if not ttl:
        return ranking_de(municipio_id=municipio_id, desde=desde)
    banco = connection.settings_dict.get('NAME', '')
    chave = f'ciu_ranking:{banco}:{municipio_id or "geral"}:{periodo}'
    try:
        guardado = cache.get(chave)
    except Exception:
        logger.warning('cache indisponível ao ler %s', chave, exc_info=True)
        guardado = None
    if guardado is not None:
        return guardado
    itens = ranking_de(municipio_id=municipio_id, desde=desde)
    try:
        cache.set(chave, itens, ttl)
    except Exception:
        logger.warning('cache indisponível ao gravar %s', chave, exc_info=True)
    return itens


def linha_publica(item, meu_id=None):
    """
    Linha do ranking para a rota pública: nome mascarado ('Maria S.') e sem o
    id do usuário, como no resto da API. `eh_voce` marca a linha de quem
    pergunta, e só ela leva `usuario_id` (é o próprio id de quem está logado).
    """
    from .serializers import mascarar_nome

    eh_voce = meu_id is not None and item['usuario_id'] == meu_id
    linha = {k: v for k, v in item.items() if k != 'usuario_id'}
    linha['nome'] = mascarar_nome(item['nome'])
    linha['eh_voce'] = eh_voce
    if eh_voce:
        linha['usuario_id'] = item['usuario_id']
    return linha
