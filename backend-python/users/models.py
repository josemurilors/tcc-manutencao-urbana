import uuid
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager
from django.db import models


class UserManager(BaseUserManager):
    def create_user(self, email, nome, password=None, **extra_fields):
        if not email:
            raise ValueError('Email is required')
        if not nome:
            raise ValueError('Nome is required')
        email = self.normalize_email(email)
        user = self.model(email=email, nome=nome, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, nome, password=None, **extra_fields):
        extra_fields.setdefault('papel', 'super_admin')
        extra_fields.setdefault('email_verified', 1)
        return self.create_user(email, nome, password, **extra_fields)


class User(AbstractBaseUser):
    last_login = None

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(max_length=255, unique=True)
    nome = models.CharField(max_length=255)
    password = models.CharField(max_length=128, db_column='senha')
    admin = models.IntegerField(default=0)
    municipio_id = models.CharField(max_length=255, blank=True, null=True, db_column='municipio_id')
    cpf = models.CharField(max_length=512, blank=True, default='')
    cpf_hash = models.CharField(max_length=512, blank=True, null=True, unique=True, db_column='cpf_hash')
    email_verified = models.SmallIntegerField(default=0, db_column='email_verificado')
    codigo_2fa = models.CharField(max_length=10, blank=True, null=True, db_column='codigo_2fa')
    codigo_2fa_expira = models.CharField(max_length=50, blank=True, null=True, db_column='codigo_2fa_expira')
    codigo_tentativas = models.IntegerField(default=0, db_column='codigo_tentativas')
    requestsResetAt = models.CharField(max_length=50, blank=True, null=True, db_column='requestsresetat')
    requestsCount = models.IntegerField(default=0, db_column='requestscount')
    criado_em = models.DateTimeField(auto_now_add=True, db_column='criado_em')
    atualizado_em = models.DateTimeField(auto_now=True, db_column='atualizado_em')
    # Papel no município (contrato v3, seção 3; regras em `core/permissoes.py`).
    # `admin` continua existindo para clientes antigos e espelha o papel.
    papel = models.CharField(max_length=20, default='cidadao')
    secretaria_id = models.IntegerField(null=True, blank=True, db_column='secretaria_id')
    equipe_id = models.IntegerField(null=True, blank=True, db_column='equipe_id')
    suspenso_ate = models.DateTimeField(null=True, blank=True)
    aceite_termos_em = models.DateTimeField(null=True, blank=True)

    objects = UserManager()

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['nome']

    def save(self, *args, **kwargs):
        self.admin = 0 if (self.papel or 'cidadao') == 'cidadao' else 1
        update_fields = kwargs.get('update_fields')
        if update_fields is not None and 'papel' in update_fields and 'admin' not in update_fields:
            kwargs['update_fields'] = [*update_fields, 'admin']
        super().save(*args, **kwargs)

    # O Django Admin (/admin/) expõe CPF cifrado, códigos 2FA e papéis de todo
    # mundo: fica só com o super admin da plataforma, nunca com a equipe da
    # prefeitura.
    @property
    def is_staff(self):
        return self.papel == 'super_admin'

    @property
    def is_superuser(self):
        return self.papel == 'super_admin'

    @property
    def is_active(self):
        return True

    def has_perm(self, perm, obj=None):
        return self.papel == 'super_admin'

    def has_module_perms(self, app_label):
        return self.papel == 'super_admin'

    class Meta:
        db_table = 'users'
        managed = False
        verbose_name = 'Usuário'
        verbose_name_plural = 'Usuários'

    def __str__(self):
        return f'{self.nome} ({self.email})'


class PushSubscription(models.Model):
    id = models.AutoField(primary_key=True)
    usuario = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='push_subscriptions', db_column='usuario_id',
    )
    endpoint = models.TextField()
    p256dh = models.TextField()
    auth = models.TextField()
    criado_em = models.DateTimeField(auto_now_add=True, db_column='criado_em')

    class Meta:
        db_table = 'push_subscriptions'
        managed = False
        verbose_name = 'Push Subscription'
        verbose_name_plural = 'Push Subscriptions'
