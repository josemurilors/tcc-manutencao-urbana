"""
Retenção de dados pessoais (LGPD, art. 15 e 16): apaga ou anonimiza o que
passou do prazo prometido na política de privacidade. Roda uma vez por dia
pelo agendador (`entrypoint.sh agendador`); rodar de novo é inofensivo.

Prazos (os da política em `privacidade.tsx` e do contrato v3):

* IP da trilha de auditoria: 30 dias — a linha fica (é da prefeitura), o
  endereço é zerado;
* advertências (strikes): 90 dias (`regras.STRIKE_VALIDADE_DIAS`), quando já
  deixaram de contar;
* convites não aceitos: 30 dias depois de vencer (levam o e-mail);
* notificações lidas: 180 dias;
* aparelhos de push sem uso: 180 dias;
* chamados excluídos pelo próprio autor: 30 dias depois, saem a foto, as
  fotos extras e a descrição (o registro mínimo fica para o histórico).

`--simular` só conta, sem gravar nada.
"""
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

IP_DIAS = 30
CONVITE_VENCIDO_DIAS = 30
NOTIFICACAO_LIDA_DIAS = 180
PUSH_SEM_USO_DIAS = 180
REMOVIDO_PELO_AUTOR_DIAS = 30


def aplicar(agora=None, simular=False):
    """Aplica os prazos; devolve {o que: quantos}."""
    from defeitos.models import Defeito, DefeitoAnexo, Strike
    from defeitos.regras import STRIKE_VALIDADE_DIAS
    from gestao.models import AuditLog, Convite
    from notificacoes.models import Notificacao, PushToken

    agora = agora or timezone.now()
    antes = lambda dias: agora - timedelta(days=dias)  # noqa: E731

    ips = AuditLog.objects.filter(criado_em__lt=antes(IP_DIAS)).exclude(ip='')
    strikes = Strike.objects.filter(criado_em__lt=antes(STRIKE_VALIDADE_DIAS))
    convites = Convite.objects.filter(aceito_em__isnull=True, expira_em__lt=antes(CONVITE_VENCIDO_DIAS))
    notificacoes = Notificacao.objects.filter(lida_em__lt=antes(NOTIFICACAO_LIDA_DIAS))
    aparelhos = PushToken.objects.filter(ultimo_uso__lt=antes(PUSH_SEM_USO_DIAS))
    removidos = (
        Defeito.objects.filter(removido_motivo='autor', removido_em__lt=antes(REMOVIDO_PELO_AUTOR_DIAS))
        .filter(~Q(descricao='') | ~Q(imagens_extra='[]') | Q(imagem_thumbnail__isnull=False)
                | Q(foto_resolucao__isnull=False))
    )
    removidos_ids = list(removidos.values_list('pk', flat=True))
    anexos = DefeitoAnexo.objects.filter(defeito_id__in=removidos_ids)

    if simular:
        return {
            'ips': ips.count(), 'strikes': strikes.count(), 'convites': convites.count(),
            'notificacoes': notificacoes.count(), 'aparelhos_push': aparelhos.count(),
            'chamados_removidos': len(removidos_ids), 'anexos': anexos.count(),
        }
    with transaction.atomic():
        resultado = {
            'ips': ips.update(ip=''),
            'strikes': strikes.delete()[0],
            'convites': convites.delete()[0],
            'notificacoes': notificacoes.delete()[0],
            'aparelhos_push': aparelhos.delete()[0],
            'anexos': anexos.delete()[0],
            'chamados_removidos': Defeito.objects.filter(pk__in=removidos_ids).update(
                descricao='', imagem_thumbnail=None, foto_resolucao=None, imagens_extra='[]',
            ),
        }
    return resultado


class Command(BaseCommand):
    help = 'Apaga ou anonimiza dados pessoais que passaram do prazo de retenção.'

    def add_arguments(self, parser):
        parser.add_argument('--simular', action='store_true', help='Só conta, sem gravar.')

    def handle(self, *args, **opcoes):
        resultado = aplicar(simular=opcoes['simular'])
        prefixo = 'simulação: ' if opcoes['simular'] else ''
        self.stdout.write(prefixo + ', '.join(f'{k}={v}' for k, v in resultado.items()))
