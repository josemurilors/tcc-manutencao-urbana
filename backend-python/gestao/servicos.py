"""
Regras de gestão da prefeitura que não cabem numa view: vínculo de membros,
regra de categoria por município (com recálculo de prazo) e moderação.

As views de `gestao/views.py` só validam a entrada e chamam isto; a
auditoria (`core.auditoria.registrar`) fica com a view, que tem o request
(IP) em mãos.
"""
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from core import permissoes

PAPEIS_VINCULAVEIS = ('operador', 'gestor', 'admin_municipal', 'super_admin')
PRIORIDADES = ('baixa', 'media', 'alta', 'urgente')

# Limites de configuração: evitam um SLA de 0 dias (todo chamado nasce
# vencido) ou de anos (indicador de prazo perde o sentido).
SLA_MIN_DIAS = 1
SLA_MAX_DIAS = 365
SUSPENSAO_MAX_DIAS = 365
CHECKLIST_MAX_ITENS = 20
CHECKLIST_MAX_CHARS = 120


class ErroGestao(ValueError):
    """Regra de negócio violada; `status` é o HTTP que a view devolve."""

    def __init__(self, mensagem, status=400):
        super().__init__(mensagem)
        self.status = status


# ---------------------------------------------------------------- suspensão

def usuario_suspenso(user, agora=None):
    """
    Se `user` está suspenso agora. Exposto aqui para as views de chamado
    (criar, apoiar, sinalizar) checarem — elas são de outro território.
    """
    ate = getattr(user, 'suspenso_ate', None)
    return bool(ate) and ate > (agora or timezone.now())


# ------------------------------------------------------------------ membros

def admins_do_municipio(municipio_id):
    from users.models import User

    return User.objects.filter(municipio_id=str(municipio_id), papel='admin_municipal')


def eh_ultimo_admin(alvo, municipio_id):
    """Rebaixar/revogar este admin deixaria a prefeitura sem ninguém para geri-la?"""
    if alvo.papel != 'admin_municipal':
        return False
    return not admins_do_municipio(municipio_id).exclude(pk=alvo.pk).exists()


def desatribuir_abertos(alvo, autor, motivo):
    """
    Tira `alvo` de atendente dos chamados abertos (qualquer município) e
    registra o evento interno em cada um, para o chamado voltar à fila em vez
    de ficar preso com quem não opera mais. Devolve quantos foram liberados.
    """
    from defeitos import fluxo
    from defeitos.models import Defeito

    abertos = list(Defeito.objects.filter(atendente=alvo, status__in=fluxo.STATUS_ABERTOS))
    agora = timezone.now()
    for defeito in abertos:
        defeito.atendente = None
        defeito.atualizado_em = agora
        defeito.save(update_fields=['atendente', 'atualizado_em'])
        fluxo.registrar_evento(
            defeito, 'atribuido', autor, publico=False,
            texto='Atendente removido da equipe; chamado voltou para a fila.',
            dados={'atendente_id': None, 'anterior_id': str(alvo.pk), 'motivo': motivo},
        )
    return len(abertos)


# --------------------------------------------------------------- categorias

def _base_por_id():
    from categorias.models import Categoria

    return {c.id: c for c in Categoria.objects.all()}


def regras_categorias(municipio_id):
    """
    Categorias da plataforma com o que a prefeitura sobrepôs. Uma linha por
    categoria base; `personalizado` diz se há override e `base` guarda o
    padrão para a tela mostrar "voltar ao padrão".
    """
    from defeitos.sla import SECRETARIAS_PADRAO, CATEGORIA_OUTRO, normalizar
    from .models import CategoriaMunicipio

    overrides = {
        o.categoria_id: o
        for o in CategoriaMunicipio.objects.select_related('secretaria').filter(municipio_id=str(municipio_id))
    }
    linhas = []
    for cat in sorted(_base_por_id().values(), key=lambda c: c.nome):
        o = overrides.get(cat.id)
        secretaria = o.secretaria if o is not None else None
        linhas.append({
            'categoria_id': cat.id,
            'nome': cat.nome,
            'icone': cat.icone,
            'prazo_sla_dias': (o.prazo_sla_dias if o is not None and o.prazo_sla_dias else cat.prazo_sla_dias),
            'prioridade': (o.prioridade if o is not None and o.prioridade else cat.prioridade_base),
            'secretaria_id': secretaria.id if secretaria else None,
            'secretaria_nome': (
                secretaria.nome if secretaria
                else SECRETARIAS_PADRAO.get(normalizar(cat.nome), SECRETARIAS_PADRAO[CATEGORIA_OUTRO])
            ),
            'ativo': o.ativo if o is not None else True,
            'checklist': list(o.checklist or []) if o is not None else [],
            'personalizado': o is not None,
            'base': {'prazo_sla_dias': cat.prazo_sla_dias, 'prioridade': cat.prioridade_base},
        })
    return linhas


def regra_categoria(municipio_id, categoria_id):
    for linha in regras_categorias(municipio_id):
        if linha['categoria_id'] == categoria_id:
            return linha
    return None


def recalcular_prazos(municipio_id, categoria, prazo_antigo, prazo_novo, autor):
    """
    Novo SLA da categoria vale também para os chamados abertos dela no
    município: `prazo_sla_dias` e `prazo_em` mudam e cada um ganha um evento
    interno `sla`. Só os que ainda seguiam a regra antiga (prazo igual ao
    anterior) — um prazo ajustado à mão num chamado específico prevalece.
    Chamados antigos sem `categoria_id` são achados pelo nome.
    """
    from django.db.models import Q

    from defeitos import fluxo, sla
    from defeitos.models import Defeito

    if not prazo_novo or prazo_antigo == prazo_novo:
        return 0
    qs = (
        Defeito.objects.ativos()
        .filter(municipio_id=str(municipio_id), status__in=fluxo.STATUS_ABERTOS, prazo_sla_dias=prazo_antigo)
        .filter(Q(categoria_id=categoria.id) | Q(categoria_id__isnull=True, categoria__iexact=categoria.nome))
    )
    total = 0
    for defeito in qs:
        prazo_em_antes = defeito.prazo_em
        defeito.prazo_sla_dias = prazo_novo
        defeito.prazo_em = sla.calcular_prazo(defeito.criado_em, prazo_novo)
        defeito.save(update_fields=['prazo_sla_dias', 'prazo_em'])
        fluxo.registrar_evento(
            defeito, 'sla', autor, publico=False,
            texto=f'Prazo da categoria alterado de {prazo_antigo} para {prazo_novo} dias.',
            dados={
                'origem': 'categoria', 'de_dias': prazo_antigo, 'para_dias': prazo_novo,
                'prazo_em_antes': prazo_em_antes, 'prazo_em': defeito.prazo_em,
            },
        )
        total += 1
    return total


# ---------------------------------------------------------------- moderação

def restaurar(defeito, autor, *, motivo=''):
    """
    Desfaz a remoção (soft delete). Se quem removeu foi a comunidade, o
    autor tinha levado um strike por isso: ele é retirado, porque a
    prefeitura acabou de dizer que o chamado era legítimo.
    """
    from defeitos import fluxo
    from defeitos.models import Strike

    motivo_anterior = defeito.removido_motivo
    strike_retirado = False
    with transaction.atomic():
        defeito.removido_em = None
        defeito.removido_motivo = ''
        defeito.atualizado_em = timezone.now()
        defeito.save(update_fields=['removido_em', 'removido_motivo', 'atualizado_em'])
        if motivo_anterior == 'comunidade' and defeito.usuario_id:
            strike = (
                Strike.objects.filter(usuario_id=defeito.usuario_id, titulo=defeito.titulo)
                .order_by('-criado_em').first()
            )
            if strike is not None:
                strike.delete()
                strike_retirado = True
        fluxo.registrar_evento(
            defeito, 'moderacao', autor, publico=False,
            texto='Chamado restaurado pela prefeitura.' + (f' {motivo}' if motivo else ''),
            dados={'acao': 'restaurar', 'motivo_anterior': motivo_anterior, 'strike_retirado': strike_retirado},
        )
    return strike_retirado


def suspender(alvo, dias, motivo):
    from notificacoes.servico import notificar

    alvo.suspenso_ate = timezone.now() + timedelta(days=dias)
    alvo.save(update_fields=['suspenso_ate'])
    # Aviso in-app + push: o cidadão precisa saber por que não consegue mais
    # reportar. `notificar` registra e segue se o push falhar.
    notificar(
        [alvo.pk], 'moderacao', 'Sua conta foi suspensa temporariamente',
        f'Por {dias} dia(s) você não poderá abrir chamados nem apoiar. Motivo: {motivo}',
    )
    return alvo


def reativar(alvo):
    from notificacoes.servico import notificar

    alvo.suspenso_ate = None
    alvo.save(update_fields=['suspenso_ate'])
    notificar(
        [alvo.pk], 'moderacao', 'Sua conta foi reativada',
        'Você já pode voltar a abrir chamados e apoiar os da sua região.',
    )
    return alvo


def pode_moderar_usuario(gestor, alvo, municipio_id):
    """
    Gestor modera cidadãos ligados ao seu município (moram lá ou abriram
    chamado lá). Servidores ficam fora: o caminho para eles é `membros/`.
    """
    from defeitos.models import Defeito

    if alvo.pk == gestor.pk or permissoes.eh_equipe(alvo):
        return False
    if str(alvo.municipio_id or '') == str(municipio_id):
        return True
    return Defeito.objects.filter(usuario=alvo, municipio_id=str(municipio_id)).exists()
