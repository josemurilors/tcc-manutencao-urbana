#!/usr/bin/env bash
# Gera (ou limpa) o município de demonstração no banco de DEV, num container
# efêmero com a imagem do backend — sem reiniciar a stack. Requer a stack dev
# no ar (postgres na rede tcc-manutencao-urbana_app-network).
#
# Uso: scripts/seed-demo.sh [--municipio 3550308] [--chamados 600] [--dias 180]
#                           [--senha 'Demo@2026'] [--semente 42] [--limpar-demo]
#   BACKEND_DIR=<pasta backend-python> (padrão: a do repositório do script)
#   DB_NAME=<banco> (padrão: manutencao_urbana)
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${BACKEND_DIR:-$RAIZ/backend-python}"
PRINCIPAL="$(cd "$(git -C "$RAIZ" rev-parse --path-format=absolute --git-common-dir)/.." && pwd)"
SENHA=""
for ENV in "$RAIZ/.env" "$PRINCIPAL/.env" "$DIR/.env"; do
  [ -f "$ENV" ] && SENHA="$(grep -E '^DB_PASSWORD=' "$ENV" | head -1 | cut -d= -f2- || true)"
  [ -n "$SENHA" ] && break
done
MONTAGEM="$DIR"
command -v cygpath >/dev/null && MONTAGEM="$(cygpath -w "$DIR")"
MSYS_NO_PATHCONV=1 docker run --rm \
  --network tcc-manutencao-urbana_app-network \
  -v "$MONTAGEM:/app" -w /app \
  -e DJANGO_SETTINGS_MODULE=core.settings.local \
  -e DB_HOST=postgres -e DB_USER=urbana -e DB_PASSWORD="$SENHA" \
  -e DB_NAME="${DB_NAME:-manutencao_urbana}" \
  -e JWT_SECRET=seed-demo -e ENCRYPTION_KEY="${ENCRYPTION_KEY:-}" \
  --entrypoint python \
  tcc-manutencao-urbana-backend manage.py seed_demo "$@"
