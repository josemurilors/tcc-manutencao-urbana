import base64
import json

from django.db import transaction
from django.http import HttpResponse
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
from .serializers import (
    municipio_do_ponto,
    DefeitoListSerializer, DefeitoDetailSerializer, DefeitoEventoSerializer,
    DefeitoCreateSerializer, DefeitoUpdateSerializer,
)

# Operar (assumir, mudar status, gerar OS) é restrito ao município a que o
# operador está vinculado — sem exceção: todo operador, inclusive o super
# admin, opera numa única cidade (`permissoes.pode_operar`). Como cidadão, o
# mesmo usuário continua livre para reportar/apoiar onde quiser.


def _negado(user):
    return Response(
        {'error': FORA_DO_MUNICIPIO if permissoes.eh_equipe(user) else 'Permissao negada'},
        status=status.HTTP_403_FORBIDDEN,
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

# Fotos extras por chamado (anexar): cada uma vai inteira em `defeito_anexos`
# e a miniatura em `imagens_extra`; sem teto, a linha incharia sem limite.
MAX_ANEXOS = 10

# Edição do chamado (PATCH): o autor só corrige a descrição enquanto ninguém
# triou; a equipe ajusta os dados de triagem. Status só pela action `status`.
CAMPOS_EDITAVEIS_AUTOR = {'descricao'}
CAMPOS_EDITAVEIS_EQUIPE = {'titulo', 'descricao', 'rua', 'bairro', 'prioridade', 'previsao_conclusao'}

# Ações de listagem: não carregam as colunas BYTEA (foto e foto de resolução).
ACOES_LISTAGEM = ('list', 'meus', 'apoiados', 'operacao', 'municipio', 'area')


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
        # município só restringe a *operação* (ver `operacao` e `_pode_operar`),
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
                           'batch_status', 'ordem_servico', 'operacao',
                           'update', 'partial_update', 'destroy', 'anexar'):
            return (permissions.IsAuthenticated(),)
        return (permissions.AllowAny(),)

    def create(self, request, *args, **kwargs):
        # Chamado só com foto do local, tirada na hora (o app abre a câmera;
        # galeria não entra). Sem imagem não há como a prefeitura triar.
        if 'imagem' not in request.FILES:
            return Response(
                {'imagem': 'Tire uma foto do problema para abrir o chamado.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
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
        webp = None
        if 'imagem' in self.request.FILES:
            from services.image_processor import process_image
            result = process_image(self.request.FILES['imagem'].read())
            webp = result['webp_bytes']

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
        defeito = self.get_object()
        apoio, created = Apoio.objects.get_or_create(
            usuario=request.user, defeito=defeito,
            defaults={'criado_em': timezone.now()},
        )
        if not created:
            apoio.delete()
            return Response({'apoiado': False}, status=status.HTTP_200_OK)
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
            from services.image_processor import process_image
            try:
                foto = process_image(arquivo.read())['webp_bytes']
            except Exception:
                return Response(
                    {'error': 'Imagem de resolucao invalida'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
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
        from services.image_processor import process_image
        try:
            result = process_image(file.read())
        except Exception:
            return Response({'error': 'Imagem invalida'}, status=status.HTTP_400_BAD_REQUEST)
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

    @action(detail=False, methods=['get'])
    def operacao(self, request):
        """
        Fila do operador: todos os chamados do município a que ele está
        vinculado (sem paginação), mais o município em si para o cabeçalho.
        """
        user = request.user
        if not permissoes.eh_equipe(user):
            return Response({'error': 'Permissao negada'}, status=status.HTTP_403_FORBIDDEN)
        if not user.municipio_id:
            return Response({'error': SEM_MUNICIPIO}, status=status.HTTP_403_FORBIDDEN)
        qs = self.get_queryset().filter(municipio_id=user.municipio_id)
        return Response({
            'municipio': _municipio_por_codigo(user.municipio_id),
            'defeitos': self._lista(qs[:2000]),
        })

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
        Chamados abertos dentro do retângulo visível do mapa
        (?min_lat=&max_lat=&min_lng=&max_lng=), rareados conforme o zoom.

        O retângulo é dividido numa grade de ~`AREA_GRADE` células por lado e
        cada célula devolve no máximo `AREA_POR_CELULA` chamados (os mais
        apoiados/urgentes primeiro): com zoom de rua sai tudo; afastando, cada
        célula cobre mais chão e o total visível fica estável. A célula é uma
        potência de 2 em graus, alinhada ao globo — arrastar o mapa no mesmo
        zoom não embaralha quais pinos aparecem.

        `celulas` traz a contagem real de cada célula (centro de massa), para
        o mapa de calor não perder a densidade que o corte escondeu.
        ?lat=&lng= (posição do usuário) libera os restritos que estão perto.
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

        vao = max(max_lat - min_lat, max_lng - min_lng, 1e-6)
        celula = 2 ** round(math.log2(vao / AREA_GRADE))
        user = request.user
        autenticado = user.is_authenticated
        params = {
            'min_lat': min_lat, 'max_lat': max_lat, 'min_lng': min_lng, 'max_lng': max_lng,
            'celula': celula, 'por_celula': AREA_POR_CELULA, 'limite': AREA_LIMITE,
            'fechados': tuple(STATUS_FECHADOS),
            'admin': permissoes.eh_equipe(user),
            'uid': str(user.id) if autenticado else None,
            'lat': lat, 'lng': lng, 'raio': regras.RAIO_VISIBILIDADE_RESTRITA_M,
        }
        base = """
            SELECT d.id, d.latitude, d.longitude, d.criado_em, d.prioridade,
                   floor(d.latitude / %(celula)s) AS cy, floor(d.longitude / %(celula)s) AS cx
            FROM defeitos d
            WHERE d.latitude BETWEEN %(min_lat)s AND %(max_lat)s
              AND d.longitude BETWEEN %(min_lng)s AND %(max_lng)s
              AND d.status NOT IN %(fechados)s
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
                        ORDER BY coalesce(a.total, 0) DESC,
                                 CASE b.prioridade WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1
                                                   WHEN 'media' THEN 2 ELSE 3 END,
                                 b.criado_em DESC, b.id
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
            'celula_graus': celula,
            'total': sum(c['total'] for c in celulas),
            'celulas': celulas,
            'defeitos': self._lista(defeitos),
        })

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

    @action(detail=True, methods=['get'])
    def ordem_servico(self, request, pk=None):
        defeito = self.get_object()
        if not permissoes.pode_operar(request.user, defeito):
            return _negado(request.user)
        from services.ordem_servico import gerar_ordem_servico
        pdf_bytes = gerar_ordem_servico(defeito)
        id_curto = defeito.protocolo or str(defeito.id)[:8]
        response = HttpResponse(pdf_bytes, content_type='application/pdf')
        response['Content-Disposition'] = f'attachment; filename="OS-{id_curto}.pdf"'
        return response

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
        from services.image_processor import process_image
        file = request.FILES.get('file')
        if not file:
            return Response(
                {'error': 'No file provided'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        result = process_image(file.read())
        return Response({
            'image': result['webp_bytes'].hex(),
            'thumbnail': result['thumbnail_bytes'].hex(),
        })


def _float_ou_none(valor):
    try:
        return float(valor)
    except (TypeError, ValueError):
        return None
