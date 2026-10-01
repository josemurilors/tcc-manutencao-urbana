"""
Ciclo de vida do chamado (contrato v3, seção 1).

Toda mudança de status passa por `transicionar`: valida a transição e quem
pode fazê-la, grava os timestamps (só daqui — `triado_em`, `iniciado_em`,
`resolvido_em`, `fechado_em`) e registra o evento no histórico, que depois
do commit vira aviso ao cidadão (`notificacoes.servico.ao_evento`).
Views, regras comunitárias e comandos chamam isto em vez de mexer em
`defeito.status`.
"""
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from core import permissoes

STATUS_ABERTOS = ('pendente', 'em_analise', 'agendado', 'em_andamento')
STATUS_FECHADOS = ('concluido', 'rejeitado')

TRANSICOES = {
    'pendente': ('em_analise', 'agendado', 'em_andamento', 'concluido', 'rejeitado'),
    'em_analise': ('agendado', 'em_andamento', 'concluido', 'rejeitado'),
    'agendado': ('em_analise', 'em_andamento', 'concluido', 'rejeitado'),
    'em_andamento': ('agendado', 'concluido', 'rejeitado'),
    'concluido': ('pendente',),
    'rejeitado': ('pendente',),
}

MOTIVOS_REJEICAO = (
    'duplicado', 'fora_da_competencia', 'nao_localizado',
    'ja_resolvido', 'improcedente', 'outro',
)

ROTULOS_CIDADAO = {
    'pendente': 'Recebido',
    'em_analise': 'Em análise',
    'agendado': 'Programado',
    'em_andamento': 'Em execução',
    'concluido': 'Resolvido',
    'rejeitado': 'Não procede',
}

ROTULOS_OPERACAO = {
    'pendente': 'Novo',
    'em_analise': 'Em triagem',
    'agendado': 'Programado',
    'em_andamento': 'Em execução',
    'concluido': 'Concluído',
    'rejeitado': 'Rejeitado',
}

# Valores antigos ainda mandados por apps desatualizados (o banco já foi
# convertido pelo `bootstrap_schema`).
STATUS_LEGADOS = {
    'vinculado_sem_resposta': 'em_andamento',
    'vinculado_com_resposta': 'em_andamento',
    'atendido': 'concluido',
    'encerrado': 'concluido',
}

# O autor pode reabrir o próprio chamado concluído até este prazo.
REABERTURA_AUTOR_DIAS = 30

# Papéis que agem "pela plataforma" e não passam pela checagem de equipe.
PAPEIS_AUTOMATICOS = ('sistema', 'comunidade')


class TransicaoInvalida(ValueError):
    """Transição que o ciclo de vida não permite (ou dados faltando)."""


class TransicaoNaoPermitida(TransicaoInvalida):
    """Transição válida, mas o autor não tem papel para fazê-la (vira 403)."""


def normalizar_status(status):
    return STATUS_LEGADOS.get(status, status)


def _checar_permissao(defeito, de, para, autor, papel):
    if papel in PAPEIS_AUTOMATICOS:
        if papel == 'comunidade' and para != 'concluido':
            raise TransicaoNaoPermitida('A comunidade só conclui chamados.')
        return
    if para == 'pendente' and de == 'concluido':
        eh_autor = autor is not None and defeito.usuario_id == getattr(autor, 'id', None)
        fechado = defeito.fechado_em or timezone.now()
        if eh_autor and timezone.now() - fechado <= timedelta(days=REABERTURA_AUTOR_DIAS):
            return
    if not permissoes.pode_operar(autor, defeito):
        raise TransicaoNaoPermitida('Chamado fora do seu município de operação'
                                    if permissoes.eh_equipe(autor) else 'Permissão negada')
    # Rejeitar e reabrir são decisões de gestão (contrato, seção 3).
    if (para == 'rejeitado' or para == 'pendente') and permissoes.nivel(autor) < permissoes.NIVEIS['gestor']:
        raise TransicaoNaoPermitida('Só gestores podem rejeitar ou reabrir chamados.')


def _validar_duplicado(defeito, duplicado_de):
    from .models import Defeito

    if duplicado_de is None or duplicado_de == '':
        raise TransicaoInvalida('Informe de qual chamado este é duplicado.')
    if not isinstance(duplicado_de, Defeito):
        try:
            duplicado_de = Defeito.objects.ativos().get(pk=duplicado_de)
        # DoesNotExist, ou ValidationError do Django para UUID malformado.
        except Exception:
            raise TransicaoInvalida('Chamado original não encontrado.')
    if duplicado_de.pk == defeito.pk:
        raise TransicaoInvalida('Um chamado não pode ser duplicado dele mesmo.')
    if str(duplicado_de.municipio_id or '') != str(defeito.municipio_id or ''):
        raise TransicaoInvalida('O chamado original precisa ser do mesmo município.')
    return duplicado_de


def transicionar(defeito, para, autor, *, papel=None, texto='', resposta_publica='', motivo='',
                 duplicado_de=None, dados=None):
    """
    Move `defeito` para o status `para` em nome de `autor` (None = sistema).
    Levanta `TransicaoInvalida` (ou `TransicaoNaoPermitida`) sem gravar nada.
    """
    from .models import Defeito

    para = normalizar_status(para)
    if para not in TRANSICOES:
        raise TransicaoInvalida('Status inválido.')
    papel = papel or (permissoes.papel(autor) if autor is not None else 'sistema')

    with transaction.atomic():
        # Relê o status travando a linha: duas ações simultâneas não passam
        # ambas pela mesma transição.
        atual = Defeito.objects.select_for_update().only('status').get(pk=defeito.pk)
        de = normalizar_status(atual.status)
        if para not in TRANSICOES.get(de, ()):
            raise TransicaoInvalida(
                f'Não é possível passar de "{ROTULOS_OPERACAO.get(de, de)}" '
                f'para "{ROTULOS_OPERACAO[para]}".'
            )
        _checar_permissao(defeito, de, para, autor, papel)

        extras = dict(dados or {})
        if para == 'rejeitado':
            if motivo not in MOTIVOS_REJEICAO:
                raise TransicaoInvalida('Informe o motivo da rejeição.')
            defeito.motivo_rejeicao = motivo
            extras['motivo'] = motivo
            if motivo == 'duplicado':
                original = _validar_duplicado(defeito, duplicado_de)
                defeito.duplicado_de = original
                extras['duplicado_de'] = str(original.pk)
                extras['duplicado_de_protocolo'] = original.protocolo

        agora = timezone.now()
        reabertura = de in STATUS_FECHADOS and para == 'pendente'
        if de == 'pendente' and defeito.triado_em is None:
            defeito.triado_em = agora
        if para == 'em_andamento' and defeito.iniciado_em is None:
            defeito.iniciado_em = agora
        if para == 'concluido':
            defeito.resolvido_em = agora
            # Legado (TEXT) ainda lido pelo app e pelo painel antigo.
            defeito.atendido_em = agora.isoformat()
        if para in STATUS_FECHADOS:
            defeito.fechado_em = agora
        if reabertura:
            defeito.fechado_em = None
            defeito.atendido_em = ''
            defeito.reaberturas = (defeito.reaberturas or 0) + 1
            defeito.motivo_rejeicao = ''
            defeito.duplicado_de = None
            # Prazo novo a partir da reabertura: com o antigo, o chamado
            # voltaria para a fila (e para o cidadão) já "atrasado há N dias".
            from .sla import calcular_prazo
            novo_prazo = calcular_prazo(agora, defeito.prazo_sla_dias)
            if novo_prazo is not None:
                defeito.prazo_em = novo_prazo
        if resposta_publica:
            defeito.resposta_publica = resposta_publica
            extras['resposta_publica'] = resposta_publica

        defeito.status = para
        defeito.atualizado_em = agora
        defeito.save(update_fields=[
            'status', 'atualizado_em', 'triado_em', 'iniciado_em', 'resolvido_em',
            'fechado_em', 'atendido_em', 'reaberturas', 'motivo_rejeicao',
            'duplicado_de', 'resposta_publica', 'prazo_em',
        ])
        registrar_evento(
            defeito, 'reaberto' if reabertura else 'status', autor,
            papel=papel, texto=texto, dados=extras, de_status=de, para_status=para,
        )
    return defeito


def registrar_evento(defeito, tipo, autor=None, *, papel=None, publico=True, texto='', dados=None,
                     de_status=None, para_status=None):
    """Grava um evento no histórico e agenda o aviso (`ao_evento`) para depois do commit."""
    from .models import DefeitoEvento

    if papel is None:
        papel = permissoes.papel(autor) if autor is not None else 'sistema'
    evento = DefeitoEvento.objects.create(
        defeito=defeito,
        tipo=tipo,
        de_status=de_status,
        para_status=para_status,
        autor=autor if autor is not None and getattr(autor, 'is_authenticated', False) else None,
        papel=papel,
        publico=publico,
        texto=texto or '',
        dados=dados or {},
    )
    transaction.on_commit(lambda: _notificar(defeito, evento))
    return evento


def _notificar(defeito, evento):
    try:
        from notificacoes.servico import ao_evento
    except ImportError:
        return
    ao_evento(defeito, evento)


def atribuir(defeito, autor, *, equipe_id=None, atendente_id=None):
    """
    Atribui o chamado a uma equipe e/ou operador. Assumir para si é de
    qualquer operador do município; atribuir a outra pessoa ou equipe é de
    gestor+. Grava `atribuido_em` na primeira atribuição.
    """
    from gestao.models import Equipe
    from users.models import User

    if not permissoes.pode_operar(autor, defeito):
        raise TransicaoNaoPermitida('Chamado fora do seu município de operação'
                                    if permissoes.eh_equipe(autor) else 'Permissão negada')
    para_si = equipe_id is None and atendente_id is not None and str(atendente_id) == str(autor.id)
    if not para_si and permissoes.nivel(autor) < permissoes.NIVEIS['gestor']:
        raise TransicaoNaoPermitida('Só gestores atribuem chamados a outras pessoas ou equipes.')
    if defeito.status in STATUS_FECHADOS:
        raise TransicaoInvalida('Chamado já finalizado.')

    dados = {}
    campos = ['atualizado_em']
    if equipe_id is not None:
        equipe = Equipe.objects.filter(pk=equipe_id, municipio_id=defeito.municipio_id, ativo=True).first()
        if equipe is None:
            raise TransicaoInvalida('Equipe não encontrada neste município.')
        defeito.equipe = equipe
        campos.append('equipe')
        dados['equipe_id'] = equipe.id
        dados['equipe_nome'] = equipe.nome
    if atendente_id is not None:
        atendente = User.objects.filter(pk=atendente_id).first()
        if atendente is None or not permissoes.pode_operar(atendente, defeito):
            raise TransicaoInvalida('Operador não pertence à equipe deste município.')
        defeito.atendente = atendente
        campos.append('atendente')
        dados['atendente_id'] = str(atendente.id)
    if not dados:
        raise TransicaoInvalida('Informe a equipe ou o operador.')

    agora = timezone.now()
    if defeito.atribuido_em is None:
        defeito.atribuido_em = agora
        campos.append('atribuido_em')
    defeito.atualizado_em = agora
    with transaction.atomic():
        defeito.save(update_fields=campos)
        # Interno: quem atende é dado da equipe, não do cidadão.
        registrar_evento(defeito, 'atribuido', autor, publico=False, dados=dados)
    return defeito
