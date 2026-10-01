"""
Rotas do app `bi`. São quatro prefixos (montados em `core/urls.py`): o BI da
gestão e as três portas públicas, cada uma com sua lista.
"""
from django.urls import path, re_path

from . import publico, views

urlpatterns = [
    path('kpis/', views.KpisView.as_view(), name='bi-kpis'),
    path('series/', views.SeriesView.as_view(), name='bi-series'),
    path('distribuicao/', views.DistribuicaoView.as_view(), name='bi-distribuicao'),
    path('aging/', views.AgingView.as_view(), name='bi-aging'),
    path('produtividade/', views.ProdutividadeView.as_view(), name='bi-produtividade'),
    path('hotspots/', views.HotspotsView.as_view(), name='bi-hotspots'),
    path('satisfacao/', views.SatisfacaoView.as_view(), name='bi-satisfacao'),
    path('chamados/', views.ChamadosView.as_view(), name='bi-chamados'),
    path('exportar/', views.ExportarView.as_view(), name='bi-exportar'),
    path('relatorio/', views.RelatorioView.as_view(), name='bi-relatorio'),
]

transparencia_urlpatterns = [
    path('<str:codigo>/', publico.TransparenciaView.as_view(), name='transparencia'),
]

dados_abertos_urlpatterns = [
    re_path(r'^(?P<codigo>[^/]+)/chamados\.(?P<formato>csv|geojson)$',
            publico.DadosAbertosView.as_view(), name='dados-abertos-chamados'),
]

open311_urlpatterns = [
    path('v2/services.json', publico.Open311ServicesView.as_view(), name='open311-services'),
    path('v2/requests.json', publico.Open311RequestsView.as_view(), name='open311-requests'),
    re_path(r'^v2/requests/(?P<protocolo>[^/]+)\.json$', publico.Open311RequestView.as_view(),
            name='open311-request'),
]
