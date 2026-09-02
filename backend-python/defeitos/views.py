from django.http import HttpResponse
from django.utils import timezone
from rest_framework import viewsets, permissions, status, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError
from django.db.models import Count, Q
from .models import Defeito, Apoio, Sinalizacao
from . import gamificacao, regras
from .serializers import (
    municipio_do_ponto,
    DefeitoListSerializer, DefeitoDetailSerializer,
    DefeitoCreateSerializer, ApoioSerializer,
)
from users.models import User


def _pode_operar(user, defeito):
    """
    Operar (assumir, mudar status, gerar OS) é restrito ao município a que o
    operador está vinculado — sem exceção: todo operador, inclusive o super
    admin, opera numa única cidade. Como cidadão, o mesmo usuário continua
    livre para reportar/apoiar onde quiser.
    """
    if not user.is_authenticated or not user.admin:
        return False
    return bool(user.municipio_id) and defeito.municipio_id == user.municipio_id


def _municipio_por_codigo(codigo):
    from django.db import connection
    with connection.cursor() as cur:
        cur.execute('SELECT codigo, nome, uf_sigla FROM municipios WHERE codigo = %s', [codigo])
        row = cur.fetchone()
    if not row:
        return {'codigo': str(codigo), 'nome': '', 'uf_sigla': ''}
    return {'codigo': str(row[0]), 'nome': row[1], 'uf_sigla': row[2]}


STATUS_FECHADOS = {'atendido', 'encerrado', 'concluido', 'rejeitado'}
FORA_DO_MUNICIPIO = 'Chamado fora do seu município de operação'
SEM_MUNICIPIO = 'Operador sem município vinculado'


class DefeitoViewSet(viewsets.ModelViewSet):
    # `distinct=True` em todos os Count: apoios e sinalizações são joins
    # independentes e sem isso um multiplicaria a contagem do outro.
    queryset = Defeito.objects.select_related(
        'usuario',
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
        if self.action in ('list', 'apoiados'):
            user = self.request.user
            if not user.is_authenticated:
                qs = qs.filter(visibilidade=Defeito.VISIBILIDADE_PUBLICA)
            elif not user.admin:
                qs = qs.filter(Q(visibilidade=Defeito.VISIBILIDADE_PUBLICA) | Q(usuario=user))
        return qs

    def get_serializer_class(self):
        if self.action == 'list':
            return DefeitoListSerializer
        if self.action == 'retrieve':
            return DefeitoDetailSerializer
        if self.action in ('create', 'update', 'partial_update'):
            return DefeitoCreateSerializer
        return DefeitoDetailSerializer

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

        from services.ia_client import routing
        categoria = self.request.data.get('categoria', '')
        rota = routing(categoria) if categoria else {}

        serializer.save(
            usuario=self.request.user,
            criado_em=timezone.now(),
            atualizado_em=timezone.now(),
            visibilidade=regras.visibilidade_inicial(self.request.user),
            imagem_thumbnail=webp,
            secretaria_responsavel=rota.get('secretaria', ''),
            prazo_sla_dias=rota.get('prazo_sla_dias', 0),
        )

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
            'defeito': DefeitoDetailSerializer(atualizado).data,
        })

    @action(detail=False, methods=['get'])
    def sinalizei(self, request):
        """{defeito_id: tipo} das sinalizações do usuário logado."""
        pares = Sinalizacao.objects.filter(usuario=request.user).values_list('defeito_id', 'tipo')
        return Response({'sinalizacoes': {str(d): t for d, t in pares}})

    @action(detail=True, methods=['patch'])
    def status(self, request, pk=None):
        defeito = self.get_object()
        e_atendente = bool(defeito.atendente_id) and defeito.atendente == request.user
        if not (e_atendente or _pode_operar(request.user, defeito)):
            return Response(
                {'error': FORA_DO_MUNICIPIO if request.user.admin else 'Permissao negada'},
                status=status.HTTP_403_FORBIDDEN,
            )
        novo_status = request.data.get('status')
        if novo_status not in dict(Defeito.STATUS_CHOICES):
            return Response(
                {'error': 'Invalid status'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        resolvidos = {'atendido', 'encerrado', 'concluido'}
        # Foto de resolução é opcional: se vier, fica guardada como registro
        # do serviço feito; sem ela o chamado é finalizado do mesmo jeito.
        arquivo = request.FILES.get('foto_resolucao')
        if arquivo is not None:
            from services.image_processor import process_image
            try:
                result = process_image(arquivo.read())
                defeito.foto_resolucao = result['webp_bytes']
            except Exception:
                return Response(
                    {'error': 'Imagem de resolucao invalida'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        defeito.status = novo_status
        if novo_status in resolvidos and not defeito.atendido_em:
            defeito.atendido_em = timezone.now().isoformat()
        defeito.save()
        return Response(DefeitoDetailSerializer(defeito).data)

    @action(detail=False, methods=['get'])
    def meus(self, request):
        qs = self.get_queryset().filter(usuario=request.user)
        page = self.paginate_queryset(qs)
        if page is not None:
            return self.get_paginated_response(
                DefeitoListSerializer(page, many=True).data,
            )
        return Response(DefeitoListSerializer(qs, many=True).data)

    @action(detail=False, methods=['get'])
    def apoiados(self, request):
         ids = Apoio.objects.filter(usuario=request.user).values_list(
             'defeito_id', flat=True,
         )
         qs = self.get_queryset().filter(id__in=list(ids))
         page = self.paginate_queryset(qs)
         if page is not None:
             return self.get_paginated_response(
                 DefeitoListSerializer(page, many=True).data,
             )
         return Response(DefeitoListSerializer(qs, many=True).data)

    @action(detail=True, methods=['patch'])
    def atender(self, request, pk=None):
        defeito = self.get_object()
        if not _pode_operar(request.user, defeito):
            return Response(
                {'error': FORA_DO_MUNICIPIO if request.user.admin else 'Permissao negada'},
                status=status.HTTP_403_FORBIDDEN,
            )
        if defeito.atendente_id:
            return Response(
                {'error': 'Chamado já possui atendente'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        defeito.atendente = request.user
        defeito.status = 'vinculado_sem_resposta'
        defeito.atendido_em = timezone.now().isoformat()
        defeito.save()
        return Response({'message': 'Chamado vinculado com sucesso'})

    @action(detail=True, methods=['post'])
    def anexar(self, request, pk=None):
        defeito = self.get_object()
        file = request.FILES.get('file')
        if not file:
            return Response({'error': 'No file provided'}, status=status.HTTP_400_BAD_REQUEST)
        from services.image_processor import process_image
        import json, base64
        result = process_image(file.read())
        extras = json.loads(defeito.imagens_extra or '[]')
        b64 = base64.b64encode(result['thumbnail_bytes']).decode('ascii')
        extras.append(f'data:image/webp;base64,{b64}')
        defeito.imagens_extra = json.dumps(extras)
        defeito.save()
        return Response(DefeitoDetailSerializer(defeito).data)

    @action(detail=False, methods=['get'])
    def operacao(self, request):
        """
        Fila do operador: todos os chamados do município a que ele está
        vinculado (sem paginação), mais o município em si para o cabeçalho.
        """
        user = request.user
        if not user.admin:
            return Response({'error': 'Permissao negada'}, status=status.HTTP_403_FORBIDDEN)
        if not user.municipio_id:
            return Response({'error': SEM_MUNICIPIO}, status=status.HTTP_403_FORBIDDEN)
        qs = self.get_queryset().filter(municipio_id=user.municipio_id)
        return Response({
            'municipio': _municipio_por_codigo(user.municipio_id),
            'defeitos': DefeitoListSerializer(qs[:2000], many=True).data,
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
            .exclude(status__in=('atendido', 'encerrado', 'concluido', 'rejeitado'))[:2000]
        )
        # Chamados restritos só para quem está perto (ou é o autor/operador).
        abertos = [d for d in abertos if regras.visivel_para(d, request.user, lat, lng)]
        dados = DefeitoListSerializer(abertos, many=True).data

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
        if not _pode_operar(request.user, defeito):
            return Response(
                {'error': FORA_DO_MUNICIPIO if request.user.admin else 'Permissao negada'},
                status=status.HTTP_403_FORBIDDEN,
            )
        from services.ordem_servico import gerar_ordem_servico
        pdf_bytes = gerar_ordem_servico(defeito)
        id_curto = str(defeito.id)[:8]
        response = HttpResponse(pdf_bytes, content_type='application/pdf')
        response['Content-Disposition'] = f'attachment; filename="OS-{id_curto}.pdf"'
        return response

    @action(detail=False, methods=['patch'])
    def batch_status(self, request):
        if not request.user.admin:
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
        novo_status = request.data.get('status')
        if novo_status not in dict(Defeito.STATUS_CHOICES):
            return Response(
                {'error': 'Invalid status'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not request.user.municipio_id:
            return Response({'error': SEM_MUNICIPIO}, status=status.HTTP_403_FORBIDDEN)
        qs = self.get_queryset().filter(id__in=ids, municipio_id=request.user.municipio_id)
        agora = timezone.now()
        if novo_status in {'atendido', 'encerrado', 'concluido'}:
            # Marca quando foi resolvido, sem sobrescrever quem já tinha data.
            qs.filter(atendido_em='').update(atendido_em=agora.isoformat())
        updated = qs.update(status=novo_status, atualizado_em=agora)
        return Response({'updated': updated})

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
