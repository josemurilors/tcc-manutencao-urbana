"""
Estrutura da prefeitura (contrato v3, seções 2 e 6): secretarias, equipes,
regras de categoria por município, configuração do cliente e trilha de
auditoria. Tabelas criadas pelo `bootstrap_schema`, por isso `managed=False`.
"""
from django.core.serializers.json import DjangoJSONEncoder
from django.db import models
from django.utils import timezone

from users.models import User


class Secretaria(models.Model):
    id = models.AutoField(primary_key=True)
    municipio_id = models.CharField(max_length=20)
    nome = models.TextField()
    sigla = models.TextField(blank=True, default='')
    email = models.TextField(blank=True, default='')
    ativo = models.BooleanField(default=True)
    criado_em = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = 'secretarias'
        managed = False
        unique_together = ('municipio_id', 'nome')

    def __str__(self):
        return self.nome


class Equipe(models.Model):
    id = models.AutoField(primary_key=True)
    municipio_id = models.CharField(max_length=20)
    secretaria = models.ForeignKey(
        Secretaria, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='equipes', db_column='secretaria_id',
    )
    nome = models.TextField()
    ativo = models.BooleanField(default=True)
    criado_em = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = 'equipes'
        managed = False
        unique_together = ('municipio_id', 'nome')

    def __str__(self):
        return self.nome


class CategoriaMunicipio(models.Model):
    """Sobrepõe, para um município, o SLA/prioridade/secretaria da categoria (ver `defeitos/sla.py`)."""
    id = models.AutoField(primary_key=True)
    municipio_id = models.CharField(max_length=20)
    categoria = models.ForeignKey(
        'categorias.Categoria', on_delete=models.CASCADE,
        related_name='regras_municipio', db_column='categoria_id',
    )
    prazo_sla_dias = models.IntegerField(null=True, blank=True)
    prioridade = models.TextField(null=True, blank=True)
    secretaria = models.ForeignKey(
        Secretaria, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='categorias', db_column='secretaria_id',
    )
    ativo = models.BooleanField(default=True)
    checklist = models.JSONField(default=list, blank=True)

    class Meta:
        db_table = 'categoria_municipio'
        managed = False
        unique_together = ('municipio_id', 'categoria')


class MunicipioConfig(models.Model):
    municipio_id = models.CharField(max_length=20, primary_key=True)
    contratado = models.BooleanField(default=False)
    nome_exibicao = models.TextField(blank=True, default='')
    cor_primaria = models.TextField(blank=True, default='')
    email_contato = models.TextField(blank=True, default='')
    telefone = models.TextField(blank=True, default='')
    site = models.TextField(blank=True, default='')
    raio_duplicado_m = models.IntegerField(default=30)
    parametros = models.JSONField(default=dict, blank=True)
    atualizado_em = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = 'municipio_config'
        managed = False


class AuditLog(models.Model):
    """Ação administrativa/operacional registrada por `core.auditoria.registrar`."""
    id = models.BigAutoField(primary_key=True)
    usuario = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='+', db_column='usuario_id',
    )
    municipio_id = models.CharField(max_length=20, null=True, blank=True)
    acao = models.TextField()
    alvo_tipo = models.TextField(blank=True, default='')
    alvo_id = models.TextField(blank=True, default='')
    dados = models.JSONField(default=dict, blank=True, encoder=DjangoJSONEncoder)
    ip = models.TextField(blank=True, default='')
    criado_em = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = 'audit_log'
        managed = False
        ordering = ['-criado_em']
