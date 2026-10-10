## 🇺🇸 English

## Index

- [Project Description](#project-description)
- [Project Status](#project-status)
- [Features and Application Demo](#features-and-application-demo)
- [Project Access](#project-access)
- [Mobile App (Expo)](#mobile-app-expo)
- [Technologies Used](#technologies-used)
- [Architecture](#architecture)
- [API Endpoints](#api-endpoints)
- [Security](#security)
- [PostGIS & Geospatial](#postgis--geospatial)
- [AI Classification Pipeline](#ai-classification-pipeline)
- [Technical Appendix](#technical-appendix)
- [Contributors](#contributors)
- [Authors](#authors)
- [License](#license)

## Project Description

Central de Inteligência Urbana (Urban Intelligence Center) is a full-stack PWA for reporting and managing urban infrastructure issues (potholes, broken lighting, damaged sidewalks, fallen trees, etc.). Citizens can submit photo + GPS reports, and an AI model classifies and prioritizes them automatically. An admin dashboard provides heatmaps and BI metrics for municipal teams.

**Deployed at:** [tcc.josemurilors.com.br](https://tcc.josemurilors.com.br)

**Stack:** React 19 + Vite 8 + Django 5.2/DRF + PostgreSQL 16/PostGIS 3.4 + ONNX Runtime (Python)

> **Environment requirements:**
>
> - **Python** 3.12 / 3.13 / 3.14 (Django 5.2 supports 3.10–3.14; the Docker image uses `python:3.13-slim`)
> - **Docker** + Docker Compose v2
> - **GDAL** on the host (`libgdal-dev`/`gdal-bin`) if running the Django backend outside Docker (djangorestframework-gis requires GDAL)
> - `uv` optional for recreating the Python venv (the versioned venv in `.venv` was generated with `uv 0.11.13`)

**Infrastructure:** Hetzner (Nuremberg, Germany) — ARM64 CX11, 4GB RAM, 2 cores, 40GB NVMe

## Project Status

> 🚧 In production

The Django backend is the active production backend. The application is deployed and serving real traffic at [tcc.josemurilors.com.br](https://tcc.josemurilors.com.br). Active development continues on new features, BI metrics, and test coverage.

## Features and Application Demo

- `Anonymous browsing`: view the heatmap of defects without login (individual markers require login)
- `Citizen reporting`: photo + GPS + category with AI classification
- `AI classification`: ONNX embeddings (paraphrase-multilingual-MiniLM-L12-v2) → 7 categories, spam detection, dedup, priority extraction
- `Duplicate detection`: spatial proximity (50m radius) + semantic similarity (cosine ≥ 0.75)
- `Spam moderation`: automatic detection of short, generic, or repetitive descriptions
- `Smart routing`: category → responsible municipal secretary (e.g., Buraco → Obras, Iluminação → Serviços Urbanos)
- `Priority scoring`: keyword match (urgente/alta/media/baixa) extracted from description
- `Critical cluster alert`: 5+ same-category defects in a 7-day window triggers a notification
- `Weekly summary`: auto-generated report (totals, resolution rate, top category/bairro)
- `Circuit breaker`: 3 IA failures → 60s cooldown, timeout 3s, silent fallback
- `Admin dashboard`: KPI metrics, per-region controls, CSV export, bar/pie charts
- `Cluster map`: auto-grouping of nearby defects with batch actions, heatmap toggle
- `Upvote system`: citizen support for defects
- `Attachments`: text/image updates on open defects
- `User management`: admin hierarchy, email verification, optional CPF at signup
- `Push notifications`: Web Push API with VAPID keys
- `Dark/light theme`: respects system preference, manual toggle, persisted in localStorage
- `Keyboard navigation`: `g + key` shortcuts (m=map, a=admin, d=dashboard, t=theme, ?=help)
- `Accessibility`: WCAG AA: aria-labels, skip-link, keyboard navigation, focus-visible, combobox, live regions
- `Responsive`: mobile-first with bottom sheets, hamburger menu <768px
- `PWA`: service worker with cache-first for static assets, manifest with splash screen
- `Privacy`: Gaussian blur on all uploaded photos to protect faces and license plates (configurable sigma)
- `GPS tolerance`: perimeter validation with ST_Buffer (~1km) + bounding box fallback for city border GPS errors
- `Email-only entry`: single flow — the email decides login vs signup, with a verification code sent by email
- `Google sign-in`: ID token validated on the backend (web and native app), no password
- `Quick map creation`: long-press on touch and right-click on desktop plant a flag and open the form
- `Citizen signaling`: on open calls, citizens flag "already resolved" or "doesn't exist" — input for the operator (the author resolves immediately; third parties need confirmation)
- `Quarantine (anti-spam)`: strikes expire after 90 days; with 3+ active, new reports are born restricted (only the author, operators, and people within 500 m see them) until the first confirmation
- `Implausible report rejection`: unlikely GPS displacement and same-category duplicates within 10 m are rejected
- `Gamification`: level, XP and city ranking — 10 XP per call, 6 per confirmation on someone else's call, +15 when one of your calls is resolved, and −20 per active strike (XP derived from history, no new table; titles from Novato to Lenda da Cidade)

### Demo

The live application is available at **[https://tcc.josemurilors.com.br](https://tcc.josemurilors.com.br)**.

## Project Access

### Quick Start (Development)

```bash
# 1. Clone
git clone git@github.com:josemurilors/tcc-manutencao-urbana.git
cd tcc-manutencao-urbana

# 2. Configure environment
cp .env.production backend-python/.env
# Edit backend-python/.env: SECRET_KEY, ENCRYPTION_KEY, DB_PASSWORD, etc.

# 3. Start backend + Redis (Django dev stack)
docker compose -f docker-compose.dev.yml up -d backend redis

# 4. Apply Django migrations
docker compose -f docker-compose.dev.yml exec backend python manage.py migrate

# 5. (Optional) Start IA service (port 8000)
docker compose --profile ia up -d ia

# 6. Frontend dev server
cd frontend && npm run dev
```

### Quick Start (Production)

```bash
# 1. Clone on VPS
git clone git@github.com:josemurilors/tcc-manutencao-urbana.git
cd tcc-manutencao-urbana

# 2. Configure environment
cp .env.production backend-python/.env
# Edit backend-python/.env with production secrets

# 3. Build full stack (Django backend)
docker compose up -d --build

# 4. Run PostGIS migration
docker compose exec -T postgres psql -U urbana -d manutencao_urbana \
  -c "CREATE EXTENSION IF NOT EXISTS postgis;"
docker compose exec -T postgres psql -U urbana -d manutencao_urbana -c "
  ALTER TABLE municipios ADD COLUMN IF NOT EXISTS polygon_geom geometry(MultiPolygon, 4326);
  CREATE INDEX IF NOT EXISTS idx_municipios_polygon_geom ON municipios USING GIST (polygon_geom);
  ALTER TABLE defeitos ADD COLUMN IF NOT EXISTS geom geometry(Point, 4326)
    GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)) STORED;
  CREATE INDEX IF NOT EXISTS idx_defeitos_geom ON defeitos USING GIST (geom);"

# 5. SSL certificate (first time)
docker compose run --rm certbot certonly --webroot \
  -w /var/www/certbot -d tcc.josemurilors.com.br

# 6. Verify health
curl https://tcc.josemurilors.com.br/api/health
```

### Mobile App (Expo)

The iOS/Android/web app lives in [`mobile/`](mobile/) and consumes the same API.

```bash
cd mobile
npm install
npm start        # scan the QR code with Expo Go
npm run web      # or open it in the browser: http://localhost:8081
```

In development the API base URL is derived from the Metro host (local backend
on port 8000) — no configuration needed. Configuration, a screen-by-screen
mapping against the web frontend, and known limitations are documented in
[`mobile/README.md`](mobile/README.md).

## Technologies Used

- **Mobile:** Expo SDK 57 + React Native 0.86 + Expo Router + react-native-maps + react-native-svg
- **Frontend:** React 19 + Vite 8 + Phosphor Icons + Framer Motion + Leaflet (react-leaflet, leaflet.heat, CartoDB)
- **Backend:** Django 5.2 + Django REST Framework (DRF) served by Gunicorn
- **Database:** PostgreSQL 16 + PostGIS 3.4 (spatial queries)
- **AI:** ONNX Runtime (Python/FastAPI) — paraphrase-multilingual-MiniLM-L12-v2
- **Maps:** Leaflet + react-leaflet + leaflet.heat + CartoDB
- **Auth:** simplejwt + BCryptPasswordHasher
- **Security:** CSRF middleware, IsAuthenticated default, AES-256-GCM encryption
- **Notifications:** Web Push API (VAPID) via pywebpush
- **Logging:** Python logging (Django)
- **Container:** Docker + Docker Compose, Nginx reverse proxy with SSL

## Architecture

| Layer | Django Stack |
|---|---|
| Frontend | React 19 + Vite 8 + Phosphor Icons + Framer Motion + Leaflet |
| Backend | Django 5.2 + DRF (Gunicorn) |
| Database | PostgreSQL 16 + PostGIS 3.4 |
| AI | ONNX Runtime (Python/FastAPI) — paraphrase-multilingual-MiniLM-L12-v2 |
| Maps | Leaflet + react-leaflet + leaflet.heat + CartoDB |
| Auth | simplejwt + BCryptPasswordHasher |
| Security | CSRF middleware, IsAuthenticated default, AES-256-GCM |
| Notifications | Web Push API (VAPID) / pywebpush |
| Logger | Python logging (Django) |

### Docker Architecture

```
┌──────────────┐     ┌──────────────────────┐     ┌──────────────────┐
│   nginx:80   │────▶│  backend-python:8000  │────▶│  postgres:5432   │
│  (SSL+proxy) │     │   (Django/Gunicorn)   │     │   (PG16+GIS)     │
└──────────────┘     └──────────────────────┘     └──────────────────┘
                               ▲
                               │ (classification calls)
                               ▼
                        ┌──────────────┐
                        │   ia:8000    │
                        │ (FastAPI     │
                        │  + ONNX)     │
                        └──────────────┘
```

All services communicate over a Docker bridge network (`app-network`). Nginx serves the SPA build and reverse-proxies `/api/*` to the Django backend; Django calls the IA service on port 8000 for classification.

## API Endpoints

### Authentication `/api/v1/auth/*`

| Method | Route | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/auth/existe/` | — | Check if the email already has an account (single entry flow) |
| POST | `/api/v1/auth/register/` | — | Register with name/email/password (CPF optional) |
| POST | `/api/v1/auth/login/` | — | Login (returns JWT + user) |
| POST | `/api/v1/auth/google/` | — | Google login/signup (ID token) |
| POST | `/api/v1/auth/refresh/` | — | Renew access token (refresh rotation) |
| GET | `/api/v1/auth/profile/` | JWT | User profile |
| POST | `/api/v1/auth/senha/` | JWT | Change password |
| POST | `/api/v1/auth/municipio/` | JWT | Update the user's municipality |
| POST | `/api/v1/auth/verify-email/` | JWT | Verify email with code |
| POST | `/api/v1/auth/resend-code/` | JWT | Resend verification code |
| GET | `/api/v1/auth/public-key/` | — | VAPID public key (push) |
| POST | `/api/v1/auth/subscribe/` | JWT | Save push subscription |
| GET | `/api/v1/auth/admin/users/` | Admin | List all users |
| GET | `/api/v1/auth/admin/estatisticas/` | Admin | Dashboard metrics |
| POST | `/api/v1/auth/admin/users/:id/admin/` | Super | Promote/remove admin |
| POST | `/api/v1/auth/admin/users/:id/municipio/` | Admin | Link municipality to user |

### Defeitos `/api/v1/defeitos/*`

| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/defeitos/` | — | List (paginated, with supports, `sinalizacoes`, `visibilidade`) |
| GET | `/api/v1/defeitos/meus/` | JWT | List the user's own defects |
| GET | `/api/v1/defeitos/apoiados/` | JWT | List defects the user supported |
| GET | `/api/v1/defeitos/apoiei/` | JWT | IDs of defects supported by the user |
| GET | `/api/v1/defeitos/sinalizei/` | JWT | User's signals (`{id: tipo}`) |
| GET | `/api/v1/defeitos/progresso/` | JWT | Logged user's level, XP and progress bar |
| GET | `/api/v1/defeitos/ranking/` | — | City/Brazil leaderboard (`?municipio=`, `?lat=&lng=`, `?geral=1`; `?periodo=semana\|mes`; `eu` returns the user's position) |
| GET | `/api/v1/defeitos/operacao/` | Admin | Operation queues (mine/all, operator's municipality) |
| GET | `/api/v1/defeitos/municipio/` | — | Defects released by proximity (restricted visibility) |
| GET | `/api/v1/defeitos/:id/` | — | Full detail with attachments and signals |
| GET | `/api/v1/defeitos/:id/ordem-servico/` | Admin | Work order PDF |
| POST | `/api/v1/defeitos/` | JWT | Create (photo + desc + GPS; rejects <10m duplicates and implausible displacement) |
| POST | `/api/v1/defeitos/:id/apoiar/` | JWT | Toggle support |
| POST | `/api/v1/defeitos/:id/sinalizar/` | JWT | Signal "resolved" or "doesn't exist" |
| POST | `/api/v1/defeitos/imagem/` | JWT | Upload image (including resolution photo) |
| PATCH | `/api/v1/defeitos/:id/` | Admin | Update status/priority/secretaria |
| PATCH | `/api/v1/defeitos/:id/status/` | Admin | Update status |
| PATCH | `/api/v1/defeitos/:id/atender/` | Admin | Assign attendant / start service |
| PATCH | `/api/v1/defeitos/:id/anexar/` | JWT | Attach image/text update |
| PATCH | `/api/v1/defeitos/batch-status/` | Admin | Batch status update |

### Municipios & Categorias

| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/municipios/` | varied | Django municipios lookup |
| GET | `/api/v1/municipios/lista/` | — | Flat `{codigo, nome, uf_sigla}` list of all municipalities (1h cache) |
| GET | `/api/v1/categorias/` | — | Django categories |

### Admin `/api/v1/admin/*`

| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/admin/vinculate/` | Super | Vincular municípios |
| GET | `/api/v1/admin/super/users/` | Super | Django user management |

### IA Service (port 8000 — ONNX Runtime)

| Method | Route | Description |
|---|---|---|
| POST | `/classify` | Text → category + confidence |
| POST | `/classify-full` | Category + priority + spam + routing |
| POST | `/classify-image` | Image base64 → category |
| POST | `/text-similarity` | Cosine similarity score |
| POST | `/summarize` | Weekly summary |
| GET | `/health` | Model loading status |

### Support / Lookups

| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/categorias/` | — | List categories with metadata |
| GET | `/api/v1/municipios/` | — | List municipalities (name, uf, polygon) |
| GET | `/api/v1/csrf-token/` | — | CSRF token |
| GET | `/api/health` | — | Health check (db, ia, uptime) |

## Security

- **Passwords:** bcrypt hashing via Django `BCryptPasswordHasher` (compatible with existing hashes)
- **JWT:** 24h expiration, payload `{ userId, email, admin, municipio_id }`, 256-bit secret, using `simplejwt`
- **CPF:** AES-256-GCM encrypted at rest + SHA-256 HMAC for unique lookups
- **CSRF:** Django `CsrfViewMiddleware` with `SameSite=Strict`
- **DRF Default:** `IsAuthenticated` — all endpoints locked by default; public ones explicitly use `AllowAny`
- **Rate Limiting:** `django-ratelimit` + Redis (multiple levels for auth, API, and per-user); circuit breaker on failures
- **HSTS/SSL:** Enforced in production settings (`SECURE_SSL_REDIRECT`, `SECURE_HSTS_SECONDS`)
- **Non-root user:** Django Docker container runs as `django` (uid 1001)
- **Upload validation:** compress to WebP 1200px max, whitelist (JPEG/PNG/WebP/AVIF), 5MB limit
- **IA Circuit Breaker:** 3 failures → 60s cooldown, never blocks defect creation
- **Validation:** DRF serializers on all inputs
- **2FA:** Optional TOTP-based two-factor authentication
- **Encryption key:** AES-256-GCM (32 bytes / 64 hex chars), generated via `openssl rand -hex 32`
- **Google login / email:** `GOOGLE_CLIENT_ID_WEB` / `GOOGLE_CLIENT_ID_ANDROID` / `GOOGLE_CLIENT_ID_IOS` (ID token validated by `aud` on the backend) and `RESEND_API_KEY` (verification codes) — all via environment variables, never in code

## PostGIS & Geospatial

PostgreSQL 16 with the PostGIS 3.4 extension for all spatial operations:

- **`municipios.polygon_geom`** — MultiPolygon(4326) from IBGE GeoJSON (~5570 municipalities, ~120MB)
- **`defeitos.geom`** — Generated always as `ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)` (managed by Django/PostGIS migrations)
- **Perimeter validation:** `ST_Within(point, polygon_geom)` — defect must be inside the user's municipality
- **Duplicate detection:** 50m spatial radius + embedding cosine similarity ≥ 0.75

## AI Classification Pipeline

```
User input → Tokenize (BERT tokenizer) → paraphrase-multilingual-MiniLM-L12-v2 (ONNX)
  → Mean pooling → L2 normalize → Cosine similarity × 7 centroids
  → Softmax(t=3.0) → Category + confidence
```

- **Model:** `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` (384-dim embeddings, multilingual)
- **Fallback:** Keyword classifier activates if ONNX fails to load or the IA container is down
- **Categories:** Buraco, Iluminação, Semáforo, Árvore Caída, Entulho, Calçada Danificada, Outro
- **Image:** MobileNetV3-small feature extractor (576-dim) — requires fine-tuning for classification
- **Duplicate detection:** 50m spatial radius + embedding cosine similarity ≥ 0.75
- **Spam filter:** Rejects texts < 10 chars, high-repeat-ratio, or generic patterns
- **Priority extraction:** Keyword match on urgent/alta/media/baixa in description
- **Secretary routing:** Category → responsible municipal department
- **Weekly summary:** Auto-generated report (totals, resolution rate, top 3 categories/bairros)
- **Critical clusters:** 5+ same-category defects within 7 days triggers priority alert
- **Circuit breaker:** 3 consecutive IA failures → 60s cooldown period, timeout 3s
- **Multi-stage Docker:** Builder (PyTorch 3GB) → exports ONNX → runtime (~200MB)

### Text Classification Detail

| Step | Description |
|---|---|
| Tokenize | BERT tokenizer, max_length=128, pad/truncate |
| Embed | paraphrase-multilingual-MiniLM-L12-v2 ONNX → 384-dim vector |
| Pool | Mean pooling of token embeddings |
| Normalize | L2 normalize to unit vector |
| Compare | Cosine similarity with 7 pre-computed category centroids |
| Softmax | Temperature=3.0, maps similarities to probabilities |
| Threshold | Confidence < 0.3 → "Outro" category |

### IA Container Architecture

```
┌─────────────────────────────────────────────────┐
│  ia:8000 (Python 3.12-slim, 800M RAM max)      │
│                                                   │
│  FastAPI ← POST /classify, /classify-full, etc.   │
│     ↓                                              │
│  inference.py (ONNX Runtime session)                │
│     ├── text_session → paraphrase-multilingual-MiniLM-L12-v2.onnx       │
│     └── image_session → mobilenetv3.onnx            │
│     └── centroids.json (7 pre-computed vectors)     │
│                                                     │
│  Healthcheck: GET /health (every 30s)               │
│  Restart: unless-stopped                             │
└─────────────────────────────────────────────────┘
```

## Technical Appendix

### Docker Architecture detail

Nginx (`nginx:80/443`) terminates SSL and serves the SPA build, reverse-proxying `/api/*` to `backend-python:8000` (Django/Gunicorn). Django persists to `postgres:5432` (PostgreSQL 16 + PostGIS) and calls `ia:8000` (FastAPI + ONNX) for classification. All services run on the `app-network` bridge. Compose files: `docker-compose.yml` (production), `docker-compose.dev.yml` (Django dev stack with Redis), `nginx.Dockerfile` (Nginx with pre-built frontend), `nginx.prod.conf` / `nginx.host.conf`.

### CI/CD Pipeline

GitHub Actions workflow (`.github/workflows/deploy.yml`):

```
Push to master
  → Lint backend (ruff) + frontend (eslint)
  → Build frontend (Vite)
  → Build Docker images
  → Deploy to VPS via SSH
  → docker compose pull && up -d
  → Health check verification
```

### Backup System

Automated PostgreSQL backup via `scripts/backup-postgres.sh`:

- **Schedule:** Daily via cron (Docker service `backup`, profile `backup`)
- **Output:** Compressed SQL dump (gzip)
- **Retention:** 30 days (configurable via `RETENTION_DAYS`)
- **Remote:** Optional S3-compatible upload via rclone
- **Notifications:** Optional Telegram alerts on failure

### Design System

Dark-first theme with CSS custom properties (`tokens.css`):

- **Font:** Inter (sans-serif) + JetBrains Mono (mono)
- **Typography:** 12px to 36px scale
- **Spacing:** 4px to 64px scale (8-step)
- **Dark:** `--bg-primary: #0d0d0f`, `--text-primary: #fafafa`, `--accent-green: #22c55e`
- **Light:** `--bg-primary: #f5f5f0`, `--text-primary: #1a1a1c`, contrast ~16.4:1 (AAA)

### Accessibility (WCAG AA)

| Criteria | Implementation |
|---|---|
| Focus visible | `:focus-visible` 2px green outline on all interactive elements |
| Icon labels | `aria-label` on every icon-only button |
| Modal semantics | `role="dialog"` + `aria-modal="true"` + `aria-label` |
| Live regions | `aria-live="polite"` on toast notifications |
| Combobox | Full WAI-ARIA `role="combobox"` with `aria-expanded` |
| Skip link | Skip-to-content link at page top (`#main-content`) |
| Escape key | Closes all modals and clears keyboard nav buffer |
| Error messages | `role="alert"` on inline validation |
| Contrast (dark) | AA+ on all combos (7.58:1 AAA on primary/secondary) |
| Contrast (light) | 16.4:1 AAA on primary |
| Keyboard nav | `g+key` shortcuts with visual help overlay (`?`) |
| Reduced motion | `prefers-reduced-motion` respected via framer-motion |

### Keyboard Navigation

Press `g`, release, then the destination key (1s buffer window):

| Shortcut | Page | Shortcut | Page |
|---|---|---|---|
| `g+m` | Map | `g+d` | Dashboard |
| `g+l` | List | `g+u` | Users |
| `g+a` | Admin | `g+s` | Settings |
| `g+i` | Login | `g+c` | Account |
| `g+r` | Register | `g+t` | Toggle theme |
| `?` | Show help | `Esc` | Clear buffer |

Shortcuts are disabled when focus is inside input/textarea/select elements.

## Contributors

| User | Contributions |
|---|---|
| [caiocinel](https://github.com/caiocinel) | Mobile app (Expo), Google sign-in and single email flow, citizen signaling and quarantine, long-press/right-click call creation, operations app, smart routes |

## Authors

| Avatar | Name | Link |
|---|---|---|
| <img src="https://github.com/josemurilors.png" width=115> | José Murilo Rodrigues Sabalo | [josemurilors](https://github.com/josemurilors) |
| <img src="https://github.com/caiocinel.png" width=115> | caiocinel | [caiocinel](https://github.com/caiocinel) |

Additional TCC group members will be added here later.

## License

This project is licensed under the **MIT License**. The full text is available in the `LICENSE` file.
