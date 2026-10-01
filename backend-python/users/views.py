import logging
import secrets
from datetime import datetime, timedelta
from django.conf import settings
from django.db import connection
from django.db.models import Q
from django.utils import timezone
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from .serializers import RegisterSerializer, UserSerializer
from .models import User, PushSubscription
from core import auditoria, permissoes
from services.email_service import send_password_reset_code, send_verification_code
from . import throttles

logger = logging.getLogger(__name__)

# Código de 6 dígitos (verificação de e-mail e recuperação de senha): mesmas
# colunas `codigo_2fa`/`codigo_2fa_expira`, mesma validade.
CODIGO_VALIDADE_MIN = 10
# Recuperação de senha: no máximo N e-mails por conta por janela, contados em
# `requestsCount`/`requestsResetAt` (vale mesmo se o cache do throttle cair).
ESQUECI_MAX_ENVIOS = 5
ESQUECI_JANELA = timedelta(hours=1)
SENHA_MIN = 6


def _gerar_codigo(user):
    """Grava um código novo de 6 dígitos (válido por `CODIGO_VALIDADE_MIN`) e o devolve."""
    code = f'{secrets.randbelow(900000) + 100000}'
    user.codigo_2fa = code
    user.codigo_2fa_expira = (timezone.now() + timedelta(minutes=CODIGO_VALIDADE_MIN)).isoformat()
    user.save(update_fields=['codigo_2fa', 'codigo_2fa_expira'])
    return code


def _codigo_expirado(user):
    if not user.codigo_2fa_expira:
        return False
    try:
        expira = datetime.fromisoformat(user.codigo_2fa_expira.replace('Z', '+00:00'))
    except (ValueError, AttributeError):
        return True
    return timezone.now() > expira


def _enviar(funcao, email, code):
    # Falha de envio não derruba o fluxo (sem RESEND_API_KEY o código fica no
    # log do servidor), mas também não some em silêncio.
    try:
        funcao(email, code)
    except Exception:
        logger.exception('falha ao enviar e-mail de código para %s', email)


def verificar_id_token_google(token):
    """Valida o ID token do Google e devolve as claims.

    Levanta ValueError com mensagem legível quando o token é inválido, expirado
    ou foi emitido para outro app (audience fora de GOOGLE_CLIENT_IDS).
    Isolado numa função para os testes poderem substituí-la.
    """
    from google.auth.exceptions import GoogleAuthError
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token as google_id_token

    aceitos = [cid for cid in settings.GOOGLE_CLIENT_IDS.values() if cid]
    if not aceitos:
        raise ValueError('Login com Google não está configurado')
    try:
        claims = google_id_token.verify_oauth2_token(token, google_requests.Request())
    except (ValueError, GoogleAuthError) as exc:
        raise ValueError('Token do Google inválido ou expirado') from exc
    if claims.get('aud') not in aceitos:
        raise ValueError('Token do Google emitido para outro aplicativo')
    if claims.get('iss') not in ('accounts.google.com', 'https://accounts.google.com'):
        raise ValueError('Emissor do token inválido')
    return claims


class ExisteEmailView(APIView):
    """
    Passo 1 do fluxo único de entrada do app: o usuário digita o e-mail e o
    cliente decide se mostra senha (conta existe) ou cadastro (não existe).
    Limitado por IP: sem isso a rota enumera a base de e-mails.
    """
    permission_classes = (permissions.AllowAny,)
    throttle_classes = (throttles.ExisteIp,)

    def post(self, request):
        email = (request.data.get('email') or '').strip().lower()
        if not email or '@' not in email:
            return Response({'error': 'Email invalido'}, status=status.HTTP_400_BAD_REQUEST)
        return Response({'existe': User.objects.filter(email__iexact=email).exists()})


class RegisterView(generics.CreateAPIView):
    queryset = User.objects.all()
    serializer_class = RegisterSerializer
    permission_classes = (permissions.AllowAny,)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        _enviar(send_verification_code, user.email, _gerar_codigo(user))
        from rest_framework_simplejwt.tokens import RefreshToken
        refresh = RefreshToken.for_user(user)
        user_serializer = UserSerializer(user)
        return Response({
            'user': user_serializer.data,
            'access': str(refresh.access_token),
            'refresh': str(refresh),
        }, status=status.HTTP_201_CREATED)


class GoogleLoginView(APIView):
    """Entrar com Google.

    GET  -> client IDs por plataforma (o app/web usa para iniciar o fluxo).
    POST -> {id_token}: valida o token, cria o usuário na primeira vez (e-mail
            já verificado pelo Google, sem senha) ou vincula à conta existente
            com o mesmo e-mail, e devolve o mesmo JWT do login comum mais
            `novo` (True quando a conta acabou de ser criada — o cliente então
            pede o nome de exibição).
    """
    permission_classes = (permissions.AllowAny,)

    def get(self, request):
        return Response(settings.GOOGLE_CLIENT_IDS)

    def post(self, request):
        token = request.data.get('id_token')
        if not token:
            return Response({'detail': 'id_token é obrigatório'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            claims = verificar_id_token_google(token)
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_401_UNAUTHORIZED)

        email = (claims.get('email') or '').strip().lower()
        if not email or not claims.get('email_verified'):
            return Response(
                {'detail': 'A conta Google precisa ter e-mail verificado'},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        user = User.objects.filter(email__iexact=email).first()
        novo = user is None
        if novo:
            nome = (claims.get('name') or email.split('@')[0]).strip()[:255]
            user = User(email=email, nome=nome, email_verified=1)
            # Sem senha: o login por e-mail/senha fica indisponível para esta conta.
            user.set_unusable_password()
            user.save()
        elif not user.email_verified:
            # O Google já atestou o e-mail; dispensa o código 2FA pendente.
            user.email_verified = 1
            user.codigo_2fa = None
            user.codigo_2fa_expira = None
            user.save(update_fields=['email_verified', 'codigo_2fa', 'codigo_2fa_expira'])

        from rest_framework_simplejwt.tokens import RefreshToken
        refresh = RefreshToken.for_user(user)
        return Response({
            'user': UserSerializer(user).data,
            'access': str(refresh.access_token),
            'refresh': str(refresh),
            'novo': novo,
        }, status=status.HTTP_201_CREATED if novo else status.HTTP_200_OK)


class LoginView(TokenObtainPairView):
    permission_classes = (permissions.AllowAny,)
    # Força bruta: limite por IP e por conta (trocar de IP não ajuda).
    throttle_classes = (throttles.LoginIp, throttles.LoginEmail)

    def post(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        try:
            serializer.is_valid(raise_exception=True)
        except Exception:
            return Response(
                {'detail': 'Usuário e/ou senha incorreto(s)'},
                status=status.HTTP_401_UNAUTHORIZED,
            )
        user = serializer.user
        from .serializers import UserSerializer
        user_serializer = UserSerializer(user)
        return Response({
            'user': user_serializer.data,
            'access': str(serializer.validated_data['access']),
            'refresh': str(serializer.validated_data['refresh']),
        })


class RefreshView(TokenRefreshView):
    permission_classes = (permissions.AllowAny,)

    def post(self, request, *args, **kwargs):
        # O simplejwt renova pelo assinado do token sem olhar o banco; se a
        # conta sumiu (apagada, ou token de um banco antigo) o cliente ficaria
        # num loop de 401 com refresh "válido". Aqui a renovação exige o usuário.
        from rest_framework_simplejwt.exceptions import TokenError
        from rest_framework_simplejwt.tokens import RefreshToken

        try:
            user_id = RefreshToken(request.data.get('refresh', ''))[settings.SIMPLE_JWT.get('USER_ID_CLAIM', 'user_id')]
        except (TokenError, KeyError):
            return Response({'detail': 'Sessão expirada'}, status=status.HTTP_401_UNAUTHORIZED)
        if not User.objects.filter(pk=user_id).exists():
            return Response({'detail': 'Usuário não encontrado'}, status=status.HTTP_401_UNAUTHORIZED)
        return super().post(request, *args, **kwargs)


class ProfileView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = UserSerializer
    permission_classes = (permissions.IsAuthenticated,)

    def get_object(self):
        return self.request.user

    def perform_destroy(self, user):
        """
        Exclusão da própria conta (exigência das lojas de apps).

        Os chamados continuam no banco porque são informação pública sobre a
        cidade, mas perdem o vínculo com a pessoa: a FK vira NULL e o e-mail
        gravado no chamado é apagado. Apoios, sinalizações, strikes e inscrições
        de push são removidos em cascata pelo próprio modelo.
        """
        user.defeitos_defeitos.update(usuario=None, usuario_email='')
        user.delete()


class ChangePasswordView(APIView):
    permission_classes = (permissions.IsAuthenticated,)

    def patch(self, request):
        senha_atual = request.data.get('senha_atual')
        nova_senha = request.data.get('nova_senha')
        if not senha_atual or not nova_senha:
            return Response(
                {'error': 'senha_atual e nova_senha são obrigatórios'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(nova_senha) < 6:
            return Response(
                {'error': 'Nova senha deve ter no mínimo 6 caracteres'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user = request.user
        if not user.check_password(senha_atual):
            return Response(
                {'error': 'Senha atual incorreta'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user.set_password(nova_senha)
        user.save(update_fields=['password'])
        return Response({'message': 'Senha alterada com sucesso'})


class UpdateMunicipioView(APIView):
    """
    Cidade do cidadão (preferência dele). Para a equipe da prefeitura o
    município é o de operação: trocar por aqui daria acesso a outra cidade,
    então só o admin da prefeitura (ou o super admin) vincula — ver
    `AdminVinculateMunicipioView`.
    """
    permission_classes = (permissions.IsAuthenticated,)

    def patch(self, request):
        if permissoes.eh_equipe(request.user) and permissoes.papel(request.user) != 'super_admin':
            return Response(
                {'error': 'O município de operação da equipe é definido pela prefeitura.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        municipio_id = request.data.get('municipio_id')
        if not municipio_id:
            return Response(
                {'error': 'municipio_id é obrigatório'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        with connection.cursor() as cursor:
            cursor.execute(
                'SELECT codigo, nome, uf_sigla FROM municipios WHERE codigo = %s',
                [municipio_id],
            )
            row = cursor.fetchone()
            if not row:
                return Response(
                    {'error': 'Município não encontrado'},
                    status=status.HTTP_404_NOT_FOUND,
                )
            user = request.user
            user.municipio_id = municipio_id
            user.save(update_fields=['municipio_id'])
            municipio = {
                'codigo': row[0], 'nome': row[1], 'uf_sigla': row[2],
            }
        return Response({'municipio': municipio})


class VerifyEmailView(APIView):
    permission_classes = (permissions.IsAuthenticated,)
    # Código de 6 dígitos: sem limite de tentativas sai na força bruta.
    throttle_classes = (throttles.VerificarEmail,)

    def post(self, request):
        codigo = request.data.get('codigo')
        if not codigo:
            return Response(
                {'error': 'Código é obrigatório'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user = request.user
        if user.email_verified:
            return Response({'message': 'Email já verificado'})
        if not user.codigo_2fa:
            return Response(
                {'error': 'Nenhum código pendente'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if _codigo_expirado(user):
            return Response(
                {'error': 'Código expirado'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if user.codigo_2fa != codigo:
            return Response(
                {'error': 'Código inválido'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user.email_verified = 1
        user.codigo_2fa = None
        user.codigo_2fa_expira = None
        user.save(update_fields=['email_verified', 'codigo_2fa', 'codigo_2fa_expira'])
        return Response({'message': 'Email verificado com sucesso'})


class ResendCodeView(APIView):
    permission_classes = (permissions.IsAuthenticated,)
    throttle_classes = (throttles.ReenviarCodigo,)

    def post(self, request):
        user = request.user
        if user.email_verified:
            return Response({'message': 'Email já verificado'})
        _enviar(send_verification_code, user.email, _gerar_codigo(user))
        return Response({'message': 'Código reenviado'})


class EsqueciSenhaView(APIView):
    """
    Pede o código de recuperação de senha por e-mail. Responde sempre 200 com
    a mesma mensagem, exista a conta ou não — senão a rota vira um jeito de
    descobrir quem está cadastrado. Limites: por IP e por e-mail (throttle) e
    `ESQUECI_MAX_ENVIOS` e-mails por conta por hora (persistido na conta).
    """
    permission_classes = (permissions.AllowAny,)
    authentication_classes = ()
    throttle_classes = (throttles.SenhaEsqueciIp, throttles.SenhaEsqueciEmail)

    MENSAGEM = 'Se houver uma conta com este e-mail, enviamos um código para redefinir a senha.'

    def post(self, request):
        email = (request.data.get('email') or '').strip().lower()
        if not email or '@' not in email:
            return Response({'error': 'Informe um e-mail válido.'}, status=status.HTTP_400_BAD_REQUEST)
        user = User.objects.filter(email__iexact=email).first()
        if user is not None and self._dentro_do_limite(user):
            _enviar(send_password_reset_code, user.email, _gerar_codigo(user))
        return Response({'message': self.MENSAGEM})

    @staticmethod
    def _dentro_do_limite(user):
        agora = timezone.now()
        try:
            reinicia = datetime.fromisoformat((user.requestsResetAt or '').replace('Z', '+00:00'))
        except ValueError:
            reinicia = None
        if reinicia is None or agora >= reinicia:
            user.requestsCount = 0
            user.requestsResetAt = (agora + ESQUECI_JANELA).isoformat()
        if (user.requestsCount or 0) >= ESQUECI_MAX_ENVIOS:
            return False
        user.requestsCount = (user.requestsCount or 0) + 1
        user.save(update_fields=['requestsCount', 'requestsResetAt'])
        return True


class RedefinirSenhaView(APIView):
    """
    Troca a senha com o código recebido por e-mail. O erro é o mesmo para
    conta inexistente, código errado ou expirado (não confirma quem existe).
    Acertar o código também prova a posse do e-mail: a conta fica verificada.
    """
    permission_classes = (permissions.AllowAny,)
    authentication_classes = ()
    throttle_classes = (throttles.SenhaRedefinirEmail,)

    def post(self, request):
        email = (request.data.get('email') or '').strip().lower()
        codigo = str(request.data.get('codigo') or '').strip()
        nova = request.data.get('nova_senha') or ''
        if not email or not codigo or not nova:
            return Response(
                {'error': 'Informe e-mail, código e a nova senha.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(nova) < SENHA_MIN:
            return Response(
                {'error': f'A nova senha precisa ter pelo menos {SENHA_MIN} caracteres.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user = User.objects.filter(email__iexact=email).first()
        if (
            user is None or not user.codigo_2fa
            or not secrets.compare_digest(user.codigo_2fa, codigo)
            or _codigo_expirado(user)
        ):
            return Response(
                {'error': 'Código inválido ou expirado. Peça um novo código.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user.set_password(nova)
        user.codigo_2fa = None
        user.codigo_2fa_expira = None
        user.email_verified = 1
        user.requestsCount = 0
        user.requestsResetAt = None
        user.save(update_fields=[
            'password', 'codigo_2fa', 'codigo_2fa_expira', 'email_verified',
            'requestsCount', 'requestsResetAt',
        ])
        return Response({'message': 'Senha redefinida. Entre com a nova senha.'})


class AceiteTermosView(APIView):
    """
    Registra o aceite dos Termos de Uso e da Política de Privacidade (LGPD).
    Repetir atualiza a data — vale o aceite da versão vigente.
    """
    permission_classes = (permissions.IsAuthenticated,)

    def post(self, request):
        user = request.user
        user.aceite_termos_em = timezone.now()
        user.save(update_fields=['aceite_termos_em'])
        return Response({'user': UserSerializer(user).data})


class MeusDadosView(APIView):
    """
    Exportação dos dados pessoais do titular (LGPD, art. 18): perfil,
    chamados (inclusive os removidos, que continuam ligados à pessoa),
    apoios, sinalizações, avaliações, strikes e notificações. Fica na
    auditoria — é a resposta formal a um pedido de acesso.
    """
    permission_classes = (permissions.IsAuthenticated,)
    throttle_classes = (throttles.MeusDados,)

    def get(self, request):
        from defeitos.models import Apoio, Defeito, Sinalizacao, Strike
        from notificacoes.models import Notificacao

        user = request.user
        chamados = list(
            Defeito.objects.filter(usuario=user).order_by('criado_em').values(
                'id', 'protocolo', 'titulo', 'descricao', 'categoria', 'status',
                'latitude', 'longitude', 'rua', 'bairro', 'municipio_id',
                'criado_em', 'resolvido_em', 'removido_em', 'removido_motivo',
                'avaliacao_nota', 'avaliacao_comentario', 'avaliado_em',
            )
        )
        apoios = [
            {'defeito_id': a['defeito_id'], 'protocolo': a['defeito__protocolo'],
             'titulo': a['defeito__titulo'], 'criado_em': a['criado_em']}
            for a in Apoio.objects.filter(usuario=user).order_by('criado_em').values(
                'defeito_id', 'defeito__protocolo', 'defeito__titulo', 'criado_em',
            )
        ]
        sinalizacoes = [
            {'defeito_id': s['defeito_id'], 'protocolo': s['defeito__protocolo'],
             'titulo': s['defeito__titulo'], 'tipo': s['tipo'], 'criado_em': s['criado_em']}
            for s in Sinalizacao.objects.filter(usuario=user).order_by('criado_em').values(
                'defeito_id', 'defeito__protocolo', 'defeito__titulo', 'tipo', 'criado_em',
            )
        ]
        avaliacoes = [
            {'defeito_id': c['id'], 'protocolo': c['protocolo'], 'titulo': c['titulo'],
             'nota': c['avaliacao_nota'], 'comentario': c['avaliacao_comentario'],
             'avaliado_em': c['avaliado_em']}
            for c in chamados if c['avaliacao_nota'] is not None
        ]
        strikes = list(Strike.objects.filter(usuario=user).order_by('criado_em').values('titulo', 'criado_em'))
        notificacoes = list(
            Notificacao.objects.filter(usuario_id=user.pk).order_by('criado_em').values(
                'tipo', 'titulo', 'corpo', 'defeito_id', 'lida_em', 'criado_em',
            )
        )

        auditoria.registrar(request, 'lgpd.exportacao', 'usuario', user.pk)
        resposta = Response({
            'gerado_em': timezone.now(),
            'usuario': UserSerializer(user).data,
            'chamados': chamados,
            'apoios': apoios,
            'sinalizacoes': sinalizacoes,
            'avaliacoes': avaliacoes,
            'strikes': strikes,
            'notificacoes': notificacoes,
        })
        resposta['Content-Disposition'] = 'attachment; filename="meus-dados-ciu.json"'
        return resposta


def _alvo_gerenciavel(gestor, alvo):
    """
    Se `gestor` (admin municipal+) pode mexer no papel/vínculo de `alvo`.
    Super admin: qualquer um. Admin municipal: cidadãos (recrutar para a
    equipe) e a equipe do próprio município — nunca a de outra cidade, nem
    alguém de nível acima do seu.
    """
    if permissoes.papel(gestor) == 'super_admin':
        return True
    if permissoes.nivel(alvo) > permissoes.nivel(gestor):
        return False
    if not permissoes.eh_equipe(alvo):
        return True
    return bool(gestor.municipio_id) and str(alvo.municipio_id or '') == str(gestor.municipio_id)


def _eh_super_admin(user):
    super_admin_email = getattr(settings, 'SUPER_ADMIN_EMAIL', None)
    return user.papel == 'super_admin' or bool(super_admin_email and user.email == super_admin_email)


class AdminUsersView(APIView):
    """
    Usuários que o admin da prefeitura gerencia: os do seu município (equipe
    e cidadãos que moram lá). `?email=` acha uma pessoa específica para
    trazer à equipe. O super admin vê todos. Nunca a base inteira para a
    prefeitura (LGPD).
    """
    permission_classes = (permissions.IsAuthenticated, permissoes.EhAdminMunicipal)

    def get(self, request):
        user = request.user
        qs = User.objects.order_by('nome')
        if permissoes.papel(user) != 'super_admin':
            if not user.municipio_id:
                return Response({'error': 'Operador sem município vinculado'}, status=status.HTTP_403_FORBIDDEN)
            filtro = Q(municipio_id=user.municipio_id)
            email = (request.query_params.get('email') or '').strip().lower()
            if email:
                filtro |= Q(email__iexact=email)
            qs = qs.filter(filtro)
        rows = list(qs.values_list('id', 'nome', 'email', 'papel', 'municipio_id'))
        mun_ids = list({str(r[4]) for r in rows if r[4]})
        municipios = {}
        if mun_ids:
            with connection.cursor() as cursor:
                cursor.execute(
                    'SELECT codigo::text, nome, uf_sigla FROM municipios WHERE codigo = ANY(%s)',
                    [mun_ids],
                )
                for mrow in cursor.fetchall():
                    municipios[str(mrow[0])] = {
                        'codigo': mrow[0], 'nome': mrow[1], 'uf_sigla': mrow[2],
                    }
        return Response([
            {
                'id': str(r[0]),
                'nome': r[1],
                'email': r[2],
                'papel': r[3],
                'admin': r[3] != 'cidadao',
                'super_admin': r[3] == 'super_admin',
                'municipio': municipios.get(str(r[4])) if r[4] else None,
            }
            for r in rows
        ])


class AdminToggleAdminView(APIView):
    """
    Define o papel de um usuário: `{"papel": "operador"|"gestor"|...}` ou o
    legado `{"admin": true|false}` (true = operador). Ninguém concede papel
    acima do próprio; o admin municipal traz a pessoa para o SEU município.
    """
    permission_classes = (permissions.IsAuthenticated, permissoes.EhAdminMunicipal)

    def patch(self, request, pk):
        gestor = request.user
        novo = request.data.get('papel')
        if novo is None:
            admin = request.data.get('admin')
            if admin is None or not isinstance(admin, bool):
                return Response(
                    {'error': 'Campo "admin" booleano é obrigatório'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            novo = 'operador' if admin else 'cidadao'
        if novo not in permissoes.NIVEIS:
            return Response({'error': 'Papel inválido'}, status=status.HTTP_400_BAD_REQUEST)
        alvo = User.objects.filter(pk=pk).first()
        if alvo is None:
            return Response(
                {'error': 'Usuário não encontrado'},
                status=status.HTTP_404_NOT_FOUND,
            )
        if _eh_super_admin(alvo):
            return Response(
                {'error': 'Não é possível alterar status do super admin'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if alvo.pk == gestor.pk:
            return Response({'error': 'Não é possível alterar o próprio papel'}, status=status.HTTP_400_BAD_REQUEST)
        if permissoes.NIVEIS[novo] > permissoes.nivel(gestor) or (
            novo == 'super_admin' and permissoes.papel(gestor) != 'super_admin'
        ):
            return Response({'error': 'Papel acima do seu'}, status=status.HTTP_403_FORBIDDEN)
        if not _alvo_gerenciavel(gestor, alvo):
            return Response({'error': 'Usuário de outro município'}, status=status.HTTP_403_FORBIDDEN)
        if permissoes.papel(gestor) != 'super_admin' and not gestor.municipio_id:
            return Response({'error': 'Operador sem município vinculado'}, status=status.HTTP_403_FORBIDDEN)

        antes = {'papel': alvo.papel, 'municipio_id': alvo.municipio_id}
        alvo.papel = novo
        campos = ['papel']
        if novo != 'cidadao' and permissoes.papel(gestor) != 'super_admin':
            # Quem entra na equipe entra na equipe DESTE município.
            alvo.municipio_id = gestor.municipio_id
            campos.append('municipio_id')
        alvo.save(update_fields=campos)
        auditoria.registrar(
            request, 'usuario.papel', 'usuario', alvo.pk,
            dados={'antes': antes, 'depois': {'papel': alvo.papel, 'municipio_id': alvo.municipio_id}},
        )
        msg = 'Admin removido do usuário' if novo == 'cidadao' else 'Usuário promovido a admin'
        return Response({'message': msg, 'papel': alvo.papel})


class AdminVinculateMunicipioView(APIView):
    """
    Município de operação de um usuário. O super admin vincula a qualquer
    cidade; o admin municipal só ao próprio município (ou desvincula) e só
    quem ele gerencia — senão um operador da cidade A virava da cidade B.
    """
    permission_classes = (permissions.IsAuthenticated, permissoes.EhAdminMunicipal)

    def patch(self, request, pk):
        gestor = request.user
        municipio_id = request.data.get('municipio_id')
        alvo = User.objects.filter(pk=pk).first()
        if alvo is None:
            return Response({'error': 'Usuário não encontrado'}, status=status.HTTP_404_NOT_FOUND)
        if permissoes.papel(gestor) != 'super_admin':
            if not gestor.municipio_id:
                return Response({'error': 'Operador sem município vinculado'}, status=status.HTTP_403_FORBIDDEN)
            if municipio_id is not None and str(municipio_id) != str(gestor.municipio_id):
                return Response(
                    {'error': 'Só é possível vincular ao seu município'},
                    status=status.HTTP_403_FORBIDDEN,
                )
            if not _alvo_gerenciavel(gestor, alvo) or _eh_super_admin(alvo):
                return Response({'error': 'Usuário de outro município'}, status=status.HTTP_403_FORBIDDEN)
        with connection.cursor() as cursor:
            if municipio_id is not None:
                cursor.execute(
                    'SELECT codigo FROM municipios WHERE codigo = %s',
                    [municipio_id],
                )
                if not cursor.fetchone():
                    return Response(
                        {'error': 'Município não encontrado'},
                        status=status.HTTP_404_NOT_FOUND,
                    )
        antes = alvo.municipio_id
        alvo.municipio_id = municipio_id
        alvo.save(update_fields=['municipio_id'])
        auditoria.registrar(
            request, 'usuario.municipio', 'usuario', alvo.pk,
            dados={'antes': antes, 'depois': municipio_id},
        )
        return Response({'message': 'Município atualizado com sucesso'})


# Removidos (soft delete) não contam em indicador nenhum: o chamado apagado
# como "não existe" ou por moderação inflaria o total e a fila.
ATIVOS = '(SELECT * FROM defeitos WHERE removido_em IS NULL)'


class AdminEstatisticasView(APIView):
    permission_classes = (permissions.IsAuthenticated,)

    def get(self, request):
        # BI é de gestor+ (contrato, seção 3), sempre da cidade dele, pelo
        # município em que o chamado caiu (d.municipio_id), não pelo do autor.
        # Só o super admin sem vínculo vê o agregado geral — antes bastava
        # desvincular um operador para ele enxergar todas as prefeituras.
        user = request.user
        if not permissoes.pode_gerir(user, user.municipio_id) or (
            not user.municipio_id and permissoes.papel(user) != 'super_admin'
        ):
            return Response(
                {'error': 'Acesso negado'},
                status=status.HTTP_403_FORBIDDEN,
            )
        is_mun_admin = bool(user.municipio_id)
        mun_join = ''
        mun_where = ' WHERE d.municipio_id = %s' if is_mun_admin else ''
        mun_where_and = ' WHERE d.municipio_id = %s AND' if is_mun_admin else ' WHERE'
        mun_params = [user.municipio_id] if is_mun_admin else []
        from_clause = f'FROM {ATIVOS} d' + (mun_where if is_mun_admin else ' WHERE 1=1')

        with connection.cursor() as cursor:
            cursor.execute(f'SELECT COUNT(*) {from_clause}', mun_params)
            total = cursor.fetchone()[0]

            cursor.execute(f'''
                SELECT COALESCE(d.categoria, 'sem_categoria') as categoria, COUNT(*) as total
                {from_clause} GROUP BY d.categoria ORDER BY total DESC
            ''', mun_params)
            por_categoria = [{'categoria': r[0], 'total': r[1]} for r in cursor.fetchall()]

            cursor.execute(f'SELECT d.status, COUNT(*) as total {from_clause} GROUP BY d.status', mun_params)
            por_status = [{'status': r[0], 'total': r[1]} for r in cursor.fetchall()]

            pendentes_status = ['pendente', 'em_analise', 'agendado', 'em_andamento']
            resolvidos_status = ['concluido']
            pendentes = sum(s['total'] for s in por_status if s['status'] in pendentes_status)
            resolvidos = sum(s['total'] for s in por_status if s['status'] in resolvidos_status)
            resolucao_rate = min(round((resolvidos / total) * 100), 100) if total > 0 else 0

            sla_join = ' WHERE d.status = %s' + (' AND d.municipio_id = %s' if is_mun_admin else '')
            sla_params = ['concluido'] + (mun_params if is_mun_admin else [])
            cursor.execute(f'''
                SELECT AVG(
                    EXTRACT(EPOCH FROM (COALESCE(d.resolvido_em::timestamp, NULLIF(d.atendido_em, '')::timestamp, d.atualizado_em::timestamp) - d.criado_em::timestamp)) / 60
                ) FROM {ATIVOS} d{sla_join}
            ''', sla_params)
            sla = cursor.fetchone()[0]
            sla_medio = round(sla) if sla else 0

            now = timezone.now()
            mes_inicio = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            mes_anterior_inicio = (mes_inicio - timedelta(days=1)).replace(day=1)
            mes_anterior_fim = mes_inicio

            cursor.execute(
                f'SELECT COUNT(*) {from_clause} AND d.criado_em::timestamp >= %s' if is_mun_admin else f'SELECT COUNT(*) FROM {ATIVOS} WHERE criado_em::timestamp >= %s',
                (mun_params + [mes_inicio.isoformat()]) if is_mun_admin else [mes_inicio.isoformat()],
            )
            mes_atual_count = cursor.fetchone()[0]
            cursor.execute(
                f'SELECT COUNT(*) {from_clause} AND d.criado_em::timestamp >= %s AND d.criado_em::timestamp < %s' if is_mun_admin else f'SELECT COUNT(*) FROM {ATIVOS} WHERE criado_em::timestamp >= %s AND criado_em::timestamp < %s',
                (mun_params + [mes_anterior_inicio.isoformat(), mes_anterior_fim.isoformat()]) if is_mun_admin else [mes_anterior_inicio.isoformat(), mes_anterior_fim.isoformat()],
            )
            mes_anterior_count = cursor.fetchone()[0]
            variacao_percentual = round(((mes_atual_count - mes_anterior_count) / mes_anterior_count) * 100) if mes_anterior_count > 0 else 0

            cutoff_90d = (now - timedelta(days=90)).isoformat()
            cursor.execute(f'''
                SELECT MAX(d.latitude) as latitude, MAX(d.longitude) as longitude,
                       MAX(d.categoria) as categoria, MAX(d.rua) as rua, MAX(d.bairro) as bairro,
                       COUNT(*) as total
                FROM {ATIVOS} d{mun_join}
                {mun_where_and} d.criado_em::timestamp >= %s AND d.latitude IS NOT NULL AND d.longitude IS NOT NULL
                GROUP BY ROUND(d.latitude::numeric, 3), ROUND(d.longitude::numeric, 3)
                HAVING COUNT(*) >= 2
                ORDER BY total DESC
                LIMIT 10
            ''', mun_params + [cutoff_90d])
            recorrencias = [{
                'latitude': float(r[0]), 'longitude': float(r[1]),
                'categoria': r[2] or 'sem_categoria',
                'rua': r[3], 'bairro': r[4],
                'total': r[5],
                'label': r[3] or f'±{abs(float(r[0])):.3f}, {abs(float(r[1])):.3f}',
            } for r in cursor.fetchall()]

            cat_sql = f'SELECT COALESCE(d.categoria, \'sem_categoria\'), COUNT(*) {from_clause}'
            cursor.execute(
                cat_sql + ' AND d.criado_em::timestamp >= %s GROUP BY d.categoria' if is_mun_admin else cat_sql + ' AND d.criado_em::timestamp >= %s GROUP BY d.categoria',
                (mun_params + [mes_inicio.isoformat()]) if is_mun_admin else [mes_inicio.isoformat()],
            )
            cat_atual = {r[0]: r[1] for r in cursor.fetchall()}

            cursor.execute(
                cat_sql + ' AND d.criado_em::timestamp >= %s AND d.criado_em::timestamp < %s GROUP BY d.categoria' if is_mun_admin else cat_sql + ' AND d.criado_em::timestamp >= %s AND d.criado_em::timestamp < %s GROUP BY d.categoria',
                (mun_params + [mes_anterior_inicio.isoformat(), mes_anterior_fim.isoformat()]) if is_mun_admin else [mes_anterior_inicio.isoformat(), mes_anterior_fim.isoformat()],
            )
            cat_anterior = {r[0]: r[1] for r in cursor.fetchall()}

            categorias_crescimento = []
            for c in por_categoria:
                atual = cat_atual.get(c['categoria'], 0)
                anterior = cat_anterior.get(c['categoria'], 0)
                categorias_crescimento.append({
                    'categoria': c['categoria'],
                    'total': c['total'],
                    'mes_atual': atual,
                    'mes_anterior': anterior,
                    'variacao': round(((atual - anterior) / anterior) * 100) if anterior > 0 else None,
                })

            tendencia_mensal = []
            ref = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            for i in range(11, -1, -1):
                m = ref.month - i
                y = ref.year
                while m < 1:
                    m += 12
                    y -= 1
                inicio = ref.replace(year=y, month=m, day=1)
                fim = (inicio + timedelta(days=32)).replace(day=1)
                cursor.execute(
                    f'SELECT COUNT(*) {from_clause} AND d.criado_em::timestamp >= %s AND d.criado_em::timestamp < %s' if is_mun_admin else f'SELECT COUNT(*) FROM {ATIVOS} WHERE criado_em::timestamp >= %s AND criado_em::timestamp < %s',
                    (mun_params + [inicio.isoformat(), fim.isoformat()]) if is_mun_admin else [inicio.isoformat(), fim.isoformat()],
                )
                total_mes = cursor.fetchone()[0]
                mes_nome = inicio.strftime('%b')
                tendencia_mensal.append({
                    'mes': mes_nome, 'ano': str(inicio.year), 'total': total_mes,
                })

            cursor.execute(f'''
                SELECT COALESCE(d.categoria, 'sem_categoria'),
                    AVG(EXTRACT(EPOCH FROM (COALESCE(d.resolvido_em::timestamp, NULLIF(d.atendido_em, '')::timestamp, d.atualizado_em::timestamp) - d.criado_em::timestamp)) / 60),
                    COUNT(*)
                FROM {ATIVOS} d
                WHERE d.status = 'concluido'{' AND d.municipio_id = %s' if is_mun_admin else ''}
                GROUP BY d.categoria
                ORDER BY 2 DESC
            ''', mun_params)
            sla_por_categoria = [{
                'categoria': r[0],
                'sla_medio_minutos': round(r[1]) if r[1] else 0,
                'total_resolvidos': r[2],
            } for r in cursor.fetchall()]

            resolvidos_status_sql = "('concluido','rejeitado')"
            now_iso = timezone.now().isoformat()
            sla_vencidos_total = 0
            sla_vencidos = []
            cursor.execute(f'''
                SELECT COUNT(*)
                FROM {ATIVOS} d{mun_join}
                {mun_where_and} d.status NOT IN {resolvidos_status_sql}
                  AND d.prazo_sla_dias > 0
                  AND d.criado_em::timestamp + (d.prazo_sla_dias || ' days')::interval < %s
            ''', mun_params + [now_iso])
            sla_vencidos_total = cursor.fetchone()[0]
            cursor.execute(f'''
                SELECT d.id, d.titulo, d.categoria, d.status,
                       d.criado_em::timestamp, d.prazo_sla_dias
                FROM {ATIVOS} d{mun_join}
                {mun_where_and} d.status NOT IN {resolvidos_status_sql}
                  AND d.prazo_sla_dias > 0
                  AND d.criado_em::timestamp + (d.prazo_sla_dias || ' days')::interval < %s
                ORDER BY d.criado_em::timestamp ASC
                LIMIT 50
            ''', mun_params + [now_iso])
            sla_vencidos = [{
                'id': str(r[0]), 'titulo': r[1], 'categoria': r[2],
                'status': r[3], 'criado_em': r[4].isoformat(),
                'prazo_sla_dias': r[5],
            } for r in cursor.fetchall()]

            cursor.execute(f'''
                SELECT d.bairro, COUNT(*),
                    SUM(CASE WHEN d.status = 'concluido' THEN 1 ELSE 0 END)
                FROM {ATIVOS} d{mun_join}
                {mun_where_and} d.bairro IS NOT NULL AND d.bairro != ''
                GROUP BY d.bairro ORDER BY COUNT(*) DESC LIMIT 10
            ''', mun_params)
            top_bairros = [{
                'bairro': r[0], 'total': r[1],
                'resolvidos': r[2],
                'taxa_resolucao': round((r[2] / r[1]) * 100) if r[1] > 0 else 0,
            } for r in cursor.fetchall()]

            hoje = timezone.now()
            inicio_semana = hoje - timedelta(days=hoje.weekday())
            inicio_semana = inicio_semana.replace(hour=0, minute=0, second=0, microsecond=0)
            fim_semana = inicio_semana + timedelta(days=7)

            cursor.execute(
                f'SELECT COUNT(*) {from_clause} AND d.criado_em::timestamp >= %s AND d.criado_em::timestamp < %s' if is_mun_admin else f'SELECT COUNT(*) FROM {ATIVOS} WHERE criado_em::timestamp >= %s AND criado_em::timestamp < %s',
                (mun_params + [inicio_semana.isoformat(), fim_semana.isoformat()]) if is_mun_admin else [inicio_semana.isoformat(), fim_semana.isoformat()],
            )
            total_semana_atual = cursor.fetchone()[0]

            semanas_anteriores = []
            for i in range(1, 5):
                s_inicio = inicio_semana - timedelta(weeks=i)
                s_fim = s_inicio + timedelta(days=7)
                cursor.execute(
                    f'SELECT COUNT(*) {from_clause} AND d.criado_em::timestamp >= %s AND d.criado_em::timestamp < %s' if is_mun_admin else f'SELECT COUNT(*) FROM {ATIVOS} WHERE criado_em::timestamp >= %s AND criado_em::timestamp < %s',
                    (mun_params + [s_inicio.isoformat(), s_fim.isoformat()]) if is_mun_admin else [s_inicio.isoformat(), s_fim.isoformat()],
                )
                semanas_anteriores.append(cursor.fetchone()[0])

            media_4_semanas = round(sum(semanas_anteriores) / len(semanas_anteriores)) if semanas_anteriores else 0
            variacao_semanal = round(((total_semana_atual - media_4_semanas) / media_4_semanas) * 100) if media_4_semanas > 0 else None

            cursor.execute(f'''
                SELECT d.bairro, COUNT(*) as total_mes
                FROM {ATIVOS} d{mun_join}
                {mun_where_and} d.bairro IS NOT NULL AND d.bairro != '' AND d.criado_em::timestamp >= %s
                GROUP BY d.bairro
                ORDER BY total_mes DESC
            ''', mun_params + [mes_inicio.isoformat()])
            bairros_historico = cursor.fetchall()

            anomalias = []
            for b in bairros_historico:
                cursor.execute(f'''
                    SELECT TO_CHAR(d.criado_em::timestamp, 'YYYY-MM'), COUNT(*)
                    FROM {ATIVOS} d{mun_join}
                    {mun_where_and} d.bairro = %s AND d.criado_em::timestamp < %s
                    GROUP BY 1
                ''', mun_params + [b[0], mes_inicio.isoformat()])
                meses_hist = cursor.fetchall()
                if len(meses_hist) >= 3:
                    counts = [m[1] for m in meses_hist]
                    media = sum(counts) / len(counts)
                    variancia = sum((c - media) ** 2 for c in counts) / len(counts)
                    stddev = variancia ** 0.5
                    total_mes = b[1]
                    z_score = (total_mes - media) / stddev if stddev > 0 else 0
                    if z_score > 2 and total_mes >= 3:
                        anomalias.append({
                            'bairro': b[0],
                            'total_mes': total_mes,
                            'media_historica': round(media * 10) / 10,
                            'z_score': round(z_score * 100) / 100,
                            'intensidade': 'alta' if z_score > 3 else 'media',
                        })
            anomalias.sort(key=lambda x: x['z_score'], reverse=True)

            recomendacoes = []
            categorias_recape = ['Buraco', 'Mobilidade']
            for r in recorrencias:
                if r['categoria'] in categorias_recape and r['total'] >= 3:
                    recomendacoes.append({
                        'tipo': 'recapeamento',
                        'local': r['rua'] or f'±{abs(r["latitude"]):.3f}, {abs(r["longitude"]):.3f}',
                        'bairro': r['bairro'],
                        'categoria': r['categoria'],
                        'ocorrencias': r['total'],
                        'sugestao': f'{r["total"]}x chamados de "{r["categoria"]}" no mesmo local. Avaliar recapeamento total da via.',
                        'impacto': 'alta',
                    })
            for c in categorias_crescimento:
                if c['variacao'] is not None and c['variacao'] > 30 and c['mes_atual'] >= 3:
                    recomendacoes.append({
                        'tipo': 'sazonalidade',
                        'local': None,
                        'bairro': None,
                        'categoria': c['categoria'],
                        'ocorrencias': c['mes_atual'],
                        'sugestao': f'Aumento de {c["variacao"]}% em "{c["categoria"]}". Reforçar equipe preventiva.',
                        'impacto': 'alta' if c['variacao'] > 60 else 'media',
                    })
            for b in top_bairros[:3]:
                if b['taxa_resolucao'] < 50 and b['total'] >= 3:
                    recomendacoes.append({
                        'tipo': 'bairro_critico',
                        'local': b['bairro'],
                        'bairro': b['bairro'],
                        'categoria': None,
                        'ocorrencias': b['total'],
                        'sugestao': f'Bairro "{b["bairro"]}" tem {b["total"]} chamados com apenas {b["taxa_resolucao"]}% resolvidos. Priorizar atendimento na região.',
                        'impacto': 'media',
                    })

        return Response({
            'total': total,
            'por_categoria': categorias_crescimento,
            'por_status': por_status,
            'pendentes': pendentes,
            'resolvidos': resolvidos,
            'taxa_resolucao': resolucao_rate,
            'sla_medio_minutos': sla_medio,
            'sazonalidade': {
                'mes_atual': mes_atual_count,
                'mes_anterior': mes_anterior_count,
                'variacao_percentual': variacao_percentual,
            },
            'recorrencias': recorrencias,
            'tendencia_mensal': tendencia_mensal,
            'sla_por_categoria': sla_por_categoria,
            'sla_vencidos_total': sla_vencidos_total,
            'sla_vencidos': sla_vencidos,
            'top_bairros': top_bairros,
            'recomendacoes': recomendacoes,
            'medias_moveis': {
                'semana_atual': total_semana_atual,
                'media_4_semanas': media_4_semanas,
                'variacao_percentual': variacao_semanal,
                'semanas_anteriores': semanas_anteriores,
            },
            'anomalias': anomalias,
        })


class SubscribeView(APIView):
    permission_classes = (permissions.IsAuthenticated,)

    def post(self, request):
        sub_data = request.data.get('subscription')
        if not sub_data:
            return Response(
                {'error': 'subscription is required'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        PushSubscription.objects.update_or_create(
            usuario=request.user,
            defaults={
                'endpoint': sub_data.get('endpoint', ''),
                'p256dh': sub_data.get('keys', {}).get('p256dh', ''),
                'auth': sub_data.get('keys', {}).get('auth', ''),
            },
        )
        return Response({'message': 'Subscribed'}, status=status.HTTP_201_CREATED)

    def delete(self, request):
        endpoint = request.data.get('endpoint')
        qs = PushSubscription.objects.filter(usuario=request.user)
        if endpoint:
            qs = qs.filter(endpoint=endpoint)
        count, _ = qs.delete()
        return Response({'deleted': count})


class PublicKeyView(APIView):
    permission_classes = (permissions.AllowAny,)

    def get(self, request):
        key = settings.VAPID_PUBLIC_KEY
        if not key:
            return Response(
                {'error': 'VAPID not configured'},
                status=status.HTTP_501_NOT_IMPLEMENTED,
            )
        return Response({'publicKey': key})
