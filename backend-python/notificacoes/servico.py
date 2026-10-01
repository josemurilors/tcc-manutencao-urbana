"""
Avisos a partir do histórico do chamado (contrato v3, seção 7.3).

`defeitos.fluxo.registrar_evento` chama `ao_evento` depois do commit de cada
evento. Daqui saem a notificação in-app (`notificacoes`) e o push (Expo, via
`push.py`), com texto humano em PT-BR para quem recebe:

- mudança pública de status → autor e apoiadores ("Seu chamado 2026-000123
  (Buraco) está em execução"); ao concluir, o autor recebe o pedido de
  avaliação (tipo `avaliar`) no lugar do aviso de status;
- resposta pública da prefeitura → autor e apoiadores (tipo `resposta`);
- atribuição → o operador atribuído, ou a equipe quando só ela foi definida;
- remoção pela moderação ou pela comunidade → o autor (tipo `moderacao`);
- marcos de apoio (5, 10, 25) → o autor (tipo `apoio_marco`), disparado pelo
  sinal de `Apoio` registrado em `apps.py` (o apoio não gera evento).

Alertas de SLA e o resumo semanal ficam nos management commands
`alertas_sla` e `resumo_semanal`, que reutilizam `notificar`.
"""
import logging

from django.db import transaction

from .models import Notificacao, PushToken
from . import push

logger = logging.getLogger(__name__)

TIPOS = ('status', 'resposta', 'avaliar', 'apoio_marco', 'sla_alerta', 'atribuido', 'moderacao', 'resumo')

MARCOS_APOIO = (5, 10, 25)

# Como cada status soa numa frase sobre o chamado ("Seu chamado X ...").
FRASES_STATUS = {
    'pendente': 'foi reaberto',
    'em_analise': 'está em análise',
    'agendado': 'foi programado',
    'em_andamento': 'está em execução',
    'concluido': 'foi resolvido',
    'rejeitado': 'foi encerrado sem atendimento',
}

# Texto padrão quando a equipe não escreveu nada para o cidadão.
CORPOS_STATUS = {
    'pendente': 'O chamado voltou para a fila da prefeitura.',
    'em_analise': 'A prefeitura está avaliando o problema relatado.',
    'agendado': 'O serviço foi programado pela equipe responsável.',
    'em_andamento': 'A equipe está trabalhando no local.',
    'concluido': 'A prefeitura informou que o problema foi resolvido.',
    'rejeitado': 'A prefeitura encerrou o chamado.',
}

MOTIVOS_REJEICAO = {
    'duplicado': 'Já existe um chamado para este mesmo problema',
    'fora_da_competencia': 'O problema não é de responsabilidade da prefeitura',
    'nao_localizado': 'A equipe não encontrou o problema no local indicado',
    'ja_resolvido': 'O problema já estava resolvido quando a equipe chegou',
    'improcedente': 'O relato não procede',
    'outro': 'A prefeitura encerrou o chamado',
}


def referencia(defeito):
    """'2026-000123 (Buraco)' — o protocolo é como o cidadão e a ouvidoria se referem ao chamado."""
    base = defeito.protocolo or f'"{defeito.titulo}"'
    return f'{base} ({defeito.categoria})' if defeito.categoria else base


# --- envio -----------------------------------------------------------------

def notificar(usuarios, tipo, titulo, corpo='', defeito=None, *, com_push=True, dados_push=None, aguardar=False):
    """
    Grava uma notificação in-app por usuário (ids, sem repetição nem None) e,
    se `com_push`, manda o push. Ponto único para qualquer app que queira avisar
    alguém (ex.: a moderação ao suspender uma conta). Devolve as notificações.
    """
    ids = [u for u in dict.fromkeys(usuarios) if u]
    if not ids:
        return []
    criadas = Notificacao.objects.bulk_create([
        Notificacao(usuario_id=uid, tipo=tipo, titulo=titulo, corpo=corpo or '',
                    defeito_id=defeito.pk if defeito is not None else None)
        for uid in ids
    ])
    if com_push:
        dados = {'tipo': tipo}
        if defeito is not None:
            dados['defeito_id'] = str(defeito.pk)
            dados['protocolo'] = defeito.protocolo
        dados.update(dados_push or {})
        enviar_push(ids, titulo, corpo or '', dados, aguardar=aguardar)
    return criadas


def enviar_push(usuarios, titulo, corpo, dados, *, aguardar=False):
    """
    Push para todos os aparelhos (`PushToken`) de `usuarios`. `dados` vai no
    payload (`{tipo, defeito_id, protocolo}`) para o app abrir o chamado ao
    tocar no aviso. Não faz nada com o push desligado.
    """
    if not push.habilitado():
        return None
    tokens = list(PushToken.objects.filter(usuario_id__in=list(usuarios)).values_list('token', flat=True))
    mensagens = [
        {'to': token, 'title': titulo, 'body': corpo, 'data': dados or {}, 'sound': 'default', 'priority': 'high'}
        for token in tokens
    ]
    return push.despachar(mensagens, aguardar=aguardar)


# --- eventos do chamado ----------------------------------------------------

def _apoiadores(defeito):
    from defeitos.models import Apoio

    return set(Apoio.objects.filter(defeito_id=defeito.pk).values_list('usuario_id', flat=True))


def destinatarios(defeito, evento):
    """Autor e apoiadores do chamado, sem quem gerou o evento."""
    ids = _apoiadores(defeito)
    if defeito.usuario_id:
        ids.add(defeito.usuario_id)
    ids.discard(evento.autor_id)
    return ids


def _corpo_status(defeito, evento, para):
    dados = evento.dados or {}
    resposta = dados.get('resposta_publica') or ''
    if para == 'rejeitado':
        motivo = MOTIVOS_REJEICAO.get(dados.get('motivo') or defeito.motivo_rejeicao, MOTIVOS_REJEICAO['outro'])
        if dados.get('duplicado_de_protocolo'):
            motivo += f' ({dados["duplicado_de_protocolo"]})'
        return f'{motivo}. {resposta}'.strip()
    return resposta or evento.texto or CORPOS_STATUS.get(para, '')


def _falta_avaliar(defeito):
    """
    O autor ainda não avaliou este ciclo de resolução: nunca avaliou, ou a
    avaliação é de antes da resolução atual (chamado reaberto e resolvido de
    novo — vale uma avaliação nova, como em `avaliar`).
    """
    if defeito.avaliacao_nota is None or defeito.avaliado_em is None:
        return True
    return bool(defeito.resolvido_em and defeito.avaliado_em < defeito.resolvido_em)


def _ao_status(defeito, evento):
    para = evento.para_status or defeito.status
    frase = FRASES_STATUS.get(para)
    if frase is None:
        return []
    ref = referencia(defeito)
    corpo = _corpo_status(defeito, evento, para)
    autor = defeito.usuario_id if defeito.usuario_id and defeito.usuario_id != evento.autor_id else None
    apoiadores = _apoiadores(defeito) - {defeito.usuario_id, evento.autor_id}
    criadas = []
    if autor:
        if para == 'concluido' and _falta_avaliar(defeito):
            criadas += notificar(
                [autor], 'avaliar', f'Seu chamado {ref} foi resolvido. Como foi o atendimento?',
                f'{corpo} Avalie o serviço: sua resposta ajuda a prefeitura a melhorar.'.strip(), defeito,
            )
        else:
            criadas += notificar([autor], 'status', f'Seu chamado {ref} {frase}', corpo, defeito)
    if apoiadores:
        criadas += notificar(apoiadores, 'status', f'O chamado {ref}, que você apoia, {frase}', corpo, defeito)
    return criadas


def _ao_resposta(defeito, evento):
    usuarios = destinatarios(defeito, evento)
    return notificar(usuarios, 'resposta', f'A prefeitura respondeu sobre o chamado {referencia(defeito)}',
                     evento.texto, defeito)


def _resumo_para_equipe(defeito):
    partes = [defeito.titulo]
    local = ', '.join(p for p in (defeito.rua, defeito.bairro) if p)
    if local:
        partes.append(local)
    if defeito.prazo_em:
        from django.utils import timezone

        partes.append(f'prazo {timezone.localtime(defeito.prazo_em):%d/%m %H:%M}')
    return ' · '.join(partes)


def _ao_atribuido(defeito, evento):
    from core import permissoes
    from users.models import User

    dados = evento.dados or {}
    ref = referencia(defeito)
    corpo = _resumo_para_equipe(defeito)
    atendente = dados.get('atendente_id')
    if atendente:
        # Quem assume para si não precisa ser avisado de si mesmo.
        if str(atendente) == str(evento.autor_id):
            return []
        return notificar([atendente], 'atribuido', f'Chamado {ref} atribuído a você', corpo, defeito)
    if dados.get('equipe_id'):
        membros = [
            u.id for u in User.objects.filter(equipe_id=dados['equipe_id'], municipio_id=defeito.municipio_id)
            if permissoes.eh_equipe(u) and u.id != evento.autor_id
        ]
        nome = dados.get('equipe_nome') or 'sua equipe'
        return notificar(membros, 'atribuido', f'Novo chamado para {nome}: {ref}', corpo, defeito)
    return []


def _ao_removido(defeito, evento):
    motivo = (evento.dados or {}).get('motivo')
    if motivo not in ('moderacao', 'comunidade'):
        return []  # 'autor': a própria pessoa excluiu.
    if not defeito.usuario_id or defeito.usuario_id == evento.autor_id:
        return []
    ref = referencia(defeito)
    if motivo == 'comunidade':
        corpo = 'Moradores da região indicaram que o problema não existe no local informado.'
    else:
        corpo = evento.texto if evento.texto and evento.texto != 'moderacao' else \
            'O chamado não segue as regras de uso do serviço.'
    return notificar([defeito.usuario_id], 'moderacao', f'Seu chamado {ref} foi removido', corpo, defeito)


def ao_evento(defeito, evento):
    """
    Roda em `on_commit`, ainda dentro da request de quem agiu: um erro aqui
    viraria 500 numa ação que já foi gravada. Por isso registra e segue.
    """
    try:
        if evento.tipo in ('status', 'reaberto') and evento.publico:
            return _ao_status(defeito, evento)
        if evento.tipo == 'resposta_publica' and evento.publico:
            return _ao_resposta(defeito, evento)
        if evento.tipo == 'atribuido':
            return _ao_atribuido(defeito, evento)
        if evento.tipo == 'removido':
            return _ao_removido(defeito, evento)
    except Exception:
        logger.exception('Falha ao notificar o evento %s do chamado %s', evento.tipo, defeito.pk)
    return []


# --- apoios ----------------------------------------------------------------

def ao_apoio(defeito_id):
    """Avisa o autor quando o chamado atinge um marco de apoios (uma vez por marco)."""
    from defeitos.fluxo import STATUS_ABERTOS
    from defeitos.models import Apoio, Defeito

    try:
        defeito = Defeito.objects.ativos().filter(pk=defeito_id).first()
        if defeito is None or not defeito.usuario_id or defeito.status not in STATUS_ABERTOS:
            return []
        # O autor que apoia o próprio chamado não conta para o marco.
        total = Apoio.objects.filter(defeito_id=defeito_id).exclude(usuario_id=defeito.usuario_id).count()
        if total not in MARCOS_APOIO:
            return []
        titulo = f'{total} pessoas apoiam seu chamado {referencia(defeito)}'
        # Tirar e repor o apoio não repete o aviso.
        if Notificacao.objects.filter(usuario_id=defeito.usuario_id, defeito_id=defeito_id,
                                      tipo='apoio_marco', titulo=titulo).exists():
            return []
        return notificar(
            [defeito.usuario_id], 'apoio_marco', titulo,
            'Quanto mais apoios, mais prioridade o problema ganha na fila da prefeitura.', defeito,
        )
    except Exception:
        logger.exception('Falha ao avisar marco de apoios do chamado %s', defeito_id)
        return []


def apoio_criado(sender, instance, created, **kwargs):
    """Receptor do `post_save` de `Apoio` (ligado em `apps.py`)."""
    if created:
        defeito_id = instance.defeito_id
        transaction.on_commit(lambda: ao_apoio(defeito_id))
