import uuid

import pytest
from conftest import CIDADE_TESTES
from django.urls import reverse

from users.models import User

pytestmark = pytest.mark.django_db(transaction=True)


class TestHealth:
    def test_health_check(self, client):
        resp = client.get(reverse('health-check'))
        assert resp.status_code == 200
        assert 'message' in resp.data


class TestRegister:
    URL = 'auth-register'

    def test_success(self, client, user_creds):
        data = {**user_creds, 'confirm_password': user_creds['password']}
        resp = client.post(reverse(self.URL), data, format='json')
        assert resp.status_code == 201
        assert 'access' in resp.data
        assert 'refresh' in resp.data
        assert resp.data['user']['email'] == user_creds['email']
        assert resp.data['user']['nome'] == user_creds['nome']
        assert 'senha' not in resp.data['user']

    def test_missing_fields(self, client):
        resp = client.post(reverse(self.URL), {}, format='json')
        assert resp.status_code == 400

    def test_password_mismatch(self, client, user_creds):
        data = {**user_creds, 'confirm_password': 'different'}
        resp = client.post(reverse(self.URL), data, format='json')
        assert resp.status_code == 400

    def test_duplicate_email(self, client, user_creds):
        data = {**user_creds, 'confirm_password': user_creds['password']}
        resp1 = client.post(reverse(self.URL), data, format='json')
        assert resp1.status_code == 201
        resp2 = client.post(reverse(self.URL), data, format='json')
        assert resp2.status_code == 400


class TestLogin:

    LOGIN_URL = 'auth-login'

    def test_success(self, client, user_creds):
        reg_data = {**user_creds, 'confirm_password': user_creds['password']}
        client.post(reverse('auth-register'), reg_data, format='json')

        resp = client.post(reverse(self.LOGIN_URL), {
            'email': user_creds['email'],
            'password': user_creds['password'],
        }, format='json')
        assert resp.status_code == 200
        assert 'access' in resp.data
        assert 'refresh' in resp.data

    def test_invalid_password(self, client, user_creds):
        reg_data = {**user_creds, 'confirm_password': user_creds['password']}
        client.post(reverse('auth-register'), reg_data, format='json')

        resp = client.post(reverse(self.LOGIN_URL), {
            'email': user_creds['email'],
            'password': 'wrong',
        }, format='json')
        assert resp.status_code == 401

    def test_nonexistent_user(self, client):
        resp = client.post(reverse(self.LOGIN_URL), {
            'email': 'nobody@example.com',
            'password': 'anything',
        }, format='json')
        assert resp.status_code == 401

    def test_register_then_login_then_refresh(self, client, user_creds):
        reg_data = {**user_creds, 'confirm_password': user_creds['password']}
        reg_resp = client.post(reverse('auth-register'), reg_data, format='json')
        assert reg_resp.status_code == 201
        orig_refresh = reg_resp.data['refresh']

        login_resp = client.post(reverse('auth-login'), {
            'email': user_creds['email'],
            'password': user_creds['password'],
        }, format='json')
        assert login_resp.status_code == 200

        refresh_resp = client.post(reverse('auth-refresh'), {
            'refresh': orig_refresh,
        }, format='json')
        assert refresh_resp.status_code == 200
        assert 'access' in refresh_resp.data


class TestProfile:

    URL = 'auth-profile'

    def test_get(self, auth_client):
        resp = auth_client.get(reverse(self.URL))
        assert resp.status_code == 200
        assert 'email' in resp.data
        assert 'nome' in resp.data
        assert 'id' in resp.data

    def test_update(self, auth_client):
        resp = auth_client.patch(reverse(self.URL), {'nome': 'Updated Name'}, format='json')
        assert resp.status_code == 200
        assert resp.data['nome'] == 'Updated Name'

    def test_unauthenticated(self, client):
        resp = client.get(reverse(self.URL))
        assert resp.status_code == 401

    def test_delete_account(self, auth_client, user_creds, client):
        resp = auth_client.delete(reverse(self.URL))
        assert resp.status_code == 204
        assert not User.objects.filter(email=user_creds['email']).exists()
        # O token antigo deixa de valer e o login também.
        assert auth_client.get(reverse(self.URL)).status_code == 401
        resp = client.post(
            reverse('auth-login'),
            {'email': user_creds['email'], 'password': user_creds['password']},
            format='json',
        )
        assert resp.status_code == 401

    def test_delete_account_anonimiza_chamados(self, auth_client, user_creds):
        from defeitos.models import Defeito
        from django.utils import timezone

        me = auth_client.get(reverse(self.URL)).data
        agora = timezone.now()
        defeito = Defeito.objects.create(
            usuario_id=me['id'],
            usuario_email=user_creds['email'],
            titulo='Buraco na rua',
            latitude=-23.55,
            longitude=-46.63,
            criado_em=agora,
            atualizado_em=agora,
        )
        assert auth_client.delete(reverse(self.URL)).status_code == 204
        defeito.refresh_from_db()
        assert defeito.usuario_id is None
        assert defeito.usuario_email == ''


class TestChangePassword:

    URL = 'auth-change-password'

    def test_success(self, auth_client, user_creds):
        resp = auth_client.patch(reverse(self.URL), {
            'senha_atual': user_creds['password'],
            'nova_senha': 'NewPass123!',
        }, format='json')
        assert resp.status_code == 200
        assert 'message' in resp.data

    def test_wrong_current_password(self, auth_client):
        resp = auth_client.patch(reverse(self.URL), {
            'senha_atual': 'wrongpass',
            'nova_senha': 'NewPass123!',
        }, format='json')
        assert resp.status_code == 400

    def test_missing_fields(self, auth_client):
        resp = auth_client.patch(reverse(self.URL), {}, format='json')
        assert resp.status_code == 400

    def test_short_password(self, auth_client, user_creds):
        resp = auth_client.patch(reverse(self.URL), {
            'senha_atual': user_creds['password'],
            'nova_senha': '12345',
        }, format='json')
        assert resp.status_code == 400

    def test_unauthenticated(self, client):
        resp = client.patch(reverse(self.URL), {}, format='json')
        assert resp.status_code == 401

    def test_login_with_new_password(self, client, user_creds):
        reg_data = {**user_creds, 'confirm_password': user_creds['password']}
        reg_resp = client.post(reverse('auth-register'), reg_data, format='json')
        assert reg_resp.status_code == 201
        token = reg_resp.data['access']
        api_client = client.__class__()
        api_client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')

        api_client.patch(reverse(self.URL), {
            'senha_atual': user_creds['password'],
            'nova_senha': 'NewPass123!',
        }, format='json')

        login_resp = client.post(reverse('auth-login'), {
            'email': user_creds['email'],
            'password': 'NewPass123!',
        }, format='json')
        assert login_resp.status_code == 200

        old_pass_resp = client.post(reverse('auth-login'), {
            'email': user_creds['email'],
            'password': user_creds['password'],
        }, format='json')
        assert old_pass_resp.status_code == 401


class TestVerifyEmail:

    URL = 'auth-verify-email'

    def test_success(self, auth_client, user_creds):
        from users.models import User
        user = User.objects.get(email=user_creds['email'])
        resp = auth_client.post(reverse(self.URL), {'codigo': user.codigo_2fa}, format='json')
        assert resp.status_code == 200

    def test_wrong_code(self, auth_client):
        resp = auth_client.post(reverse(self.URL), {'codigo': '000000'}, format='json')
        assert resp.status_code == 400

    def test_missing_code(self, auth_client):
        resp = auth_client.post(reverse(self.URL), {}, format='json')
        assert resp.status_code == 400

    def test_unauthenticated(self, client):
        resp = client.post(reverse(self.URL), {'codigo': '123456'}, format='json')
        assert resp.status_code == 401

    def test_already_verified(self, auth_client, user_creds):
        from users.models import User
        user = User.objects.get(email=user_creds['email'])
        auth_client.post(reverse(self.URL), {'codigo': user.codigo_2fa}, format='json')
        resp = auth_client.post(reverse(self.URL), {'codigo': '000000'}, format='json')
        assert resp.status_code == 200


class TestResendCode:

    URL = 'auth-resend-code'

    def test_resend(self, auth_client):
        resp = auth_client.post(reverse(self.URL), {}, format='json')
        assert resp.status_code == 200
        assert 'message' in resp.data

    def test_unauthenticated(self, client):
        resp = client.post(reverse(self.URL), {}, format='json')
        assert resp.status_code == 401


class TestUpdateMunicipio:

    URL = 'auth-update-municipio'

    def test_missing_municipio_id(self, auth_client):
        resp = auth_client.patch(reverse(self.URL), {}, format='json')
        assert resp.status_code == 400

    def test_nonexistent_municipio(self, auth_client):
        resp = auth_client.patch(reverse(self.URL), {'municipio_id': '999'}, format='json')
        assert resp.status_code == 404

    def test_unauthenticated(self, client):
        resp = client.patch(reverse(self.URL), {'municipio_id': '1'}, format='json')
        assert resp.status_code == 401

    def test_success_with_real_municipio(self, auth_client):
        from django.db import connection
        with connection.cursor() as cursor:
            cursor.execute('SELECT codigo::text FROM municipios LIMIT 1')
            row = cursor.fetchone()
        if not row:
            pytest.skip('No municipios in database')
        resp = auth_client.patch(reverse(self.URL), {'municipio_id': row[0]}, format='json')
        assert resp.status_code == 200
        assert resp.data['municipio']['codigo'] == row[0]


class TestAdminUsers:

    URL = 'auth-admin-users'

    def test_non_admin_forbidden(self, auth_client):
        resp = auth_client.get(reverse(self.URL))
        assert resp.status_code == 403

    def test_admin_list(self, admin_client):
        resp = admin_client.get(reverse(self.URL))
        assert resp.status_code == 200
        assert isinstance(resp.data, list)

    def test_admin_municipal_ve_so_a_equipe(self, admin_client):
        import uuid
        from conftest import CIDADE_TESTES
        from users.models import User
        uid = uuid.uuid4().hex[:8]
        morador = User.objects.create_user(f'morador-{uid}@example.com', 'Maria Morador Silva', 'Test@123456',
                                           municipio_id=CIDADE_TESTES)
        servidor = User.objects.create_user(f'servidor-{uid}@example.com', 'Sérgio Servidor', 'Test@123456',
                                            papel='operador', municipio_id=CIDADE_TESTES)
        de_fora = User.objects.create_user(f'fora-{uid}@example.com', 'Fora Daqui', 'Test@123456',
                                           papel='operador', municipio_id='9999901')
        ids = [u['id'] for u in admin_client.get(reverse(self.URL)).data]
        assert str(servidor.id) in ids
        assert str(morador.id) not in ids
        # Busca por e-mail: cidadão vem com nome mascarado e sem cidade.
        resp = admin_client.get(reverse(self.URL), {'email': morador.email.upper()})
        (achado,) = [u for u in resp.data if u['id'] == str(morador.id)]
        assert achado['nome'] == 'Maria S.' and achado['municipio'] is None
        # Servidor de outra prefeitura não é encontrado.
        resp = admin_client.get(reverse(self.URL), {'email': de_fora.email})
        assert str(de_fora.id) not in [u['id'] for u in resp.data]

    def test_unauthenticated(self, client):
        resp = client.get(reverse(self.URL))
        assert resp.status_code == 401


class TestAdminToggle:

    URL = 'auth-admin-toggle'

    def test_promote_user(self, admin_client):
        import uuid
        from users.models import User
        uid = str(uuid.uuid4())[:8]
        user = User.objects.create_user(
            email=f'promote-{uid}@example.com', nome='Promote Me', password='Test@123456',
        )
        resp = admin_client.patch(
            reverse(self.URL, kwargs={'pk': user.id}),
            {'admin': True}, format='json',
        )
        assert resp.status_code == 200

    def test_demote_user(self, admin_client):
        import uuid
        from users.models import User
        uid = str(uuid.uuid4())[:8]
        user = User.objects.create_user(
            email=f'demote-{uid}@example.com', nome='Demote Me', password='Test@123456',
        )
        user.admin = 1
        user.save(update_fields=['admin'])

        resp = admin_client.patch(
            reverse(self.URL, kwargs={'pk': user.id}),
            {'admin': False}, format='json',
        )
        assert resp.status_code == 200

    def test_nonexistent_user(self, admin_client):
        resp = admin_client.patch(
            reverse(self.URL, kwargs={'pk': uuid.uuid4()}),
            {'admin': True}, format='json',
        )
        assert resp.status_code == 404

    def test_non_admin_forbidden(self, auth_client):
        import uuid
        from users.models import User
        uid = str(uuid.uuid4())[:8]
        user = User.objects.create_user(
            email=f'target-{uid}@example.com', nome='Target', password='Test@123456',
        )
        resp = auth_client.patch(
            reverse(self.URL, kwargs={'pk': user.id}),
            {'admin': True}, format='json',
        )
        assert resp.status_code == 403

    def test_unauthenticated(self, client):
        resp = client.patch(
            reverse(self.URL, kwargs={'pk': uuid.uuid4()}),
            {'admin': True}, format='json',
        )
        assert resp.status_code == 401

    def test_missing_admin_field(self, admin_client):
        import uuid
        from users.models import User
        uid = str(uuid.uuid4())[:8]
        user = User.objects.create_user(
            email=f'noflag-{uid}@example.com', nome='No Flag', password='Test@123456',
        )
        resp = admin_client.patch(
            reverse(self.URL, kwargs={'pk': user.id}),
            {}, format='json',
        )
        assert resp.status_code == 400


class TestAdminEstatisticas:

    URL = 'auth-admin-estatisticas'

    def test_non_admin_forbidden(self, auth_client):
        resp = auth_client.get(reverse(self.URL))
        assert resp.status_code == 403

    def test_admin_access(self, admin_client):
        resp = admin_client.get(reverse(self.URL))
        assert resp.status_code == 200
        assert 'total' in resp.data
        assert 'por_categoria' in resp.data
        assert 'por_status' in resp.data
        assert 'sla_medio_minutos' in resp.data
        assert 'tendencia_mensal' in resp.data
        assert 'anomalias' in resp.data

    def test_unauthenticated(self, client):
        resp = client.get(reverse(self.URL))
        assert resp.status_code == 401

    def test_sla_vencidos_total(self, admin_client):
        from datetime import timedelta
        from django.utils import timezone
        from defeitos.models import Defeito

        resp = admin_client.get(reverse(self.URL))
        assert resp.status_code == 200
        baseline = resp.data['sla_vencidos_total']

        now = timezone.now()
        Defeito.objects.create(
            municipio_id=CIDADE_TESTES,
            titulo='SLA Vencido',
            criado_em=now - timedelta(days=10),
            atualizado_em=now - timedelta(days=10),
            prazo_sla_dias=3,
            status='pendente',
        )
        Defeito.objects.create(
            municipio_id=CIDADE_TESTES,
            titulo='Dentro do SLA',
            criado_em=now,
            atualizado_em=now,
            prazo_sla_dias=30,
            status='pendente',
        )

        resp = admin_client.get(reverse(self.URL))
        assert resp.status_code == 200
        assert resp.data['sla_vencidos_total'] == baseline + 1
        titulos = [d['titulo'] for d in resp.data['sla_vencidos']]
        assert 'SLA Vencido' in titulos
        assert 'Dentro do SLA' not in titulos

    def test_sla_vencidos_total_uncapped(self, admin_client):
        from datetime import timedelta
        from django.utils import timezone
        from defeitos.models import Defeito

        resp = admin_client.get(reverse(self.URL))
        assert resp.status_code == 200
        baseline = resp.data['sla_vencidos_total']

        now = timezone.now()
        for i in range(60):
            Defeito.objects.create(
            municipio_id=CIDADE_TESTES,
                titulo=f'SLA Vencido Mass {i}',
                criado_em=now - timedelta(days=10),
                atualizado_em=now - timedelta(days=10),
                prazo_sla_dias=3,
                status='pendente',
            )

        resp = admin_client.get(reverse(self.URL))
        assert resp.status_code == 200
        assert resp.data['sla_vencidos_total'] == baseline + 60
        assert len(resp.data['sla_vencidos']) == 50


class TestSubscribe:

    URL = 'auth-subscribe'

    def test_subscribe_success(self, auth_client):
        resp = auth_client.post(reverse(self.URL), {
            'subscription': {
                'endpoint': 'https://fcm.example.com/send',
                'keys': {'p256dh': 'abc123', 'auth': 'def456'},
            },
        }, format='json')
        assert resp.status_code == 201

    def test_subscribe_missing_data(self, auth_client):
        resp = auth_client.post(reverse(self.URL), {}, format='json')
        assert resp.status_code == 400

    def test_subscribe_unauthenticated(self, client):
        resp = client.post(reverse(self.URL), {}, format='json')
        assert resp.status_code == 401

    def test_unsubscribe(self, auth_client):
        auth_client.post(reverse(self.URL), {
            'subscription': {
                'endpoint': 'https://fcm.example.com/send',
                'keys': {'p256dh': 'abc123', 'auth': 'def456'},
            },
        }, format='json')

        from users.models import PushSubscription
        sub = PushSubscription.objects.first()
        assert sub is not None

        resp = auth_client.delete(reverse(self.URL), {'endpoint': sub.endpoint}, format='json')
        assert resp.status_code == 200
        assert resp.data['deleted'] >= 1


class TestPublicKey:

    URL = 'auth-public-key'

    def test_not_configured(self, client):
        resp = client.get(reverse(self.URL))
        assert resp.status_code == 501


@pytest.mark.django_db
class TestGoogleLogin:
    URL = 'auth-google'

    CLAIMS = {
        'aud': 'web-client-id',
        'iss': 'https://accounts.google.com',
        'sub': '1234567890',
        'email': 'Pessoa@Gmail.com',
        'email_verified': True,
        'name': 'Pessoa do Google',
    }

    @pytest.fixture(autouse=True)
    def _google(self, monkeypatch, settings):
        settings.GOOGLE_CLIENT_IDS = {'web': 'web-client-id', 'android': '', 'ios': ''}
        self.claims = dict(self.CLAIMS)

        def fake(token):
            if token != 'token-valido':
                raise ValueError('Token do Google inválido ou expirado')
            return self.claims

        monkeypatch.setattr('users.views.verificar_id_token_google', fake)

    def test_config_lists_client_ids(self, client):
        resp = client.get(reverse(self.URL))
        assert resp.status_code == 200
        assert resp.data['web'] == 'web-client-id'

    def test_creates_user_first_time(self, client):
        resp = client.post(reverse(self.URL), {'id_token': 'token-valido'}, format='json')
        assert resp.status_code == 201
        assert resp.data['novo'] is True
        assert 'access' in resp.data and 'refresh' in resp.data
        assert resp.data['user']['email'] == 'pessoa@gmail.com'
        assert resp.data['user']['nome'] == 'Pessoa do Google'
        user = User.objects.get(email='pessoa@gmail.com')
        assert user.email_verified == 1
        assert not user.has_usable_password()

    def test_links_existing_account_by_email(self, client, user_creds):
        client.post(reverse('auth-register'), {**user_creds, 'confirm_password': user_creds['password']}, format='json')
        self.claims['email'] = user_creds['email'].upper()
        resp = client.post(reverse(self.URL), {'id_token': 'token-valido'}, format='json')
        assert resp.status_code == 200
        assert resp.data['novo'] is False
        assert User.objects.filter(email__iexact=user_creds['email']).count() == 1
        # A verificação pendente por código é dispensada: o Google atestou o e-mail.
        assert User.objects.get(email__iexact=user_creds['email']).email_verified == 1

    def test_rejects_invalid_token(self, client):
        resp = client.post(reverse(self.URL), {'id_token': 'qualquer'}, format='json')
        assert resp.status_code == 401

    def test_rejects_unverified_google_email(self, client):
        self.claims['email_verified'] = False
        resp = client.post(reverse(self.URL), {'id_token': 'token-valido'}, format='json')
        assert resp.status_code == 401
        assert not User.objects.filter(email='pessoa@gmail.com').exists()

    def test_requires_token(self, client):
        resp = client.post(reverse(self.URL), {}, format='json')
        assert resp.status_code == 400


class TestRefreshExigeUsuario:
    def test_refresh_de_conta_apagada_da_401(self, client):
        from rest_framework_simplejwt.tokens import RefreshToken
        uid = uuid.uuid4().hex[:8]
        user = User.objects.create_user(email=f'sumiu-{uid}@example.com', nome='Sumiu', password='Test@123456')
        refresh = str(RefreshToken.for_user(user))
        user.delete()
        resp = client.post(reverse('auth-refresh'), {'refresh': refresh}, format='json')
        assert resp.status_code == 401

    def test_refresh_normal_continua_funcionando(self, client):
        from rest_framework_simplejwt.tokens import RefreshToken
        uid = uuid.uuid4().hex[:8]
        user = User.objects.create_user(email=f'vivo-{uid}@example.com', nome='Vivo', password='Test@123456')
        refresh = str(RefreshToken.for_user(user))
        resp = client.post(reverse('auth-refresh'), {'refresh': refresh}, format='json')
        assert resp.status_code == 200
        assert 'access' in resp.data


class TestExisteEmail:
    def test_existe(self, client, auth_client, user_creds):
        resp = client.post(reverse('auth-existe'), {'email': user_creds['email']}, format='json')
        assert resp.status_code == 200
        assert resp.data['existe'] is True

    def test_case_insensitive(self, client, auth_client, user_creds):
        resp = client.post(reverse('auth-existe'), {'email': user_creds['email'].upper()}, format='json')
        assert resp.data['existe'] is True

    def test_nao_existe(self, client):
        resp = client.post(reverse('auth-existe'), {'email': 'ninguem@nada.com'}, format='json')
        assert resp.status_code == 200
        assert resp.data['existe'] is False

    def test_email_invalido(self, client):
        resp = client.post(reverse('auth-existe'), {'email': 'sem-arroba'}, format='json')
        assert resp.status_code == 400
