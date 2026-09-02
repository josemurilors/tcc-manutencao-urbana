"""
Gamificação: nível, EXP e ranking por município.

Nada disso vive em coluna própria — o XP é **derivado** das tabelas que já
existem, então fica sempre coerente com a moderação comunitária (`regras.py`):

* chamado apagado como "não existe" some do banco e leva o XP junto;
* strike ativo desconta XP enquanto não expira;
* nenhum backfill/migração: contas antigas já nascem com o XP do histórico.

Fontes de XP:
* `XP_CHAMADO` por chamado aberto (que ainda existe);
* `XP_BONUS_RESOLVIDO` a mais quando um chamado seu é resolvido — problema
  real, comprovado;
* `XP_CONFIRMACAO` por apoio/confirmação em chamado **de outra pessoa**
  (apoiar o próprio chamado não pontua, como em `regras.aplicar_confirmacao`);
* `XP_STRIKE` (negativo) por strike ativo. O total nunca fica abaixo de zero.

Curva de nível: subir ao nível `n` custa `XP_BASE_NIVEL * n * (n-1)` de XP
acumulado — nível 2 aos 30 XP (3 chamados ou 5 confirmações), nível 3 aos 90,
nível 4 aos 180... Cada nível carrega um título (`TITULOS`).

O ranking é por município e mede **contribuição naquela cidade** (chamados
abertos lá + confirmações em chamados de lá); strikes são reputação global e
ficam de fora — o chamado apagado já deixou de pontuar.
"""

from django.db.models import Count, F, Q

from . import regras
from .models import Apoio, Defeito

XP_CHAMADO = 10
XP_CONFIRMACAO = 6
XP_BONUS_RESOLVIDO = 15
XP_STRIKE = -20

# XP acumulado para estar no nível n: XP_BASE_NIVEL * n * (n-1).
XP_BASE_NIVEL = 15

STATUS_RESOLVIDOS = ('atendido', 'encerrado', 'concluido')

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


def _xp_total(chamados, resolvidos, confirmacoes, strikes=0):
    xp = (
        chamados * XP_CHAMADO
        + resolvidos * XP_BONUS_RESOLVIDO
        + confirmacoes * XP_CONFIRMACAO
        + strikes * XP_STRIKE
    )
    return max(xp, 0)


def resumo_do_usuario(usuario):
    """Progresso completo do usuário logado (tela de conta)."""
    chamados = Defeito.objects.filter(usuario=usuario)
    total = chamados.count()
    resolvidos = chamados.filter(status__in=STATUS_RESOLVIDOS).count()
    confirmacoes = (
        Apoio.objects.filter(usuario=usuario)
        .exclude(defeito__usuario=usuario)
        .count()
    )
    strikes = regras.strikes_ativos(usuario).count()
    dados = progresso(_xp_total(total, resolvidos, confirmacoes, strikes))
    dados.update({
        'chamados': total,
        'resolvidos': resolvidos,
        'confirmacoes': confirmacoes,
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
                'chamados': 0, 'resolvidos': 0, 'confirmacoes': 0,
            }
        return linhas[chave]

    reports = Defeito.objects.exclude(usuario=None)
    apoios = Apoio.objects.exclude(usuario=F('defeito__usuario'))
    if municipio_id is not None:
        reports = reports.filter(municipio_id=municipio_id)
        apoios = apoios.filter(defeito__municipio_id=municipio_id)
    if desde is not None:
        reports = reports.filter(criado_em__gte=desde)
        apoios = apoios.filter(criado_em__gte=desde)

    reports = reports.values('usuario_id', 'usuario__nome').annotate(
        total=Count('id'),
        resolvidos=Count('id', filter=Q(status__in=STATUS_RESOLVIDOS)),
    )
    for r in reports:
        item = linha(r['usuario_id'], r['usuario__nome'])
        item['chamados'] = r['total']
        item['resolvidos'] = r['resolvidos']

    confirmacoes = apoios.values('usuario_id', 'usuario__nome').annotate(total=Count('id'))
    for c in confirmacoes:
        linha(c['usuario_id'], c['usuario__nome'])['confirmacoes'] = c['total']

    itens = []
    for item in linhas.values():
        xp = _xp_total(item['chamados'], item['resolvidos'], item['confirmacoes'])
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
