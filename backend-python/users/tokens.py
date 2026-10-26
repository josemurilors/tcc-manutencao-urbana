"""
Tokens JWT que morrem junto com a senha.

O simplejwt não olha o banco: trocar a senha não derrubava as sessões abertas
(refresh de 7 dias). Aqui cada token leva um selo derivado do hash da senha
(`pwd`); mudou a senha, mudou o selo, e access e refresh antigos são recusados.
"""
import hashlib

from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.tokens import RefreshToken

CLAIM = 'pwd'


def selo(user):
    return hashlib.sha256((user.password or '').encode()).hexdigest()[:16]


def emitir(user):
    """RefreshToken do usuário com o selo da senha (o access herda o claim)."""
    refresh = RefreshToken.for_user(user)
    refresh[CLAIM] = selo(user)
    return refresh


def selo_confere(token, user):
    # shortcut: token sem o claim (emitido antes desta mudança) segue valendo até
    # expirar (refresh de 7 dias); depois disso pode virar `== selo(user)` estrito.
    return CLAIM not in token or token[CLAIM] == selo(user)


class LoginSerializer(TokenObtainPairSerializer):
    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token[CLAIM] = selo(user)
        return token


class Autenticacao(JWTAuthentication):
    def get_user(self, validated_token):
        user = super().get_user(validated_token)
        if not selo_confere(validated_token, user):
            raise AuthenticationFailed('Sessão encerrada: a senha foi alterada.', code='token_not_valid')
        return user


def refresh_valido(texto, user):
    """True se o refresh é legível e foi emitido para a senha atual."""
    try:
        return selo_confere(RefreshToken(texto), user)
    except TokenError:
        return False
