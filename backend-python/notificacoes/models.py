from django.db import models
from django.utils import timezone

from users.models import User


class Notificacao(models.Model):
    """Aviso in-app ao cidadão (criado por `servico.ao_evento`)."""
    id = models.BigAutoField(primary_key=True)
    usuario = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='notificacoes', db_column='usuario_id',
    )
    tipo = models.TextField()
    titulo = models.TextField()
    corpo = models.TextField(blank=True, default='')
    defeito = models.ForeignKey(
        'defeitos.Defeito', on_delete=models.CASCADE, null=True, blank=True,
        related_name='notificacoes', db_column='defeito_id',
    )
    lida_em = models.DateTimeField(null=True, blank=True)
    criado_em = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = 'notificacoes'
        managed = False
        ordering = ['-criado_em']


class PushToken(models.Model):
    """Token do Expo Push de um aparelho do usuário."""
    id = models.AutoField(primary_key=True)
    usuario = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='push_tokens', db_column='usuario_id',
    )
    token = models.TextField(unique=True)
    plataforma = models.TextField(blank=True, default='')
    criado_em = models.DateTimeField(default=timezone.now)
    ultimo_uso = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = 'push_tokens'
        managed = False
