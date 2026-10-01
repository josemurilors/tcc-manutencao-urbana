"""
Resumo semanal para gestores e admins municipais: o que entrou, o que saiu,
o que está atrasado e como o cidadão avaliou, nos últimos 7 dias. Vai como
notificação in-app (tipo `resumo`) e, se o e-mail estiver configurado
(`RESEND_API_KEY`), também por e-mail. Agendar para segunda de manhã.

Rodar de novo na mesma semana não repete: quem recebeu um resumo nos
últimos 6 dias fica de fora (`--forcar` ignora isso).
"""
import asyncio
import logging
from datetime import timedelta
from html import escape

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db.models import Avg, F
from django.utils import timezone

from defeitos.fluxo import STATUS_ABERTOS
from defeitos.models import Defeito
from municipios.models import Municipio
from notificacoes import servico
from notificacoes.models import Notificacao
from users.models import User

PAPEIS_GESTAO = ('gestor', 'admin_municipal')
PERIODO = timedelta(days=7)
INTERVALO_MINIMO = timedelta(days=6)

logger = logging.getLogger(__name__)


def indicadores(municipio_id, agora):
    inicio = agora - PERIODO
    base = Defeito.objects.ativos().filter(municipio_id=municipio_id)
    resolvidos = base.filter(status='concluido', resolvido_em__gte=inicio)
    com_prazo = resolvidos.filter(prazo_em__isnull=False)
    no_prazo = com_prazo.filter(resolvido_em__lte=F('prazo_em')).count()
    total_com_prazo = com_prazo.count()
    abertos = base.filter(status__in=STATUS_ABERTOS)
    avaliacoes = base.filter(avaliado_em__gte=inicio, avaliacao_nota__isnull=False)
    return {
        'recebidos': base.filter(criado_em__gte=inicio).count(),
        'resolvidos': resolvidos.count(),
        'pct_no_prazo': round(100 * no_prazo / total_com_prazo) if total_com_prazo else None,
        'abertos': abertos.count(),
        'vencidos': abertos.filter(prazo_em__lt=agora).count(),
        'csat_media': avaliacoes.aggregate(m=Avg('avaliacao_nota'))['m'],
        'csat_respostas': avaliacoes.count(),
    }


def _plural(n, singular, plural):
    return f'{n} {singular if n == 1 else plural}'


def texto_resumo(k):
    resolvidos = _plural(k['resolvidos'], 'resolvido', 'resolvidos')
    if k['pct_no_prazo'] is not None:
        resolvidos += f' ({k["pct_no_prazo"]}% no prazo)'
    frases = [
        f'{_plural(k["recebidos"], "chamado recebido", "chamados recebidos")} e {resolvidos}.',
        f'{_plural(k["abertos"], "chamado em aberto", "chamados em aberto")}, '
        f'{k["vencidos"]} com prazo vencido.',
    ]
    if k['csat_respostas']:
        media = f'{k["csat_media"]:.1f}'.replace('.', ',')
        frases.append(f'Satisfação média {media}/5 em {_plural(k["csat_respostas"], "avaliação", "avaliações")}.')
    return ' '.join(frases)


def html_resumo(nome, k):
    linhas = [
        ('Recebidos', k['recebidos']),
        ('Resolvidos', k['resolvidos']),
        ('Resolvidos no prazo', f'{k["pct_no_prazo"]}%' if k['pct_no_prazo'] is not None else '—'),
        ('Em aberto', k['abertos']),
        ('Com prazo vencido', k['vencidos']),
        ('Satisfação média', f'{k["csat_media"]:.1f}/5'.replace('.', ',') if k['csat_respostas'] else '—'),
    ]
    tabela = ''.join(
        f'<tr><td style="padding:6px 12px">{escape(r)}</td>'
        f'<td style="padding:6px 12px;font-weight:700;text-align:right">{escape(str(v))}</td></tr>'
        for r, v in linhas
    )
    return (
        '<div style="font-family:sans-serif;max-width:520px;margin:0 auto">'
        f'<h2>Resumo da semana — {escape(nome)}</h2>'
        '<p>Indicadores dos últimos 7 dias na Central de Inteligência Urbana:</p>'
        f'<table style="border-collapse:collapse;width:100%;background:#f5f5f5;border-radius:8px">{tabela}</table>'
        '<p style="color:#888;font-size:12px">Você recebe este e-mail por ser gestor no município.</p>'
        '</div>'
    )


def email_configurado():
    return bool(getattr(settings, 'RESEND_API_KEY', ''))


def enviar_email(destino, assunto, html):
    # `email_service` só expõe helpers de código de verificação; o envio
    # genérico é o `_send_email` interno (assíncrono, já trata falha da API).
    from services import email_service

    return asyncio.run(email_service._send_email(to=destino, subject=assunto, html=html))


class Command(BaseCommand):
    help = 'Envia aos gestores o resumo semanal do município (in-app e, se configurado, e-mail).'

    def add_arguments(self, parser):
        parser.add_argument('--municipio', help='Só este município (código IBGE).')
        parser.add_argument('--forcar', action='store_true', help='Envia mesmo a quem recebeu nos últimos 6 dias.')
        parser.add_argument('--sem-email', action='store_true', help='Só a notificação in-app.')

    def handle(self, *args, **opts):
        agora = timezone.now()
        gestores = (
            User.objects.filter(papel__in=PAPEIS_GESTAO)
            .exclude(municipio_id__isnull=True).exclude(municipio_id='')
        )
        if opts['municipio']:
            gestores = gestores.filter(municipio_id=opts['municipio'])
        if not opts['forcar']:
            recentes = Notificacao.objects.filter(tipo='resumo', criado_em__gte=agora - INTERVALO_MINIMO)
            gestores = gestores.exclude(id__in=recentes.values('usuario_id'))

        por_municipio = {}
        for gestor in gestores.only('id', 'email', 'municipio_id'):
            por_municipio.setdefault(gestor.municipio_id, []).append(gestor)

        mandar_email = email_configurado() and not opts['sem_email']
        enviados = emails = 0
        for municipio_id, pessoas in por_municipio.items():
            municipio = Municipio.objects.filter(codigo=municipio_id).first()
            nome = f'{municipio.nome}/{municipio.uf_sigla}' if municipio else municipio_id
            k = indicadores(municipio_id, agora)
            titulo = f'Resumo da semana em {nome}'
            servico.notificar([p.id for p in pessoas], 'resumo', titulo, texto_resumo(k), com_push=False)
            enviados += len(pessoas)
            if not mandar_email:
                continue
            html = html_resumo(nome, k)
            for pessoa in pessoas:
                try:
                    resposta = enviar_email(pessoa.email, f'{titulo} — Central de Inteligência Urbana', html)
                except Exception:
                    # Um e-mail que falhou não pode impedir o dos outros gestores.
                    logger.exception('Falha ao enviar resumo semanal para o usuário %s', pessoa.id)
                    continue
                if resposta and resposta.get('id'):
                    emails += 1
        self.stdout.write(self.style.SUCCESS(
            f'Resumo enviado a {enviados} gestor(es) em {len(por_municipio)} município(s); {emails} e-mail(s).'
        ))
