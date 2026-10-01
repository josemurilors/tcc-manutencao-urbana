"""
`seed_demo`: gera um município de demonstração coerente (ciclo de vida pelo
fluxo, histórico no passado, nenhum aviso) e `--limpar-demo` remove só a demo.
"""
import uuid
from datetime import timedelta
from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection
from django.db.models import F
from django.utils import timezone

from defeitos.models import Apoio, Defeito, DefeitoEvento
from gestao.models import Equipe
from notificacoes.models import Notificacao
from users.models import User

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture
def cidade(db):
    codigo = f'd{uuid.uuid4().hex[:8]}'
    with connection.cursor() as cur:
        # Caixa no Ártico: nunca contém coordenadas de outros testes.
        cur.execute("""
            INSERT INTO municipios (codigo, nome, uf, uf_sigla, min_lat, max_lat, min_lng, max_lng)
            VALUES (%s, 'Cidade Demo', '43', 'RS', 80, 81, 0, 1)
        """, [codigo])
    return codigo


def _seed(*args):
    saida = StringIO()
    call_command('seed_demo', *args, stdout=saida)
    return saida.getvalue()


def test_seed_demo_gera_ciclo_completo_e_limpa_so_a_demo(cidade):
    # Chamado "real" do município: não pode ser tocado pela limpeza.
    agora = timezone.now()
    real = User.objects.create_user('real@example.com', 'Pessoa Real', 'x', municipio_id=cidade)
    chamado_real = Defeito.objects.create(usuario=real, titulo='Real', municipio_id=cidade,
                                          criado_em=agora, atualizado_em=agora)

    saida = _seed('--municipio', cidade, '--chamados', '80', '--dias', '90', '--semente', '7')
    assert 'chamados em 90 dias' in saida

    demo = Defeito.objects.filter(municipio_id=cidade, usuario__email__endswith='@demo.ciu')
    assert demo.count() == 80
    # Estrutura criada pelo seed_gestao_demo e equipe demo com papéis.
    assert Equipe.objects.filter(municipio_id=cidade).exists()
    papeis = set(User.objects.filter(municipio_id=cidade, email__endswith='@demo.ciu')
                 .values_list('papel', flat=True))
    assert papeis == {'cidadao', 'operador', 'gestor'}

    status = set(demo.values_list('status', flat=True))
    assert {'concluido', 'rejeitado'} <= status
    concluidos = demo.filter(status='concluido')
    assert not concluidos.filter(resolvido_em__isnull=True).exists()
    assert not concluidos.filter(resposta_publica='').exists()
    assert not concluidos.filter(equipe__isnull=True).exists()
    assert not demo.filter(status='rejeitado', motivo_rejeicao='').exists()
    assert demo.filter(avaliacao_nota__isnull=False).exists()
    assert Apoio.objects.filter(defeito__in=demo).exists()

    # Tudo no passado e em ordem: nada depois de agora, nada antes da criação.
    assert demo.filter(criado_em__lt=agora - timedelta(days=91)).count() == 0
    assert not demo.filter(resolvido_em__lt=F('criado_em')).exists()
    assert not demo.filter(triado_em__lt=F('criado_em')).exists()
    eventos = DefeitoEvento.objects.filter(defeito__in=demo)
    assert eventos.filter(tipo='criado').count() == 80
    assert not eventos.filter(criado_em__gt=timezone.now()).exists()
    assert not eventos.filter(criado_em__lt=F('defeito__criado_em')).exists()
    assert eventos.filter(tipo='status', para_status='concluido').exists()
    assert eventos.filter(tipo='atribuido').exists()
    # Histórico retroativo não avisa ninguém.
    assert not Notificacao.objects.filter(defeito__in=demo).exists()

    # Rodar de novo substitui a demo anterior (não acumula).
    _seed('--municipio', cidade, '--chamados', '20', '--dias', '30')
    assert Defeito.objects.filter(municipio_id=cidade, usuario__email__endswith='@demo.ciu').count() == 20

    _seed('--municipio', cidade, '--limpar-demo')
    assert not Defeito.objects.filter(municipio_id=cidade, usuario__email__endswith='@demo.ciu').exists()
    assert not User.objects.filter(email__endswith='@demo.ciu', municipio_id=cidade).exists()
    assert Defeito.objects.filter(pk=chamado_real.pk).exists()
    assert User.objects.filter(pk=real.pk).exists()


def test_seed_demo_municipio_inexistente():
    with pytest.raises(CommandError):
        _seed('--municipio', '0000001')
