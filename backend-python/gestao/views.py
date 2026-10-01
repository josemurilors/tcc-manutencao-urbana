"""
Gestão da prefeitura — `api/v1/gestao/` (contrato v3, seção 7.6).

Toda rota opera sobre UM município: o do usuário (`users.municipio_id`) ou,
para o super admin, o de `?municipio=<codigo>`. Como o município nunca vem
do corpo nem do objeto, o isolamento entre clientes é por construção: os
querysets já nascem filtrados e um id de outra cidade dá 404.

Leitura e escrita têm níveis mínimos diferentes por rota (`leitura` /
`escrita` em cada view). Toda escrita chama `core.auditoria.registrar`.
"""
import uuid
from datetime import datetime, time, timedelta

from django.db import IntegrityError, transaction
from django.db.models import Count, F, Q
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import APIException, NotFound, ParseError, PermissionDenied
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import SAFE_METHODS
from rest_framework.response import Response
from rest_framework.views import APIView

from core import auditoria, permissoes
from core.permissoes import NIVEIS

from . import servicos
from .models import AuditLog, CategoriaMunicipio, Equipe, MunicipioConfig, Secretaria
from .serializers import (
    AuditLogSerializer, CategoriaRegraSerializer, EquipeSerializer, MembroAlterarSerializer,
    MembroCriarSerializer, MunicipioConfigSerializer, RemoverSerializer, RestaurarSerializer,
    SecretariaSerializer, SuspenderSerializer, membro_dict,
)

MENSAGENS_NIVEL = {
    'operador': 'Disponível apenas para a equipe da prefeitura.',
    'gestor': 'Disponível apenas para gestores da prefeitura.',
    'admin_municipal': 'Disponível apenas para administradores da prefeitura.',
}

# Teto das listas da moderação: é uma fila de trabalho, não um relatório.
LIMITE_SINALIZADOS = 100
LIMITE_REMOVIDOS = 50
LIMITE_USUARIOS = 100


class Conflito(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = 'Conflito com o estado atual.'
    default_code = 'conflito'


class DadosInvalidos(APIException):
    """400 no formato do contrato (`{detail}`), com os erros por campo em `campos`."""
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = 'invalido'

    def __init__(self, erros):
        primeiro = _primeira_mensagem(erros)
        super().__init__({'detail': primeiro, 'campos': erros})


def _primeira_mensagem(erros):
    if isinstance(erros, dict):
        for valor in erros.values():
            return _primeira_mensagem(valor)
    if isinstance(erros, (list, tuple)) and erros:
        return _primeira_mensagem(erros[0])
    return str(erros) if erros else 'Dados inválidos.'


def _validar(serializer):
    if not serializer.is_valid():
        raise DadosInvalidos(serializer.errors)
    return serializer.validated_data


def _erro_servico(erro):
    if erro.status == 409:
        return Conflito(str(erro))
    if erro.status == 403:
        return PermissionDenied(str(erro))
    if erro.status == 404:
        return NotFound(str(erro))
    return ParseError(str(erro))


def resolver_municipio(request):
    """Município sobre o qual a requisição age (ver docstring do módulo)."""
    from municipios.models import Municipio

    user = request.user
    pedido = (request.query_params.get('municipio') or '').strip()
    if permissoes.papel(user) == 'super_admin' and pedido:
        if not Municipio.objects.filter(codigo=pedido).exists():
            raise NotFound('Município não encontrado.')
        return pedido
    if pedido and str(pedido) != str(user.municipio_id or ''):
        raise PermissionDenied('Você só gerencia o município em que atua.')
    if not user.municipio_id:
        raise ParseError('Seu usuário não está vinculado a um município.')
    return str(user.municipio_id)


class _GestaoView(APIView):
    leitura = 'gestor'
    escrita = 'admin_municipal'

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        minimo = self.leitura if request.method in SAFE_METHODS else self.escrita
        if permissoes.nivel(request.user) < NIVEIS[minimo]:
            raise PermissionDenied(MENSAGENS_NIVEL[minimo])
        self.municipio_id = resolver_municipio(request)

    def auditar(self, acao, alvo_tipo='', alvo_id='', dados=None):
        auditoria.registrar(
            self.request, acao, alvo_tipo=alvo_tipo, alvo_id=alvo_id,
            dados=dados, municipio_id=self.municipio_id,
        )

    # Secretaria/equipe referenciadas no corpo precisam ser deste município.
    def secretaria_valida(self, secretaria_id):
        if secretaria_id is None:
            return None
        sec = Secretaria.objects.filter(pk=secretaria_id, municipio_id=self.municipio_id, ativo=True).first()
        if sec is None:
            raise ParseError('Secretaria não encontrada neste município.')
        return sec

    def equipe_valida(self, equipe_id):
        if equipe_id is None:
            return None
        eq = Equipe.objects.filter(pk=equipe_id, municipio_id=self.municipio_id, ativo=True).first()
        if eq is None:
            raise ParseError('Equipe não encontrada neste município.')
        return eq


# ---------------------------------------------------------------- município

def _municipio_payload(municipio_id, config):
    from municipios.models import Municipio

    mun = Municipio.objects.filter(codigo=municipio_id).values('nome', 'uf_sigla').first() or {}
    return {
        'municipio_id': municipio_id,
        'nome': mun.get('nome', ''),
        'uf_sigla': mun.get('uf_sigla', ''),
        **MunicipioConfigSerializer(config).data,
    }


class MunicipioView(_GestaoView):
    leitura = 'operador'
    escrita = 'admin_municipal'

    def _config(self):
        # Sem linha ainda = padrão da plataforma; só grava quando alguém edita.
        return (
            MunicipioConfig.objects.filter(pk=self.municipio_id).first()
            or MunicipioConfig(municipio_id=self.municipio_id)
        )

    def get(self, request):
        return Response(_municipio_payload(self.municipio_id, self._config()))

    def patch(self, request):
        config = self._config()
        ser = MunicipioConfigSerializer(config, data=request.data, partial=True)
        dados = _validar(ser)
        # "Contratado" é a flag comercial do cliente: só a plataforma liga/desliga.
        if 'contratado' in dados and permissoes.papel(request.user) != 'super_admin':
            raise PermissionDenied('Apenas a plataforma altera a situação de contratação.')
        antes = {campo: getattr(config, campo) for campo in dados}
        for campo, valor in dados.items():
            setattr(config, campo, valor)
        config.atualizado_em = timezone.now()
        config.save()
        self.auditar('municipio.config', 'municipio', self.municipio_id, {
            'antes': antes, 'depois': {campo: getattr(config, campo) for campo in dados},
        })
        return Response(_municipio_payload(self.municipio_id, config))


# ------------------------------------------------------------- secretarias

class SecretariasView(_GestaoView):

    def get(self, request):
        qs = (
            Secretaria.objects.filter(municipio_id=self.municipio_id)
            .annotate(total_equipes=Count('equipes', filter=Q(equipes__ativo=True)))
            .order_by('-ativo', 'nome')
        )
        if request.query_params.get('ativo') in ('1', 'true'):
            qs = qs.filter(ativo=True)
        return Response(SecretariaSerializer(qs, many=True).data)

    def post(self, request):
        dados = _validar(SecretariaSerializer(data=request.data))
        if Secretaria.objects.filter(municipio_id=self.municipio_id, nome__iexact=dados['nome']).exists():
            raise Conflito('Já existe uma secretaria com este nome.')
        try:
            sec = Secretaria.objects.create(municipio_id=self.municipio_id, **dados)
        except IntegrityError:
            raise Conflito('Já existe uma secretaria com este nome.')
        self.auditar('secretaria.criar', 'secretaria', sec.pk, {'depois': SecretariaSerializer(sec).data})
        return Response(SecretariaSerializer(sec).data, status=status.HTTP_201_CREATED)


class SecretariaDetalheView(_GestaoView):

    def _obj(self, pk):
        sec = Secretaria.objects.filter(pk=pk, municipio_id=self.municipio_id).first()
        if sec is None:
            raise NotFound('Secretaria não encontrada.')
        return sec

    def get(self, request, pk):
        return Response(SecretariaSerializer(self._obj(pk)).data)

    def patch(self, request, pk):
        sec = self._obj(pk)
        dados = _validar(SecretariaSerializer(sec, data=request.data, partial=True))
        if 'nome' in dados and Secretaria.objects.filter(
            municipio_id=self.municipio_id, nome__iexact=dados['nome'],
        ).exclude(pk=sec.pk).exists():
            raise Conflito('Já existe uma secretaria com este nome.')
        antes = SecretariaSerializer(sec).data
        for campo, valor in dados.items():
            setattr(sec, campo, valor)
        sec.save()
        depois = SecretariaSerializer(sec).data
        self.auditar('secretaria.alterar', 'secretaria', sec.pk, {'antes': antes, 'depois': depois})
        return Response(depois)

    def delete(self, request, pk):
        """
        Apaga se nada aponta para ela; senão só desativa — chamados, equipes
        e servidores antigos continuam dizendo de qual secretaria eram.
        """
        from defeitos.models import Defeito
        from users.models import User

        sec = self._obj(pk)
        em_uso = (
            Equipe.objects.filter(secretaria=sec).exists()
            or Defeito.objects.filter(secretaria=sec).exists()
            or CategoriaMunicipio.objects.filter(secretaria=sec).exists()
            or User.objects.filter(secretaria_id=sec.pk).exists()
        )
        if em_uso:
            sec.ativo = False
            sec.save(update_fields=['ativo'])
            self.auditar('secretaria.desativar', 'secretaria', sec.pk, {'nome': sec.nome})
        else:
            self.auditar('secretaria.excluir', 'secretaria', sec.pk, {'nome': sec.nome})
            sec.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# ----------------------------------------------------------------- equipes

def _com_totais_membros(equipes):
    from users.models import User

    equipes = list(equipes)
    totais = dict(
        User.objects.filter(equipe_id__in=[e.id for e in equipes], papel__in=servicos.PAPEIS_VINCULAVEIS)
        .values_list('equipe_id').annotate(total=Count('id'))
    )
    for e in equipes:
        e.total_membros = totais.get(e.id, 0)
    return equipes


class EquipesView(_GestaoView):

    def get(self, request):
        qs = Equipe.objects.filter(municipio_id=self.municipio_id).select_related('secretaria').order_by('-ativo', 'nome')
        if request.query_params.get('ativo') in ('1', 'true'):
            qs = qs.filter(ativo=True)
        secretaria_id = request.query_params.get('secretaria_id')
        if secretaria_id and secretaria_id.isdigit():
            qs = qs.filter(secretaria_id=int(secretaria_id))
        return Response(EquipeSerializer(_com_totais_membros(qs), many=True).data)

    def post(self, request):
        dados = _validar(EquipeSerializer(data=request.data))
        sec = self.secretaria_valida(dados.pop('secretaria_id', None))
        if Equipe.objects.filter(municipio_id=self.municipio_id, nome__iexact=dados['nome']).exists():
            raise Conflito('Já existe uma equipe com este nome.')
        try:
            eq = Equipe.objects.create(municipio_id=self.municipio_id, secretaria=sec, **dados)
        except IntegrityError:
            raise Conflito('Já existe uma equipe com este nome.')
        corpo = EquipeSerializer(eq).data
        self.auditar('equipe.criar', 'equipe', eq.pk, {'depois': corpo})
        return Response(corpo, status=status.HTTP_201_CREATED)


class EquipeDetalheView(_GestaoView):

    def _obj(self, pk):
        eq = Equipe.objects.select_related('secretaria').filter(pk=pk, municipio_id=self.municipio_id).first()
        if eq is None:
            raise NotFound('Equipe não encontrada.')
        return eq

    def get(self, request, pk):
        return Response(EquipeSerializer(self._obj(pk)).data)

    def patch(self, request, pk):
        eq = self._obj(pk)
        dados = _validar(EquipeSerializer(eq, data=request.data, partial=True))
        if 'nome' in dados and Equipe.objects.filter(
            municipio_id=self.municipio_id, nome__iexact=dados['nome'],
        ).exclude(pk=eq.pk).exists():
            raise Conflito('Já existe uma equipe com este nome.')
        antes = EquipeSerializer(eq).data
        if 'secretaria_id' in dados:
            eq.secretaria = self.secretaria_valida(dados.pop('secretaria_id'))
        for campo, valor in dados.items():
            setattr(eq, campo, valor)
        eq.save()
        depois = EquipeSerializer(eq).data
        self.auditar('equipe.alterar', 'equipe', eq.pk, {'antes': antes, 'depois': depois})
        return Response(depois)

    def delete(self, request, pk):
        """Como secretaria: desativa se há chamados ou membros, apaga se não há."""
        from defeitos.models import Defeito
        from users.models import User

        eq = self._obj(pk)
        if Defeito.objects.filter(equipe=eq).exists() or User.objects.filter(equipe_id=eq.pk).exists():
            eq.ativo = False
            eq.save(update_fields=['ativo'])
            self.auditar('equipe.desativar', 'equipe', eq.pk, {'nome': eq.nome})
        else:
            self.auditar('equipe.excluir', 'equipe', eq.pk, {'nome': eq.nome})
            eq.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# ----------------------------------------------------------------- membros

def _nomes(municipio_id):
    secretarias = dict(Secretaria.objects.filter(municipio_id=municipio_id).values_list('id', 'nome'))
    equipes = dict(Equipe.objects.filter(municipio_id=municipio_id).values_list('id', 'nome'))
    return secretarias, equipes


def _abertos_por_atendente(ids):
    from defeitos import fluxo
    from defeitos.models import Defeito

    return dict(
        Defeito.objects.ativos()
        .filter(atendente_id__in=ids, status__in=fluxo.STATUS_ABERTOS)
        .values_list('atendente_id').annotate(total=Count('id'))
    )


class _MembrosBase(_GestaoView):

    def membros(self):
        from users.models import User

        return User.objects.filter(municipio_id=self.municipio_id, papel__in=servicos.PAPEIS_VINCULAVEIS)

    def payload(self, alvo):
        secretarias, equipes = _nomes(self.municipio_id)
        abertos = _abertos_por_atendente([alvo.pk]).get(alvo.pk, 0)
        return membro_dict(alvo, secretarias, equipes, abertos)

    def lotacao(self, dados, alvo=None):
        """
        (secretaria_id, equipe_id) a gravar. Equipe de uma secretaria puxa a
        secretaria junto; as duas informadas e divergentes é erro.
        """
        sec_id = alvo.secretaria_id if alvo else None
        eq_id = alvo.equipe_id if alvo else None
        if 'secretaria_id' in dados:
            sec = self.secretaria_valida(dados['secretaria_id'])
            sec_id = sec.pk if sec else None
        if 'equipe_id' in dados:
            eq = self.equipe_valida(dados['equipe_id'])
            eq_id = eq.pk if eq else None
            if eq is not None and eq.secretaria_id:
                if 'secretaria_id' in dados and sec_id is not None and sec_id != eq.secretaria_id:
                    raise ParseError('A equipe escolhida pertence a outra secretaria.')
                sec_id = eq.secretaria_id
        elif 'secretaria_id' in dados and eq_id:
            # Mudou de secretaria sem dizer a equipe: a antiga só fica se for dela.
            da_equipe = Equipe.objects.filter(pk=eq_id).values_list('secretaria_id', flat=True).first()
            if da_equipe and da_equipe != sec_id:
                eq_id = None
        return sec_id, eq_id

    def checar_alcance(self, alvo):
        if permissoes.nivel(alvo) > permissoes.nivel(self.request.user):
            raise PermissionDenied('Você não pode alterar alguém com papel acima do seu.')


class MembrosView(_MembrosBase):

    def get(self, request):
        qs = self.membros()
        termo = (request.query_params.get('q') or '').strip()
        if termo:
            qs = qs.filter(Q(nome__icontains=termo) | Q(email__icontains=termo))
        papel_filtro = request.query_params.get('papel')
        if papel_filtro:
            qs = qs.filter(papel=papel_filtro)
        for campo in ('equipe_id', 'secretaria_id'):
            valor = request.query_params.get(campo)
            if valor and valor.isdigit():
                qs = qs.filter(**{campo: int(valor)})
        usuarios = sorted(qs, key=lambda u: (-NIVEIS.get(u.papel, 0), u.nome.lower()))
        secretarias, equipes = _nomes(self.municipio_id)
        abertos = _abertos_por_atendente([u.pk for u in usuarios])
        return Response([membro_dict(u, secretarias, equipes, abertos.get(u.pk, 0)) for u in usuarios])

    def post(self, request):
        """Vincula uma conta existente (pelo e-mail) à equipe da prefeitura."""
        from users.models import User

        dados = _validar(MembroCriarSerializer(data=request.data))
        gestor = request.user
        if dados['papel'] == 'super_admin' and permissoes.papel(gestor) != 'super_admin':
            raise PermissionDenied('Apenas a plataforma concede o papel de super admin.')
        alvo = User.objects.filter(email__iexact=dados['email'].strip()).first()
        if alvo is None:
            raise NotFound(
                'Nenhuma conta com este e-mail. Peça para a pessoa criar a conta no app e tente de novo.'
            )
        if alvo.pk == gestor.pk:
            raise ParseError('Você não pode alterar o próprio papel.')
        self.checar_alcance(alvo)
        if permissoes.eh_equipe(alvo):
            if str(alvo.municipio_id or '') == self.municipio_id:
                raise Conflito('Esta pessoa já faz parte da equipe. Altere o papel na lista de membros.')
            raise Conflito('Esta pessoa já atua na equipe de outro município.')
        sec_id, eq_id = self.lotacao(dados)

        antes = {'papel': alvo.papel, 'municipio_id': alvo.municipio_id,
                 'secretaria_id': alvo.secretaria_id, 'equipe_id': alvo.equipe_id}
        alvo.papel = dados['papel']
        alvo.municipio_id = self.municipio_id
        alvo.secretaria_id = sec_id
        alvo.equipe_id = eq_id
        alvo.save(update_fields=['papel', 'municipio_id', 'secretaria_id', 'equipe_id'])
        self.auditar('membro.vincular', 'usuario', alvo.pk, {
            'email': alvo.email, 'antes': antes,
            'depois': {'papel': alvo.papel, 'municipio_id': alvo.municipio_id,
                       'secretaria_id': sec_id, 'equipe_id': eq_id},
        })
        return Response(self.payload(alvo), status=status.HTTP_201_CREATED)


class MembroDetalheView(_MembrosBase):

    def _obj(self, pk):
        alvo = self.membros().filter(pk=pk).first()
        if alvo is None:
            raise NotFound('Membro não encontrado nesta prefeitura.')
        return alvo

    def get(self, request, pk):
        return Response(self.payload(self._obj(pk)))

    def patch(self, request, pk):
        dados = _validar(MembroAlterarSerializer(data=request.data))
        alvo = self._obj(pk)
        gestor = request.user
        self.checar_alcance(alvo)
        novo = dados.get('papel', alvo.papel)
        if novo != alvo.papel:
            if alvo.pk == gestor.pk:
                raise ParseError('Você não pode alterar o próprio papel.')
            if novo == 'super_admin' and permissoes.papel(gestor) != 'super_admin':
                raise PermissionDenied('Apenas a plataforma concede o papel de super admin.')
            if servicos.eh_ultimo_admin(alvo, self.municipio_id):
                raise Conflito('Esta é a única pessoa administradora da prefeitura. '
                               'Promova outra pessoa antes de mudar este papel.')
        sec_id, eq_id = self.lotacao(dados, alvo)

        antes = {'papel': alvo.papel, 'secretaria_id': alvo.secretaria_id, 'equipe_id': alvo.equipe_id}
        alvo.papel = novo
        alvo.secretaria_id = sec_id
        alvo.equipe_id = eq_id
        alvo.save(update_fields=['papel', 'secretaria_id', 'equipe_id'])
        depois = {'papel': alvo.papel, 'secretaria_id': sec_id, 'equipe_id': eq_id}
        if antes != depois:
            self.auditar('membro.alterar', 'usuario', alvo.pk, {'email': alvo.email, 'antes': antes, 'depois': depois})
        return Response(self.payload(alvo))

    def delete(self, request, pk):
        """Revoga o acesso: volta a cidadão e os chamados abertos dele voltam para a fila."""
        alvo = self._obj(pk)
        self.checar_alcance(alvo)
        if alvo.pk == request.user.pk:
            raise ParseError('Você não pode revogar o próprio acesso. Peça a outra pessoa administradora.')
        if servicos.eh_ultimo_admin(alvo, self.municipio_id):
            raise Conflito('Esta é a única pessoa administradora da prefeitura. '
                           'Promova outra pessoa antes de revogar este acesso.')
        antes = {'papel': alvo.papel, 'secretaria_id': alvo.secretaria_id, 'equipe_id': alvo.equipe_id}
        with transaction.atomic():
            liberados = servicos.desatribuir_abertos(alvo, request.user, 'membro_revogado')
            alvo.papel = 'cidadao'
            alvo.secretaria_id = None
            alvo.equipe_id = None
            alvo.save(update_fields=['papel', 'secretaria_id', 'equipe_id'])
            self.auditar('membro.revogar', 'usuario', alvo.pk, {
                'email': alvo.email, 'antes': antes, 'chamados_liberados': liberados,
            })
        return Response({'id': str(alvo.pk), 'papel': alvo.papel, 'chamados_liberados': liberados})


# -------------------------------------------------------------- categorias

class CategoriasView(_GestaoView):
    leitura = 'operador'

    def get(self, request):
        return Response(servicos.regras_categorias(self.municipio_id))


class CategoriaDetalheView(_GestaoView):
    leitura = 'operador'

    def _base(self, categoria_id):
        from categorias.models import Categoria

        cat = Categoria.objects.filter(pk=categoria_id).first()
        if cat is None:
            raise NotFound('Categoria não encontrada.')
        return cat

    def get(self, request, categoria_id):
        self._base(categoria_id)
        return Response(servicos.regra_categoria(self.municipio_id, categoria_id))

    def patch(self, request, categoria_id):
        cat = self._base(categoria_id)
        dados = _validar(CategoriaRegraSerializer(data=request.data))
        if not dados:
            raise ParseError('Nada para alterar.')
        with transaction.atomic():
            antes = servicos.regra_categoria(self.municipio_id, cat.id)
            regra, _ = CategoriaMunicipio.objects.get_or_create(municipio_id=self.municipio_id, categoria=cat)
            if 'secretaria_id' in dados:
                regra.secretaria = self.secretaria_valida(dados.pop('secretaria_id'))
            for campo, valor in dados.items():
                setattr(regra, campo, valor)
            regra.save()
            depois = servicos.regra_categoria(self.municipio_id, cat.id)
            recalculados = servicos.recalcular_prazos(
                self.municipio_id, cat, antes['prazo_sla_dias'], depois['prazo_sla_dias'], request.user,
            )
            self.auditar('categoria.alterar', 'categoria', cat.id, {
                'nome': cat.nome,
                'antes': {k: antes[k] for k in ('prazo_sla_dias', 'prioridade', 'secretaria_id', 'ativo', 'checklist')},
                'depois': {k: depois[k] for k in ('prazo_sla_dias', 'prioridade', 'secretaria_id', 'ativo', 'checklist')},
                'chamados_recalculados': recalculados,
            })
        return Response({**depois, 'chamados_recalculados': recalculados})


# --------------------------------------------------------------- moderação

def _defeito_moderacao(d):
    # Sem máscara no nome do autor: só gestor+ chega aqui e precisa saber quem moderar.
    return {
        'id': str(d.id),
        'protocolo': d.protocolo,
        'titulo': d.titulo,
        'categoria': d.categoria,
        'status': d.status,
        'bairro': d.bairro,
        'rua': d.rua,
        'visibilidade': d.visibilidade,
        'criado_em': d.criado_em,
        'autor_id': str(d.usuario_id) if d.usuario_id else None,
        'autor_nome': d.usuario.nome if d.usuario_id and d.usuario else None,
    }


class ModeracaoView(_GestaoView):
    leitura = 'gestor'

    def get(self, request):
        from defeitos import fluxo, regras
        from defeitos.models import Defeito
        from users.models import User

        mun = self.municipio_id
        sinalizados_qs = (
            Defeito.objects.ativos()
            .filter(municipio_id=mun, status__in=fluxo.STATUS_ABERTOS)
            .select_related('usuario')
            .annotate(
                total_resolvido=Count('sinalizacoes', filter=Q(sinalizacoes__tipo='resolvido'), distinct=True),
                total_nao_existe=Count('sinalizacoes', filter=Q(sinalizacoes__tipo='nao_existe'), distinct=True),
                total_apoios=Count('apoios', distinct=True),
            )
            .filter(Q(total_resolvido__gt=0) | Q(total_nao_existe__gt=0))
            .order_by('-total_nao_existe', '-total_resolvido', 'criado_em')
        )
        sinalizados = [
            {**_defeito_moderacao(d), 'total_resolvido': d.total_resolvido,
             'total_nao_existe': d.total_nao_existe, 'total_apoios': d.total_apoios}
            for d in sinalizados_qs[:LIMITE_SINALIZADOS]
        ]

        removidos_qs = (
            Defeito.objects.filter(municipio_id=mun, removido_em__isnull=False)
            .select_related('usuario').order_by('-removido_em')
        )
        removidos = [
            {**_defeito_moderacao(d), 'removido_em': d.removido_em, 'removido_motivo': d.removido_motivo}
            for d in removidos_qs[:LIMITE_REMOVIDOS]
        ]

        agora = timezone.now()
        limite_strike = agora - timedelta(days=regras.STRIKE_VALIDADE_DIAS)
        autores_aqui = Defeito.objects.filter(municipio_id=mun, usuario__isnull=False).values('usuario_id')
        usuarios_qs = (
            User.objects.filter(Q(municipio_id=mun) | Q(id__in=autores_aqui))
            .exclude(papel__in=permissoes.PAPEIS_EQUIPE)
            .annotate(strikes_ativos=Count('strikes', filter=Q(strikes__criado_em__gte=limite_strike), distinct=True))
            .filter(Q(suspenso_ate__gt=agora) | Q(strikes_ativos__gt=0))
            .order_by(F('suspenso_ate').desc(nulls_last=True), '-strikes_ativos', 'nome')
        )
        usuarios = list(usuarios_qs[:LIMITE_USUARIOS])
        removidos_por_autor = dict(
            Defeito.objects.filter(municipio_id=mun, removido_em__isnull=False, usuario_id__in=[u.pk for u in usuarios])
            .values_list('usuario_id').annotate(total=Count('id'))
        )
        usuarios_payload = [{
            'id': str(u.pk),
            'nome': u.nome,
            'suspenso_ate': u.suspenso_ate,
            'suspenso': servicos.usuario_suspenso(u, agora),
            'strikes_ativos': u.strikes_ativos,
            'em_quarentena': u.strikes_ativos > regras.STRIKES_TOLERADOS,
            'chamados_removidos': removidos_por_autor.get(u.pk, 0),
        } for u in usuarios]

        return Response({
            'sinalizados': sinalizados,
            'removidos': removidos,
            'usuarios': usuarios_payload,
            'contagens': {
                'sinalizados': sinalizados_qs.count(),
                'removidos': removidos_qs.count(),
                'suspensos': sum(1 for u in usuarios_payload if u['suspenso']),
                'em_quarentena': sum(1 for u in usuarios_payload if u['em_quarentena']),
            },
        })


class _ModeracaoDefeitoView(_GestaoView):
    escrita = 'gestor'

    def defeito(self, pk):
        from defeitos.models import Defeito

        d = Defeito.objects.filter(pk=pk, municipio_id=self.municipio_id).first()
        if d is None:
            raise NotFound('Chamado não encontrado.')
        return d


def _resposta_defeito(d):
    return {'id': str(d.id), 'protocolo': d.protocolo, 'removido_em': d.removido_em,
            'removido_motivo': d.removido_motivo}


class RemoverDefeitoView(_ModeracaoDefeitoView):

    def post(self, request, pk):
        from defeitos import regras

        dados = _validar(RemoverSerializer(data=request.data))
        d = self.defeito(pk)
        if d.removido_em is not None:
            raise Conflito('Este chamado já foi removido.')
        with transaction.atomic():
            regras.remover(d, request.user, dados['motivo'], texto='Removido pela moderação da prefeitura.')
            self.auditar('moderacao.remover', 'defeito', d.pk, {'protocolo': d.protocolo, 'motivo': dados['motivo']})
        return Response(_resposta_defeito(d))


class RestaurarDefeitoView(_ModeracaoDefeitoView):

    def post(self, request, pk):
        dados = _validar(RestaurarSerializer(data=request.data))
        d = self.defeito(pk)
        if d.removido_em is None:
            raise Conflito('Este chamado não está removido.')
        motivo_anterior = d.removido_motivo
        with transaction.atomic():
            strike = servicos.restaurar(d, request.user, motivo=dados.get('motivo', ''))
            self.auditar('moderacao.restaurar', 'defeito', d.pk, {
                'protocolo': d.protocolo, 'motivo_anterior': motivo_anterior,
                'motivo': dados.get('motivo', ''), 'strike_retirado': strike,
            })
        return Response({**_resposta_defeito(d), 'strike_retirado': strike})


class _ModeracaoUsuarioView(_GestaoView):
    escrita = 'gestor'

    def alvo(self, pk):
        from users.models import User

        alvo = User.objects.filter(pk=pk).first()
        if alvo is None:
            raise NotFound('Usuário não encontrado.')
        if alvo.pk == self.request.user.pk:
            raise ParseError('Você não pode moderar a própria conta.')
        if permissoes.eh_equipe(alvo):
            raise ParseError('Servidores não são suspensos por aqui: revogue o acesso em Membros.')
        if not servicos.pode_moderar_usuario(self.request.user, alvo, self.municipio_id):
            raise NotFound('Usuário não encontrado neste município.')
        return alvo


def _resposta_usuario(u):
    return {'id': str(u.pk), 'nome': u.nome, 'suspenso_ate': u.suspenso_ate,
            'suspenso': servicos.usuario_suspenso(u)}


class SuspenderUsuarioView(_ModeracaoUsuarioView):

    def post(self, request, pk):
        dados = _validar(SuspenderSerializer(data=request.data))
        alvo = self.alvo(pk)
        antes = alvo.suspenso_ate
        with transaction.atomic():
            servicos.suspender(alvo, dados['dias'], dados['motivo'])
            self.auditar('usuario.suspender', 'usuario', alvo.pk, {
                'dias': dados['dias'], 'motivo': dados['motivo'],
                'antes': antes, 'suspenso_ate': alvo.suspenso_ate,
            })
        return Response(_resposta_usuario(alvo))


class ReativarUsuarioView(_ModeracaoUsuarioView):

    def post(self, request, pk):
        alvo = self.alvo(pk)
        if not servicos.usuario_suspenso(alvo):
            raise Conflito('Este usuário não está suspenso.')
        antes = alvo.suspenso_ate
        with transaction.atomic():
            servicos.reativar(alvo)
            self.auditar('usuario.reativar', 'usuario', alvo.pk, {'suspenso_ate_anterior': antes})
        return Response(_resposta_usuario(alvo))


# --------------------------------------------------------------- auditoria

class AuditoriaPaginacao(PageNumberPagination):
    page_size = 30
    page_size_query_param = 'page_size'
    max_page_size = 100


def _data(valor, nome):
    try:
        return datetime.strptime(valor, '%Y-%m-%d').date()
    except ValueError:
        raise ParseError(f'Use a data "{nome}" no formato AAAA-MM-DD.')


class AuditoriaView(_GestaoView):
    leitura = 'admin_municipal'

    def get(self, request):
        qs = AuditLog.objects.filter(municipio_id=self.municipio_id).select_related('usuario').order_by('-criado_em', '-id')
        params = request.query_params
        acao = (params.get('acao') or '').strip()
        if acao:
            # `acao=membro` traz membro.vincular, membro.revogar... ; `membro.revogar` só ela.
            qs = qs.filter(Q(acao=acao) | Q(acao__startswith=f'{acao}.'))
        usuario_id = (params.get('usuario_id') or '').strip()
        if usuario_id:
            try:
                uuid.UUID(usuario_id)
            except ValueError:
                raise ParseError('usuario_id inválido.')
            qs = qs.filter(usuario_id=usuario_id)
        for campo in ('alvo_tipo', 'alvo_id'):
            valor = (params.get(campo) or '').strip()
            if valor:
                qs = qs.filter(**{campo: valor})
        fuso = timezone.get_current_timezone()
        if params.get('inicio'):
            qs = qs.filter(criado_em__gte=timezone.make_aware(datetime.combine(_data(params['inicio'], 'inicio'), time.min), fuso))
        if params.get('fim'):
            fim = _data(params['fim'], 'fim') + timedelta(days=1)
            qs = qs.filter(criado_em__lt=timezone.make_aware(datetime.combine(fim, time.min), fuso))
        paginador = AuditoriaPaginacao()
        pagina = paginador.paginate_queryset(qs, request, view=self)
        return paginador.get_paginated_response(AuditLogSerializer(pagina, many=True).data)
