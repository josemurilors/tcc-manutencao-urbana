import secrets
from datetime import datetime, timedelta
from django.conf import settings
from django.db import connection
from django.utils import timezone
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from .serializers import RegisterSerializer, UserSerializer
from .models import User, PushSubscription
from services.email_service import send_verification_code


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
    """
    permission_classes = (permissions.AllowAny,)

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
        code = f'{secrets.randbelow(900000) + 100000}'
        user.codigo_2fa = code
        user.codigo_2fa_expira = (timezone.now() + timedelta(minutes=10)).isoformat()
        user.save(update_fields=['codigo_2fa', 'codigo_2fa_expira'])
        try:
            send_verification_code(user.email, code)
        except Exception:
            pass
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
    permission_classes = (permissions.IsAuthenticated,)

    def patch(self, request):
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
        if user.codigo_2fa_expira:
            try:
                expira = datetime.fromisoformat(user.codigo_2fa_expira.replace('Z', '+00:00'))
            except (ValueError, AttributeError):
                expira = timezone.now()
            if timezone.now() > expira:
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

    def post(self, request):
        user = request.user
        if user.email_verified:
            return Response({'message': 'Email já verificado'})
        code = f'{secrets.randbelow(900000) + 100000}'
        user.codigo_2fa = code
        user.codigo_2fa_expira = (timezone.now() + timedelta(minutes=10)).isoformat()
        user.save(update_fields=['codigo_2fa', 'codigo_2fa_expira'])
        try:
            send_verification_code(user.email, code)
        except Exception:
            pass
        return Response({'message': 'Código reenviado'})


class AdminUsersView(APIView):
    permission_classes = (permissions.IsAuthenticated,)

    def get(self, request):
        if not request.user.admin:
            return Response(
                {'error': 'Acesso negado'},
                status=status.HTTP_403_FORBIDDEN,
            )
        super_admin_email = getattr(settings, 'SUPER_ADMIN_EMAIL', None)
        with connection.cursor() as cursor:
            cursor.execute(
                'SELECT id::text, nome, email, admin, municipio_id FROM users ORDER BY nome',
            )
            rows = cursor.fetchall()
            mun_ids = list(set(str(r[4]) for r in rows if r[4]))
            municipios = {}
            if mun_ids:
                cursor.execute(
                    'SELECT codigo::text, nome, uf_sigla FROM municipios WHERE codigo = ANY(%s)',
                    [mun_ids],
                )
                for mrow in cursor.fetchall():
                    municipios[str(mrow[0])] = {
                        'codigo': mrow[0], 'nome': mrow[1], 'uf_sigla': mrow[2],
                    }
            users = []
            for r in rows:
                admin = bool(r[3])
                users.append({
                    'id': r[0],
                    'nome': r[1],
                    'email': r[2],
                    'admin': admin,
                    'super_admin': bool(super_admin_email and r[2] == super_admin_email),
                    'municipio': municipios.get(r[4]) if r[4] else None,
                })
        return Response(users)


class AdminToggleAdminView(APIView):
    permission_classes = (permissions.IsAuthenticated,)

    def patch(self, request, pk):
        if not request.user.admin:
            return Response(
                {'error': 'Acesso negado'},
                status=status.HTTP_403_FORBIDDEN,
            )
        admin = request.data.get('admin')
        if admin is None or not isinstance(admin, bool):
            return Response(
                {'error': 'Campo "admin" booleano é obrigatório'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        super_admin_email = getattr(settings, 'SUPER_ADMIN_EMAIL', None)
        with connection.cursor() as cursor:
            cursor.execute(
                'SELECT id, email FROM users WHERE id = %s',
                [pk],
            )
            row = cursor.fetchone()
            if not row:
                return Response(
                    {'error': 'Usuário não encontrado'},
                    status=status.HTTP_404_NOT_FOUND,
                )
            if super_admin_email and row[1] == super_admin_email:
                return Response(
                    {'error': 'Não é possível alterar status do super admin'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            cursor.execute(
                'UPDATE users SET admin = %s, atualizado_em = %s WHERE id = %s',
                [1 if admin else 0, timezone.now().isoformat(), pk],
            )
        msg = 'Usuário promovido a admin' if admin else 'Admin removido do usuário'
        return Response({'message': msg})


class AdminVinculateMunicipioView(APIView):
    permission_classes = (permissions.IsAuthenticated,)

    def patch(self, request, pk):
        if not request.user.admin:
            return Response(
                {'error': 'Acesso negado'},
                status=status.HTTP_403_FORBIDDEN,
            )
        municipio_id = request.data.get('municipio_id')
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
            cursor.execute(
                'UPDATE users SET municipio_id = %s, atualizado_em = %s WHERE id = %s',
                [municipio_id, timezone.now().isoformat(), pk],
            )
        return Response({'message': 'Município atualizado com sucesso'})


class AdminEstatisticasView(APIView):
    permission_classes = (permissions.IsAuthenticated,)

    def get(self, request):
        if not request.user.admin:
            return Response(
                {'error': 'Acesso negado'},
                status=status.HTTP_403_FORBIDDEN,
            )
        # Operador vinculado a um municipio ve as estatisticas da cidade dele,
        # pelo municipio em que o chamado caiu (d.municipio_id), nao pelo do
        # autor. Admin sem vinculo (gestao) ve o agregado geral.
        user = request.user
        is_mun_admin = bool(user.municipio_id)
        mun_join = ''
        mun_where = ' WHERE d.municipio_id = %s' if is_mun_admin else ''
        mun_where_and = ' WHERE d.municipio_id = %s AND' if is_mun_admin else ' WHERE'
        mun_params = [user.municipio_id] if is_mun_admin else []
        from_clause = 'FROM defeitos d' + (mun_where if is_mun_admin else ' WHERE 1=1')

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

            pendentes_status = ['pendente', 'em_andamento', 'vinculado_sem_resposta', 'vinculado_com_resposta']
            resolvidos_status = ['atendido', 'encerrado', 'concluido']
            pendentes = sum(s['total'] for s in por_status if s['status'] in pendentes_status)
            resolvidos = sum(s['total'] for s in por_status if s['status'] in resolvidos_status)
            resolucao_rate = min(round((resolvidos / total) * 100), 100) if total > 0 else 0

            sla_join = ' WHERE d.status IN (%s,%s)' + (' AND d.municipio_id = %s' if is_mun_admin else '')
            sla_params = ['atendido', 'encerrado'] + (mun_params if is_mun_admin else [])
            cursor.execute(f'''
                SELECT AVG(
                    EXTRACT(EPOCH FROM (COALESCE(d.atendido_em::timestamp, d.atualizado_em::timestamp) - d.criado_em::timestamp)) / 60
                ) FROM defeitos d{sla_join}
            ''', sla_params)
            sla = cursor.fetchone()[0]
            sla_medio = round(sla) if sla else 0

            now = timezone.now()
            mes_inicio = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            mes_anterior_inicio = (mes_inicio - timedelta(days=1)).replace(day=1)
            mes_anterior_fim = mes_inicio

            cursor.execute(
                f'SELECT COUNT(*) {from_clause} AND d.criado_em::timestamp >= %s' if is_mun_admin else 'SELECT COUNT(*) FROM defeitos WHERE criado_em::timestamp >= %s',
                (mun_params + [mes_inicio.isoformat()]) if is_mun_admin else [mes_inicio.isoformat()],
            )
            mes_atual_count = cursor.fetchone()[0]
            cursor.execute(
                f'SELECT COUNT(*) {from_clause} AND d.criado_em::timestamp >= %s AND d.criado_em::timestamp < %s' if is_mun_admin else 'SELECT COUNT(*) FROM defeitos WHERE criado_em::timestamp >= %s AND criado_em::timestamp < %s',
                (mun_params + [mes_anterior_inicio.isoformat(), mes_anterior_fim.isoformat()]) if is_mun_admin else [mes_anterior_inicio.isoformat(), mes_anterior_fim.isoformat()],
            )
            mes_anterior_count = cursor.fetchone()[0]
            variacao_percentual = round(((mes_atual_count - mes_anterior_count) / mes_anterior_count) * 100) if mes_anterior_count > 0 else 0

            cutoff_90d = (now - timedelta(days=90)).isoformat()
            cursor.execute(f'''
                SELECT MAX(d.latitude) as latitude, MAX(d.longitude) as longitude,
                       MAX(d.categoria) as categoria, MAX(d.rua) as rua, MAX(d.bairro) as bairro,
                       COUNT(*) as total
                FROM defeitos d{mun_join}
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
                    f'SELECT COUNT(*) {from_clause} AND d.criado_em::timestamp >= %s AND d.criado_em::timestamp < %s' if is_mun_admin else 'SELECT COUNT(*) FROM defeitos WHERE criado_em::timestamp >= %s AND criado_em::timestamp < %s',
                    (mun_params + [inicio.isoformat(), fim.isoformat()]) if is_mun_admin else [inicio.isoformat(), fim.isoformat()],
                )
                total_mes = cursor.fetchone()[0]
                mes_nome = inicio.strftime('%b')
                tendencia_mensal.append({
                    'mes': mes_nome, 'ano': str(inicio.year), 'total': total_mes,
                })

            cursor.execute(f'''
                SELECT COALESCE(d.categoria, 'sem_categoria'),
                    AVG(EXTRACT(EPOCH FROM (COALESCE(d.atendido_em::timestamp, d.atualizado_em::timestamp) - d.criado_em::timestamp)) / 60),
                    COUNT(*)
                FROM defeitos d
                WHERE d.status IN ('atendido', 'encerrado'){' AND d.municipio_id = %s' if is_mun_admin else ''}
                GROUP BY d.categoria
                ORDER BY 2 DESC
            ''', mun_params)
            sla_por_categoria = [{
                'categoria': r[0],
                'sla_medio_minutos': round(r[1]) if r[1] else 0,
                'total_resolvidos': r[2],
            } for r in cursor.fetchall()]

            resolvidos_status_sql = "('atendido','encerrado','concluido')"
            now_iso = timezone.now().isoformat()
            sla_vencidos_total = 0
            sla_vencidos = []
            cursor.execute(f'''
                SELECT COUNT(*)
                FROM defeitos d{mun_join}
                {mun_where_and} d.status NOT IN {resolvidos_status_sql}
                  AND d.prazo_sla_dias > 0
                  AND d.criado_em::timestamp + (d.prazo_sla_dias || ' days')::interval < %s
            ''', mun_params + [now_iso])
            sla_vencidos_total = cursor.fetchone()[0]
            cursor.execute(f'''
                SELECT d.id, d.titulo, d.categoria, d.status,
                       d.criado_em::timestamp, d.prazo_sla_dias
                FROM defeitos d{mun_join}
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
                    SUM(CASE WHEN d.status IN ('atendido','encerrado') THEN 1 ELSE 0 END)
                FROM defeitos d{mun_join}
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
                f'SELECT COUNT(*) {from_clause} AND d.criado_em::timestamp >= %s AND d.criado_em::timestamp < %s' if is_mun_admin else 'SELECT COUNT(*) FROM defeitos WHERE criado_em::timestamp >= %s AND criado_em::timestamp < %s',
                (mun_params + [inicio_semana.isoformat(), fim_semana.isoformat()]) if is_mun_admin else [inicio_semana.isoformat(), fim_semana.isoformat()],
            )
            total_semana_atual = cursor.fetchone()[0]

            semanas_anteriores = []
            for i in range(1, 5):
                s_inicio = inicio_semana - timedelta(weeks=i)
                s_fim = s_inicio + timedelta(days=7)
                cursor.execute(
                    f'SELECT COUNT(*) {from_clause} AND d.criado_em::timestamp >= %s AND d.criado_em::timestamp < %s' if is_mun_admin else 'SELECT COUNT(*) FROM defeitos WHERE criado_em::timestamp >= %s AND criado_em::timestamp < %s',
                    (mun_params + [s_inicio.isoformat(), s_fim.isoformat()]) if is_mun_admin else [s_inicio.isoformat(), s_fim.isoformat()],
                )
                semanas_anteriores.append(cursor.fetchone()[0])

            media_4_semanas = round(sum(semanas_anteriores) / len(semanas_anteriores)) if semanas_anteriores else 0
            variacao_semanal = round(((total_semana_atual - media_4_semanas) / media_4_semanas) * 100) if media_4_semanas > 0 else None

            cursor.execute(f'''
                SELECT d.bairro, COUNT(*) as total_mes
                FROM defeitos d{mun_join}
                {mun_where_and} d.bairro IS NOT NULL AND d.bairro != '' AND d.criado_em::timestamp >= %s
                GROUP BY d.bairro
                ORDER BY total_mes DESC
            ''', mun_params + [mes_inicio.isoformat()])
            bairros_historico = cursor.fetchall()

            anomalias = []
            for b in bairros_historico:
                cursor.execute(f'''
                    SELECT TO_CHAR(d.criado_em::timestamp, 'YYYY-MM'), COUNT(*)
                    FROM defeitos d{mun_join}
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
