from io import StringIO

import pytest
from django.core.management import call_command

from users.models import User

pytestmark = pytest.mark.django_db


def test_cria_super_admin_novo_e_e_idempotente():
    saida = StringIO()
    call_command('criar_super_admin', 'root@example.com', 'Segura@123', stdout=saida)
    u = User.objects.get(email='root@example.com')
    assert u.papel == 'super_admin'
    assert u.is_superuser and u.admin == 1
    assert u.check_password('Segura@123')

    call_command('criar_super_admin', 'root@example.com', 'Outra@123', stdout=saida)
    assert User.objects.filter(email__iexact='root@example.com').count() == 1
    assert u.check_password('Segura@123')


def test_promove_existente_sem_trocar_senha():
    User.objects.create_user(email='gestor@example.com', nome='Gestor', password='Antiga@123')
    call_command('criar_super_admin', 'gestor@example.com', 'Nova@123', stdout=StringIO())
    u = User.objects.get(email='gestor@example.com')
    assert u.papel == 'super_admin'
    assert u.check_password('Antiga@123')
