import uuid
from django.contrib.gis.db import models
from django.contrib.gis.geos import Point
from django.core.serializers.json import DjangoJSONEncoder
from django.db import connection
from django.utils import timezone
from users.models import User


def gerar_protocolo(quando=None):
    """Próximo protocolo `AAAA-NNNNNN` (sequência global `defeitos_protocolo_seq`)."""
    ano = timezone.localtime(quando or timezone.now()).year
    with connection.cursor() as cur:
        cur.execute("SELECT nextval('defeitos_protocolo_seq')")
        numero = cur.fetchone()[0]
    return f'{ano}-{numero:06d}'


# Colunas grandes do chamado: as BYTEA (foto e foto de resolução), as fotos
# extras em base64 e o log JSON de atualizações. Listagens, filas e laços que
# não as mostram não devem trazê-las do banco.
COLUNAS_PESADAS = ('imagem_thumbnail', 'foto_resolucao', 'imagens_extra', 'atualizacoes')


class DefeitoQuerySet(models.QuerySet):
    def ativos(self):
        """Sem os removidos (soft delete); é o que toda listagem deve usar."""
        return self.filter(removido_em__isnull=True)

    def leves(self):
        """Sem as `COLUNAS_PESADAS` (carregadas sob demanda se alguém as ler)."""
        return self.defer(*COLUNAS_PESADAS)


class Defeito(models.Model):
    # Status canônicos (contrato v3, seção 1). Transições e rótulos em `fluxo.py`.
    STATUS_CHOICES = [
        ('pendente', 'Pendente'),
        ('em_analise', 'Em análise'),
        ('agendado', 'Agendado'),
        ('em_andamento', 'Em andamento'),
        ('concluido', 'Concluído'),
        ('rejeitado', 'Rejeitado'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    usuario = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='defeitos_defeitos', db_column='usuario',
    )
    titulo = models.CharField(max_length=255)
    descricao = models.TextField(blank=True, default='')
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)

    @property
    def localizacao(self):
        if self.latitude is not None and self.longitude is not None:
            return Point(self.longitude, self.latitude, srid=4326)
        return None

    @localizacao.setter
    def localizacao(self, value):
        if value is not None:
            self.longitude = value.x
            self.latitude = value.y

    rua = models.TextField(blank=True, default='')
    bairro = models.TextField(blank=True, default='')
    imagem_url = models.CharField(max_length=512, blank=True, default='')
    categoria = models.CharField(max_length=255, blank=True, default='')
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default='pendente')
    # 'restrita' = autor em quarentena (ver `regras.py`): só quem está perto do
    # ponto, o autor e operadores enxergam; vira 'publica' na 1ª confirmação.
    VISIBILIDADE_PUBLICA = 'publica'
    VISIBILIDADE_RESTRITA = 'restrita'
    visibilidade = models.CharField(max_length=20, default='publica')
    prioridade = models.CharField(max_length=50, blank=True, default='')
    previsao_conclusao = models.TextField(blank=True, default='')
    atendido_em = models.TextField(blank=True, default='')
    secretaria_responsavel = models.CharField(max_length=255, blank=True, default='', db_column='secretaria_responsavel')
    prazo_sla_dias = models.IntegerField(default=0, db_column='prazo_sla_dias')
    usuario_email = models.CharField(max_length=255, blank=True, default='')
    imagem_thumbnail = models.BinaryField(null=True, blank=True, db_column='imagem_thumbnail')
    foto_resolucao = models.BinaryField(null=True, blank=True, db_column='foto_resolucao')
    imagens_extra = models.TextField(default='[]')
    atualizacoes = models.TextField(default='[]')
    atendente = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='defeitos_atendidos', db_column='atendente_id',
    )
    # Código IBGE do município onde o ponto caiu (resolvido no backend a partir
    # de lat/lng, tabela `municipios`). Permite, no futuro, restringir
    # usuários/admins ao próprio município sem depender do cadastro deles.
    municipio_id = models.CharField(max_length=255, blank=True, null=True, db_column='municipio_id')
    criado_em = models.DateTimeField(db_column='criado_em')
    atualizado_em = models.DateTimeField(db_column='atualizado_em')

    # --- v3 (contrato, seção 2) ---
    # Gerado no primeiro save; o cidadão e a ouvidoria se referem ao chamado por ele.
    protocolo = models.CharField(max_length=20, unique=True, null=True, blank=True, editable=False)
    # Inteiro e não FK: `categoria` (o nome, texto) já ocupa o nome do campo.
    categoria_id = models.IntegerField(null=True, blank=True, db_column='categoria_id')
    secretaria = models.ForeignKey(
        'gestao.Secretaria', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='defeitos', db_column='secretaria_id',
    )
    equipe = models.ForeignKey(
        'gestao.Equipe', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='defeitos', db_column='equipe_id',
    )
    # Gravados só por `fluxo.py`.
    triado_em = models.DateTimeField(null=True, blank=True)
    atribuido_em = models.DateTimeField(null=True, blank=True)
    iniciado_em = models.DateTimeField(null=True, blank=True)
    resolvido_em = models.DateTimeField(null=True, blank=True)
    fechado_em = models.DateTimeField(null=True, blank=True)
    prazo_em = models.DateTimeField(null=True, blank=True)
    reaberturas = models.IntegerField(default=0)
    resposta_publica = models.TextField(blank=True, default='')
    motivo_rejeicao = models.TextField(blank=True, default='')
    duplicado_de = models.ForeignKey(
        'self', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='duplicados', db_column='duplicado_de',
    )
    avaliacao_nota = models.SmallIntegerField(null=True, blank=True)
    avaliacao_comentario = models.TextField(blank=True, default='')
    avaliado_em = models.DateTimeField(null=True, blank=True)
    removido_em = models.DateTimeField(null=True, blank=True)
    removido_motivo = models.TextField(blank=True, default='')

    objects = DefeitoQuerySet.as_manager()

    class Meta:
        db_table = 'defeitos'
        managed = False
        verbose_name = 'Defeito'
        verbose_name_plural = 'Defeitos'
        ordering = ['-criado_em']

    def __str__(self):
        return self.protocolo or self.titulo

    def save(self, *args, **kwargs):
        if self._state.adding and not self.protocolo:
            self.protocolo = gerar_protocolo(self.criado_em)
        super().save(*args, **kwargs)


class Apoio(models.Model):
    id = models.AutoField(primary_key=True)
    usuario = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='apoios',
        db_column='usuario_id',
    )
    defeito = models.ForeignKey(
        Defeito, on_delete=models.CASCADE, related_name='apoios',
        db_column='defeito_id',
    )
    criado_em = models.DateTimeField(db_column='criado_em')

    class Meta:
        db_table = 'apoios'
        managed = False
        verbose_name = 'Apoio'
        verbose_name_plural = 'Apoios'
        unique_together = ('usuario', 'defeito')

    def __str__(self):
        return f'{self.usuario_id} -> {self.defeito_id}'


class Sinalizacao(models.Model):
    """
    Sinal do cidadão sobre um chamado ainda aberto: "já foi resolvido" (alguém
    passou lá e o problema sumiu, mas o operador não fechou) ou "não existe"
    (nunca houve / foi reportado errado). Uma por usuário por chamado; o tipo
    pode ser trocado. Não muda o status sozinho — é insumo para o operador.
    """
    RESOLVIDO = 'resolvido'
    NAO_EXISTE = 'nao_existe'
    TIPO_CHOICES = [
        (RESOLVIDO, 'Já foi resolvido'),
        (NAO_EXISTE, 'Não existe'),
    ]

    id = models.AutoField(primary_key=True)
    usuario = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='sinalizacoes',
        db_column='usuario_id',
    )
    defeito = models.ForeignKey(
        Defeito, on_delete=models.CASCADE, related_name='sinalizacoes',
        db_column='defeito_id',
    )
    tipo = models.CharField(max_length=20, choices=TIPO_CHOICES)
    criado_em = models.DateTimeField(db_column='criado_em')

    class Meta:
        db_table = 'sinalizacoes'
        managed = False
        verbose_name = 'Sinalização'
        verbose_name_plural = 'Sinalizações'
        unique_together = ('usuario', 'defeito')

    def __str__(self):
        return f'{self.usuario_id} -> {self.defeito_id}: {self.tipo}'


class Strike(models.Model):
    """
    Marca contra quem reportou algo que a comunidade removeu como "nunca
    existiu". O chamado sai das listagens (soft delete); o strike guarda o
    autor, o título e a data — strikes expiram (ver `regras.STRIKE_VALIDADE_DIAS`).
    """
    id = models.AutoField(primary_key=True)
    usuario = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='strikes',
        db_column='usuario_id',
    )
    titulo = models.TextField(blank=True, default='')
    criado_em = models.DateTimeField(db_column='criado_em')

    class Meta:
        db_table = 'strikes'
        managed = False
        verbose_name = 'Strike'
        verbose_name_plural = 'Strikes'

    def __str__(self):
        return f'{self.usuario_id} @ {self.criado_em:%Y-%m-%d}'


class DefeitoEvento(models.Model):
    """
    Histórico do chamado (contrato v3): toda mudança passa por
    `fluxo.registrar_evento`. `publico=False` (ex.: nota interna) só a equipe
    do município vê. `papel` é o do autor no momento do evento.
    """
    TIPOS = (
        'criado', 'status', 'atribuido', 'resposta_publica', 'nota_interna',
        'apoio', 'sinalizacao', 'anexo', 'avaliacao', 'reaberto', 'prioridade',
        'sla', 'removido', 'moderacao',
    )

    id = models.BigAutoField(primary_key=True)
    defeito = models.ForeignKey(
        Defeito, on_delete=models.CASCADE, related_name='eventos', db_column='defeito_id',
    )
    tipo = models.TextField()
    de_status = models.TextField(null=True, blank=True)
    para_status = models.TextField(null=True, blank=True)
    autor = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='+', db_column='autor_id',
    )
    papel = models.TextField(blank=True, default='')
    publico = models.BooleanField(default=True)
    texto = models.TextField(blank=True, default='')
    dados = models.JSONField(default=dict, blank=True, encoder=DjangoJSONEncoder)
    criado_em = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = 'defeito_eventos'
        managed = False
        ordering = ['criado_em', 'id']

    def __str__(self):
        return f'{self.defeito_id} {self.tipo} @ {self.criado_em:%Y-%m-%d %H:%M}'


class DefeitoAnexo(models.Model):
    """Foto extra do chamado: do cidadão, ou evidência de antes/depois da equipe."""
    TIPOS = ('cidadao', 'antes', 'depois')

    id = models.BigAutoField(primary_key=True)
    defeito = models.ForeignKey(
        Defeito, on_delete=models.CASCADE, related_name='anexos', db_column='defeito_id',
    )
    tipo = models.TextField()
    imagem = models.BinaryField()
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
    autor = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='+', db_column='autor_id',
    )
    criado_em = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = 'defeito_anexos'
        managed = False
        ordering = ['criado_em', 'id']


class RespostaPadrao(models.Model):
    """Texto pronto que a equipe usa na resposta pública (por município/categoria)."""
    id = models.AutoField(primary_key=True)
    municipio_id = models.CharField(max_length=20)
    titulo = models.TextField()
    texto = models.TextField()
    categoria_id = models.IntegerField(null=True, blank=True, db_column='categoria_id')
    ativo = models.BooleanField(default=True)
    criado_em = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = 'respostas_padrao'
        managed = False
        ordering = ['titulo']
