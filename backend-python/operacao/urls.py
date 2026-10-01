from django.urls import path

from . import views

# Ids de chamado são UUID; o conversor devolve 404 para lixo antes da view.
urlpatterns = [
    path('fila/', views.fila_view, name='operacao-fila'),
    path('resumo/', views.resumo_view, name='operacao-resumo'),
    path('chamados/<uuid:pk>/transicao/', views.transicao_view, name='operacao-transicao'),
    path('chamados/<uuid:pk>/atribuir/', views.atribuir_view, name='operacao-atribuir'),
    path('chamados/<uuid:pk>/liberar/', views.liberar_view, name='operacao-liberar'),
    path('chamados/<uuid:pk>/nota/', views.nota_view, name='operacao-nota'),
    path('chamados/<uuid:pk>/resposta/', views.resposta_view, name='operacao-resposta'),
    path('chamados/<uuid:pk>/evidencia/', views.evidencia_view, name='operacao-evidencia'),
    path('chamados/<uuid:pk>/anexos/', views.anexos_view, name='operacao-anexos'),
    path('chamados/<uuid:pk>/sla/', views.sla_view, name='operacao-sla'),
    path('chamados/<uuid:pk>/prioridade/', views.prioridade_view, name='operacao-prioridade'),
    path('chamados/<uuid:pk>/ordem-servico/', views.ordem_servico_view, name='operacao-ordem-servico'),
    path('anexos/<int:pk>/imagem/', views.anexo_imagem_view, name='operacao-anexo-imagem'),
    path('lote/', views.lote_view, name='operacao-lote'),
    path('respostas-padrao/', views.respostas_padrao_view, name='operacao-respostas-padrao'),
    path('respostas-padrao/<int:pk>/', views.resposta_padrao_view, name='operacao-resposta-padrao'),
    path('equipes/', views.equipes_view, name='operacao-equipes'),
]
