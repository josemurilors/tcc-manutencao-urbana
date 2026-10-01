"""
Fila da operação: o que a equipe deve atacar primeiro (contrato v3, 7.1).

O `score` (0–100) é calculado no banco, para ordenar e paginar sem trazer o
município inteiro para a memória (a fila antiga parava em 2000 chamados e o
resto simplesmente sumia). Cinco componentes, cada um normalizado em 0..1 e
multiplicado pelo seu peso:

    score = 30 * prioridade      urgente 1 · alta 0,7 · media 0,4 · baixa/vazio 0,2
          + 30 * pressão do SLA  1 se vencido; senão fração do prazo já consumida
                                 (agora - criado_em) / (prazo_em - criado_em);
                                 0 sem prazo definido
          + 20 * apoios          min(apoios, 10) / 10
          + 10 * idade           min(dias desde a abertura, 60) / 60
          + 10 * sinalizações    min(sinalizações "resolvido" + "não existe", 3) / 3

Por que esses pesos: prioridade e SLA são compromisso da prefeitura (o SLA é
o que o TCE e a ouvidoria cobram), por isso dividem 60% do peso. Apoios
medem o impacto percebido pela população, mas saturam em 10 para um
chamado viral não enterrar um semáforo apagado. A idade desempata o que
ficou esquecido sem prazo. Sinalizações indicam que alguém no local diz que
o problema sumiu ou nunca existiu: vale uma checagem rápida para fechar a
fila e não mandar equipe à toa.

`motivos(defeito)` devolve, em linguagem de servidor, o que mais pesou —
o app mostra o primeiro na linha da fila.
"""
from django.db.models import (
    Case, Count, F, FloatField, Func, IntegerField, OuterRef, Q, Subquery, Value, When,
)
from django.db.models.functions import Cast, Coalesce, Greatest, Least, NullIf
from django.utils import timezone

from defeitos.models import Apoio, Sinalizacao

PESO_PRIORIDADE = 30
PESO_SLA = 30
PESO_APOIOS = 20
PESO_IDADE = 10
PESO_SINALIZACOES = 10

PRIORIDADE_FATOR = {'urgente': 1.0, 'alta': 0.7, 'media': 0.4, 'baixa': 0.2}
PRIORIDADE_FATOR_PADRAO = 0.2

APOIOS_TETO = 10
IDADE_TETO_DIAS = 60
SINALIZACOES_TETO = 3


class _Epoch(Func):
    """Segundos desde 1970 de um timestamp (Postgres)."""
    template = 'EXTRACT(EPOCH FROM %(expressions)s)'
    output_field = FloatField()


def _contagem(model, **filtro):
    """COUNT correlacionado por chamado. Subquery em vez de JOIN + GROUP BY:
    não multiplica uma contagem pela outra e deixa o ORDER BY livre."""
    sub = (
        model.objects.filter(defeito_id=OuterRef('pk'), **filtro)
        .order_by().values('defeito_id').annotate(c=Count('*')).values('c')[:1]
    )
    return Coalesce(Subquery(sub, output_field=IntegerField()), Value(0))


def anotar(qs, agora=None):
    """Acrescenta `total_apoios`, `total_resolvido`, `total_nao_existe` e `score`."""
    agora = agora or timezone.now()
    qs = qs.annotate(
        total_apoios=_contagem(Apoio),
        total_resolvido=_contagem(Sinalizacao, tipo=Sinalizacao.RESOLVIDO),
        total_nao_existe=_contagem(Sinalizacao, tipo=Sinalizacao.NAO_EXISTE),
    )

    agora_s = _Epoch(Value(agora))
    prioridade = Case(
        *[When(prioridade=nome, then=Value(fator)) for nome, fator in PRIORIDADE_FATOR.items()],
        default=Value(PRIORIDADE_FATOR_PADRAO), output_field=FloatField(),
    )
    duracao_prazo = NullIf(_Epoch(F('prazo_em')) - _Epoch(F('criado_em')), Value(0.0))
    consumido = (agora_s - _Epoch(F('criado_em'))) / duracao_prazo
    sla = Case(
        When(prazo_em__isnull=True, then=Value(0.0)),
        When(prazo_em__lte=agora, then=Value(1.0)),
        default=Coalesce(Greatest(Value(0.0), Least(Value(1.0), consumido)), Value(0.0)),
        output_field=FloatField(),
    )
    apoios = Cast(Least(F('total_apoios'), Value(APOIOS_TETO)), FloatField()) / Value(float(APOIOS_TETO))
    idade = Greatest(
        Value(0.0),
        Least((agora_s - _Epoch(F('criado_em'))) / Value(86400.0), Value(float(IDADE_TETO_DIAS))),
    ) / Value(float(IDADE_TETO_DIAS))
    sinalizacoes = Cast(
        Least(F('total_resolvido') + F('total_nao_existe'), Value(SINALIZACOES_TETO)), FloatField(),
    ) / Value(float(SINALIZACOES_TETO))
    return qs.annotate(score=(
        Value(float(PESO_PRIORIDADE)) * prioridade
        + Value(float(PESO_SLA)) * sla
        + Value(float(PESO_APOIOS)) * apoios
        + Value(float(PESO_IDADE)) * idade
        + Value(float(PESO_SINALIZACOES)) * sinalizacoes
    ))


# Ordenações aceitas em `?ordenar=`; o id no fim deixa a paginação estável.
ORDENACOES = {
    'score': (F('score').desc(), F('prazo_em').asc(nulls_last=True), 'criado_em', 'id'),
    'prazo': (F('prazo_em').asc(nulls_last=True), F('score').desc(), 'id'),
    'antigos': ('criado_em', 'id'),
    'apoios': (F('total_apoios').desc(), F('score').desc(), 'id'),
    'distancia': (F('distancia_m').asc(nulls_last=True), F('score').desc(), 'id'),
}


def filtro_vencidos(agora=None):
    from defeitos.fluxo import STATUS_ABERTOS

    return Q(status__in=STATUS_ABERTOS, prazo_em__lt=agora or timezone.now())


def motivos(defeito, agora=None):
    """Frases curtas do que mais pesou no score, na ordem do peso."""
    from defeitos import sla

    agora = agora or timezone.now()
    saida = []
    restante = sla.sla_restante_horas(defeito, agora)
    if restante is not None:
        if restante < 0:
            dias = int(-restante // 24)
            saida.append(f'Prazo vencido há {dias} d' if dias else f'Prazo vencido há {int(-restante)} h')
        elif restante <= 24:
            saida.append(f'Prazo vence em {max(1, int(restante))} h')
    if defeito.prioridade in ('urgente', 'alta'):
        saida.append(f'Prioridade {defeito.prioridade}')
    apoios = getattr(defeito, 'total_apoios', 0) or 0
    if apoios:
        saida.append(f'{apoios} apoio' + ('s' if apoios > 1 else ''))
    sinais = (getattr(defeito, 'total_resolvido', 0) or 0) + (getattr(defeito, 'total_nao_existe', 0) or 0)
    if sinais:
        saida.append('Cidadãos dizem que já foi resolvido ou não existe')
    if defeito.criado_em:
        dias = (agora - defeito.criado_em).days
        if dias >= 15:
            saida.append(f'Aberto há {dias} dias')
    return saida
