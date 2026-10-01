from django.contrib import admin
from django.urls import path, include
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from bi import urls as bi_urls


@api_view(['GET', 'HEAD'])
@permission_classes([AllowAny])
def health_check(request):
    return Response({'message': 'API da Central de Inteligência Urbana'})


urlpatterns = [
    path('api/v1/health/', health_check, name='health-check'),
    path('api/v1/auth/', include('users.urls')),
    path('api/v1/defeitos/', include('defeitos.urls')),
    path('api/v1/municipios/', include('municipios.urls')),
    path('api/v1/categorias/', include('categorias.urls')),
    path('api/v1/bi/', include('bi.urls')),
    path('api/v1/transparencia/', include(bi_urls.transparencia_urlpatterns)),
    path('api/v1/dados-abertos/', include(bi_urls.dados_abertos_urlpatterns)),
    path('api/v1/open311/', include(bi_urls.open311_urlpatterns)),
    path('admin/', admin.site.urls),
]
