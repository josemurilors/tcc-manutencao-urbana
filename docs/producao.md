# Produção — deploy, rede, agendador e backup

Detalhes de operação que saíram do README principal.

## Subir do zero

```bash
git clone git@github.com:josemurilors/tcc-manutencao-urbana.git
cd tcc-manutencao-urbana

cp .env.example .env
# Edite .env com os segredos de produção (o compose lê as variáveis da raiz)

docker compose up -d --build
```

O `up -d --build` sobe nginx (com o build web do app), backend, PostgreSQL,
Redis, o serviço de IA e o agendador. O primeiro build da IA baixa o PyTorch
(~3 GB) só para exportar o modelo ONNX; a imagem final tem ~720 MB.

PostGIS (extensão + geometrias), na primeira vez:

```bash
docker compose exec -T postgres psql -U urbana -d manutencao_urbana \
  -c "CREATE EXTENSION IF NOT EXISTS postgis;"
docker compose exec -T postgres psql -U urbana -d manutencao_urbana -c "
  ALTER TABLE municipios ADD COLUMN IF NOT EXISTS polygon_geom geometry(MultiPolygon, 4326);
  CREATE INDEX IF NOT EXISTS idx_municipios_polygon_geom ON municipios USING GIST (polygon_geom);
  ALTER TABLE defeitos ADD COLUMN IF NOT EXISTS geom geometry(Point, 4326)
    GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)) STORED;
  CREATE INDEX IF NOT EXISTS idx_defeitos_geom ON defeitos USING GIST (geom);"
```

## Rede e borda

O tráfego entra exclusivamente via **Cloudflare Tunnel** (`cloudflared`,
`tcc_tunnel`); as portas 80/443 da VPS ficam fechadas no firewall da nuvem. O
túnel fala com o nginx na porta 8080; a 443 usa o origin certificate em
`./cloudflare/` (`cert.pem` + `key.pem`). Os dois acessos são o mesmo bloco
`server` em `nginx.prod.conf`, com os mesmos cabeçalhos de segurança.

O nginx serve o build web do app (`mobile/`, `expo export --platform web`),
faz reverse-proxy de `/api/*` para o Django e redireciona os endereços do antigo
frontend React (`/lista` → `/operacao`, `/admin/dashboard` → `/painel`).

```bash
curl https://tcc.josemurilors.com.br/api/v1/health/
```

## CI/CD

`.github/workflows/deploy.yml`, a cada push na `master`: gitleaks, build das
imagens, pytest do backend, lint e typecheck do app; com tudo verde, deploy via
SSH (`git pull` + `docker compose up -d --build` + `image prune`).

## Notificações e agendador

Todo evento relevante vira aviso in-app e push (Expo Push; variáveis
`EXPO_PUSH_ENABLED` / `EXPO_ACCESS_TOKEN`). O serviço `scheduler` roda
`entrypoint.sh agendador` no fuso `America/Sao_Paulo`: `alertas_sla` de hora
em hora e `resumo_semanal` às segundas, a partir das 8h. Nenhum comando repete
aviso, então reiniciar ou rodar à mão é seguro.

```bash
docker compose up -d scheduler
docker compose exec backend python manage.py alertas_sla --dry-run
```

## Backup

Dump diário do PostgreSQL com retenção de 30 dias e upload opcional via rclone
(`scripts/backup-postgres.sh`; restauração em `scripts/restore-postgres.sh`).
