"""
`aplicar_retencao`: prazos de retenção da política de privacidade (IP 30 dias,
strikes 90, convites/notificações/push vencidos, fotos de chamado excluído
pelo autor) — e nada antes do prazo.
"""
import uuid
from datetime import timedelta
from io import StringIO

import pytest
from django.core.management import call_command
from django.utils import timezone

from defeitos.models import Defeito, DefeitoAnexo, Strike
from gestao.models import AuditLog, Convite
from notificacoes.models import Notificacao, PushToken
from users.models import User

pytestmark = pytest.mark.django_db(transaction=True)


def _usuario():
    uid = uuid.uuid4().hex[:8]
    return User.objects.create_user(f'ret-{uid}@example.com', f'Pessoa {uid}', 'Test@123456')


def _chamado(user, removido_dias, motivo='autor'):
    agora = timezone.now()
    return Defeito.objects.create(
        titulo='Chamado', descricao='Meu telefone é 9999-9999', categoria='Entulho', municipio_id='T-ret',
        criado_em=agora - timedelta(days=60), atualizado_em=agora, status='pendente', usuario=user,
        imagem_thumbnail=b'foto', imagens_extra='["data:image/webp;base64,AA=="]',
        removido_em=agora - timedelta(days=removido_dias), removido_motivo=motivo,
    )


def test_aplica_os_prazos():
    agora = timezone.now()
    user = _usuario()
    velho = lambda dias: agora - timedelta(days=dias)  # noqa: E731

    log_velho = AuditLog.objects.create(acao='x', ip='200.1.1.1', criado_em=velho(31))
    log_novo = AuditLog.objects.create(acao='x', ip='200.1.1.2', criado_em=velho(5))
    strike_velho = Strike.objects.create(usuario=user, titulo='a', criado_em=velho(91))
    strike_novo = Strike.objects.create(usuario=user, titulo='b', criado_em=velho(10))
    convite_vencido = Convite.objects.create(email='alguem@example.com', municipio_id='T-ret', papel='operador',
                                             token=uuid.uuid4().hex, criado_em=velho(60), expira_em=velho(40))
    convite_aceito = Convite.objects.create(email='outro@example.com', municipio_id='T-ret', papel='operador',
                                            token=uuid.uuid4().hex, criado_em=velho(60), expira_em=velho(40),
                                            aceito_em=velho(50))
    lida = Notificacao.objects.create(usuario=user, tipo='t', titulo='a', lida_em=velho(200))
    nao_lida = Notificacao.objects.create(usuario=user, tipo='t', titulo='b', criado_em=velho(200))
    aparelho_velho = PushToken.objects.create(usuario=user, token=uuid.uuid4().hex, ultimo_uso=velho(200))
    aparelho_novo = PushToken.objects.create(usuario=user, token=uuid.uuid4().hex)
    excluido = _chamado(user, removido_dias=31)
    DefeitoAnexo.objects.create(defeito=excluido, tipo='cidadao', imagem=b'x', autor=user, latitude=1, longitude=1)
    recente = _chamado(user, removido_dias=5)
    moderado = _chamado(user, removido_dias=31, motivo='comunidade')

    saida = StringIO()
    call_command('aplicar_retencao', '--simular', stdout=saida)
    assert 'simulação' in saida.getvalue()
    assert AuditLog.objects.get(pk=log_velho.pk).ip == '200.1.1.1'

    call_command('aplicar_retencao', stdout=StringIO())

    assert AuditLog.objects.get(pk=log_velho.pk).ip == ''
    assert AuditLog.objects.get(pk=log_novo.pk).ip == '200.1.1.2'
    assert not Strike.objects.filter(pk=strike_velho.pk).exists()
    assert Strike.objects.filter(pk=strike_novo.pk).exists()
    assert not Convite.objects.filter(pk=convite_vencido.pk).exists()
    assert Convite.objects.filter(pk=convite_aceito.pk).exists()
    assert not Notificacao.objects.filter(pk=lida.pk).exists()
    assert Notificacao.objects.filter(pk=nao_lida.pk).exists()
    assert not PushToken.objects.filter(pk=aparelho_velho.pk).exists()
    assert PushToken.objects.filter(pk=aparelho_novo.pk).exists()

    excluido.refresh_from_db()
    assert (excluido.descricao, excluido.imagem_thumbnail, excluido.imagens_extra) == ('', None, '[]')
    assert not DefeitoAnexo.objects.filter(defeito=excluido).exists()
    for intacto in (recente, moderado):
        intacto.refresh_from_db()
        assert intacto.descricao and intacto.imagem_thumbnail
