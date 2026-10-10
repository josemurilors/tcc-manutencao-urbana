<p align="center">
  <img src="icone-projeto.svg" alt="Central de Inteligência Urbana" width="200">
</p>

<h1 align="center">Central de Inteligência Urbana — Urban Intelligence Center</h1>

<p align="center">
  <img src="https://img.shields.io/badge/STATUS-EM%20PRODU%C3%87%C3%83O-green?style=for-the-badge" alt="Status">
  <img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" alt="License: MIT">
  <img src="https://img.shields.io/badge/stack-React%2019%20%7C%20Django%205%20%7C%20PostGIS-blueviolet?style=for-the-badge" alt="Stack">
  <img src="https://img.shields.io/badge/deploy-Hetzner%20VPS-important?style=for-the-badge" alt="Deploy: Hetzner VPS">
  <img src="https://img.shields.io/badge/python-3.13-3776AB?style=for-the-badge" alt="Python 3.13">
</p>

<p align="center">
  <a href="#português">🇧🇷 Português</a> · <a href="#english">🇺🇸 English</a>
</p>

---

<a id="português"></a>

## 🇧🇷 Português

## Índice

- [Descrição do Projeto](#descrição-do-projeto)
- [Status do Projeto](#status-do-projeto)
- [Funcionalidades e Demonstração da Aplicação](#funcionalidades-e-demonstração-da-aplicação)
- [Plataforma v3](#plataforma-v3)
- [Acesso ao Projeto](#acesso-ao-projeto)
- [App Mobile (Expo)](#app-mobile-expo)
- [Tecnologias utilizadas](#tecnologias-utilizadas)
- [Arquitetura](#arquitetura)
- [API Endpoints](#api-endpoints)
- [Segurança](#segurança)
- [PostGIS & Geoespacial](#postgis--geoespacial)
- [Pipeline de Classificação IA](#pipeline-de-classificação-ia)
- [Apêndice Técnico](#apêndice-técnico)
- [Pessoas Contribuidoras](#pessoas-contribuidoras)
- [Autores](#autores)
- [Licença](#licença)

## Descrição do Projeto

Central de Inteligência Urbana é uma PWA full-stack para reportar e gerenciar problemas de infraestrutura urbana (buracos, iluminação quebrada, calçadas danificadas, árvores caídas etc.). Cidadãos podem enviar relatos com foto + GPS; a IA classifica e prioriza automaticamente. Painel administrativo com mapa de calor e métricas de BI.

**Deploy em produção:** [tcc.josemurilors.com.br](https://tcc.josemurilors.com.br)

**Stack:** React 19 + Vite 8 + Django 5.2/DRF + PostgreSQL 16/PostGIS 3.4 + ONNX Runtime (Python)

> **Requisitos de ambiente:**
>
> - **Node.js** ≥ 22.12 (Vite 8 exige `^20.19.0 || >=22.12.0`; testado localmente com v26.4)
> - **Python** 3.12 / 3.13 / 3.14 (Django 5.2 suporta 3.10–3.14; a imagem Docker usa `python:3.13-slim`)
> - **Docker** + Docker Compose v2
> - **GDAL** no host (`libgdal-dev`/`gdal-bin`) se for rodar o backend Django fora do Docker (djangorestframework-gis exige GDAL)
> - `uv` opcional para recriar o venv Python (o venv versionado em `.venv` foi gerado com `uv 0.11.13`)

**Infraestrutura:** Hetzner (Nuremberg, Alemanha) — ARM64 CX11, 4GB RAM, 2 cores, 40GB NVMe

## Status do Projeto

> 🚧 Projeto em produção

A aplicação está no ar e em uso contínuo em `tcc.josemurilors.com.br`. O backend Django é o backend oficial de produção; novas funcionalidades e correções seguem sendo entregues incrementalmente.

## Funcionalidades e Demonstração da Aplicação

- `Navegação anônima`: visualização do mapa de calor de defeitos sem login (marcadores individuais exigem login)
- `Relato cidadão`: foto + GPS + categoria com classificação por IA
- `Classificação IA`: embeddings ONNX (paraphrase-multilingual-MiniLM-L12-v2) → 7 categorias, detecção de spam, dedup e extração de prioridade
- `Detecção de duplicados`: proximidade espacial (raio de 50m) + similaridade semântica (cosseno ≥ 0,75)
- `Moderação de spam`: detecção automática de descrições curtas, genéricas ou repetitivas
- `Roteamento inteligente`: categoria → secretaria municipal responsável (ex.: Buraco → Obras, Iluminação → Serviços Urbanos)
- `Pontuação de prioridade`: correspondência de palavras-chave (urgente/alta/media/baixa) extraídas da descrição
- `Alerta de cluster crítico`: 5+ defeitos da mesma categoria em janela de 7 dias dispara notificação
- `Resumo semanal`: relatório automático (totais, taxa de resolução, top categoria/bairro)
- `Circuit breaker`: 3 falhas de IA → cooldown de 60s, timeout 3s, fallback silencioso
- `Painel admin`: métricas KPI, controles por região, export CSV, gráficos de barra/pizza
- `Mapa de clusters`: auto-agrupamento de defeitos próximos com ações em lote, toggle de heatmap
- `Sistema de upvotes`: apoio cidadão aos defeitos
- `Anexos`: atualizações de texto/imagem em defeitos abertos
- `Gestão de usuários`: hierarquia admin, verificação de e-mail, CPF opcional no cadastro
- `Notificações push`: Web Push API com chaves VAPID
- `Tema claro/escuro`: respeita preferência do sistema, toggle manual, persistido em localStorage
- `Navegação por teclado`: atalhos `g + tecla` (m=mapa, a=admin, d=dashboard, t=tema, ?=ajuda)
- `Acessibilidade`: WCAG AA — aria-labels, skip-link, navegação por teclado, focus-visible, combobox, live regions
- `Responsivo`: mobile-first com bottom sheets, menu hamburguer <768px
- `PWA`: service worker com cache-first para assets estáticos, manifest com splash screen
- `Privacidade`: ofuscação de imagem via blur gaussiano em todas as fotos enviadas para atenuação de privacidade (sigma configurável)
- `Tolerância de GPS`: validação de perímetro com ST_Buffer (~1km) + bounding box fallback para erros de GPS na borda do município
- `Entrada por e-mail`: fluxo único — o e-mail decide se é login ou cadastro, com código de verificação enviado por e-mail
- `Login com Google`: ID token validado no backend (web e app nativo), sem senha
- `Criação rápida no mapa`: long-press no toque e botão direito no PC plantam a bandeira e abrem o formulário
- `Sinalização cidadã`: em chamados abertos, o cidadão sinaliza "já foi resolvido" ou "não existe" — insumo para o operador (o autor resolve na hora; terceiros, com confirmação)
- `Quarentena (anti-spam)`: strikes expiram em 90 dias; com 3+ ativos, novos reports nascem restritos (só autor, operadores e quem está a ≤ 500 m veem) até a 1ª confirmação
- `Recusa de reports implausíveis`: deslocamento GPS improvável e duplicado da mesma categoria a < 10 m são recusados
- `Gamificação`: nível, EXP e ranking por cidade — 10 XP por chamado, 6 por confirmação em chamado de terceiros, +15 quando um chamado seu é resolvido e −20 por strike ativo (XP derivado do histórico, sem tabela nova; títulos de Novato a Lenda da Cidade)

### Demonstração

A aplicação está disponível ao vivo em: **[tcc.josemurilors.com.br](https://tcc.josemurilors.com.br)**

## Plataforma v3

A v3 transforma a Central num produto de zeladoria urbana para prefeituras
(B2G): o cidadão reporta, a equipe de campo executa, a gestão acompanha
prazos e resultados, e a cidade publica os números. O cliente da v3 é o app
em [`mobile/`](mobile/) (iOS, Android e web); o vocabulário, o esquema e a
API compartilhados estão em
[`docs/arquitetura/contrato-v3.md`](docs/arquitetura/contrato-v3.md).

### O que o produto faz, por público

- `Cidadão`: abre chamado com foto e GPS e recebe um **protocolo**
  (`AAAA-NNNNNN`); acompanha pela linha do tempo (Recebido → Em análise →
  Programado → Em execução → Resolvido / Não procede), inclusive sem login,
  pelo protocolo; apoia chamados de outras pessoas e sinaliza "já foi
  resolvido" ou "não existe"; avalia o atendimento de 1 a 5 depois da
  solução e pode reabrir em até 30 dias; exporta os próprios dados (LGPD).
- `Operação` (equipe de campo): aba **Operação** com fila priorizada por
  prazo e apoios, filtros (meus, da equipe, sem atribuição, vencidos), mapa
  da fila, assumir chamado, mudar status, nota interna, resposta pública ao
  cidadão, foto de evidência antes/depois com GPS e checklist da categoria.
  Funciona sem rede: as ações ficam numa fila e são reenviadas com
  `Idempotency-Key`, sem duplicar nada.
- `Gestão`: aba **Painel** com o BI do município — recebidos, resolvidos,
  % no prazo (SLA), lead time P50/P90, tempo da primeira resposta,
  reabertura, CSAT e cidadãos ativos —, série histórica, distribuição por
  categoria/secretaria/equipe/bairro, aging do backlog, produtividade por
  operador, hotspots no mapa e satisfação, com drill-down até a lista de
  chamados, exportação CSV e relatório mensal. A gestão atribui a equipes e
  operadores, rejeita com motivo, marca duplicados, reabre e ajusta SLA. O
  admin municipal configura secretarias, equipes, membros, categorias
  (prazo, prioridade, secretaria, checklist), dados do município, moderação
  e consulta a auditoria.

### Papéis

Cada servidor atua em **um** município (`users.municipio_id`). Regras em
`backend-python/core/permissoes.py`.

| Papel             | Pode                                                                     |
| ----------------- | ------------------------------------------------------------------------ |
| `cidadao`         | Reportar, apoiar, sinalizar, avaliar, reabrir o próprio chamado (30 dias) |
| `operador`        | Fila, assumir, mudar status, notas, resposta pública, evidências          |
| `gestor`          | + rejeitar, duplicado, reabrir, atribuir, SLA, BI, exportações, moderação |
| `admin_municipal` | + equipe e papéis, secretarias, categorias, configuração, auditoria       |
| `super_admin`     | Gere qualquer município (`?municipio=`); opera só no seu                  |

### Transparência e dados abertos

Sem login e sem dados pessoais:

- `GET /api/v1/transparencia/<codigo_ibge>/` — indicadores dos últimos 90
  dias, desempenho por categoria, série mensal e últimos resolvidos (tela
  `transparencia/<codigo>` no app).
- `GET /api/v1/dados-abertos/<codigo_ibge>/chamados.csv` e `.geojson` —
  chamados públicos, com coordenadas de 4 casas.
- Open311 GeoReport v2 (leitura): `/api/v1/open311/v2/services.json` e
  `requests.json`.

### Notificações

Todo evento relevante do chamado vira aviso in-app (central de
notificações) e push pelo **Expo Push** (`expo-notifications` no app):
mudança de status, resposta da prefeitura, pedido de avaliação, marco de
apoios, atribuição, alerta de SLA, moderação e o resumo semanal do gestor.
Variáveis do backend: `EXPO_PUSH_ENABLED` (padrão `1`) e
`EXPO_ACCESS_TOKEN` (só se o projeto Expo exigir token de acesso).

### Agendador (alertas de SLA e resumo semanal)

O serviço `scheduler` dos composes (`docker-compose.yml`,
`docker-compose.dev.yml` e `docker-compose.host.yml`) usa a mesma imagem e
as mesmas variáveis do backend e roda `entrypoint.sh agendador`, um loop
shell no fuso `America/Sao_Paulo`:

- **de hora em hora**: `python manage.py alertas_sla` — avisa operador,
  equipe e gestores dos chamados que vencem em 24 h ou já venceram;
- **às segundas, a partir das 8h**: `python manage.py resumo_semanal` —
  resumo da semana para gestores e admins municipais (in-app e, com
  `RESEND_API_KEY`, por e-mail).

Os dois comandos não repetem aviso, então reiniciar o agendador ou rodá-los
à mão é seguro.

```bash
docker compose up -d scheduler                 # produção (sobe junto no up -d)
docker compose logs -f scheduler
docker compose exec backend python manage.py alertas_sla --dry-run
docker compose exec backend python manage.py resumo_semanal --municipio 3550308 --forcar
```

### Município de demonstração (`seed_demo`)

Gera um município realista para vendas e para o BI: cidadãos fictícios,
gestora e operadores para cada equipe, e chamados distribuídos por
categoria e bairro em volta do centro da cidade, passando pelo ciclo de
vida real (`defeitos/fluxo.py`): triagem, atribuição, execução, conclusão
com resposta pública, rejeições com motivo, duplicados, reaberturas,
avaliações com comentário, apoios e sinalizações. As datas são retroativas
e coerentes (mais volume recente, prazos que melhoram com o tempo), e
nenhum aviso é disparado. Tudo que é demo usa e-mail `@demo.ciu`.

```bash
# Banco de DEV, num container efêmero (sem reiniciar a stack):
scripts/seed-demo.sh                                  # São Paulo (3550308), 600 chamados, 180 dias
scripts/seed-demo.sh --municipio 3509502 --chamados 300 --dias 90
scripts/seed-demo.sh --senha 'Demo@2026'              # gestora e operadores demo podem entrar
scripts/seed-demo.sh --limpar-demo                    # remove só a demo do município

# Em qualquer ambiente com o backend no ar:
docker compose exec backend python manage.py seed_demo --municipio 3550308 --semente 42
```

Rodar de novo substitui a demo anterior do município. `--limpar-demo` apaga
os usuários `@demo.ciu` do município e os chamados deles (com histórico,
apoios e sinalizações); chamados reais e a estrutura da prefeitura
(secretarias e equipes, criadas pelo `seed_gestao_demo` se faltarem) ficam.

### Testes do backend

`scripts/test-backend.sh` roda o pytest num container efêmero com a imagem
do backend e um banco de teste próprio (`test_<sufixo>`), então várias
execuções em paralelo (worktrees, agentes) não se atrapalham. Requer a
stack dev no ar.

```bash
scripts/test-backend.sh                                   # suíte inteira
TEST_DB_SUFFIX=bi scripts/test-backend.sh bi/tests.py     # um arquivo, banco test_bi
scripts/test-backend.sh -k transicao                      # por nome
```

## Acesso ao Projeto

### Quick Start (Desenvolvimento)

```bash
# 1. Clone
git clone git@github.com:josemurilors/tcc-manutencao-urbana.git
cd tcc-manutencao-urbana

# 2. Configure o ambiente do backend Django
cp .env.production backend-python/.env
# Edite backend-python/.env: ENCRYPTION_KEY, DB_PASSWORD, etc.

# 3. Suba o banco (Postgres + PostGIS) e o backend Django + Redis
docker compose -f docker-compose.dev.yml up -d backend redis

# 4. Rode as migrações do Django
docker compose -f docker-compose.dev.yml exec backend python manage.py migrate

# 5. (Opcional) Suba o serviço de IA
docker compose -f docker-compose.dev.yml --profile ia up -d ia

# 6. Frontend dev server
cd frontend && npm run dev
```

### Quick Start (Produção)

```bash
# 1. Clone na VPS
git clone git@github.com:josemurilors/tcc-manutencao-urbana.git
cd tcc-manutencao-urbana

# 2. Configure o ambiente
cp .env.production backend-python/.env
# Edite backend-python/.env com os segredos de produção

# 3. Build da stack completa (Django backend)
docker compose up -d --build

# 4. Rode a migração PostGIS (extensão + geometrias)
docker compose exec -T postgres psql -U urbana -d manutencao_urbana \
  -c "CREATE EXTENSION IF NOT EXISTS postgis;"
docker compose exec -T postgres psql -U urbana -d manutencao_urbana -c "
  ALTER TABLE municipios ADD COLUMN IF NOT EXISTS polygon_geom geometry(MultiPolygon, 4326);
  CREATE INDEX IF NOT EXISTS idx_municipios_polygon_geom ON municipios USING GIST (polygon_geom);
  ALTER TABLE defeitos ADD COLUMN IF NOT EXISTS geom geometry(Point, 4326)
    GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)) STORED;
  CREATE INDEX IF NOT EXISTS idx_defeitos_geom ON defeitos USING GIST (geom);"

# 5. Certificado SSL (primeira vez)
docker compose run --rm certbot certonly --webroot \
  -w /var/www/certbot -d tcc.josemurilors.com.br

# 6. Verifique a saúde
curl https://tcc.josemurilors.com.br/api/health
```

### App Mobile (Expo)

O app iOS/Android/web vive em [`mobile/`](mobile/) e consome a mesma API.

```bash
cd mobile
npm install
npm start        # leia o QR code com o Expo Go
npm run web      # ou abra no navegador: http://localhost:8081
```

Em desenvolvimento a URL da API é derivada do host do Metro (backend local na
porta 8000) — não precisa configurar nada. Detalhes de configuração,
equivalência tela a tela com o frontend web e limitações conhecidas estão em
[`mobile/README.md`](mobile/README.md).

## Tecnologias utilizadas

- **Mobile:** Expo SDK 57 + React Native 0.86 + Expo Router + react-native-maps (Leaflet no web) + react-native-svg
- **Frontend:** React 19 + Vite 8 + Phosphor Icons + Framer Motion + Leaflet + react-leaflet + leaflet.heat + CartoDB
- **Backend:** Django 5.2 + Django REST Framework (Gunicorn)
- **Database:** PostgreSQL 16 + PostGIS 3.4 (consultas espaciais)
- **IA:** ONNX Runtime (Python/FastAPI) — paraphrase-multilingual-MiniLM-L12-v2
- **Maps:** Leaflet + react-leaflet + leaflet.heat + CartoDB
- **Auth:** simplejwt + BCryptPasswordHasher
- **Security:** CSRF middleware, IsAuthenticated default, AES-256-GCM
- **Notifications:** Web Push API (VAPID) via pywebpush
- **Logger:** Python logging (Django)

## Arquitetura

| Camada | Stack |
|---|---|
| Frontend | React 19 + Vite 8 + Phosphor Icons + Framer Motion + Leaflet |
| Backend | Django 5.2 + DRF (Gunicorn) |
| Database | PostgreSQL 16 + PostGIS 3.4 |
| IA | ONNX Runtime (Python/FastAPI) — paraphrase-multilingual-MiniLM-L12-v2 |
| Maps | Leaflet + react-leaflet + leaflet.heat + CartoDB |
| Auth | simplejwt + BCryptPasswordHasher |
| Security | CSRF middleware, IsAuthenticated default, AES-256-GCM |
| Notifications | Web Push API (VAPID) via pywebpush |
| Logger | Python logging (Django) |

### Diagrama Docker

```
┌──────────────┐     ┌──────────────────────┐     ┌──────────────────┐
│   nginx:80   │────▶│  backend-python:8000  │────▶│  postgres:5432   │
│  :443 (SSL)  │     │  (Django/Gunicorn)   │     │  (PG16+PostGIS)  │
└──────────────┘     └──────────┬───────────┘     └──────────────────┘
                               │                        ▲
                               ▼                        │
                        ┌──────────────┐       (consultas espaciais)
                        │   ia:8000    │
                        │  (FastAPI    │
                        │   + ONNX)    │
                        └──────────────┘
```

Todos os serviços comunicam-se sobre a rede bridge do Docker (`app-network`). O Nginx serve o build da SPA e faz reverse-proxy `/api/*` para o Django em :8000; o serviço de IA em :8000 roda ao lado, consumido pelo backend.

## API Endpoints

### Autenticação Django `/api/v1/auth/*`

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| POST | `/api/v1/auth/existe/` | — | Verifica se o e-mail já tem conta (fluxo único de entrada) |
| POST | `/api/v1/auth/register/` | — | Cadastro com nome/e-mail/senha (CPF opcional) |
| POST | `/api/v1/auth/login/` | — | Login (retorna JWT + usuário) |
| POST | `/api/v1/auth/google/` | — | Login/cadastro com Google (ID token) |
| POST | `/api/v1/auth/refresh/` | — | Renova o access token (rotação do refresh) |
| GET | `/api/v1/auth/profile/` | JWT | Perfil do usuário |
| POST | `/api/v1/auth/senha/` | JWT | Alterar senha |
| POST | `/api/v1/auth/municipio/` | JWT | Atualizar o município do usuário |
| POST | `/api/v1/auth/verify-email/` | JWT | Verificar e-mail com código |
| POST | `/api/v1/auth/resend-code/` | JWT | Reenviar código de verificação |
| GET | `/api/v1/auth/public-key/` | — | Chave pública VAPID (push) |
| POST | `/api/v1/auth/subscribe/` | JWT | Salvar inscrição push |
| GET | `/api/v1/auth/admin/users/` | Admin | Listar todos os usuários |
| GET | `/api/v1/auth/admin/estatisticas/` | Admin | Métricas do painel |
| POST | `/api/v1/auth/admin/users/:id/admin/` | Super | Promover/remover admin |
| POST | `/api/v1/auth/admin/users/:id/municipio/` | Admin | Vincular município ao usuário |

### Defeitos `/api/v1/defeitos/*`

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| GET | `/api/v1/defeitos/` | — | Listar (paginação, apoios, `sinalizacoes`, `visibilidade`) |
| GET | `/api/v1/defeitos/meus/` | JWT | Listar defeitos do próprio usuário |
| GET | `/api/v1/defeitos/apoiados/` | JWT | Listar defeitos que o usuário apoiou |
| GET | `/api/v1/defeitos/apoiei/` | JWT | IDs de defeitos apoiados pelo usuário |
| GET | `/api/v1/defeitos/sinalizei/` | JWT | Sinalizações do usuário (`{id: tipo}`) |
| GET | `/api/v1/defeitos/progresso/` | JWT | Nível, XP e barra de progresso do usuário logado |
| GET | `/api/v1/defeitos/ranking/` | — | Ranking por cidade ou Brasil (`?municipio=`, `?lat=&lng=`, `?geral=1`; `?periodo=semana\|mes`; `eu` traz a posição do usuário) |
| GET | `/api/v1/defeitos/operacao/` | Admin | Filas da operação (meus/todos, município do operador) |
| GET | `/api/v1/defeitos/municipio/` | — | Chamados liberados por proximidade (visibilidade restrita) |
| GET | `/api/v1/defeitos/:id/` | — | Detalhe completo com anexos e sinalizações |
| GET | `/api/v1/defeitos/:id/ordem-servico/` | Admin | PDF da ordem de serviço |
| POST | `/api/v1/defeitos/` | JWT | Criar (foto + desc + GPS; recusa duplicado <10m e deslocamento implausível) |
| POST | `/api/v1/defeitos/:id/apoiar/` | JWT | Alternar apoio |
| POST | `/api/v1/defeitos/:id/sinalizar/` | JWT | Sinalizar "resolvido" ou "não existe" |
| POST | `/api/v1/defeitos/imagem/` | JWT | Upload de imagem (inclui foto de resolução) |
| PATCH | `/api/v1/defeitos/:id/` | Admin | Atualizar status/prioridade/secretaria |
| PATCH | `/api/v1/defeitos/:id/status/` | Admin | Atualizar status |
| PATCH | `/api/v1/defeitos/:id/atender/` | Admin | Atribuir atendente / iniciar atendimento |
| PATCH | `/api/v1/defeitos/:id/anexar/` | JWT | Anexar atualização de imagem/texto |
| PATCH | `/api/v1/defeitos/batch-status/` | Admin | Atualizar status em lote |

### Municípios & Categorias `/api/v1/*`

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| GET/POST | `/api/v1/municipios/` | variado | Lookup de municípios |
| GET | `/api/v1/municipios/lista/` | — | Lista achatada `{codigo, nome, uf_sigla}` de todos os municípios (cache 1h) |
| GET | `/api/v1/categorias/` | — | Listar categorias |

### Admin Django `/api/v1/admin/*`

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| GET | `/api/v1/admin/vinculate/` | Super | Vincular municípios |
| GET | `/api/v1/admin/super/users/` | Super | Gestão de usuários |

### IA Service (porta 8000 — ONNX Runtime)

| Método | Rota | Descrição |
|---|---|---|
| POST | `/classify` | Texto → categoria + confiança |
| POST | `/classify-full` | Categoria + prioridade + spam + roteamento |
| POST | `/classify-image` | Imagem base64 → categoria |
| POST | `/text-similarity` | Score de similaridade cosseno |
| POST | `/summarize` | Resumo semanal |
| GET | `/health` | Status de carregamento do modelo |

### Support / Categoria / Municipio lookups

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| GET | `/api/v1/categorias/` | — | Listar categorias com metadados |
| GET | `/api/v1/municipios/` | — | Listar municípios (nome, uf, polygon) |
| GET | `/api/v1/csrf-token/` | — | Token CSRF |
| GET | `/api/health` | — | Health check (db, ia, uptime) |

## Segurança

- **Senhas:** bcrypt hashing (salt rounds = 10); Django `BCryptPasswordHasher` compatível com hashes existentes
- **JWT (simplejwt):** expiração de 24h, payload `{ userId, email, admin, municipio_id }`, secret de 256-bit
- **CPF:** criptografado em repouso com AES-256-GCM + SHA-256 HMAC para lookups únicos
- **CSRF:** `CsrfViewMiddleware` do Django com `SameSite=Strict`
- **DRF default:** `IsAuthenticated` — todos os endpoints travados por padrão; públicos usam `AllowAny` explicitamente
- **Rate Limiting:** `django-ratelimit` + Redis (circuit breaker) — global, auth, API e por usuário
- **HSTS/SSL:** enforce em settings de produção (`SECURE_SSL_REDIRECT`, `SECURE_HSTS_SECONDS`)
- **Usuário não-root:** container Django roda como `django` (uid 1001)
- **Validação de upload:** compressão para WebP 1200px máx, whitelist (JPEG/PNG/WebP/AVIF), limite 5MB
- **IA Circuit Breaker:** 3 falhas → cooldown 60s, nunca bloqueia criação de defeito
- **Validação:** serializers DRF em todas as entradas
- **2FA:** TOTP de dois fatores opcional
- **Chave de criptografia:** AES-256-GCM (32 bytes / 64 hex chars), gerada via `openssl rand -hex 32`
- **Login Google / e-mail:** `GOOGLE_CLIENT_ID_WEB` / `GOOGLE_CLIENT_ID_ANDROID` / `GOOGLE_CLIENT_ID_IOS` (ID token validado pelo `aud` no backend) e `RESEND_API_KEY` (envio dos códigos de verificação) — todos via variáveis de ambiente, nunca em código

## PostGIS & Geoespacial

PostgreSQL 16 com extensão PostGIS 3.4 para todas as operações espaciais:

- **`municipios.polygon_geom`** — MultiPolygon(4326) a partir do GeoJSON IBGE (5570 municípios, ~120MB)
- **`defeitos.geom`** — gerado sempre como `ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)` via migração Django/PostGIS
- **Validação de perímetro:** `ST_Within(point, polygon_geom)` — o defeito deve estar dentro do município do usuário
- **Detecção de duplicados:** raio espacial de 50m + similaridade de embedding (cosseno) ≥ 0,75

O Django gerencia a geometria via PostGIS diretamente nas migrações — nenhum script SQL legado externo é necessário.

## Pipeline de Classificação IA

```
User input → Tokenize (BERT tokenizer) → paraphrase-multilingual-MiniLM-L12-v2 (ONNX)
  → Mean pooling → L2 normalize → Cosine similarity × 7 centroids
  → Softmax(t=3.0) → Category + confidence
```

- **Modelo:** `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` (embeddings 384-dim, multilíngue)
- **Fallback:** classificador por palavras-chave ativa se o ONNX falhar ao carregar ou o container de IA cair
- **Categorias:** Buraco, Iluminação, Semáforo, Árvore Caída, Entulho, Calçada Danificada, Outro
- **Imagem:** extrator de features MobileNetV3-small (576-dim) — requer fine-tuning para classificação
- **Detecção de duplicados:** raio espacial de 50m + similaridade cosseno de embedding ≥ 0,75
- **Filtro de spam:** rejeita textos < 10 chars, alta taxa de repetição ou padrões genéricos
- **Extração de prioridade:** match de palavras-chave urgent/alta/media/baixa na descrição
- **Roteamento de secretaria:** categoria → departamento municipal responsável
- **Resumo semanal:** relatório automático (totais, taxa de resolução, top 3 categorias/bairros)
- **Clusters críticos:** 5+ defeitos da mesma categoria em 7 dias dispara alerta de prioridade
- **Circuit breaker:** 3 falhas de IA consecutivas → cooldown 60s, timeout 3s
- **Docker multi-stage:** Builder (PyTorch 3GB) → exporta ONNX → runtime (~200MB)

### Text Classification Detail

| Passo | Descrição |
|---|---|
| Tokenize | BERT tokenizer, max_length=128, pad/truncate |
| Embed | paraphrase-multilingual-MiniLM-L12-v2 ONNX → vetor 384-dim |
| Pool | Mean pooling dos embeddings de token |
| Normalize | L2 normalize para vetor unitário |
| Compare | Cosseno com 7 centróides de categoria pré-computados |
| Softmax | Temperature=3.0, mapeia similaridades a probabilidades |
| Threshold | Confiança < 0,3 → categoria "Outro" |

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
│     └── centroids.json (7 vetores pré-computados)   │
│                                                     │
│  Healthcheck: GET /health (a cada 30s)              │
│  Restart: unless-stopped                             │
└─────────────────────────────────────────────────┘
```

## Apêndice Técnico

### Docker Architecture detail

A stack de produção usa `docker-compose.yml` (postgres + backend-python + nginx + ia) sobre a rede `app-network`. O `docker-compose.dev.yml` (Redis + backend-python) é usado em desenvolvimento. O nginx faz SSL termination e reverse-proxy `/api/*` para o Django em :8000; o serviço de IA em :8000 roda ao lado.

### CI/CD Pipeline

GitHub Actions workflow (`.github/workflows/deploy.yml`):

```
Push to master
  → Lint backend (ruff/flake8) + frontend (eslint)
  → Build frontend (Vite)
  → Build Docker images
  → Deploy to VPS via SSH
  → docker compose pull && up -d
  → Health check verification
```

### Backup System

Backup automatizado do PostgreSQL via `scripts/backup-postgres.sh`:

- **Agendamento:** diário via cron (serviço Docker `backup`, profile `backup`)
- **Saída:** dump SQL comprimido (gzip)
- **Retenção:** 30 dias (configurável via `RETENTION_DAYS`)
- **Remoto:** upload opcional S3-compatible via rclone
- **Notificações:** alertas Telegram opcionais em caso de falha

### Design System

Tema dark-first com CSS custom properties (`tokens.css`):

- **Fonte:** Inter (sans-serif) + JetBrains Mono (mono)
- **Tipografia:** escala 12px a 36px
- **Espaçamento:** escala 4px a 64px (8 passos)
- **Dark:** `--bg-primary: #0d0d0f`, `--text-primary: #fafafa`, `--accent-green: #22c55e`
- **Light:** `--bg-primary: #f5f5f0`, `--text-primary: #1a1a1c`, contraste ~16.4:1 (AAA)

### Acessibilidade (WCAG AA)

| Critério | Implementação |
|---|---|
| Focus visible | `:focus-visible` outline verde 2px em todos os elementos interativos |
| Icon labels | `aria-label` em todo botão somente-ícone |
| Modal semantics | `role="dialog"` + `aria-modal="true"` + `aria-label` |
| Live regions | `aria-live="polite"` em notificações toast |
| Combobox | WAI-ARIA completo `role="combobox"` com `aria-expanded` |
| Skip link | link skip-to-content no topo (`#main-content`) |
| Escape key | fecha todos os modais e limpa buffer de nav por teclado |
| Error messages | `role="alert"` em validação inline |
| Contrast (dark) | AA+ em todos os combos (7.58:1 AAA primary/secondary) |
| Contrast (light) | 16.4:1 AAA primary |
| Keyboard nav | atalhos `g+key` com overlay de ajuda visual (`?`) |
| Reduced motion | `prefers-reduced-motion` respeitado via framer-motion |

### Navegação por Teclado

Pressione `g`, solte, depois a tecla de destino (janela de buffer de 1s):

| Atalho | Página | Atalho | Página |
|---|---|---|---|
| `g+m` | Mapa | `g+d` | Dashboard |
| `g+l` | Lista | `g+u` | Usuários |
| `g+a` | Admin | `g+s` | Configurações |
| `g+i` | Login | `g+c` | Conta |
| `g+r` | Registro | `g+t` | Alternar tema |
| `?` | Mostrar ajuda | `Esc` | Limpar buffer |

Os atalhos são desabilitados quando o foco está em elemento input/textarea/select.

## Pessoas Contribuidoras

| Usuário | Contribuições |
|---|---|
| [caiocinel](https://github.com/caiocinel) | App mobile (Expo), login com Google e fluxo único por e-mail, sinalização cidadã e quarentena, criação de chamado por long-press/clique direito, app de operação, rotas inteligentes |

## Autores

| Foto do Autor | Nome | Link |
|---|---|---|
| <img src="https://github.com/josemurilors.png" width=115 alt="José Murilo Rodrigues Sabalo"> | José Murilo Rodrigues Sabalo | [Perfil no GitHub](https://github.com/josemurilors) |
| <img src="https://github.com/caiocinel.png" width=115 alt="caiocinel"> | caiocinel | [Perfil no GitHub](https://github.com/caiocinel) |

Demais membros do grupo do TCC serão adicionados aqui posteriormente.

## Licença

Este projeto está licenciado sob a licença **MIT**. O texto completo está disponível no arquivo `LICENSE`.

---

<a id="english"></a>


---

**English version:** [docs/README.en.md](docs/README.en.md)
