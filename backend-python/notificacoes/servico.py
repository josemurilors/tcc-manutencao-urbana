"""
Avisos ao cidadão a partir do histórico do chamado.

`defeitos.fluxo` chama `ao_evento` depois do commit de cada evento. Aqui só
o mínimo: notificação in-app para o autor e quem apoiou, quando o evento é
público e muda algo que o cidadão acompanha (status ou resposta da
prefeitura). O envio de push fica em `enviar_push`, ainda sem transporte.
"""
import logging

from .models import Notificacao

logger = logging.getLogger(__name__)

# Tipos de evento que viram aviso para quem acompanha o chamado.
TIPOS_NOTIFICADOS = ('status', 'resposta_publica')


def destinatarios(defeito, evento):
    """Autor e apoiadores do chamado, sem quem gerou o evento."""
    from defeitos.models import Apoio

    ids = set(Apoio.objects.filter(defeito_id=defeito.pk).values_list('usuario_id', flat=True))
    if defeito.usuario_id:
        ids.add(defeito.usuario_id)
    ids.discard(evento.autor_id)
    return ids


def _mensagem(defeito, evento):
    from defeitos.fluxo import ROTULOS_CIDADAO

    ref = defeito.protocolo or defeito.titulo
    if evento.tipo == 'resposta_publica':
        return f'Resposta da prefeitura ({ref})', evento.texto
    rotulo = ROTULOS_CIDADAO.get(evento.para_status or defeito.status, defeito.status)
    corpo = (evento.dados or {}).get('resposta_publica') or evento.texto or defeito.titulo
    return f'Chamado {ref}: {rotulo}', corpo


def ao_evento(defeito, evento):
    if not evento.publico or evento.tipo not in TIPOS_NOTIFICADOS:
        return []
    usuarios = destinatarios(defeito, evento)
    if not usuarios:
        return []
    titulo, corpo = _mensagem(defeito, evento)
    criadas = Notificacao.objects.bulk_create([
        Notificacao(usuario_id=uid, tipo=evento.tipo, titulo=titulo, corpo=corpo or '', defeito_id=defeito.pk)
        for uid in usuarios
    ])
    enviar_push(usuarios, titulo, corpo or '', {'defeito_id': str(defeito.pk), 'tipo': evento.tipo})
    return criadas


def enviar_push(usuarios, titulo, corpo, dados):
    """
    Envia push para os aparelhos (`PushToken`) de `usuarios`.

    No-op por enquanto: o transporte (Expo Push) é de outra entrega. Quem
    implementar mantém a assinatura — `ao_evento` já chama com os ids dos
    usuários, título, corpo e `dados` ({defeito_id, tipo}) para o app abrir
    o chamado ao tocar no aviso.
    """
    logger.debug('push pendente para %d usuário(s): %s', len(usuarios), titulo)
