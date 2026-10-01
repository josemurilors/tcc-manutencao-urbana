#!/bin/sh
set -e

# Agendador (serviço `scheduler` dos composes): mesma imagem do backend, sem
# gunicorn. Acorda na virada de cada hora (America/Sao_Paulo) e roda
# `alertas_sla`; às segundas, a partir das 8h, também `resumo_semanal`. Os dois
# comandos não repetem aviso (deduplicam no banco), então rodar de novo depois
# de um restart ou numa hora seguinte da segunda é inofensivo — o resumo sai
# uma vez por semana para cada gestor. Às 3h roda `aplicar_retencao` (prazos
# de retenção da LGPD; idempotente). Falha de um comando não derruba o loop.
if [ "$1" = "agendador" ]; then
    export TZ="${TZ:-America/Sao_Paulo}"
    echo "Agendador: aguardando PostgreSQL..."
    while ! pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" >/dev/null 2>&1; do
        sleep 2
    done
    echo "Agendador iniciado ($TZ): alertas_sla de hora em hora, resumo_semanal às segundas 8h, aplicar_retencao às 3h"
    while true; do
        # Segundos até a próxima hora cheia (+5 s de folga).
        agora_min=$(date +%M | sed 's/^0//')
        agora_seg=$(date +%S | sed 's/^0//')
        sleep $(( (59 - agora_min) * 60 + (60 - agora_seg) + 5 ))
        echo "[$(date '+%Y-%m-%d %H:%M')] alertas_sla"
        python manage.py alertas_sla 2>&1 || echo "alertas_sla falhou (código $?)"
        hora=$(date +%H | sed 's/^0//')
        if [ "$(date +%u)" = "1" ] && [ "${hora:-0}" -ge 8 ]; then
            echo "[$(date '+%Y-%m-%d %H:%M')] resumo_semanal"
            python manage.py resumo_semanal 2>&1 || echo "resumo_semanal falhou (código $?)"
        fi
        if [ "${hora:-0}" = "3" ]; then
            echo "[$(date '+%Y-%m-%d %H:%M')] aplicar_retencao"
            python manage.py aplicar_retencao 2>&1 || echo "aplicar_retencao falhou (código $?)"
        fi
    done
fi

# Se um comando explícito foi passado (ex: docker compose run --rm backend
# python -c "..."), executa-o diretamente sem o bootstrap completo (usado pelo CI).
if [ $# -gt 0 ]; then
    exec "$@"
fi

echo "Waiting for PostgreSQL..."
while ! pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" >/dev/null 2>&1; do
    sleep 1
done
echo "PostgreSQL ready"

echo "Bootstrapping database schema (managed=False tables)..."
python manage.py bootstrap_schema 2>&1

echo "Generating initial migrations (managed=False apps)..."
python manage.py makemigrations users municipios categorias --noinput 2>&1

echo "Running core migrations..."
python manage.py migrate contenttypes --noinput 2>&1
python manage.py migrate auth --noinput 2>&1
python manage.py migrate sessions --noinput 2>&1
python manage.py migrate admin --noinput 2>&1

echo "Running app migrations (faking managed=False)..."
python manage.py migrate users --fake --noinput 2>&1
python manage.py migrate municipios --fake --noinput 2>&1
python manage.py migrate categorias --fake --noinput 2>&1
python manage.py migrate defeitos --fake --noinput 2>&1

echo "Ensuring super admin exists..."
python - <<'PYEOF' 2>&1
import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings.production')
django.setup()

from users.models import User

email = os.environ.get('SUPER_ADMIN_EMAIL', '').strip().lower()
if not email:
    print('SUPER_ADMIN_EMAIL not set; skipping')
    raise SystemExit(0)

password = os.environ.get('SUPER_ADMIN_PASSWORD', '')
if not password:
    print('SUPER_ADMIN_PASSWORD not set; skipping super admin creation')
    raise SystemExit(0)
if not User.objects.filter(email__iexact=email).exists():
    user = User(
        email=email,
        nome='Administrador',
        admin=1,
        email_verified=1,
    )
    user.set_password(password)
    user.save()
    print(f'Super admin criado: {email}')
else:
    print(f'Super admin já existe: {email}')
PYEOF

echo "Collecting static files..."
python manage.py collectstatic --noinput --clear

echo "Starting gunicorn..."
exec gunicorn core.wsgi:application \
    --bind 0.0.0.0:8000 \
    --workers 2 \
    --threads 2 \
    --worker-class gthread \
    --max-requests 1000 \
    --max-requests-jitter 100 \
    --timeout 120 \
    --access-logfile - \
    --error-logfile - \
    --log-level info