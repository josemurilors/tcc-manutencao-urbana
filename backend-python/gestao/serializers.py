"""
Entrada e saída da gestão (contrato v3, seção 7.6).

A entrada é validada por serializers simples; o que depende do município
(secretaria/equipe pertencem a ele?) fica na view, que sabe qual é.
"""
import re

from rest_framework import serializers

from core.permissoes import NIVEIS

from . import servicos
from .models import AuditLog, Equipe, MunicipioConfig, Secretaria

COR_HEX = re.compile(r'^#[0-9a-fA-F]{6}$')


# -------------------------------------------------------------- município

class MunicipioConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = MunicipioConfig
        fields = (
            'contratado', 'nome_exibicao', 'cor_primaria', 'email_contato', 'telefone',
            'site', 'raio_duplicado_m', 'parametros', 'atualizado_em',
        )
        read_only_fields = ('atualizado_em',)
        extra_kwargs = {
            'nome_exibicao': {'max_length': 120},
            'telefone': {'max_length': 30},
            'site': {'max_length': 255},
        }

    email_contato = serializers.EmailField(required=False, allow_blank=True)
    raio_duplicado_m = serializers.IntegerField(required=False, min_value=5, max_value=500)

    def validate_cor_primaria(self, valor):
        if valor and not COR_HEX.match(valor):
            raise serializers.ValidationError('Use uma cor no formato #RRGGBB.')
        return valor

    def validate_site(self, valor):
        if valor and not valor.startswith(('http://', 'https://')):
            raise serializers.ValidationError('O site precisa começar com http:// ou https://.')
        return valor

    def validate_parametros(self, valor):
        if not isinstance(valor, dict):
            raise serializers.ValidationError('Parâmetros devem ser um objeto.')
        # Chaves que a operação lê (`operacao/views.py::PARAMETROS_PADRAO`):
        # tipo errado aqui viraria 500 ou regra silenciosamente desligada lá.
        if 'exigir_foto_conclusao' in valor and not isinstance(valor['exigir_foto_conclusao'], bool):
            raise serializers.ValidationError('"exigir_foto_conclusao" deve ser verdadeiro ou falso.')
        if 'raio_evidencia_m' in valor:
            raio = valor['raio_evidencia_m']
            if isinstance(raio, bool) or not isinstance(raio, int) or not 20 <= raio <= 2000:
                raise serializers.ValidationError('"raio_evidencia_m" deve ser um inteiro de 20 a 2000 metros.')
        return valor


# ---------------------------------------------------- secretarias/equipes

class SecretariaSerializer(serializers.ModelSerializer):
    nome = serializers.CharField(max_length=120)
    sigla = serializers.CharField(max_length=20, required=False, allow_blank=True)
    email = serializers.EmailField(required=False, allow_blank=True)
    total_equipes = serializers.SerializerMethodField()

    class Meta:
        model = Secretaria
        fields = ('id', 'nome', 'sigla', 'email', 'ativo', 'criado_em', 'total_equipes')
        read_only_fields = ('id', 'criado_em')
        # A unicidade (município, nome) é checada na view, que conhece o município.
        validators = []

    def validate_nome(self, valor):
        valor = ' '.join(valor.split())
        if len(valor) < 2:
            raise serializers.ValidationError('Informe o nome da secretaria.')
        return valor

    def get_total_equipes(self, obj):
        if hasattr(obj, 'total_equipes'):
            return obj.total_equipes
        return obj.equipes.filter(ativo=True).count()


class EquipeSerializer(serializers.ModelSerializer):
    nome = serializers.CharField(max_length=120)
    secretaria_id = serializers.IntegerField(required=False, allow_null=True)
    secretaria_nome = serializers.SerializerMethodField()
    total_membros = serializers.SerializerMethodField()

    class Meta:
        model = Equipe
        fields = ('id', 'nome', 'secretaria_id', 'secretaria_nome', 'ativo', 'criado_em', 'total_membros')
        read_only_fields = ('id', 'criado_em')
        validators = []

    def validate_nome(self, valor):
        valor = ' '.join(valor.split())
        if len(valor) < 2:
            raise serializers.ValidationError('Informe o nome da equipe.')
        return valor

    def get_secretaria_nome(self, obj):
        return obj.secretaria.nome if obj.secretaria_id and obj.secretaria else None

    def get_total_membros(self, obj):
        if hasattr(obj, 'total_membros'):
            return obj.total_membros
        from users.models import User
        return User.objects.filter(equipe_id=obj.id, papel__in=servicos.PAPEIS_VINCULAVEIS).count()


# ----------------------------------------------------------------- membros

class MembroCriarSerializer(serializers.Serializer):
    # Não é EmailField: a conta já existe (o vínculo é por busca exata) e o
    # validador do Django recusa domínios sem ponto que o cadastro aceitou.
    email = serializers.CharField(max_length=254)
    papel = serializers.ChoiceField(choices=servicos.PAPEIS_VINCULAVEIS)
    secretaria_id = serializers.IntegerField(required=False, allow_null=True)
    equipe_id = serializers.IntegerField(required=False, allow_null=True)


    def validate_email(self, valor):
        valor = valor.strip()
        if '@' not in valor or ' ' in valor:
            raise serializers.ValidationError('Informe um e-mail válido.')
        return valor


class MembroAlterarSerializer(serializers.Serializer):
    papel = serializers.ChoiceField(choices=servicos.PAPEIS_VINCULAVEIS, required=False)
    secretaria_id = serializers.IntegerField(required=False, allow_null=True)
    equipe_id = serializers.IntegerField(required=False, allow_null=True)


def membro_dict(user, nomes_secretarias, nomes_equipes, abertos=0):
    return {
        'id': str(user.id),
        'nome': user.nome,
        'email': user.email,
        'papel': user.papel,
        'nivel': NIVEIS.get(user.papel, 0),
        'secretaria_id': user.secretaria_id,
        'secretaria_nome': nomes_secretarias.get(user.secretaria_id),
        'equipe_id': user.equipe_id,
        'equipe_nome': nomes_equipes.get(user.equipe_id),
        'suspenso_ate': user.suspenso_ate,
        'chamados_abertos': abertos,
        'criado_em': user.criado_em,
    }


# -------------------------------------------------------------- categorias

class CategoriaRegraSerializer(serializers.Serializer):
    """PATCH de uma categoria: `null` em prazo/prioridade/secretaria volta ao padrão."""
    prazo_sla_dias = serializers.IntegerField(
        required=False, allow_null=True, min_value=servicos.SLA_MIN_DIAS, max_value=servicos.SLA_MAX_DIAS,
    )
    prioridade = serializers.ChoiceField(choices=servicos.PRIORIDADES, required=False, allow_null=True)
    secretaria_id = serializers.IntegerField(required=False, allow_null=True)
    ativo = serializers.BooleanField(required=False)
    checklist = serializers.ListField(
        child=serializers.CharField(max_length=servicos.CHECKLIST_MAX_CHARS, allow_blank=False),
        required=False, max_length=servicos.CHECKLIST_MAX_ITENS,
    )

    def validate_checklist(self, itens):
        limpos = [' '.join(i.split()) for i in itens]
        return [i for i in limpos if i]


# --------------------------------------------------------------- moderação

class RemoverSerializer(serializers.Serializer):
    motivo = serializers.CharField(min_length=3, max_length=500)


class RestaurarSerializer(serializers.Serializer):
    motivo = serializers.CharField(required=False, allow_blank=True, max_length=500, default='')


class SuspenderSerializer(serializers.Serializer):
    dias = serializers.IntegerField(min_value=1, max_value=servicos.SUSPENSAO_MAX_DIAS)
    motivo = serializers.CharField(min_length=3, max_length=500)


# --------------------------------------------------------------- auditoria

class AuditLogSerializer(serializers.ModelSerializer):
    usuario_id = serializers.SerializerMethodField()
    usuario_nome = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = ('id', 'acao', 'usuario_id', 'usuario_nome', 'municipio_id', 'alvo_tipo', 'alvo_id',
                  'dados', 'ip', 'criado_em')

    def get_usuario_id(self, obj):
        return str(obj.usuario_id) if obj.usuario_id else None

    def get_usuario_nome(self, obj):
        return obj.usuario.nome if obj.usuario_id and obj.usuario else None
