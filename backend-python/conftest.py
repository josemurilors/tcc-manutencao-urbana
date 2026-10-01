import os
import subprocess
import sys
import uuid

import pytest
from rest_framework.test import APIClient

# Força o settings de teste (local) para todo o processo pytest. O container de
# dev roda com DJANGO_SETTINGS_MODULE=core.settings.production, e se isso não
# for sobrescrito aqui, o pytest-django e o _bootstrap_test_db usariam o banco
# de produção (manutencao_urbana) em vez do banco de teste — apagando dados reais.
os.environ['DJANGO_SETTINGS_MODULE'] = 'core.settings.local'


def _bootstrap_test_db():
    """Cria o banco de teste (se não existir) e aplica o schema via manage.py.

    As tabelas do projeto (users, defeitos, ...) são `managed=False` e criadas
    via `bootstrap_schema` (SQL puro). O pytest-django não as cria no banco de
    teste, então aplicamos o schema ANTES do pytest rodar (com --reuse-db o
    pytest não recria o banco). Sem isso, todos os testes falham com
    'relation "users" does not exist'.

    Usa um subprocess para evitar o bloqueio de acesso ao banco que o
    pytest-django impõe dentro da sessão de teste.
    """
    import django
    django.setup()

    from django.conf import settings
    db = settings.DATABASES['default']
    # Nunca dropar o banco de produção local: deriva o nome do banco de teste
    # exatamente como o pytest-django (prefixo test_ quando TEST.NAME ausente).
    test_cfg = db.get('TEST') or {}
    dbname = test_cfg.get('NAME') or f"test_{db['NAME']}"

    import psycopg2
    from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
    conn = psycopg2.connect(
        host=db['HOST'], port=db.get('PORT'), user=db['USER'],
        password=db.get('PASSWORD', ''), dbname='postgres',
    )
    conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
    cur = conn.cursor()
    # Recria o banco de teste do zero a cada execução -> estado determinístico
    # (evita que dados de execuções anteriores, acumulados com --reuse-db,
    # quebrem a detecção de duplicados e outros testes).
    cur.execute("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = %s AND pid <> pg_backend_pid()", (dbname,))
    cur.execute(f'DROP DATABASE IF EXISTS "{dbname}"')
    cur.execute(f'CREATE DATABASE "{dbname}"')
    cur.close()
    conn.close()

    env = os.environ.copy()
    env['DJANGO_SETTINGS_MODULE'] = 'core.settings.local'
    env['DB_NAME'] = dbname
    subprocess.run(
        [sys.executable, 'manage.py', 'bootstrap_schema'],
        env=env, check=True, capture_output=True,
    )


def pytest_sessionstart(session):
    _bootstrap_test_db()


@pytest.fixture(scope='session')
def django_db_setup(django_db_setup, django_db_blocker):
    """Garante o schema no banco de teste (redundante, mas seguro)."""
    with django_db_blocker.unblock():
        from django.core.management import call_command
        call_command('bootstrap_schema', verbosity=0)


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture
def user_creds():
    uid = str(uuid.uuid4())[:8]
    return {
        'email': f'test-{uid}@example.com',
        'nome': f'Test User {uid}',
        'password': 'Test@123456',
    }


@pytest.fixture
def auth_client(client, user_creds):
    from django.urls import reverse
    data = {**user_creds, 'confirm_password': user_creds['password']}
    resp = client.post(reverse('auth-register'), data, format='json')
    assert resp.status_code == 201
    token = resp.data['access']
    new_client = APIClient()
    new_client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
    return new_client


# Cidade de teste que contém as coordenadas padrão de `_create_defeito`
# (-23.55, -46.63 + i*0.01). Todo operador opera numa única cidade, então o
# admin dos testes precisa estar vinculado a ela para assumir/finalizar.
CIDADE_TESTES = '9999900'


@pytest.fixture
def admin_client(auth_client, user_creds):
    """Admin municipal da cidade de teste (que cobre os chamados padrão)."""
    from django.db import connection
    from users.models import User
    with connection.cursor() as cur:
        cur.execute("""
            INSERT INTO municipios (codigo, nome, uf, uf_sigla, min_lat, max_lat, min_lng, max_lng, polygon_geom)
            VALUES (%s, 'Cidade Testes', '35', 'SP', -24.0, -23.0, -47.0, -44.0,
                    ST_Multi(ST_GeomFromText('POLYGON((-47 -24, -44 -24, -44 -23, -47 -23, -47 -24))', 4326)))
            ON CONFLICT (codigo) DO NOTHING
        """, [CIDADE_TESTES])
    user = User.objects.get(email=user_creds['email'])
    user.papel = 'admin_municipal'
    user.municipio_id = CIDADE_TESTES
    user.save(update_fields=['papel', 'municipio_id'])
    return auth_client


@pytest.fixture(autouse=True)
def _sem_limite_de_deslocamento(request, monkeypatch):
    """
    Os helpers de teste criam chamados ~1 km afastados em milissegundos, o que
    tropeçaria na regra de deslocamento plausível. Fica sem limite por padrão;
    a classe marcada com `deslocamento_real` testa a regra de verdade.
    """
    if request.node.get_closest_marker('deslocamento_real'):
        return
    from defeitos import regras
    monkeypatch.setattr(regras, 'VELOCIDADE_MAX_KMH', float('inf'))


@pytest.fixture(autouse=True)
def _ranking_sem_cache(settings):
    """O cache do ranking vive no Redis compartilhado: nos testes, sempre recalcula."""
    settings.CIU_RANKING_CACHE_S = 0
