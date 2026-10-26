import base64
import math
from rest_framework import serializers
from django.conf import settings
from django.db import connection
from django.db.models import Count
from core import permissoes
from . import fluxo, sla
from .models import Defeito, Apoio, DefeitoEvento

PRIORIDADES = ('urgente', 'alta', 'media', 'baixa')


def mascarar_nome(nome):
    """'Maria Silva Souza' -> 'Maria S.' (LGPD: o público não vê o nome completo do autor)."""
    partes = (nome or '').split()
    if not partes:
        return ''
    if len(partes) == 1:
        return partes[0]
    return f'{partes[0]} {partes[-1][0].upper()}.'


def _sinalizacoes(obj):
    """
    Contagem de sinalizações do cidadão ("já foi resolvido" / "não existe").
    Vem das anotações do queryset da viewset; um objeto avulso (ex.: recém
    salvo numa action) conta direto no banco.
    """
    if hasattr(obj, 'total_resolvido'):
        return {
            'resolvido': obj.total_resolvido,
            'nao_existe': obj.total_nao_existe,
        }
    contagem = {'resolvido': 0, 'nao_existe': 0}
    for linha in obj.sinalizacoes.values('tipo').annotate(total=Count('id')):
        contagem[linha['tipo']] = linha['total']
    return contagem


class FotoField(serializers.Field):
    """
    Foto do chamado (`imagem_thumbnail` ou `foto_resolucao`). Por padrão vai
    inline como data URI (contrato antigo do app). Com `?imagens=url` na
    requisição vai só a URL de `defeitos/<id>/foto/` — com ETag e
    Cache-Control, sem repetir centenas de KB em base64 a cada resposta de
    ação. `v` muda quando o chamado muda, para o cache do app não servir foto velha.
    """
    TIPOS = {'imagem_thumbnail': 'reporte', 'foto_resolucao': 'resolucao'}

    def __init__(self, campo, **kwargs):
        self.campo = campo
        super().__init__(source='*', read_only=True, **kwargs)

    def to_representation(self, obj):
        valor = getattr(obj, self.campo)
        if not valor:
            return None
        request = self.context.get('request')
        params = getattr(request, 'query_params', None) or getattr(request, 'GET', None) or {}
        if request is not None and params.get('imagens') == 'url':
            from django.urls import reverse
            versao = int(obj.atualizado_em.timestamp()) if obj.atualizado_em else 0
            caminho = reverse('defeitos-foto', args=[obj.pk])
            return request.build_absolute_uri(f'{caminho}?tipo={self.TIPOS[self.campo]}&v={versao}')
        return f'data:image/webp;base64,{base64.b64encode(valor).decode("ascii")}'


class _VisaoMixin:
    """
    O que cada um enxerga do chamado. A equipe do município do chamado vê o
    nome completo do autor e quem atende; o resto (cidadão, anônimo, equipe
    de outra cidade) vê o nome mascarado e nenhum id de usuário. Sem
    `request` no contexto vale a visão pública.
    """

    def _usuario(self):
        request = self.context.get('request')
        return getattr(request, 'user', None)

    def _eh_equipe_do_chamado(self, obj):
        return permissoes.pode_operar(self._usuario(), obj)

    def get_autor_nome(self, obj):
        nome = obj.usuario.nome if obj.usuario_id and obj.usuario else ''
        usuario = self._usuario()
        eh_autor = usuario is not None and getattr(usuario, 'id', None) == obj.usuario_id
        if eh_autor or self._eh_equipe_do_chamado(obj):
            return nome
        return mascarar_nome(nome)

    def get_eh_autor(self, obj):
        usuario = self._usuario()
        return bool(obj.usuario_id) and getattr(usuario, 'id', None) == obj.usuario_id

    def get_atendente_id(self, obj):
        if obj.atendente_id and self._eh_equipe_do_chamado(obj):
            return str(obj.atendente_id)
        return None

    def get_tem_atendente(self, obj):
        return bool(obj.atendente_id)

    def get_status_rotulo(self, obj):
        return fluxo.ROTULOS_CIDADAO.get(obj.status, obj.status)

    def get_secretaria_nome(self, obj):
        if obj.secretaria_id and obj.secretaria:
            return obj.secretaria.nome
        return obj.secretaria_responsavel

    def get_total_apoios(self, obj):
        return getattr(obj, 'total_apoios', 0)

    def get_sinalizacoes(self, obj):
        return _sinalizacoes(obj)

    # SLA é métrica interna da equipe (contrato v3): cidadão e anônimo não
    # enxergam atraso, nem mesmo o autor do chamado. `prazo_em` continua
    # público — é a previsão mostrada ao reportar ("até 15/11").
    def get_sla_vencido(self, obj):
        if not self._eh_equipe_do_chamado(obj):
            return False
        return sla.sla_vencido(obj)

    def get_sla_restante_horas(self, obj):
        if not self._eh_equipe_do_chamado(obj):
            return None
        return sla.sla_restante_horas(obj)


# Campos comuns de listagem e detalhe. Nada de `usuario`, `usuario_email` ou
# ids de usuário: `atendente_id` só sai preenchido para a equipe do município.
CAMPOS_LISTA = (
    'id', 'protocolo', 'titulo', 'status', 'status_rotulo', 'categoria_nome', 'categoria_id',
    'autor_nome', 'eh_autor', 'latitude', 'longitude', 'municipio_id',
    'rua', 'bairro', 'prioridade', 'atendente_id', 'tem_atendente', 'equipe_id',
    'secretaria_id', 'secretaria_nome',
    'total_apoios', 'sinalizacoes', 'criado_em', 'atualizado_em', 'resolvido_em', 'imagem_url',
    'prazo_em', 'sla_vencido', 'sla_restante_horas', 'visibilidade', 'avaliacao_nota',
    # Com `resolvido_em`, diz se a nota é desta resolução (reaberto e resolvido
    # de novo pede avaliação nova) — o selo "Avaliar" de Meus chamados.
    'avaliado_em',
)


class DefeitoListSerializer(_VisaoMixin, serializers.ModelSerializer):
    autor_nome = serializers.SerializerMethodField()
    eh_autor = serializers.SerializerMethodField()
    atendente_id = serializers.SerializerMethodField()
    tem_atendente = serializers.SerializerMethodField()
    status_rotulo = serializers.SerializerMethodField()
    categoria_nome = serializers.CharField(source='categoria', read_only=True, default='')
    equipe_id = serializers.ReadOnlyField()
    secretaria_id = serializers.ReadOnlyField()
    secretaria_nome = serializers.SerializerMethodField()
    total_apoios = serializers.SerializerMethodField()
    sinalizacoes = serializers.SerializerMethodField()
    sla_vencido = serializers.SerializerMethodField()
    sla_restante_horas = serializers.SerializerMethodField()

    class Meta:
        model = Defeito
        fields = CAMPOS_LISTA


class DefeitoDetailSerializer(DefeitoListSerializer):
    imagem_thumbnail = FotoField('imagem_thumbnail')
    foto_resolucao_url = FotoField('foto_resolucao')
    duplicado_de = serializers.SerializerMethodField()
    municipio = serializers.SerializerMethodField()

    class Meta:
        model = Defeito
        fields = CAMPOS_LISTA + (
            'descricao', 'categoria', 'previsao_conclusao', 'atendido_em',
            'secretaria_responsavel', 'prazo_sla_dias',
            'imagem_thumbnail', 'foto_resolucao_url', 'imagens_extra', 'atualizacoes',
            'municipio', 'triado_em', 'atribuido_em', 'iniciado_em', 'fechado_em',
            'reaberturas', 'resposta_publica', 'motivo_rejeicao', 'duplicado_de',
            'avaliacao_comentario',
        )

    def get_duplicado_de(self, obj):
        return str(obj.duplicado_de_id) if obj.duplicado_de_id else None

    def get_municipio(self, obj):
        """{codigo, nome, uf_sigla} do município do chamado, ou None."""
        if not obj.municipio_id:
            return None
        with connection.cursor() as cur:
            cur.execute('SELECT codigo, nome, uf_sigla FROM municipios WHERE codigo = %s', [obj.municipio_id])
            row = cur.fetchone()
        return {'codigo': str(row[0]), 'nome': row[1], 'uf_sigla': row[2]} if row else None


class DefeitoEventoSerializer(serializers.ModelSerializer):
    """Linha do histórico. Quem fez só aparece com nome para a equipe do município."""
    autor_nome = serializers.SerializerMethodField()
    para_status_rotulo = serializers.SerializerMethodField()

    class Meta:
        model = DefeitoEvento
        fields = (
            'id', 'tipo', 'de_status', 'para_status', 'para_status_rotulo', 'papel',
            'publico', 'texto', 'dados', 'criado_em', 'autor_nome',
        )

    def get_autor_nome(self, obj):
        nome = obj.autor.nome if obj.autor_id and obj.autor else ''
        if self.context.get('equipe'):
            return nome
        if obj.tipo == 'apoio':
            # Confirmação é anônima para o público: só conta quantos.
            return ''
        if obj.papel == 'cidadao':
            return mascarar_nome(nome)
        if obj.papel in permissoes.PAPEIS_EQUIPE:
            return 'Prefeitura'
        if obj.papel == 'comunidade':
            return 'Comunidade'
        return ''

    def get_para_status_rotulo(self, obj):
        if not obj.para_status:
            return None
        return fluxo.ROTULOS_CIDADAO.get(obj.para_status, obj.para_status)


def municipio_do_ponto(lat, lng):
    """
    Município (código IBGE, nome, UF e bounding box) que contém o ponto, ou None.

    Usa o polígono PostGIS de `municipios`; se o ponto não cair em nenhum
    (fronteira, mar, dado ausente), tenta a bounding box mais próxima do centro.
    """
    if lat is None or lng is None:
        return None
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT codigo, nome, uf_sigla, min_lat, max_lat, min_lng, max_lng FROM municipios
            WHERE polygon_geom IS NOT NULL
              AND ST_Contains(polygon_geom::geometry, ST_SetSRID(ST_MakePoint(%s, %s), 4326))
            LIMIT 1
            """,
            [lng, lat],
        )
        row = cur.fetchone()
        if not row:
            cur.execute(
                """
                SELECT codigo, nome, uf_sigla, min_lat, max_lat, min_lng, max_lng FROM municipios
                WHERE %s BETWEEN min_lat AND max_lat AND %s BETWEEN min_lng AND max_lng
                ORDER BY ABS((min_lat + max_lat) / 2 - %s) + ABS((min_lng + max_lng) / 2 - %s)
                LIMIT 1
                """,
                [lat, lng, lat, lng],
            )
            row = cur.fetchone()
    if not row:
        return None
    return {
        'codigo': str(row[0]), 'nome': row[1], 'uf_sigla': row[2],
        'min_lat': row[3], 'max_lat': row[4], 'min_lng': row[5], 'max_lng': row[6],
    }


def _distancia_m(lat1, lng1, lat2, lng2):
    """Distância aproximada em metros (equiretangular; suficiente para dezenas de metros)."""
    dlat = (lat2 - lat1) * 111000
    dlng = (lng2 - lng1) * 111000 * math.cos(math.radians(lat1))
    return math.sqrt(dlat * dlat + dlng * dlng)


def _mesma_categoria_perto(lat, lng, categoria, raio_m):
    """Chamado aberto da mesma categoria a até `raio_m` do ponto, ou None."""
    deg = raio_m / 111000 * 1.5  # caixa folgada; a distância real é conferida abaixo
    candidatos = (
        Defeito.objects.ativos().filter(
            categoria__iexact=categoria,
            latitude__range=(lat - deg, lat + deg),
            longitude__range=(lng - deg, lng + deg),
        )
        .exclude(status__in=fluxo.STATUS_FECHADOS)
        .values('id', 'latitude', 'longitude')[:20]
    )
    mais_perto = None
    for c in candidatos:
        d = _distancia_m(lat, lng, c['latitude'], c['longitude'])
        if d <= raio_m and (mais_perto is None or d < mais_perto['distancia_m']):
            mais_perto = {'id': c['id'], 'distancia_m': d}
    return mais_perto


class DefeitoCreateSerializer(serializers.ModelSerializer):
    """
    Só o que o cidadão informa ao abrir o chamado. Status, roteamento, SLA,
    município, visibilidade e protocolo são decididos no backend
    (`perform_create`); a resposta usa a visão de detalhe.
    """

    class Meta:
        model = Defeito
        fields = ('titulo', 'descricao', 'latitude', 'longitude', 'rua', 'bairro', 'categoria')

    def to_representation(self, instance):
        return DefeitoDetailSerializer(instance, context=self.context).data

    def create(self, validated_data):
        lat = validated_data.get('latitude')
        lng = validated_data.get('longitude')
        descricao = validated_data.get('descricao', '')
        categoria = (validated_data.get('categoria') or '').strip()

        # 1) Regra dura, independente de texto: outro chamado da MESMA categoria,
        #    ainda aberto, a poucos metros -> é o mesmo problema. O cliente deve
        #    confirmar o existente em vez de abrir outro (evita o mapa cheio de
        #    pinos repetidos no mesmo buraco).
        if lat and lng and categoria:
            existente = _mesma_categoria_perto(lat, lng, categoria, settings.DUPLICATE_CATEGORY_RADIUS_M)
            if existente:
                raise serializers.ValidationError(
                    {
                        'duplicado': True,
                        'defeito_existente_id': str(existente['id']),
                        'distancia_m': round(existente['distancia_m'], 1),
                        'detail': (
                            f'Já existe um chamado de {categoria} a '
                            f'{max(1, round(existente["distancia_m"]))} m daqui. '
                            'Confirme ele no mapa em vez de abrir outro.'
                        ),
                    },
                    code='duplicate_defect',
                )

        # Em qual cidade o ponto caiu — gravado no chamado, não no usuário. A
        # view já resolve antes (o roteamento depende da cidade); aqui só se
        # alguém salvar o serializer sem passar por ela.
        if 'municipio_id' not in validated_data:
            municipio = municipio_do_ponto(lat, lng) if lat and lng else None
            validated_data['municipio_id'] = municipio['codigo'] if municipio else None

        # 2) Similaridade de texto (IA) num raio maior, só quando há descrição.
        if lat and lng and descricao:
            from django.db.models import F
            from django.db.models.functions import ACos, Cos, Radians, Sin
            import asyncio

            radius_m = settings.DUPLICATE_RADIUS_M
            threshold = settings.DUPLICATE_SIMILARITY_THRESHOLD

            deg_approx = radius_m / 111000

            candidatos_qs = Defeito.objects.ativos().filter(
                latitude__range=(lat - deg_approx, lat + deg_approx),
                longitude__range=(lng - deg_approx, lng + deg_approx),
            ).exclude(
                status__in=fluxo.STATUS_FECHADOS
            ).exclude(
                descricao=''
            ).values('id', 'descricao', 'latitude', 'longitude')[:20]

            candidatos = []
            for c in candidatos_qs:
                dlat = c['latitude'] - lat
                dlng = c['longitude'] - lng
                dist_approx_m = math.sqrt((dlat * 111000) ** 2 + (dlng * 111000 * math.cos(math.radians(lat))) ** 2)
                if dist_approx_m <= radius_m:
                    candidatos.append(c)

            if candidatos:
                from services.ia_client import get_embeddings_batch

                textos = [descricao] + [c['descricao'] for c in candidatos]

                embeddings = asyncio.run(get_embeddings_batch(textos))

                if embeddings and len(embeddings) == len(textos):
                    emb_novo = embeddings[0]

                    for i, candidato in enumerate(candidatos):
                        emb_existente = embeddings[i + 1]
                        dot_product = sum(a * b for a, b in zip(emb_novo, emb_existente))
                        norm_novo = math.sqrt(sum(a * a for a in emb_novo))
                        norm_existente = math.sqrt(sum(a * a for a in emb_existente))
                        similaridade = dot_product / (norm_novo * norm_existente) if norm_novo > 0 and norm_existente > 0 else 0.0

                        if similaridade >= threshold:
                            raise serializers.ValidationError(
                                {
                                    'duplicado': True,
                                    'defeito_existente_id': str(candidato['id']),
                                    'similaridade': round(similaridade, 4),
                                    'detail': 'Ja existe um relato similar nesta localizacao'
                                },
                                code='duplicate_defect'
                            )

        return super().create(validated_data)


class DefeitoUpdateSerializer(serializers.ModelSerializer):
    """
    Edição do chamado. Quais campos cada um pode mandar é decidido na view
    (autor: só a descrição, enquanto pendente; equipe: dados de triagem).
    Status nunca muda por aqui — só por `fluxo.transicionar`.
    """
    prioridade = serializers.ChoiceField(choices=PRIORIDADES, required=False)

    class Meta:
        model = Defeito
        fields = ('titulo', 'descricao', 'rua', 'bairro', 'prioridade', 'previsao_conclusao')

    def to_representation(self, instance):
        return DefeitoDetailSerializer(instance, context=self.context).data


class ApoioSerializer(serializers.ModelSerializer):
    class Meta:
        model = Apoio
        fields = '__all__'
        read_only_fields = ('criado_em', 'municipio_id')
