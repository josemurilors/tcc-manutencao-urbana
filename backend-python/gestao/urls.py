from django.urls import path

from . import views

urlpatterns = [
    path('municipio/', views.MunicipioView.as_view(), name='gestao-municipio'),
    path('secretarias/', views.SecretariasView.as_view(), name='gestao-secretarias'),
    path('secretarias/<int:pk>/', views.SecretariaDetalheView.as_view(), name='gestao-secretaria'),
    path('equipes/', views.EquipesView.as_view(), name='gestao-equipes'),
    path('equipes/<int:pk>/', views.EquipeDetalheView.as_view(), name='gestao-equipe'),
    path('membros/', views.MembrosView.as_view(), name='gestao-membros'),
    path('membros/<uuid:pk>/', views.MembroDetalheView.as_view(), name='gestao-membro'),
    path('convites/', views.ConvitesView.as_view(), name='gestao-convites'),
    path('convites/<int:pk>/', views.ConviteDetalheView.as_view(), name='gestao-convite'),
    path('convites/<int:pk>/reenviar/', views.ConviteReenviarView.as_view(), name='gestao-convite-reenviar'),
    path('categorias/', views.CategoriasView.as_view(), name='gestao-categorias'),
    path('categorias/<int:categoria_id>/', views.CategoriaDetalheView.as_view(), name='gestao-categoria'),
    path('moderacao/', views.ModeracaoView.as_view(), name='gestao-moderacao'),
    path('moderacao/defeitos/<uuid:pk>/remover/', views.RemoverDefeitoView.as_view(),
         name='gestao-moderacao-remover'),
    path('moderacao/defeitos/<uuid:pk>/restaurar/', views.RestaurarDefeitoView.as_view(),
         name='gestao-moderacao-restaurar'),
    path('moderacao/usuarios/<uuid:pk>/suspender/', views.SuspenderUsuarioView.as_view(),
         name='gestao-moderacao-suspender'),
    path('moderacao/usuarios/<uuid:pk>/reativar/', views.ReativarUsuarioView.as_view(),
         name='gestao-moderacao-reativar'),
    path('auditoria/', views.AuditoriaView.as_view(), name='gestao-auditoria'),
]
