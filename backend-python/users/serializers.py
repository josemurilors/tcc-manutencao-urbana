from rest_framework import serializers
from .models import User
from services.cpf_validator import validar_digitos
from services.encryption import encrypt_text, hash_text


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=6)
    confirm_password = serializers.CharField(write_only=True, min_length=6)
    cpf = serializers.CharField(write_only=True, required=False, allow_blank=True)
    municipio_id = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = User
        fields = ('email', 'nome', 'password', 'confirm_password', 'cpf', 'municipio_id')

    def validate_email(self, value):
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError('Email already registered')
        return value.lower()

    def validate_cpf(self, value):
        nums = ''.join(c for c in (value or '') if c.isdigit())
        if not nums:
            return ''
        if len(nums) != 11 or not validar_digitos(nums):
            raise serializers.ValidationError('CPF inválido')
        if User.objects.filter(cpf_hash=hash_text(nums)).exists():
            raise serializers.ValidationError('CPF já cadastrado')
        return nums

    def validate(self, attrs):
        if attrs['password'] != attrs.pop('confirm_password'):
            raise serializers.ValidationError({'confirm_password': 'Passwords do not match'})
        return attrs

    def create(self, validated_data):
        password = validated_data.pop('password')
        cpf = validated_data.pop('cpf', '')
        municipio_id = validated_data.pop('municipio_id', '')
        user = User(**validated_data)
        user.set_password(password)
        if cpf:
            user.cpf = encrypt_text(cpf)
            user.cpf_hash = hash_text(cpf)
        user.municipio_id = municipio_id or None
        user.save()
        return user


def mascarar_cpf(cifrado):
    """CPF guardado cifrado -> '***.456.789-**'. Nunca devolve o texto cifrado nem o CPF inteiro."""
    if not cifrado:
        return None
    try:
        from services.encryption import decrypt_text
        nums = decrypt_text(cifrado)
    except Exception:
        return None
    if len(nums) != 11:
        return None
    return f'***.{nums[3:6]}.{nums[6:9]}-**'


class UserSerializer(serializers.ModelSerializer):
    """
    Perfil do próprio usuário. Só `nome` é editável: e-mail exige nova
    verificação, CPF passa por cifra + hash (cadastro), e município/papel
    têm endpoints próprios com regra de quem pode mudar o quê.
    """
    cpf = serializers.SerializerMethodField()
    super_admin = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            'id', 'email', 'nome', 'cpf', 'admin', 'papel', 'super_admin', 'municipio_id',
            'secretaria_id', 'equipe_id', 'email_verified', 'criado_em',
        )
        read_only_fields = (
            'id', 'email', 'admin', 'papel', 'municipio_id', 'secretaria_id', 'equipe_id',
            'email_verified', 'criado_em',
        )

    def get_cpf(self, obj):
        return mascarar_cpf(obj.cpf)

    def get_super_admin(self, obj):
        return obj.papel == 'super_admin'
