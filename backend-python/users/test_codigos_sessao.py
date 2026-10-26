"""
Códigos de 6 dígitos (tentativas e validade) e sessões que morrem com a troca
de senha (`users/tokens.py`).
"""

import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from users.test_conta import _ip, _registrar, codigos  # noqa: F401  (fixture)
from users.views import CODIGO_MAX_TENTATIVAS

pytestmark = pytest.mark.django_db(transaction=True)


def _pedir_codigo(user, codigos):
    APIClient().post(reverse('auth-senha-esqueci'), {'email': user.email}, format='json', REMOTE_ADDR=_ip())
    return codigos[-1][1]


def _redefinir(user, codigo, nova='NovaSenha#9'):
    return APIClient().post(
        reverse('auth-senha-redefinir'),
        {'email': user.email, 'codigo': codigo, 'nova_senha': nova},
        format='json', REMOTE_ADDR=_ip(),
    )


class TestTentativasDoCodigo:

    def test_quinta_tentativa_errada_apaga_o_codigo(self, codigos, settings):
        settings.CIU_THROTTLE_TAXAS = {'senha_redefinir_email': '100/m'}
        _, user, _ = _registrar()
        certo = _pedir_codigo(user, codigos)
        errado = '000000' if certo != '000000' else '111111'
        for _ in range(CODIGO_MAX_TENTATIVAS):
            assert _redefinir(user, errado).status_code == 400
        # O código certo também morreu: é preciso pedir outro.
        assert _redefinir(user, certo).status_code == 400
        user.refresh_from_db()
        assert user.codigo_2fa is None and user.check_password('Senha@123')

    def test_codigo_novo_zera_o_contador(self, codigos, settings):
        settings.CIU_THROTTLE_TAXAS = {'senha_redefinir_email': '100/m'}
        _, user, _ = _registrar()
        certo = _pedir_codigo(user, codigos)
        errado = '000000' if certo != '000000' else '111111'
        for _ in range(CODIGO_MAX_TENTATIVAS - 1):
            _redefinir(user, errado)
        novo = _pedir_codigo(user, codigos)
        assert _redefinir(user, novo).status_code == 200

    def test_verificar_email_tambem_limita_tentativas(self, settings):
        settings.CIU_THROTTLE_TAXAS = {'verificar_email': '100/m'}
        cli, user, _ = _registrar()
        errado = '000000' if user.codigo_2fa != '000000' else '111111'
        certo = user.codigo_2fa
        url = reverse('auth-verify-email')
        for _ in range(CODIGO_MAX_TENTATIVAS):
            assert cli.post(url, {'codigo': errado}, format='json').status_code == 400
        assert cli.post(url, {'codigo': certo}, format='json').status_code == 400

    def test_codigo_sem_data_de_validade_nao_vale(self, codigos):
        _, user, _ = _registrar()
        certo = _pedir_codigo(user, codigos)
        user.refresh_from_db()
        user.codigo_2fa_expira = None
        user.save(update_fields=['codigo_2fa_expira'])
        assert _redefinir(user, certo).status_code == 400


class TestSessaoEncerradaPelaSenha:

    def test_redefinir_senha_derruba_access_e_refresh(self, codigos):
        cli, user, dados = _registrar()
        assert cli.get(reverse('auth-profile')).status_code == 200
        assert _redefinir(user, _pedir_codigo(user, codigos)).status_code == 200
        assert cli.get(reverse('auth-profile')).status_code == 401
        resp = APIClient().post(reverse('auth-refresh'), {'refresh': dados['refresh']}, format='json')
        assert resp.status_code == 401

    def test_novo_login_funciona_apos_a_troca(self, codigos):
        _, user, _ = _registrar()
        _redefinir(user, _pedir_codigo(user, codigos))
        login = APIClient().post(
            reverse('auth-login'), {'email': user.email, 'password': 'NovaSenha#9'},
            format='json', REMOTE_ADDR=_ip(),
        )
        assert login.status_code == 200
        cli = APIClient()
        cli.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
        assert cli.get(reverse('auth-profile')).status_code == 200
        renovado = APIClient().post(reverse('auth-refresh'), {'refresh': login.data['refresh']}, format='json')
        assert renovado.status_code == 200

    def test_trocar_senha_logado_devolve_tokens_novos_e_derruba_os_velhos(self):
        cli, _, dados = _registrar()
        resp = cli.patch(reverse('auth-change-password'),
                         {'senha_atual': 'Senha@123', 'nova_senha': 'Outra#1234'}, format='json')
        assert resp.status_code == 200
        assert cli.get(reverse('auth-profile')).status_code == 401
        novo = APIClient()
        novo.credentials(HTTP_AUTHORIZATION=f"Bearer {resp.data['access']}")
        assert novo.get(reverse('auth-profile')).status_code == 200
        assert APIClient().post(reverse('auth-refresh'), {'refresh': dados['refresh']}, format='json').status_code == 401
        assert APIClient().post(reverse('auth-refresh'), {'refresh': resp.data['refresh']}, format='json').status_code == 200

    def test_token_sem_selo_continua_valendo(self):
        # Emitidos antes desta mudança não têm o claim `pwd`; valem até expirar.
        from rest_framework_simplejwt.tokens import RefreshToken
        _, user, _ = _registrar()
        refresh = RefreshToken.for_user(user)
        cli = APIClient()
        cli.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
        assert cli.get(reverse('auth-profile')).status_code == 200
