"""
Formas de saída da operação (contrato v3, 7.1).

`ChamadoFila` reaproveita a listagem de defeitos (mesma visão por papel de
`_VisaoMixin`) e acrescenta o que a equipe precisa para decidir: score,
prazo, distância, quem atende e o checklist da categoria no município.
"""
from django.urls import reverse
from rest_framework import serializers

from core import permissoes
from defeitos.models import DefeitoAnexo, RespostaPadrao
from defeitos.serializers import (
    CAMPOS_LISTA, DefeitoDetailSerializer, DefeitoListSerializer, mascarar_nome,
)

from . import fila

CAMPOS_FILA = (
    'score', 'score_motivos', 'distancia_m', 'atendente_nome', 'equipe_nome',
    'total_resolvido', 'total_nao_existe', 'checklist',
)


class _ExtrasOperacaoMixin:
    """Campos de operação; `checklists` ({categoria_id: [itens]}) vem do contexto."""

    def get_score(self, obj):
        valor = getattr(obj, 'score', None)
        return round(float(valor), 1) if valor is not None else None

    def get_score_motivos(self, obj):
        return fila.motivos(obj)

    def get_distancia_m(self, obj):
        valor = getattr(obj, 'distancia_m', None)
        return round(float(valor)) if valor is not None else None

    def get_atendente_nome(self, obj):
        if obj.atendente_id and self._eh_equipe_do_chamado(obj):
            return obj.atendente.nome if obj.atendente else ''
        return None

    def get_equipe_nome(self, obj):
        return obj.equipe.nome if obj.equipe_id and obj.equipe else None

    def get_total_resolvido(self, obj):
        return getattr(obj, 'total_resolvido', 0) or 0

    def get_total_nao_existe(self, obj):
        return getattr(obj, 'total_nao_existe', 0) or 0

    def get_checklist(self, obj):
        checklists = self.context.get('checklists')
        if checklists is None:
            checklists = checklists_do_municipio(obj.municipio_id)
            self.context['checklists'] = checklists
        return checklists.get(obj.categoria_id, [])


class ChamadoFilaSerializer(_ExtrasOperacaoMixin, DefeitoListSerializer):
    """Linha da fila (`ChamadoFila` no contrato)."""
    score = serializers.SerializerMethodField()
    score_motivos = serializers.SerializerMethodField()
    distancia_m = serializers.SerializerMethodField()
    atendente_nome = serializers.SerializerMethodField()
    equipe_nome = serializers.SerializerMethodField()
    total_resolvido = serializers.SerializerMethodField()
    total_nao_existe = serializers.SerializerMethodField()
    checklist = serializers.SerializerMethodField()

    class Meta(DefeitoListSerializer.Meta):
        fields = CAMPOS_LISTA + CAMPOS_FILA


class ChamadoOperacaoSerializer(_ExtrasOperacaoMixin, DefeitoDetailSerializer):
    """Detalhe do chamado devolvido pelas ações da operação."""
    score = serializers.SerializerMethodField()
    score_motivos = serializers.SerializerMethodField()
    distancia_m = serializers.SerializerMethodField()
    atendente_nome = serializers.SerializerMethodField()
    equipe_nome = serializers.SerializerMethodField()
    total_resolvido = serializers.SerializerMethodField()
    total_nao_existe = serializers.SerializerMethodField()
    checklist = serializers.SerializerMethodField()

    class Meta(DefeitoDetailSerializer.Meta):
        fields = DefeitoDetailSerializer.Meta.fields + CAMPOS_FILA


def checklists_do_municipio(municipio_id):
    """{categoria_id: [itens]} configurados pela prefeitura (`categoria_municipio.checklist`)."""
    if not municipio_id:
        return {}
    from gestao.models import CategoriaMunicipio

    saida = {}
    linhas = CategoriaMunicipio.objects.filter(municipio_id=str(municipio_id), ativo=True)
    for categoria_id, itens in linhas.values_list('categoria_id', 'checklist'):
        saida[categoria_id] = [str(i) for i in (itens or []) if str(i).strip()]
    return saida


class AnexoSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()
    autor_nome = serializers.SerializerMethodField()

    class Meta:
        model = DefeitoAnexo
        fields = ('id', 'tipo', 'url', 'latitude', 'longitude', 'autor_nome', 'criado_em')

    def get_url(self, obj):
        caminho = reverse('operacao-anexo-imagem', args=[obj.id])
        request = self.context.get('request')
        return request.build_absolute_uri(caminho) if request else caminho

    def get_autor_nome(self, obj):
        nome = obj.autor.nome if obj.autor_id and obj.autor else ''
        if self.context.get('equipe'):
            return nome
        # Fora da equipe: foto da prefeitura sai como "Prefeitura" e a do
        # cidadão com o nome mascarado, como no histórico.
        if obj.tipo in ('antes', 'depois'):
            return 'Prefeitura'
        return mascarar_nome(nome)


class RespostaPadraoSerializer(serializers.ModelSerializer):
    titulo = serializers.CharField(max_length=120, trim_whitespace=True)
    texto = serializers.CharField(max_length=2000, trim_whitespace=True)
    categoria_id = serializers.IntegerField(required=False, allow_null=True)

    class Meta:
        model = RespostaPadrao
        fields = ('id', 'titulo', 'texto', 'categoria_id', 'ativo', 'criado_em')
        read_only_fields = ('id', 'ativo', 'criado_em')

    def validate_categoria_id(self, valor):
        if valor is None:
            return None
        from categorias.models import Categoria

        if not Categoria.objects.filter(pk=valor).exists():
            raise serializers.ValidationError('Categoria não encontrada.')
        return valor


def membro(user):
    return {'id': str(user.id), 'nome': user.nome, 'papel': permissoes.papel(user)}
