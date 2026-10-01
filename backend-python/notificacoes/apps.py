from django.apps import AppConfig


class NotificacoesConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'notificacoes'

    def ready(self):
        # O apoio não passa por `fluxo.registrar_evento`; o marco de apoios
        # (5, 10, 25) é detectado pelo próprio save do `Apoio`.
        from django.db.models.signals import post_save

        from defeitos.models import Apoio

        from .servico import apoio_criado

        post_save.connect(apoio_criado, sender=Apoio, dispatch_uid='notificacoes.apoio_criado')
