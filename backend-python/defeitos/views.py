import base64
import json
from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework import viewsets, permissions, status, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError
from django.db.models import Count, Q
from core import auditoria, permissoes
from .models import Defeito, Apoio, Sinalizacao, DefeitoAnexo, DefeitoEvento
from . import fluxo, gamificacao, regras, sla
from .fluxo import TransicaoInvalida, TransicaoNaoPermitida
from users import throttles
from .serializers import (
    municipio_do_ponto,
    DefeitoListSerializer, DefeitoDetailSerializer, DefeitoEventoSerializer,
    DefeitoCreateSerializer, DefeitoUpdateSerializer,
)

# Operar (assumir, mudar status) é restrito ao município a que o
# operador está vinculado — sem exceção: todo operador, inclusive o super
# admin, opera numa única cidade (`permissoes.pode_operar`). Como cidadão, o
# mesmo usuário continua livre para reportar/apoiar onde quiser.


def _negado(user):
    return Response(
        {'error': FORA_DO_MUNICIPIO if permissoes.eh_equipe(user) else 'Permissao negada'},
        status=status.HTTP_403_FORBIDDEN,
    )


def _suspenso(user):
    """
    403 com explicação se o usuário está suspenso pela moderação
    (`users.suspenso_ate` no futuro); None se pode participar. Suspenso
    continua vendo e acompanhando os chamados — só não reporta, apoia,
    sinaliza, anexa, avalia nem reabre.
    """
    ate = getattr(user, 'suspenso_ate', None)
    if not ate or ate <= timezone.now():
        return None
    quando = timezone.localtime(ate).strftime('%d/%m/%Y às %H:%M')
    return Response(
        {
            'detail': (
                f'Sua conta está suspensa até {quando} por descumprir as regras de uso. '
                'Até lá você pode acompanhar os chamados, mas não pode reportar, apoiar '
                'nem sinalizar problemas.'
            ),
            'codigo': 'conta_suspensa',
            'suspenso_ate': ate,
        },
        status=status.HTTP_403_FORBIDDEN,
    )


# Upload de foto: teto de tamanho e só imagem. O teto vem antes do Pillow
# abrir o arquivo — sem ele qualquer um manda centenas de MB para o servidor
# decodificar.
MAX_IMAGEM_BYTES = 8 * 1024 * 1024
# Alguns clientes (web, apps antigos) mandam a foto sem tipo; o Pillow decide.
TIPOS_GENERICOS = ('', 'application/octet-stream')


def _ler_imagem(arquivo):
    """(bytes, None) se `arquivo` é uma imagem aceitável; (None, Response 400) se não."""
    if arquivo.size is not None and arquivo.size > MAX_IMAGEM_BYTES:
        return None, Response(
            {'error': f'A foto passa de {MAX_IMAGEM_BYTES // (1024 * 1024)} MB. Tire outra ou reduza a resolução.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    tipo = (getattr(arquivo, 'content_type', '') or '').lower()
    if not tipo.startswith('image/') and tipo not in TIPOS_GENERICOS:
        return None, Response(
            {'error': 'O arquivo enviado não é uma imagem.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    return arquivo.read(), None


def _processar(arquivo):
    """`process_image` do upload validado: (resultado, None) ou (None, Response 400)."""
    from services.image_processor import process_image
    dados, erro = _ler_imagem(arquivo)
    if erro is not None:
        return None, erro
    try:
        return process_image(dados), None
    except Exception:
        # Pillow levanta vários tipos (UnidentifiedImageError, OSError,
        # DecompressionBombError); para o cliente é tudo "não é uma foto".
        return None, Response(
            {'error': 'Não foi possível ler a imagem. Envie uma foto JPG, PNG ou WEBP.'},
            status=status.HTTP_400_BAD_REQUEST,
        )


def _municipio_por_codigo(codigo):
    from django.db import connection
    with connection.cursor() as cur:
        cur.execute('SELECT codigo, nome, uf_sigla FROM municipios WHERE codigo = %s', [codigo])
        row = cur.fetchone()
    if not row:
        return {'codigo': str(codigo), 'nome': '', 'uf_sigla': ''}
    return {'codigo': str(row[0]), 'nome': row[1], 'uf_sigla': row[2]}


STATUS_FECHADOS = fluxo.STATUS_FECHADOS
FORA_DO_MUNICIPIO = 'Chamado fora do seu município de operação'
SEM_MUNICIPIO = 'Operador sem município vinculado'

# Rarefação do mapa (`area`): células por lado do retângulo visível, chamados
# por célula e teto absoluto da resposta.
AREA_GRADE = 8
AREA_POR_CELULA = 4
AREA_LIMITE = 400
AREA_SITUACOES = ('abertos', 'resolvidos', 'todos')
# Resolvidos no mapa: só os recentes, para mostrar entrega sem poluir.
AREA_RESOLVIDOS_DIAS = 90

# "Já reportaram aqui?" (`proximos`): raio padrão quando a prefeitura não
# configurou `raio_duplicado_m`, teto do ?raio= e janela dos resolvidos.
PROXIMOS_RAIO_PADRAO_M = 30
PROXIMOS_RAIO_MAX_M = 500
PROXIMOS_RESOLVIDOS_DIAS = 30
PROXIMOS_LIMITE = 50

# Avaliação do atendimento pelo autor (CSAT).
AVALIACAO_EDITAVEL_DIAS = 7
AVALIACAO_COMENTARIO_MAX = 1000
# Reabertura exige um motivo de verdade, não um clique por engano.
REABERTURA_MOTIVO_MIN = 5

# Fotos extras por chamado (anexar): cada uma vai inteira em `defeito_anexos`
# e a miniatura em `imagens_extra`; sem teto, a linha incharia sem limite.
MAX_ANEXOS = 10

# Edição do chamado (PATCH): o autor só corrige a descrição enquanto ninguém
# triou; a equipe ajusta os dados de triagem. Status só pela action `status`.
CAMPOS_EDITAVEIS_AUTOR = {'descricao'}
CAMPOS_EDITAVEIS_EQUIPE = {'titulo', 'descricao', 'rua', 'bairro', 'prioridade', 'previsao_conclusao'}

# Ações de listagem: não carregam as colunas BYTEA (foto e foto de resolução).
ACOES_LISTAGEM = ('list', 'meus', 'apoiados', 'municipio', 'area')


class DefeitoViewSet(viewsets.ModelViewSet):
    # `distinct=True` em todos os Count: apoios e sinalizações são joins
    # independentes e sem isso um multiplicaria a contagem do outro.
    # Removidos (soft delete) não existem para a API: nem listagem nem detalhe.
    queryset = Defeito.objects.ativos().select_related(
        'usuario', 'secretaria',
    ).annotate(
        total_apoios=Count('apoios', distinct=True),
        total_resolvido=Count(
            'sinalizacoes', distinct=True,
            filter=Q(sinalizacoes__tipo=Sinalizacao.RESOLVIDO),
        ),
        total_nao_existe=Count(
            'sinalizacoes', distinct=True,
            filter=Q(sinalizacoes__tipo=Sinalizacao.NAO_EXISTE),
        ),
    ).order_by('-criado_em')
    filter_backends = (filters.SearchFilter, filters.OrderingFilter)
    search_fields = ('titulo', 'descricao', 'rua', 'bairro')
    ordering_fields = ('criado_em', 'total_apoios')
    lookup_value_regex = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

    def get_queryset(self):
        # A listagem é a mesma para todo mundo: o vínculo do operador com um
        # município só restringe a *operação* (app `operacao` e `permissoes.pode_operar`),
        # nunca o que ele enxerga como cidadão.
        #
        # Exceção: chamados `restrita` (autor em quarentena, ver `regras.py`)
        # ficam fora das listagens sem GPS — só o autor e operadores os veem
        # aqui. A visão do mapa (`municipio`) libera os que estão perto.
        qs = self.queryset
        if self.action in ACOES_LISTAGEM:
            qs = qs.defer('imagem_thumbnail', 'foto_resolucao')
        if self.action in ('list', 'apoiados'):
            user = self.request.user
            if not user.is_authenticated:
                qs = qs.filter(visibilidade=Defeito.VISIBILIDADE_PUBLICA)
            elif not permissoes.eh_equipe(user):
                qs = qs.filter(Q(visibilidade=Defeito.VISIBILIDADE_PUBLICA) | Q(usuario=user))
        return qs

    def get_serializer_class(self):
        if self.action == 'list':
            return DefeitoListSerializer
        if self.action == 'retrieve':
            return DefeitoDetailSerializer
        if self.action == 'create':
            return DefeitoCreateSerializer
        if self.action in ('update', 'partial_update'):
            return DefeitoUpdateSerializer
        return DefeitoDetailSerializer

    def _lista(self, defeitos):
        return DefeitoListSerializer(defeitos, many=True, context=self.get_serializer_context()).data

    def _detalhe(self, defeito):
        return DefeitoDetailSerializer(defeito, context=self.get_serializer_context()).data

    def get_permissions(self):
        if self.action in ('create', 'apoiar', 'meus', 'apoiados', 'apoiei', 'atender', 'status',
                           'sinalizar', 'sinalizei', 'progresso',
                           'batch_status',
                           'update', 'partial_update', 'destroy', 'anexar',
                           'avaliar', 'reabrir', 'imagem'):
            return (permissions.IsAuthenticated(),)
        return (permissions.AllowAny(),)

    def get_throttles(self):
        # Só as ações que geram custo (processar foto, abrir chamado) têm teto
        # por usuário; leitura e mapa ficam livres.
        if self.action == 'create':
            return (throttles.CriarChamado(),)
        if self.action == 'imagem':
            return (throttles.Imagem(),)
        return super().get_throttles()

    def create(self, request, *args, **kwargs):
        suspenso = _suspenso(request.user)
        if suspenso is not None:
            return suspenso
        # Chamado só com foto do local, tirada na hora (o app abre a câmera;
        # galeria não entra). Sem imagem não há como a prefeitura triar.
        if 'imagem' not in request.FILES:
            return Response(
                {'imagem': 'Tire uma foto do problema para abrir o chamado.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        self._imagem, erro = _processar(request.FILES['imagem'])
        if erro is not None:
            return erro
        # Ninguém reporta em dois lugares que não daria tempo de percorrer.
        try:
            lat = float(request.data.get('latitude', ''))
            lng = float(request.data.get('longitude', ''))
        except (TypeError, ValueError):
            lat = lng = None
        erro = regras.deslocamento_implausivel(request.user, lat, lng)
        if erro:
            return Response({'error': erro}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        try:
            return super().create(request, *args, **kwargs)
        except ValidationError as e:
            detail = e.detail
            if isinstance(detail, dict) and detail.get('duplicado'):
                # O DRF embrulha cada valor em ErrorDetail (string); devolve tipos limpos.
                corpo = {k: str(v) for k, v in detail.items()}
                corpo['duplicado'] = True
                for campo in ('distancia_m', 'similaridade'):
                    if campo in corpo:
                        corpo[campo] = float(corpo[campo])
                return Response(corpo, status=status.HTTP_409_CONFLICT)
            raise

    def perform_create(self, serializer):
        # Já validada e processada em `create`.
        processada = getattr(self, '_imagem', None)
        webp = processada['webp_bytes'] if processada else None

        # Em qual cidade o ponto caiu — gravado no chamado, não no usuário. É
        # a cidade que decide o roteamento (a prefeitura pode ter regra própria).
        dados = serializer.validated_data
        lat, lng = dados.get('latitude'), dados.get('longitude')
        municipio = municipio_do_ponto(lat, lng) if lat and lng else None
        municipio_id = municipio['codigo'] if municipio else None
        regra = sla.regra_para(dados.get('categoria', ''), municipio_id)

        agora = timezone.now()
        with transaction.atomic():
            defeito = serializer.save(
                usuario=self.request.user,
                criado_em=agora,
                atualizado_em=agora,
                status='pendente',
                municipio_id=municipio_id,
                visibilidade=regras.visibilidade_inicial(self.request.user),
                imagem_thumbnail=webp,
                categoria_id=regra['categoria_id'],
                prioridade=regra['prioridade'],
                secretaria_id=regra['secretaria_id'],
                secretaria_responsavel=regra['secretaria_nome'],
                prazo_sla_dias=regra['prazo_sla_dias'],
                prazo_em=sla.calcular_prazo(agora, regra['prazo_sla_dias']),
            )
            fluxo.registrar_evento(defeito, 'criado', self.request.user, para_status='pendente')

    @action(detail=True, methods=['post'])
    def apoiar(self, request, pk=None):
        """
        "Eu também": liga/desliga o apoio do usuário. O apoio de outra pessoa
        que não o autor vira evento `apoio` no histórico (público, sem nome;
        o app agrega em "N pessoas confirmaram"). Desfazer o apoio apaga o
        evento dele, para a contagem do histórico bater com a de apoios.
        """
        suspenso = _suspenso(request.user)
        if suspenso is not None:
            return suspenso
        defeito = self.get_object()
        with transaction.atomic():
            apoio, created = Apoio.objects.get_or_create(
                usuario=request.user, defeito=defeito,
                defaults={'criado_em': timezone.now()},
            )
            if not created:
                apoio.delete()
                DefeitoEvento.objects.filter(defeito=defeito, tipo='apoio', autor=request.user).delete()
                return Response({'apoiado': False}, status=status.HTTP_200_OK)
            if defeito.usuario_id != request.user.id:
                fluxo.registrar_evento(defeito, 'apoio', request.user)
            regras.aplicar_confirmacao(defeito, request.user)
        return Response({'apoiado': True}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def sinalizar(self, request, pk=None):
        """
        Cidadão indica que o chamado "já foi resolvido" ou "não existe".
        Repetir o mesmo tipo remove a sinalização; mandar outro tipo troca.
        Só para chamados abertos — num fechado não há o que sinalizar.

        Depois de gravar, `regras.aplicar_sinalizacao` decide se o chamado
        fecha (`resultado: 'concluido'`, vem o `defeito` atualizado) ou some
        (`resultado: 'inexistente'`, o chamado já não existe mais).
        """
        suspenso = _suspenso(request.user)
        if suspenso is not None:
            return suspenso
        defeito = self.get_object()
        tipo = request.data.get('tipo')
        if tipo not in dict(Sinalizacao.TIPO_CHOICES):
            return Response({'error': 'Tipo invalido'}, status=status.HTTP_400_BAD_REQUEST)
        if defeito.status in STATUS_FECHADOS:
            return Response({'error': 'Chamado ja finalizado'}, status=status.HTTP_400_BAD_REQUEST)

        atual = Sinalizacao.objects.filter(usuario=request.user, defeito=defeito).first()
        if atual is None:
            Sinalizacao.objects.create(
                usuario=request.user, defeito=defeito, tipo=tipo,
                criado_em=timezone.now(),
            )
            meu_tipo = tipo
        elif atual.tipo == tipo:
            atual.delete()
            meu_tipo = None
        else:
            atual.tipo = tipo
            atual.criado_em = timezone.now()
            atual.save()
            meu_tipo = tipo

        resultado = None
        if meu_tipo is not None:
            # Interno: insumo de moderação, não aparece na linha do tempo pública.
            fluxo.registrar_evento(
                defeito, 'sinalizacao', request.user, publico=False, dados={'tipo': meu_tipo},
            )
            resultado = regras.aplicar_sinalizacao(defeito, request.user, meu_tipo)

        if resultado == regras.RESULTADO_INEXISTENTE:
            return Response({
                'tipo': meu_tipo,
                'sinalizacoes': {Sinalizacao.RESOLVIDO: 0, Sinalizacao.NAO_EXISTE: 0},
                'resultado': resultado,
                'defeito': None,
            })

        # Recarrega pela viewset para vir com as anotações (apoios, sinalizações).
        atualizado = self.queryset.get(pk=defeito.pk)
        return Response({
            'tipo': meu_tipo,
            'sinalizacoes': regras.contar_sinalizacoes(defeito),
            'resultado': resultado,
            'defeito': self._detalhe(atualizado),
        })

    @action(detail=False, methods=['get'])
    def sinalizei(self, request):
        """{defeito_id: tipo} das sinalizações do usuário logado."""
        pares = Sinalizacao.objects.filter(usuario=request.user).values_list('defeito_id', 'tipo')
        return Response({'sinalizacoes': {str(d): t for d, t in pares}})

    @action(detail=True, methods=['patch'])
    def status(self, request, pk=None):
        """
        Muda o status pelo `fluxo` (transições, timestamps, histórico e aviso
        ao cidadão). Aceita `resposta_publica`, `texto`, `motivo` e
        `duplicado_de` (rejeição) e `foto_resolucao` (evidência do serviço).
        """
        defeito = self.get_object()
        if not permissoes.pode_operar(request.user, defeito):
            return _negado(request.user)
        novo_status = fluxo.normalizar_status(request.data.get('status'))
        if novo_status not in fluxo.TRANSICOES:
            return Response(
                {'error': 'Invalid status'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Foto de resolução é opcional: se vier, fica guardada como registro
        # do serviço feito; sem ela o chamado é finalizado do mesmo jeito.
        foto = None
        arquivo = request.FILES.get('foto_resolucao')
        if arquivo is not None:
            processada, erro = _processar(arquivo)
            if erro is not None:
                return erro
            foto = processada['webp_bytes']
        try:
            with transaction.atomic():
                fluxo.transicionar(
                    defeito, novo_status, request.user,
                    texto=request.data.get('texto') or '',
                    resposta_publica=request.data.get('resposta_publica') or '',
                    motivo=request.data.get('motivo') or '',
                    duplicado_de=request.data.get('duplicado_de') or None,
                )
                if foto is not None:
                    defeito.foto_resolucao = foto
                    defeito.save(update_fields=['foto_resolucao'])
                    DefeitoAnexo.objects.create(defeito=defeito, tipo='depois', imagem=foto, autor=request.user)
                    fluxo.registrar_evento(defeito, 'anexo', request.user, dados={'tipo': 'depois'})
        except TransicaoNaoPermitida as e:
            return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)
        except TransicaoInvalida as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(self._detalhe(defeito))

    @action(detail=True, methods=['get'])
    def eventos(self, request, pk=None):
        """
        Histórico do chamado. Público para todos; os internos (notas,
        atribuições, sinalizações) só para a equipe do município.
        """
        defeito = self.get_object()
        equipe = permissoes.pode_operar(request.user, defeito)
        qs = DefeitoEvento.objects.filter(defeito=defeito).select_related('autor')
        if not equipe:
            qs = qs.filter(publico=True)
        contexto = {**self.get_serializer_context(), 'equipe': equipe}
        return Response(DefeitoEventoSerializer(qs, many=True, context=contexto).data)

    def update(self, request, *args, **kwargs):
        """
        Edição parcial sempre (PUT vira PATCH). Autor: só `descricao` e só
        enquanto `pendente`. Equipe do município: dados de triagem. Campos
        fora da lista são recusados — status, município, SLA e atendente
        têm caminhos próprios.
        """
        defeito = self.get_object()
        user = request.user
        if permissoes.pode_operar(user, defeito):
            permitidos = CAMPOS_EDITAVEIS_EQUIPE
        elif defeito.usuario_id == user.id:
            if defeito.status != 'pendente':
                return Response(
                    {'error': 'O chamado já está em atendimento e não pode mais ser editado.'},
                    status=status.HTTP_403_FORBIDDEN,
                )
            permitidos = CAMPOS_EDITAVEIS_AUTOR
        else:
            return _negado(user)
        proibidos = sorted(set(request.data.keys()) - permitidos)
        if proibidos:
            return Response(
                {'error': f'Campos não editáveis: {", ".join(proibidos)}'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer = self.get_serializer(defeito, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        mudancas = {
            campo: [getattr(defeito, campo), valor]
            for campo, valor in serializer.validated_data.items()
            if getattr(defeito, campo) != valor
        }
        if mudancas:
            with transaction.atomic():
                for campo, (_, valor) in mudancas.items():
                    setattr(defeito, campo, valor)
                defeito.atualizado_em = timezone.now()
                defeito.save(update_fields=[*mudancas, 'atualizado_em'])
                prioridade = mudancas.pop('prioridade', None)
                if prioridade:
                    fluxo.registrar_evento(
                        defeito, 'prioridade', user, publico=False,
                        dados={'de': prioridade[0], 'para': prioridade[1]},
                    )
                if mudancas:
                    fluxo.registrar_evento(
                        defeito, 'moderacao', user, publico=False,
                        texto='Dados do chamado editados', dados={'campos': mudancas},
                    )
        return Response(self._detalhe(defeito))

    def destroy(self, request, *args, **kwargs):
        """
        Soft delete. O autor exclui o próprio chamado enquanto pendente; a
        gestão do município remove (moderação, com motivo e auditoria).
        """
        defeito = self.get_object()
        user = request.user
        eh_autor = defeito.usuario_id == user.id
        if eh_autor and defeito.status == 'pendente':
            regras.remover(defeito, user, 'autor', texto='Excluído pelo próprio autor')
        elif permissoes.pode_gerir(user, defeito.municipio_id) and permissoes.eh_equipe(user):
            motivo = (request.data.get('motivo') if hasattr(request.data, 'get') else '') or 'moderacao'
            with transaction.atomic():
                regras.remover(defeito, user, 'moderacao', texto=motivo)
                auditoria.registrar(
                    request, 'defeito.remover', 'defeito', defeito.id,
                    dados={'motivo': motivo, 'protocolo': defeito.protocolo},
                    municipio_id=defeito.municipio_id,
                )
        elif eh_autor:
            return Response(
                {'error': 'O chamado já está em atendimento e não pode mais ser excluído.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        else:
            return _negado(user)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=['get'])
    def meus(self, request):
        qs = self.get_queryset().filter(usuario=request.user)
        page = self.paginate_queryset(qs)
        if page is not None:
            return self.get_paginated_response(self._lista(page))
        return Response(self._lista(qs))

    @action(detail=False, methods=['get'])
    def apoiados(self, request):
         ids = Apoio.objects.filter(usuario=request.user).values_list(
             'defeito_id', flat=True,
         )
         qs = self.get_queryset().filter(id__in=list(ids))
         page = self.paginate_queryset(qs)
         if page is not None:
             return self.get_paginated_response(self._lista(page))
         return Response(self._lista(qs))

    @action(detail=True, methods=['patch'])
    def atender(self, request, pk=None):
        """Operador assume o chamado: vira o atendente e o chamado passa a em execução."""
        defeito = self.get_object()
        if not permissoes.pode_operar(request.user, defeito):
            return _negado(request.user)
        if defeito.atendente_id:
            return Response(
                {'error': 'Chamado já possui atendente'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            with transaction.atomic():
                fluxo.atribuir(defeito, request.user, atendente_id=request.user.id)
                if defeito.status != 'em_andamento':
                    fluxo.transicionar(defeito, 'em_andamento', request.user)
        except TransicaoNaoPermitida as e:
            return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)
        except TransicaoInvalida as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({'message': 'Chamado vinculado com sucesso'})

    @action(detail=True, methods=['post'])
    def anexar(self, request, pk=None):
        """
        Foto extra: do autor (`cidadao`) ou da equipe do município (`antes`/
        `depois`, via `tipo`). Terceiros não anexam em chamado alheio.
        """
        suspenso = _suspenso(request.user)
        if suspenso is not None:
            return suspenso
        defeito = self.get_object()
        user = request.user
        if permissoes.pode_operar(user, defeito):
            tipo = request.data.get('tipo') if request.data.get('tipo') in ('antes', 'depois') else 'antes'
        elif defeito.usuario_id == user.id:
            tipo = 'cidadao'
        else:
            return _negado(user)
        file = request.FILES.get('file')
        if not file:
            return Response({'error': 'No file provided'}, status=status.HTTP_400_BAD_REQUEST)
        if DefeitoAnexo.objects.filter(defeito=defeito).count() >= MAX_ANEXOS:
            return Response(
                {'error': f'Limite de {MAX_ANEXOS} fotos por chamado atingido.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        result, erro = _processar(file)
        if erro is not None:
            return erro
        extras = json.loads(defeito.imagens_extra or '[]')
        b64 = base64.b64encode(result['thumbnail_bytes']).decode('ascii')
        extras.append(f'data:image/webp;base64,{b64}')
        with transaction.atomic():
            DefeitoAnexo.objects.create(
                defeito=defeito, tipo=tipo, imagem=result['webp_bytes'], autor=user,
                latitude=_float_ou_none(request.data.get('latitude')),
                longitude=_float_ou_none(request.data.get('longitude')),
            )
            defeito.imagens_extra = json.dumps(extras)
            defeito.atualizado_em = timezone.now()
            defeito.save(update_fields=['imagens_extra', 'atualizado_em'])
            fluxo.registrar_evento(defeito, 'anexo', user, dados={'tipo': tipo})
        return Response(self._detalhe(defeito))

    @action(detail=False, methods=['get'], permission_classes=(permissions.AllowAny,))
    def municipio(self, request):
        """
        Visão expandida do mapa: a cidade onde o ponto (?lat=&lng=) caiu, todos
        os chamados abertos dela (sem paginação) e rankings prontos — tipos mais
        frequentes, mais antigos e mais confirmados.
        """
        try:
            lat = float(request.query_params.get('lat', ''))
            lng = float(request.query_params.get('lng', ''))
        except ValueError:
            return Response({'detail': 'Informe lat e lng.'}, status=status.HTTP_400_BAD_REQUEST)
        municipio = municipio_do_ponto(lat, lng)
        if not municipio:
            return Response({'detail': 'Nenhum município neste ponto.'}, status=status.HTTP_404_NOT_FOUND)

        abertos = (
            self.get_queryset()
            .filter(municipio_id=municipio['codigo'])
            .exclude(status__in=STATUS_FECHADOS)[:2000]
        )
        # Chamados restritos só para quem está perto (ou é o autor/operador).
        abertos = [d for d in abertos if regras.visivel_para(d, request.user, lat, lng)]
        dados = self._lista(abertos)

        por_categoria = {}
        for d in dados:
            nome = d.get('categoria_nome') or 'Sem categoria'
            por_categoria[nome] = por_categoria.get(nome, 0) + 1
        tipos = sorted(
            ({'categoria': k, 'total': v} for k, v in por_categoria.items()),
            key=lambda x: (-x['total'], x['categoria']),
        )
        mais_antigos = sorted(dados, key=lambda d: d['criado_em'])[:10]
        mais_apoiados = sorted(dados, key=lambda d: (-(d.get('total_apoios') or 0), d['criado_em']))[:10]

        return Response({
            'municipio': municipio,
            'total_abertos': len(dados),
            'tipos': tipos,
            'mais_antigos': [d['id'] for d in mais_antigos],
            'mais_apoiados': [d['id'] for d in mais_apoiados if (d.get('total_apoios') or 0) > 0],
            'defeitos': dados,
        })

    @action(detail=False, methods=['get'], permission_classes=(permissions.AllowAny,))
    def area(self, request):
        """
        Chamados dentro do retângulo visível do mapa
        (?min_lat=&max_lat=&min_lng=&max_lng=), rareados conforme o zoom.

        `situacao=abertos|resolvidos|todos` (padrão abertos): resolvidos são
        os concluídos há até `AREA_RESOLVIDOS_DIAS` dias, contados por
        `resolvido_em` — o mapa mostra o que a prefeitura entregou, não o
        histórico inteiro. Rejeitados nunca aparecem. `categorias=1,4,7`
        filtra por `categoria_id`.

        O retângulo é dividido numa grade de ~`AREA_GRADE` células por lado e
        cada célula devolve no máximo `AREA_POR_CELULA` chamados (abertos antes
        de resolvidos, depois os mais apoiados/urgentes): com zoom de rua sai
        tudo; afastando, cada célula cobre mais chão e o total visível fica
        estável. A célula é uma potência de 2 em graus, alinhada ao globo —
        arrastar o mapa no mesmo zoom não embaralha quais pinos aparecem.

        `celulas` (para todos, logado ou não) traz a contagem real de cada
        célula (centro de massa), para o mapa de calor não perder a densidade
        que o corte escondeu. ?lat=&lng= (posição do usuário) libera os
        restritos que estão perto.
        """
        import math
        from django.db import connection
        try:
            min_lat = float(request.query_params['min_lat'])
            max_lat = float(request.query_params['max_lat'])
            min_lng = float(request.query_params['min_lng'])
            max_lng = float(request.query_params['max_lng'])
        except (KeyError, ValueError):
            return Response(
                {'detail': 'Informe min_lat, max_lat, min_lng e max_lng.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            lat = float(request.query_params['lat'])
            lng = float(request.query_params['lng'])
        except (KeyError, ValueError):
            lat = lng = None
        situacao = request.query_params.get('situacao') or 'abertos'
        if situacao not in AREA_SITUACOES:
            return Response(
                {'detail': 'situacao deve ser abertos, resolvidos ou todos.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        categorias, erro = _ids_inteiros(request.query_params.get('categorias'))
        if erro:
            return Response({'detail': 'categorias deve ser uma lista de ids: 1,2,3.'},
                            status=status.HTTP_400_BAD_REQUEST)

        vao = max(max_lat - min_lat, max_lng - min_lng, 1e-6)
        celula = 2 ** round(math.log2(vao / AREA_GRADE))
        user = request.user
        autenticado = user.is_authenticated
        params = {
            'min_lat': min_lat, 'max_lat': max_lat, 'min_lng': min_lng, 'max_lng': max_lng,
            'celula': celula, 'por_celula': AREA_POR_CELULA, 'limite': AREA_LIMITE,
            'fechados': tuple(STATUS_FECHADOS),
            'resolvidos_desde': timezone.now() - timedelta(days=AREA_RESOLVIDOS_DIAS),
            'categorias': categorias,
            'admin': permissoes.eh_equipe(user),
            'uid': str(user.id) if autenticado else None,
            'lat': lat, 'lng': lng, 'raio': regras.RAIO_VISIBILIDADE_RESTRITA_M,
        }
        abertos = 'd.status NOT IN %(fechados)s'
        resolvidos = "(d.status = 'concluido' AND d.resolvido_em >= %(resolvidos_desde)s)"
        filtro_situacao = {
            'abertos': abertos,
            'resolvidos': resolvidos,
            'todos': f'({abertos} OR {resolvidos})',
        }[situacao]
        filtro_categoria = 'AND d.categoria_id = ANY(%(categorias)s)' if categorias else ''
        base = f"""
            SELECT d.id, d.latitude, d.longitude, d.prioridade,
                   (d.status = 'concluido') AS resolvido,
                   CASE WHEN d.status = 'concluido' THEN d.resolvido_em ELSE d.criado_em END AS data_ref,
                   floor(d.latitude / %(celula)s) AS cy, floor(d.longitude / %(celula)s) AS cx
            FROM defeitos d
            WHERE d.latitude BETWEEN %(min_lat)s AND %(max_lat)s
              AND d.longitude BETWEEN %(min_lng)s AND %(max_lng)s
              AND {filtro_situacao}
              {filtro_categoria}
              AND d.removido_em IS NULL
              AND (d.visibilidade = 'publica' OR %(admin)s OR d.usuario = %(uid)s::uuid
                   OR (%(lat)s::float8 IS NOT NULL AND ST_DWithin(
                       ST_MakePoint(d.longitude, d.latitude)::geography,
                       ST_MakePoint(%(lng)s::float8, %(lat)s::float8)::geography, %(raio)s)))
        """
        with connection.cursor() as cur:
            cur.execute(f"""
                SELECT id FROM (
                    SELECT b.id, row_number() OVER (
                        PARTITION BY b.cy, b.cx
                        ORDER BY b.resolvido, coalesce(a.total, 0) DESC,
                                 CASE b.prioridade WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1
                                                   WHEN 'media' THEN 2 ELSE 3 END,
                                 b.data_ref DESC, b.id
                    ) AS rn
                    FROM ({base}) b
                    LEFT JOIN (SELECT defeito_id, count(*) AS total FROM apoios GROUP BY 1) a
                           ON a.defeito_id = b.id
                ) x WHERE rn <= %(por_celula)s LIMIT %(limite)s
            """, params)
            ids = [row[0] for row in cur.fetchall()]
            cur.execute(f"""
                SELECT avg(latitude), avg(longitude), count(*) FROM ({base}) b GROUP BY cy, cx
            """, params)
            celulas = [
                {'latitude': la, 'longitude': lo, 'total': n} for la, lo, n in cur.fetchall()
            ]

        defeitos = self.queryset.defer('imagem_thumbnail', 'foto_resolucao').filter(id__in=ids)
        return Response({
            'situacao': situacao,
            'celula_graus': celula,
            'total': sum(c['total'] for c in celulas),
            'celulas': celulas,
            'defeitos': self._lista(defeitos),
        })

    @action(detail=False, methods=['get'], permission_classes=(permissions.AllowAny,))
    def proximos(self, request):
        """
        O que já foi reportado perto de um ponto (?lat=&lng=), do mais perto ao
        mais longe — o app mostra antes de abrir um chamado novo, para o
        cidadão apoiar o existente em vez de duplicar. Entram os abertos no
        raio e os resolvidos há até `PROXIMOS_RESOLVIDOS_DIAS` dias ("isso já
        foi consertado"). Raio: ?raio= (até `PROXIMOS_RAIO_MAX_M`), senão o
        `raio_duplicado_m` da prefeitura do ponto, senão `PROXIMOS_RAIO_PADRAO_M`.
        Cada item traz `raio_duplicado_m` (o da prefeitura, mesmo com ?raio=),
        repetido nos cabeçalhos `X-Raio-Duplicado-M` e `X-Raio-M` (raio da
        busca) para quando a lista vem vazia. ?categoria= aceita o id ou o nome.
        """
        from django.db import connection
        from gestao.models import MunicipioConfig
        try:
            lat = float(request.query_params.get('lat', ''))
            lng = float(request.query_params.get('lng', ''))
        except ValueError:
            return Response({'detail': 'Informe lat e lng.'}, status=status.HTTP_400_BAD_REQUEST)

        raio = None
        if request.query_params.get('raio'):
            try:
                raio = float(request.query_params['raio'])
            except ValueError:
                return Response({'detail': 'raio deve ser um número em metros.'},
                                status=status.HTTP_400_BAD_REQUEST)
        # Raio de duplicado da prefeitura do ponto: vai em cada item e no
        # cabeçalho `X-Raio-Duplicado-M` (o app usa no "é o mesmo problema?"),
        # mesmo quando ?raio= troca o raio da busca.
        raio_duplicado = PROXIMOS_RAIO_PADRAO_M
        municipio = municipio_do_ponto(lat, lng)
        if municipio:
            configurado = (
                MunicipioConfig.objects.filter(municipio_id=municipio['codigo'])
                .values_list('raio_duplicado_m', flat=True).first()
            )
            if configurado:
                raio_duplicado = configurado
        raio_duplicado = min(max(raio_duplicado, 1), PROXIMOS_RAIO_MAX_M)
        if raio is None:
            raio = raio_duplicado
        raio = min(max(raio, 1), PROXIMOS_RAIO_MAX_M)

        params = {
            'lat': lat, 'lng': lng, 'raio': raio,
            'abertos': tuple(fluxo.STATUS_ABERTOS),
            'resolvidos_desde': timezone.now() - timedelta(days=PROXIMOS_RESOLVIDOS_DIAS),
            'limite': PROXIMOS_LIMITE,
        }
        filtro_categoria = ''
        categoria = (request.query_params.get('categoria') or '').strip()
        if categoria.isdigit():
            filtro_categoria = 'AND d.categoria_id = %(categoria_id)s'
            params['categoria_id'] = int(categoria)
        elif categoria:
            filtro_categoria = 'AND lower(d.categoria) = lower(%(categoria)s)'
            params['categoria'] = categoria
        # O raio nunca passa de `RAIO_VISIBILIDADE_RESTRITA_M`, então os
        # restritos que aparecem aqui são justamente os que quem está no
        # ponto já poderia ver (ver `regras.visivel_para`).
        with connection.cursor() as cur:
            cur.execute(f"""
                SELECT d.id, d.protocolo, d.titulo, d.categoria, d.categoria_id, d.status,
                       d.latitude, d.longitude, d.criado_em, d.resolvido_em,
                       ST_Distance(ST_MakePoint(d.longitude, d.latitude)::geography,
                                   ST_MakePoint(%(lng)s, %(lat)s)::geography) AS distancia,
                       (SELECT count(*) FROM apoios a WHERE a.defeito_id = d.id) AS apoios
                FROM defeitos d
                WHERE d.removido_em IS NULL
                  AND d.latitude IS NOT NULL AND d.longitude IS NOT NULL
                  AND ST_DWithin(ST_MakePoint(d.longitude, d.latitude)::geography,
                                 ST_MakePoint(%(lng)s, %(lat)s)::geography, %(raio)s)
                  AND (d.status IN %(abertos)s
                       OR (d.status = 'concluido' AND d.resolvido_em >= %(resolvidos_desde)s))
                  {filtro_categoria}
                ORDER BY distancia, d.criado_em DESC
                LIMIT %(limite)s
            """, params)
            linhas = cur.fetchall()
        return Response([
            {
                'id': str(r[0]), 'protocolo': r[1], 'titulo': r[2], 'categoria': r[3],
                'categoria_id': r[4], 'status': r[5],
                'status_rotulo': fluxo.ROTULOS_CIDADAO.get(r[5], r[5]),
                'latitude': r[6], 'longitude': r[7],
                'criado_em': r[8], 'resolvido_em': r[9],
                'distancia_m': round(r[10], 1), 'total_apoios': r[11],
                'raio_duplicado_m': raio_duplicado,
            }
            for r in linhas
        ], headers={'X-Raio-Duplicado-M': str(raio_duplicado), 'X-Raio-M': str(round(raio))})

    @action(detail=False, methods=['get'], permission_classes=(permissions.AllowAny,),
            url_path=r'protocolo/(?P<numero>[^/]+)', url_name='protocolo')
    def por_protocolo(self, request, numero=None):
        """
        Consulta pública pelo número de protocolo (`AAAA-NNNNNN`), como nas
        centrais 156: quem tem o número acompanha o chamado sem login.
        Restritos (autor em quarentena) só para o autor e a equipe.
        """
        numero = (numero or '').strip().upper()
        defeito = self.queryset.filter(protocolo=numero).first()
        if defeito is None or not regras.visivel_para(defeito, request.user):
            return Response({'detail': 'Nenhum chamado encontrado com este protocolo.'},
                            status=status.HTTP_404_NOT_FOUND)
        return Response(self._detalhe(defeito))

    @action(detail=True, methods=['post'])
    def avaliar(self, request, pk=None):
        """
        O autor avalia o atendimento de um chamado resolvido: `nota` de 1 a 5
        e `comentario` opcional. Pode corrigir por `AVALIACAO_EDITAVEL_DIAS`
        dias depois da primeira avaliação; se o chamado for reaberto e
        resolvido de novo, vale uma avaliação nova. Alimenta o CSAT do BI.
        """
        suspenso = _suspenso(request.user)
        if suspenso is not None:
            return suspenso
        defeito = self.get_object()
        if defeito.usuario_id != request.user.id:
            return Response({'detail': 'Só quem abriu o chamado pode avaliar o atendimento.'},
                            status=status.HTTP_403_FORBIDDEN)
        if defeito.status != 'concluido':
            return Response({'detail': 'Você poderá avaliar quando o chamado for resolvido.'},
                            status=status.HTTP_409_CONFLICT)
        nota = _inteiro_estrito(request.data.get('nota'))
        if nota not in range(1, 6):
            return Response({'detail': 'Dê uma nota de 1 a 5.'}, status=status.HTTP_400_BAD_REQUEST)
        comentario = str(request.data.get('comentario') or '').strip()
        if len(comentario) > AVALIACAO_COMENTARIO_MAX:
            return Response(
                {'detail': f'O comentário pode ter até {AVALIACAO_COMENTARIO_MAX} caracteres.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        agora = timezone.now()
        # Primeira avaliação deste ciclo de resolução (depois de `resolvido_em`).
        primeira = (
            DefeitoEvento.objects.filter(defeito=defeito, tipo='avaliacao')
            .filter(criado_em__gte=defeito.resolvido_em or defeito.criado_em)
            .order_by('criado_em').values_list('criado_em', flat=True).first()
        )
        edicao = primeira is not None
        if edicao and agora - primeira > timedelta(days=AVALIACAO_EDITAVEL_DIAS):
            return Response(
                {'detail': f'A avaliação só pode ser alterada até {AVALIACAO_EDITAVEL_DIAS} dias depois de feita.'},
                status=status.HTTP_409_CONFLICT,
            )
        with transaction.atomic():
            defeito.avaliacao_nota = nota
            defeito.avaliacao_comentario = comentario
            defeito.avaliado_em = agora
            defeito.save(update_fields=['avaliacao_nota', 'avaliacao_comentario', 'avaliado_em'])
            fluxo.registrar_evento(
                defeito, 'avaliacao', request.user, texto=comentario,
                dados={'nota': nota, 'edicao': edicao},
            )
        return Response(self._detalhe(self.queryset.get(pk=defeito.pk)))

    @action(detail=True, methods=['post'])
    def reabrir(self, request, pk=None):
        """
        Reabre um chamado fechado com um `motivo` ("o buraco voltou"). O autor
        reabre o próprio chamado resolvido até `fluxo.REABERTURA_AUTOR_DIAS`
        dias depois da solução; a gestão (gestor+) do município reabre
        qualquer fechado, inclusive rejeitado. Conta em `reaberturas`.
        """
        suspenso = _suspenso(request.user)
        if suspenso is not None:
            return suspenso
        defeito = self.get_object()
        user = request.user
        motivo = str(request.data.get('motivo') or '').strip()
        if len(motivo) < REABERTURA_MOTIVO_MIN:
            return Response(
                {'detail': 'Conte em poucas palavras por que o problema continua (motivo obrigatório).'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if defeito.status not in STATUS_FECHADOS:
            return Response({'detail': 'Este chamado ainda está aberto.'}, status=status.HTTP_409_CONFLICT)

        gestao = permissoes.pode_operar(user, defeito) and permissoes.nivel(user) >= permissoes.NIVEIS['gestor']
        if not gestao:
            if defeito.usuario_id != user.id:
                return Response(
                    {'detail': 'Só quem abriu o chamado ou a gestão da prefeitura pode reabri-lo.'},
                    status=status.HTTP_403_FORBIDDEN,
                )
            if defeito.status == 'rejeitado':
                return Response(
                    {'detail': 'Chamado marcado como "não procede" só pode ser reaberto pela prefeitura. '
                               'Se o problema existe, abra um novo chamado.'},
                    status=status.HTTP_403_FORBIDDEN,
                )
            resolvido = defeito.resolvido_em or defeito.fechado_em
            if resolvido and timezone.now() - resolvido > timedelta(days=fluxo.REABERTURA_AUTOR_DIAS):
                return Response(
                    {'detail': f'O prazo para reabrir ({fluxo.REABERTURA_AUTOR_DIAS} dias após a solução) '
                               'terminou. Abra um novo chamado.'},
                    status=status.HTTP_403_FORBIDDEN,
                )
        try:
            fluxo.transicionar(defeito, 'pendente', user, texto=motivo, dados={'motivo': motivo})
        except TransicaoNaoPermitida as e:
            return Response({'detail': str(e)}, status=status.HTTP_403_FORBIDDEN)
        except TransicaoInvalida as e:
            return Response({'detail': str(e)}, status=status.HTTP_409_CONFLICT)
        return Response(self._detalhe(self.queryset.get(pk=defeito.pk)))

    @action(detail=False, methods=['get'])
    def progresso(self, request):
        """Nível, XP e barra de progresso do usuário logado (ver `gamificacao.py`)."""
        return Response(gamificacao.resumo_do_usuario(request.user))

    @action(detail=False, methods=['get'], permission_classes=(permissions.AllowAny,))
    def ranking(self, request):
        """
        Leaderboard de contribuição: ?municipio=<código IBGE>, ?lat=&lng=
        (resolve a cidade do ponto) ou ?geral=1 (Brasil inteiro). ?periodo=
        semana|mes recorta ao que aconteceu no período (padrão: tudo).
        `eu` traz a linha do usuário logado mesmo fora do top.
        """
        periodo = request.query_params.get('periodo') or 'tudo'
        dias = {'semana': 7, 'mes': 30, 'tudo': None}
        if periodo not in dias:
            return Response({'detail': 'Período inválido.'}, status=status.HTTP_400_BAD_REQUEST)
        desde = None
        if dias[periodo]:
            from datetime import timedelta
            desde = timezone.now() - timedelta(days=dias[periodo])

        codigo = request.query_params.get('municipio')
        if request.query_params.get('geral'):
            municipio = None
        elif codigo:
            municipio = _municipio_por_codigo(codigo)
            if not municipio['nome']:
                return Response({'detail': 'Município não encontrado.'}, status=status.HTTP_404_NOT_FOUND)
        else:
            try:
                lat = float(request.query_params.get('lat', ''))
                lng = float(request.query_params.get('lng', ''))
            except ValueError:
                return Response(
                    {'detail': 'Informe municipio, lat/lng ou geral=1.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            municipio = municipio_do_ponto(lat, lng)
            if not municipio:
                return Response({'detail': 'Nenhum município neste ponto.'}, status=status.HTTP_404_NOT_FOUND)

        completo = gamificacao.ranking_de(
            municipio_id=municipio['codigo'] if municipio else None,
            desde=desde,
        )
        eu = None
        if request.user.is_authenticated:
            eu = next((i for i in completo if i['usuario_id'] == str(request.user.id)), None)
        return Response({
            'municipio': {
                'codigo': municipio['codigo'],
                'nome': municipio['nome'],
                'uf_sigla': municipio['uf_sigla'],
            } if municipio else None,
            'periodo': periodo,
            'total_participantes': len(completo),
            'ranking': completo[:20],
            'eu': eu,
        })

    @action(detail=False, methods=['get'])
    def apoiei(self, request):
        ids = Apoio.objects.filter(usuario=request.user).values_list('defeito_id', flat=True)
        return Response({'ids': [str(i) for i in ids]})

    @action(detail=False, methods=['patch'])
    def batch_status(self, request):
        """
        Mesmo `status` para vários chamados do município do operador, um a um
        pelo `fluxo` (cada um com histórico e aviso). Os que não aceitam a
        transição voltam em `erros` ({id: motivo}) sem travar o resto.
        """
        if not permissoes.eh_equipe(request.user):
            return Response(
                {'error': 'Permissao negada'},
                status=status.HTTP_403_FORBIDDEN,
            )
        ids = request.data.get('ids')
        if not isinstance(ids, list) or not ids:
            return Response(
                {'error': 'Informe ao menos um id'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(ids) > 100:
            return Response(
                {'error': 'Maximo de 100 chamados por lote'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        novo_status = fluxo.normalizar_status(request.data.get('status'))
        if novo_status not in fluxo.TRANSICOES:
            return Response(
                {'error': 'Invalid status'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not request.user.municipio_id:
            return Response({'error': SEM_MUNICIPIO}, status=status.HTTP_403_FORBIDDEN)
        qs = Defeito.objects.ativos().filter(id__in=ids, municipio_id=request.user.municipio_id)
        atualizados, erros = 0, {}
        for defeito in qs:
            try:
                fluxo.transicionar(
                    defeito, novo_status, request.user,
                    texto=request.data.get('texto') or '',
                    resposta_publica=request.data.get('resposta_publica') or '',
                    motivo=request.data.get('motivo') or '',
                )
                atualizados += 1
            except TransicaoInvalida as e:
                erros[str(defeito.id)] = str(e)
        return Response({'updated': atualizados, 'erros': erros})

    @action(detail=False, methods=['post'])
    def imagem(self, request):
        """
        Processa uma foto avulsa (desfoque de privacidade + WEBP). Só para
        quem está logado, com teto de tamanho e de frequência: aberta, era
        CPU de graça para qualquer um na internet.
        """
        file = request.FILES.get('file')
        if not file:
            return Response(
                {'error': 'No file provided'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        result, erro = _processar(file)
        if erro is not None:
            return erro
        return Response({
            'image': result['webp_bytes'].hex(),
            'thumbnail': result['thumbnail_bytes'].hex(),
        })


def _inteiro_estrito(valor):
    """5, '5' ou 5.0 -> 5; 3.5, '3.5', True, None ou lixo -> None (sem arredondar nota)."""
    if isinstance(valor, bool):
        return None
    if isinstance(valor, int):
        return valor
    if isinstance(valor, float):
        return int(valor) if valor.is_integer() else None
    if isinstance(valor, str) and valor.strip().isdigit():
        return int(valor.strip())
    return None


def _ids_inteiros(texto):
    """'1, 4,7' -> ([1, 4, 7], False); vazio -> ([], False); lixo -> ([], True)."""
    if not texto:
        return [], False
    try:
        return [int(p) for p in texto.split(',') if p.strip()], False
    except ValueError:
        return [], True


def _float_ou_none(valor):
    try:
        return float(valor)
    except (TypeError, ValueError):
        return None
