from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import NotificacaoViewSet, PushTokenView

router = DefaultRouter()
router.register('', NotificacaoViewSet, basename='notificacoes')

urlpatterns = [
    # Antes do router: senão `push-tokens` casaria com a rota de detalhe `<pk>/`.
    path('push-tokens/', PushTokenView.as_view(), name='notificacoes-push-tokens'),
    path('', include(router.urls)),
]
