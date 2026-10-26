<h1 align="center">Central de Inteligência Urbana — Urban Intelligence Center</h1>

<p align="center">
  <a href="../README.md">🇧🇷 Português</a> · <a href="#english">🇺🇸 English</a>
</p>

<a id="english"></a>

## Project Description

Urban Intelligence Center is a platform for reporting and managing urban
infrastructure issues (potholes, broken lighting, damaged sidewalks, fallen
trees, etc.). Citizens submit a photo + GPS report, AI classifies and
prioritizes it, the city crew executes, and management tracks deadlines and
results.

**Deployed at:** [tcc.josemurilors.com.br](https://tcc.josemurilors.com.br) —
Hetzner (Nuremberg) ARM64, behind a Cloudflare Tunnel.

**Stack:** Expo/React Native (Android, iOS and web) · Django 5.2/DRF ·
PostgreSQL 16/PostGIS 3.4 · ONNX Runtime (FastAPI) · Redis

> **Requirements:** Node.js ≥ 22 (Expo SDK 57) · Python 3.12–3.14 (the Docker
> image uses `python:3.13-slim`) · Docker + Compose v2 · GDAL on the host only
> to run Django outside Docker · `uv` optional for recreating `.venv`.

## Project Status

🚧 In production, in continuous use. The Django backend is the official
backend; the app in [`mobile/`](../mobile/) is the only client: the same
code builds the Android/iOS app and the website (Expo web build served by nginx). New features keep shipping
incrementally.

## Features

- **Citizen report:** photo + GPS + category with AI classification (7
  categories), spam detection and dedup (50 m radius + cosine ≥ 0.75)
- **Routing and priority:** category → responsible municipal secretary;
  keyword-based priority; cluster alert (5+ of the same type in 7 days)
- **v3 service flow:** protocol number, timeline, SLA, reopening, rating,
  before/after evidence (details in
  [`contrato-v3.md`](arquitetura/contrato-v3.md))
- **Maps:** heatmap, clusters with batch actions, city perimeter validated
  with PostGIS (`ST_Within` + ~1 km border tolerance)
- **Dashboards:** admin with KPIs and CSV export (web); full per-audience BI
  in the app's **Painel** tab
- **Support and signaling:** upvotes, "already resolved"/"doesn't exist",
  gamification (level, XP and city ranking)
- **Moderation:** anti-spam quarantine by strikes, implausible-report
  rejection, Gaussian blur on uploaded photos (privacy)
- **Accounts:** e-mail-only entry (verification code), Google sign-in,
  optional TOTP 2FA, e-mail verification, hierarchical user management
- **Notifications:** Expo Push in the installed app and the in-app center on
  every platform (no browser push on the website yet)
- **Platform:** one app for Android, iOS and web (installable as a PWA),
  light/dark theme, WCAG AA contrast checked by a script, layout that adapts
  from phone to desktop

### Demo

**[tcc.josemurilors.com.br](https://tcc.josemurilors.com.br)**

## Platform v3

v3 turns the Center into an urban-maintenance product for city halls (B2G):
the citizen reports, the field team executes, management tracks deadlines and
results, and the city publishes the numbers. The v3 client is the app in
[`mobile/`](../mobile/) (iOS, Android and web); the shared vocabulary, schema
and API live in [`docs/arquitetura/contrato-v3.md`](arquitetura/contrato-v3.md).

### What the product does, by audience

- `Citizen`: opens a ticket with photo and GPS and gets a **protocol**
  (`YYYY-NNNNNN`); follows the timeline (Received → Under review → Scheduled →
  In progress → Resolved / Rejected) by protocol, without login; supports,
  signals, rates (1–5), reopens within 30 days and exports their own data
  (LGPD).
- `Operations`: queue prioritized by deadline and support, claim tickets,
  change status, internal notes, public reply, evidence photos and checklist.
  Works offline: actions queue up and are replayed with `Idempotency-Key`.
- `Management`: city BI (SLA, P50/P90 lead time, CSAT, aging, hotspots,
  productivity) with drill-down and export; administers secretariats, teams,
  categories, SLA, moderation and audit.

### Roles

Each public servant acts in **one** municipality (`users.municipio_id`). Rules
in `backend-python/core/permissoes.py`.

| Role              | Can                                                                      |
| ----------------- | ------------------------------------------------------------------------ |
| `cidadao`         | Report, support, signal, rate, reopen own ticket (30 days)                |
| `operador`        | Queue, claim, change status, notes, public reply, evidence                |
| `gestor`          | + reject, duplicate, reopen, assign, SLA, BI, exports, moderation         |
| `admin_municipal` | + team and roles, secretariats, categories, settings, audit               |
| `super_admin`     | Manages any municipality (`?municipio=`); operates only in their own       |

### Transparency and open data

No login, no personal data:

- `GET /api/v1/transparencia/<ibge_code>/` — indicators of the last 90 days
- `GET /api/v1/dados-abertos/<ibge_code>/chamados.csv` and `.geojson`
- Open311 GeoReport v2 (read): `/api/v1/open311/v2/services.json` and `requests.json`

### Notifications and scheduler

Every relevant event becomes an in-app notice and a push (Expo Push; env
vars `EXPO_PUSH_ENABLED` / `EXPO_ACCESS_TOKEN`). The `scheduler` service in
the composes runs `entrypoint.sh agendador` in the `America/Sao_Paulo`
timezone: `alertas_sla` hourly and `resumo_semanal` on Mondays from 8h. No
command repeats a notice, so restarting or running them by hand is safe.

```bash
docker compose up -d scheduler                 # production (comes up with up -d)
docker compose exec backend python manage.py alertas_sla --dry-run
```

### Demo municipality (`seed_demo`)

Generates a realistic city for sales and BI: fictional citizens, teams and
tickets that go through the real lifecycle, with coherent backdated
timestamps. All demo data uses `@demo.ciu` e-mails. Re-running replaces the
previous demo; `--limpar-demo` deletes only the demo.

```bash
scripts/seed-demo.sh                                  # DEV: São Paulo, 600 tickets, 180 days
scripts/seed-demo.sh --municipio 3509502 --chamados 300 --dias 90
docker compose exec backend python manage.py seed_demo --municipio 3550308
```

### Backend tests

`scripts/test-backend.sh` runs pytest in an ephemeral container with its own
test database (`test_<suffix>`), so parallel runs (worktrees, agents) don't
collide. Requires the dev stack up.

```bash
scripts/test-backend.sh                                   # whole suite
scripts/test-backend.sh -k transicao                      # by name
```

## Project Access

### Quick Start (Development)

```bash
git clone git@github.com:josemurilors/tcc-manutencao-urbana.git
cd tcc-manutencao-urbana

cp .env.example backend-python/.env
# Edit backend-python/.env: ENCRYPTION_KEY, DB_PASSWORD, etc.

docker compose -f docker-compose.dev.yml up -d backend redis   # pulls postgres (PostGIS) along
docker compose -f docker-compose.dev.yml exec backend python manage.py migrate
docker compose -f docker-compose.dev.yml --profile ia up -d ia # (optional) IA service

cd mobile && npm install && npm run web   # site and app at http://localhost:8081
```

### Quick Start (Production)

```bash
git clone git@github.com:josemurilors/tcc-manutencao-urbana.git
cd tcc-manutencao-urbana

cp .env.example .env
# Edit .env with production secrets (compose reads the variables from the root)

docker compose up -d --build

# PostGIS (extension + geometries), first time:
docker compose exec -T postgres psql -U urbana -d manutencao_urbana \
  -c "CREATE EXTENSION IF NOT EXISTS postgis;"
docker compose exec -T postgres psql -U urbana -d manutencao_urbana -c "
  ALTER TABLE municipios ADD COLUMN IF NOT EXISTS polygon_geom geometry(MultiPolygon, 4326);
  CREATE INDEX IF NOT EXISTS idx_municipios_polygon_geom ON municipios USING GIST (polygon_geom);
  ALTER TABLE defeitos ADD COLUMN IF NOT EXISTS geom geometry(Point, 4326)
    GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)) STORED;
  CREATE INDEX IF NOT EXISTS idx_defeitos_geom ON defeitos USING GIST (geom);"
```

Traffic enters exclusively via the **Cloudflare Tunnel** (`cloudflared`,
`tcc_tunnel`); VPS ports 80/443 stay closed at the cloud firewall. nginx uses
the origin certificate in `./cloudflare/` (`cert.pem` + `key.pem`).

```bash
curl https://tcc.josemurilors.com.br/api/v1/health/
```

### Mobile App (Expo)

The iOS/Android/web app lives in [`mobile/`](../mobile/) and consumes the same
API.

```bash
cd mobile && npm install && npm start   # QR code with Expo Go
```

Setup details and limitations: [`mobile/README.md`](../mobile/README.md).

## Architecture

Stack, deploy pipeline and service-request sequence diagrams:
[`docs/arquitetura/diagramas.md`](arquitetura/diagramas.md).

| Layer | Stack |
|---|---|
| App and website | Expo SDK 57 + React Native 0.86 + Expo Router + react-native-maps (Leaflet on web) |
| Backend | Django 5.2 + DRF (Gunicorn) + Redis |
| Database | PostgreSQL 16 + PostGIS 3.4 |
| IA | FastAPI + ONNX Runtime — paraphrase-multilingual-MiniLM-L12-v2 |
| Auth | simplejwt + BCrypt + Google sign-in |
| Edge | Cloudflare (WAF/TLS) + Tunnel → nginx → backend |

nginx serves the SPA build and reverse-proxies `/api/*` and `/uploads` to
Django; the IA service runs alongside (profile `ia`), consumed by the backend;
scheduler and backup (own profiles) use the backend image. CI/CD: GitHub
Actions (`.github/workflows/deploy.yml`) — gitleaks, build, tests, deploy over
SSH and health check. Backup: daily Postgres dump with 30-day retention and
optional rclone upload (`scripts/backup-postgres.sh`).

## API

The contract between app, backend and docs lives in
[`docs/arquitetura/contrato-v3.md`](arquitetura/contrato-v3.md) — the single
source of routes, schemas and vocabulary. Prefixes under `/api/v1/`:

| Prefix | Contents |
|---|---|
| `auth/` | e-mail entry, Google, profile, push (VAPID) |
| `defeitos/` | tickets: create, list, support, signal, protocol, operations |
| `operacao/` `bi/` `gestao/` `notificacoes/` | field queue, BI, administration, notices |
| `transparencia/` `dados-abertos/` `open311/` | public pages and open data |
| `municipios/` `categorias/` | lookups (IBGE, categories with SLA) |
| `health/` `csrf-token/` | health check (200 when the API is up) and CSRF token |

## Security

- Bcrypt passwords; JWT (simplejwt) with refresh rotation; optional TOTP 2FA
- CPF encrypted at rest (AES-256-GCM) + HMAC for unique lookup
- DRF `IsAuthenticated` by default; public endpoints use explicit `AllowAny`;
  CSRF `SameSite=Strict`; Redis-backed rate limiting
- Uploads: JPEG/PNG/WebP/AVIF whitelist, max 5 MB, WebP ≤ 1200 px, Gaussian
  privacy blur
- Non-root Django container (uid 1001); HSTS and `SECURE_SSL_REDIRECT` in prod
- Secrets only via env vars (`ENCRYPTION_KEY`, `RESEND_API_KEY`,
  `GOOGLE_CLIENT_ID_*`, VAPID), never in code

## AI & Geospatial

- **Classification:** multilingual ONNX embeddings (MiniLM-L12-v2, 384-dim) →
  7 centroids → softmax; keyword fallback if the service is down. Spam,
  duplicates, priority and routing handled in the backend. Pipeline details:
  [`ia/README.md`](../ia/README.md); experiment metrics:
  [`ia/experimentos/RELATORIO_ACADEMICO.md`](../ia/experimentos/RELATORIO_ACADEMICO.md)
- **Circuit breaker:** 3 IA failures → 60 s cooldown; never blocks a report
- **PostGIS:** `municipios.polygon_geom` (IBGE MultiPolygon, 5570 municipalities)
  and `defeitos.geom` generated by a Django migration; perimeter validation
  with `ST_Within` plus tolerance buffer

## Contributors

| User | Contributions |
|---|---|
| [caiocinel](https://github.com/caiocinel) | Mobile app (Expo), Google sign-in and e-mail-only entry, citizen signaling and quarantine, long-press/right-click ticket creation, operations app, smart routing |

## Authors

| Photo | Name | Link |
|---|---|---|
| <img src="https://github.com/josemurilors.png" width=115 alt="José Murilo Rodrigues Sabalo"> | José Murilo Rodrigues Sabalo | [GitHub profile](https://github.com/josemurilors) |
| <img src="https://github.com/caiocinel.png" width=115 alt="caiocinel"> | caiocinel | [GitHub profile](https://github.com/caiocinel) |

Other TCC group members will be added here later.

## License

MIT — full text in [`LICENSE`](../LICENSE).
