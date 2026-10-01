"""
API de notificações (contrato v3, seção 7.3): caixa de entrada do usuário
logado e registro dos tokens de push do aparelho. Cada um só enxerga e mexe
no que é seu — notificação de outra pessoa responde 404, não 403, para não
confirmar que o id existe.
"""
from django.utils import timezone
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.views import APIView

from . import push
from .models import Notificacao, PushToken

# Aparelhos guardados por conta: o suficiente para celular + tablet + trocas,
# sem acumular tokens mortos de quem reinstala o app toda semana.
MAX_TOKENS_POR_USUARIO = 10


class NotificacaoSerializer(serializers.ModelSerializer):
    defeito_id = serializers.UUIDField(read_only=True, allow_null=True)

    class Meta:
        model = Notificacao
        fields = ('id', 'tipo', 'titulo', 'corpo', 'defeito_id', 'lida_em', 'criado_em')
        read_only_fields = fields


class NotificacaoViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    serializer_class = NotificacaoSerializer
    # A ordem é sempre a mais recente primeiro; os filtros genéricos não se aplicam.
    filter_backends = ()

    def get_queryset(self):
        qs = Notificacao.objects.filter(usuario_id=self.request.user.id).order_by('-criado_em', '-id')
        if self.action == 'list':
            params = self.request.query_params
            if params.get('nao_lidas') in ('1', 'true'):
                qs = qs.filter(lida_em__isnull=True)
            if params.get('tipo'):
                qs = qs.filter(tipo=params['tipo'])
        return qs

    def get_object(self):
        # O 404 padrão do Django sai em inglês ("No Notificacao matches...") e
        # chegaria assim na tela do app.
        pk = str(self.kwargs.get('pk', ''))
        notificacao = self.get_queryset().filter(pk=pk).first() if pk.isdigit() else None
        if notificacao is None:
            raise NotFound('Notificação não encontrada.')
        return notificacao

    @action(detail=False, methods=['get'], url_path='nao-lidas')
    def nao_lidas(self, request):
        return Response({'total': self.get_queryset().filter(lida_em__isnull=True).count()})

    @action(detail=True, methods=['post'])
    def lida(self, request, pk=None):
        notificacao = self.get_object()
        if notificacao.lida_em is None:
            notificacao.lida_em = timezone.now()
            notificacao.save(update_fields=['lida_em'])
        return Response(self.get_serializer(notificacao).data)

    @action(detail=False, methods=['post'], url_path='todas-lidas')
    def todas_lidas(self, request):
        total = self.get_queryset().filter(lida_em__isnull=True).update(lida_em=timezone.now())
        return Response({'atualizadas': total})


class PushTokenView(APIView):
    """POST registra (ou move para esta conta) o token do aparelho; DELETE o remove no logout."""

    @staticmethod
    def _token(request):
        dados = request.data if hasattr(request.data, 'get') else {}
        return str(dados.get('token') or request.query_params.get('token') or '').strip()

    def post(self, request):
        token = self._token(request)
        if not push.token_valido(token):
            return Response({'detail': 'Token de push inválido.'}, status=status.HTTP_400_BAD_REQUEST)
        plataforma = str(request.data.get('plataforma') or '').strip().lower()[:20]
        agora = timezone.now()
        # O token é do aparelho: se outra conta logou nele antes, passa a ser
        # desta (senão a conta anterior seguiria recebendo os avisos daqui).
        registro, criado = PushToken.objects.update_or_create(
            token=token,
            defaults={'usuario_id': request.user.id, 'plataforma': plataforma, 'ultimo_uso': agora},
        )
        antigos = list(
            PushToken.objects.filter(usuario_id=request.user.id)
            .order_by('-ultimo_uso', '-id').values_list('id', flat=True)[MAX_TOKENS_POR_USUARIO:]
        )
        if antigos:
            PushToken.objects.filter(id__in=antigos).delete()
        return Response(
            {'token': registro.token, 'plataforma': registro.plataforma},
            status=status.HTTP_201_CREATED if criado else status.HTTP_200_OK,
        )

    def delete(self, request):
        token = self._token(request)
        if not token:
            return Response({'detail': 'Informe o token.'}, status=status.HTTP_400_BAD_REQUEST)
        # Idempotente: logout repetido ou token já removido pela Expo não é erro.
        PushToken.objects.filter(token=token, usuario_id=request.user.id).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
