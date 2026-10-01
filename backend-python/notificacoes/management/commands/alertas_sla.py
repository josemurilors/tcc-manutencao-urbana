"""
Avisa a equipe responsável e os gestores sobre chamados cujo prazo (SLA)
vence nas próximas 24 h ou já venceu. Pensado para rodar de hora em hora
(cron/agendador); pode rodar quantas vezes quiser sem repetir aviso.

Deduplicação sem coluna extra: o alerta "vence em 24 h" só sai se o usuário
ainda não tem `sla_alerta` daquele chamado criado depois de `prazo_em - 24h`;
o "venceu", se não tem um criado depois de `prazo_em`. Se o gestor muda o
prazo, a janela anda junto e o alerta volta a valer para o prazo novo.

Quem recebe: o operador atribuído, os membros da equipe do chamado e os
gestores/admins do município (os de uma secretaria só recebem os dela).
In-app vai um por chamado; o push sai agrupado por pessoa, para não disparar
dezenas de vibrações seguidas.
"""
from collections import defaultdict
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from core import permissoes
from defeitos.fluxo import STATUS_ABERTOS
from defeitos.models import Defeito
from notificacoes import servico
from notificacoes.models import Notificacao
from users.models import User

JANELA_AVISO = timedelta(hours=24)
PAPEIS_GESTAO = ('gestor', 'admin_municipal')


class Responsaveis:
    """Resolve (e guarda por município/equipe) quem responde por cada chamado."""

    def __init__(self):
        self._gestores = {}
        self._equipes = {}

    def gestores(self, municipio_id):
        if municipio_id not in self._gestores:
            self._gestores[municipio_id] = list(
                User.objects.filter(municipio_id=municipio_id, papel__in=PAPEIS_GESTAO)
                .values_list('id', 'secretaria_id')
            )
        return self._gestores[municipio_id]

    def equipe(self, equipe_id, municipio_id):
        chave = (equipe_id, municipio_id)
        if chave not in self._equipes:
            self._equipes[chave] = [
                u.id for u in User.objects.filter(equipe_id=equipe_id, municipio_id=municipio_id)
                if permissoes.eh_equipe(u)
            ]
        return self._equipes[chave]

    def de(self, defeito):
        ids = []
        if defeito.atendente_id:
            ids.append(defeito.atendente_id)
        if defeito.equipe_id:
            ids += self.equipe(defeito.equipe_id, defeito.municipio_id)
        ids += [
            uid for uid, secretaria_id in self.gestores(defeito.municipio_id)
            if secretaria_id is None or secretaria_id == defeito.secretaria_id
        ]
        return list(dict.fromkeys(ids))


def _horas(delta):
    return max(1, round(delta.total_seconds() / 3600))


class Command(BaseCommand):
    help = 'Avisa equipe e gestores sobre chamados com prazo vencendo (24 h) ou vencido.'

    def add_arguments(self, parser):
        parser.add_argument('--municipio', help='Só este município (código IBGE).')
        parser.add_argument(
            '--vencidos-desde-dias', type=int, default=7,
            help='Ignora chamados vencidos há mais que isso (evita a avalanche do backlog antigo '
                 'na primeira execução). Padrão: 7.',
        )
        parser.add_argument('--dry-run', action='store_true', help='Só mostra o que seria enviado.')

    def handle(self, *args, **opts):
        agora = timezone.now()
        qs = (
            Defeito.objects.ativos().leves()
            .filter(status__in=STATUS_ABERTOS, prazo_em__isnull=False,
                    prazo_em__lte=agora + JANELA_AVISO,
                    prazo_em__gte=agora - timedelta(days=opts['vencidos_desde_dias']))
            .exclude(municipio_id__isnull=True)
            .order_by('prazo_em')
        )
        if opts['municipio']:
            qs = qs.filter(municipio_id=opts['municipio'])

        responsaveis = Responsaveis()
        por_usuario = defaultdict(list)  # usuário -> [(defeito, vencido, titulo, corpo)]
        total = 0
        defeitos = list(qs)
        # Avisos já dados, numa consulta só (antes era uma por chamado). A
        # janela mais antiga possível é `prazo_em - 24 h` do primeiro chamado.
        avisos = defaultdict(list)  # defeito_id -> [(usuario_id, criado_em)]
        if defeitos:
            for defeito_id, usuario_id, criado_em in Notificacao.objects.filter(
                tipo='sla_alerta', defeito_id__in=[d.pk for d in defeitos],
                criado_em__gte=min(d.prazo_em for d in defeitos) - JANELA_AVISO,
            ).values_list('defeito_id', 'usuario_id', 'criado_em'):
                avisos[defeito_id].append((usuario_id, criado_em))
        for defeito in defeitos:
            vencido = defeito.prazo_em <= agora
            inicio_janela = defeito.prazo_em if vencido else defeito.prazo_em - JANELA_AVISO
            destinatarios = responsaveis.de(defeito)
            if not destinatarios:
                continue
            ja_avisados = {u for u, quando in avisos[defeito.pk] if quando >= inicio_janela}
            novos = [u for u in destinatarios if u not in ja_avisados]
            if not novos:
                continue
            ref = servico.referencia(defeito)
            prazo = timezone.localtime(defeito.prazo_em)
            if vencido:
                titulo = f'Prazo vencido: chamado {ref}'
                corpo = f'{defeito.titulo} — venceu em {prazo:%d/%m às %H:%M} ({_horas(agora - defeito.prazo_em)} h de atraso).'
            else:
                titulo = f'Prazo vence em {_horas(defeito.prazo_em - agora)} h: chamado {ref}'
                corpo = f'{defeito.titulo} — prazo até {prazo:%d/%m às %H:%M}.'
            if defeito.bairro:
                corpo += f' Bairro: {defeito.bairro}.'
            total += len(novos)
            if opts['dry_run']:
                self.stdout.write(f'[dry-run] {titulo} -> {len(novos)} pessoa(s)')
                continue
            servico.notificar(novos, 'sla_alerta', titulo, corpo, defeito, com_push=False)
            for uid in novos:
                por_usuario[uid].append((defeito, vencido, titulo, corpo))

        for uid, alertas in por_usuario.items():
            self._push_agrupado(uid, alertas)
        self.stdout.write(self.style.SUCCESS(f'{total} alerta(s) de SLA enviados para {len(por_usuario)} pessoa(s).'))

    @staticmethod
    def _push_agrupado(uid, alertas):
        if len(alertas) == 1:
            defeito, _, titulo, corpo = alertas[0]
            servico.enviar_push([uid], titulo, corpo, {
                'tipo': 'sla_alerta', 'defeito_id': str(defeito.pk), 'protocolo': defeito.protocolo,
            }, aguardar=True)
            return
        vencidos = sum(1 for a in alertas if a[1])
        vencendo = len(alertas) - vencidos
        partes = []
        if vencidos:
            partes.append(f'{vencidos} com prazo vencido')
        if vencendo:
            partes.append(f'{vencendo} vencendo nas próximas 24 h')
        servico.enviar_push(
            [uid], f'{len(alertas)} chamados precisam de atenção', ' e '.join(partes) + '.',
            {'tipo': 'sla_alerta'}, aguardar=True,
        )
