#!/usr/bin/env bash
# Roda a suíte do backend num container efêmero, com banco de teste próprio.
# Permite várias execuções em paralelo (worktrees diferentes) sem uma pisar na
# outra. Requer a stack dev no ar (postgres na rede tcc-manutencao-urbana_app-network).
#
# Uso: scripts/test-backend.sh [-k expr | caminho::teste ...]
#   BACKEND_DIR=<pasta backend-python> (padrão: a do repositório do script)
#   TEST_DB_SUFFIX=<nome> (padrão: derivado da pasta)
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${BACKEND_DIR:-$RAIZ/backend-python}"
SUFIXO="${TEST_DB_SUFFIX:-$(basename "$(dirname "$DIR")" | tr -c 'a-zA-Z0-9\n' '_' | tr 'A-Z' 'a-z')}"
# Em worktrees o .env (ignorado pelo git) só existe no checkout principal.
PRINCIPAL="$(cd "$(git -C "$RAIZ" rev-parse --path-format=absolute --git-common-dir)/.." && pwd)"
SENHA=""
for ENV in "$RAIZ/.env" "$PRINCIPAL/.env" "$DIR/.env"; do
  [ -f "$ENV" ] && SENHA="$(grep -E '^DB_PASSWORD=' "$ENV" | head -1 | cut -d= -f2- || true)"
  [ -n "$SENHA" ] && break
done
# Git Bash no Windows: converte o caminho para o formato do Docker.
MONTAGEM="$DIR"
command -v cygpath >/dev/null && MONTAGEM="$(cygpath -w "$DIR")"
MSYS_NO_PATHCONV=1 docker run --rm \
  --network tcc-manutencao-urbana_app-network \
  -v "$MONTAGEM:/app" -w /app \
  -e DJANGO_SETTINGS_MODULE=core.settings.local \
  -e DB_HOST=postgres -e DB_USER=urbana -e DB_PASSWORD="$SENHA" \
  -e DB_TEST_NAME="test_${SUFIXO}" \
  -e JWT_SECRET=test-secret -e ENCRYPTION_KEY="${ENCRYPTION_KEY:-}" \
  --entrypoint python \
  tcc-manutencao-urbana-backend -m pytest -q -p no:cacheprovider "$@"
