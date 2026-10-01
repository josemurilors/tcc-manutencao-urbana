"""
Papéis e permissões (contrato v3, seção 3).

Um servidor atua em **um** município (`users.municipio_id`). A hierarquia é
`operador` < `gestor` < `admin_municipal`; o `super_admin` gere qualquer
município, mas opera chamados só no seu. Toda checagem de papel passa por
aqui — nada de `user.admin` espalhado pelas views.
"""
from rest_framework.permissions import BasePermission

PAPEIS_EQUIPE = ('operador', 'gestor', 'admin_municipal', 'super_admin')

NIVEIS = {
    'cidadao': 0,
    'operador': 1,
    'gestor': 2,
    'admin_municipal': 3,
    'super_admin': 4,
}


def papel(user) -> str:
    if user is None or not getattr(user, 'is_authenticated', False):
        return 'cidadao'
    valor = getattr(user, 'papel', None) or 'cidadao'
    return valor if valor in NIVEIS else 'cidadao'


def nivel(user) -> int:
    return NIVEIS[papel(user)]


def eh_equipe(user) -> bool:
    return nivel(user) >= NIVEIS['operador']


def _municipio_de(defeito_ou_municipio_id):
    """Aceita um objeto com `municipio_id` (chamado) ou o próprio código."""
    if defeito_ou_municipio_id is None or isinstance(defeito_ou_municipio_id, (str, int)):
        return defeito_ou_municipio_id
    return getattr(defeito_ou_municipio_id, 'municipio_id', None)


def _mesmo_municipio(user, municipio_id):
    return bool(user.municipio_id) and municipio_id is not None and str(municipio_id) == str(user.municipio_id)


def pode_operar(user, defeito_ou_municipio_id) -> bool:
    """Ver fila, assumir, mudar status: equipe do município — inclusive o super admin."""
    if not eh_equipe(user):
        return False
    return _mesmo_municipio(user, _municipio_de(defeito_ou_municipio_id))


def pode_gerir(user, municipio_id) -> bool:
    """Gestor+ no município (super admin: qualquer)."""
    municipio_id = _municipio_de(municipio_id)
    if papel(user) == 'super_admin':
        return True
    return nivel(user) >= NIVEIS['gestor'] and _mesmo_municipio(user, municipio_id)


def pode_administrar(user, municipio_id) -> bool:
    """Admin municipal+ no município (super admin: qualquer)."""
    municipio_id = _municipio_de(municipio_id)
    if papel(user) == 'super_admin':
        return True
    return nivel(user) >= NIVEIS['admin_municipal'] and _mesmo_municipio(user, municipio_id)


class _NivelMinimo(BasePermission):
    """
    Nível mínimo na view; no objeto (algo com `municipio_id`) exige também o
    município certo, pelo mesmo critério das funções acima.
    """
    minimo = 'operador'
    message = 'Permissão negada'

    def has_permission(self, request, view):
        return nivel(request.user) >= NIVEIS[self.minimo]

    def has_object_permission(self, request, view, obj):
        return self.checar_objeto(request.user, obj)

    def checar_objeto(self, user, obj):
        return pode_operar(user, obj)


class EhEquipe(_NivelMinimo):
    minimo = 'operador'


class EhGestor(_NivelMinimo):
    minimo = 'gestor'

    def checar_objeto(self, user, obj):
        return pode_gerir(user, obj)


class EhAdminMunicipal(_NivelMinimo):
    minimo = 'admin_municipal'

    def checar_objeto(self, user, obj):
        return pode_administrar(user, obj)
