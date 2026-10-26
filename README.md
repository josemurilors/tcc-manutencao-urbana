<p align="center">
  <img src="icone-projeto.svg" alt="Central de Inteligência Urbana" width="200">
</p>

<h1 align="center">Central de Inteligência Urbana — Urban Intelligence Center</h1>

<p align="center">
  <img src="https://img.shields.io/badge/STATUS-EM%20PRODU%C3%87%C3%83O-green?style=for-the-badge" alt="Status">
  <img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" alt="License: MIT">
  <img src="https://img.shields.io/badge/stack-React%2019%20%7C%20Django%205%20%7C%20PostGIS-blueviolet?style=for-the-badge" alt="Stack">
  <img src="https://img.shields.io/badge/deploy-Hetzner%20VPS%20%2B%20Cloudflare-important?style=for-the-badge" alt="Deploy: Hetzner VPS + Cloudflare">
  <img src="https://img.shields.io/badge/python-3.13-3776AB?style=for-the-badge" alt="Python 3.13">
</p>

<p align="center">
  <a href="#português">🇧🇷 Português</a> · <a href="docs/README.en.md">🇺🇸 English</a>
</p>

---

<a id="português"></a>

## Descrição do Projeto

Central de Inteligência Urbana é uma plataforma para reportar e gerenciar
problemas de infraestrutura urbana (buracos, iluminação quebrada, calçadas
danificadas, árvores caídas etc.). O cidadão envia relato com foto + GPS, a IA
classifica e prioriza, a prefeitura executa e a gestão acompanha prazos e
resultados.

**Deploy:** [tcc.josemurilors.com.br](https://tcc.josemurilors.com.br) —
Hetzner (Nuremberg) ARM64, atrás de Cloudflare Tunnel.

**Stack:** React 19 + Vite 8 · Expo/React Native · Django 5.2/DRF ·
PostgreSQL 16/PostGIS 3.4 · ONNX Runtime (FastAPI) · Redis

> **Requisitos:** Node.js ≥ 22.12 (Vite 8) · Python 3.12–3.14 (a imagem usa
> `python:3.13-slim`) · Docker + Compose v2 · GDAL no host (`libgdal-dev`) só
> para rodar o Django fora do Docker · `uv` opcional para recriar o `.venv`.

## Status do Projeto

🚧 Em produção, em uso contínuo. O backend Django é o backend oficial; o app
em [`mobile/`](mobile/) é o cliente da v3; o frontend web está em
[`frontend/`](frontend/) e é legado. Novas entregas seguem de forma
incremental.

## Funcionalidades

- **Relato cidadão:** foto + GPS + categoria, com classificação por IA
  (7 categorias), detecção de spam e dedup (raio 50 m + cosseno ≥ 0,75)
- **Roteamento e prioridade:** categoria → secretaria responsável;
  prioridade por palavras-chave; alerta de cluster (5+ do mesmo tipo em 7 dias)
- **Fluxo de atendimento v3:** protocolo, linha do tempo, SLA, reabertura,
  avaliação, evidências antes/depois (detalhe em
  [`docs/arquitetura/contrato-v3.md`](docs/arquitetura/contrato-v3.md))
- **Mapas:** mapa de calor, clusters com ações em lote, perímetro municipal
  validado com PostGIS (`ST_Within` + tolerância de ~1 km na borda)
- **Painéis:** admin com KPIs e export CSV (web); BI completo por público na
  aba **Painel** do app
- **Apoio e sinalização cidadã:** upvotes, "já foi resolvido"/"não existe",
  gamificação (nível, EXP e ranking por cidade)
- **Moderação:** quarentena anti-spam por strikes, recusa de reports
  implausíveis, ofuscação Gaussiana das fotos enviadas (privacidade)
- **Contas:** entrada por e-mail (código de verificação), login com Google,
  2FA TOTP opcional, verificação de e-mail, gestão de usuários por hierarquia
- **Notificações:** Web Push (VAPID) no PWA e Expo Push no app, além da
  central in-app
- **Plataforma:** PWA com service worker, tema claro/escuro, WCAG AA,
  atalhos de teclado, mobile-first (detalhes em
  [`docs/frontend.md`](docs/frontend.md))

### Demonstração

**[tcc.josemurilors.com.br](https://tcc.josemurilors.com.br)**

## Plataforma v3

A v3 transforma a Central num produto de zeladoria urbana para prefeituras
(B2G): o cidadão reporta, a equipe de campo executa, a gestão acompanha prazos
e resultados, e a cidade publica os números. O cliente da v3 é o app em
[`mobile/`](mobile/) (iOS, Android e web); o vocabulário, o esquema e a API
compartilhados estão em
[`docs/arquitetura/contrato-v3.md`](docs/arquitetura/contrato-v3.md).

### O que o produto faz, por público

- `Cidadão`: abre chamado com foto e GPS e recebe um **protocolo**
  (`AAAA-NNNNNN`); acompanha a linha do tempo (Recebido → Em análise →
  Programado → Em execução → Resolvido / Não procede) pelo protocolo, sem
  login; apoia, sinaliza, avalia (1–5), reabre em até 30 dias e exporta os
  próprios dados (LGPD).
- `Operação`: fila priorizada por prazo e apoios, assumir chamado, mudar
  status, nota interna, resposta pública, foto de evidência e checklist.
  Funciona sem rede: as ações ficam numa fila e são reenviadas com
  `Idempotency-Key`.
- `Gestão`: BI do município (SLA, lead time P50/P90, CSAT, aging, hotspots,
  produtividade) com drill-down e exportação; administra secretarias, equipes,
  categorias, SLA, moderação e auditoria.

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

- `GET /api/v1/transparencia/<codigo_ibge>/` — indicadores dos últimos 90 dias
- `GET /api/v1/dados-abertos/<codigo_ibge>/chamados.csv` e `.geojson`
- Open311 GeoReport v2 (leitura): `/api/v1/open311/v2/services.json` e `requests.json`

### Notificações e agendador

Todo evento relevante vira aviso in-app e push (Expo Push; variáveis
`EXPO_PUSH_ENABLED` / `EXPO_ACCESS_TOKEN`). O serviço `scheduler` dos composes
roda `entrypoint.sh agendador` no fuso `America/Sao_Paulo`: `alertas_sla` de
hora em hora e `resumo_semanal` às segundas, a partir das 8h. Nenhum comando
repete aviso, então reiniciar ou rodar à mão é seguro.

```bash
docker compose up -d scheduler                 # produção (sobe junto no up -d)
docker compose exec backend python manage.py alertas_sla --dry-run
```

### Município de demonstração (`seed_demo`)

Gera um município realista para vendas e para o BI: cidadãos fictícios,
equipes e chamados que passam pelo ciclo de vida real, com datas retroativas
coerentes. Tudo que é demo usa e-mail `@demo.ciu`. Rodar de novo substitui a
demo anterior; `--limpar-demo` apaga só a demo.

```bash
scripts/seed-demo.sh                                  # DEV: São Paulo, 600 chamados, 180 dias
scripts/seed-demo.sh --municipio 3509502 --chamados 300 --dias 90
docker compose exec backend python manage.py seed_demo --municipio 3550308
```

### Testes do backend

`scripts/test-backend.sh` roda o pytest num container efêmero com banco de
teste próprio (`test_<sufixo>`), então execuções em paralelo não se atrapalham.
Requer a stack dev no ar.

```bash
scripts/test-backend.sh                                   # suíte inteira
scripts/test-backend.sh -k transicao                      # por nome
```

## Acesso ao Projeto

### Quick Start (Desenvolvimento)

```bash
git clone git@github.com:josemurilors/tcc-manutencao-urbana.git
cd tcc-manutencao-urbana

cp .env.example backend-python/.env
# Edite backend-python/.env: ENCRYPTION_KEY, DB_PASSWORD, etc.

docker compose -f docker-compose.dev.yml up -d backend redis   # puxa o postgres (PostGIS) junto
docker compose -f docker-compose.dev.yml exec backend python manage.py migrate
docker compose -f docker-compose.dev.yml --profile ia up -d ia # (opcional) serviço de IA

cd frontend && npm run dev
```

### Quick Start (Produção)

```bash
git clone git@github.com:josemurilors/tcc-manutencao-urbana.git
cd tcc-manutencao-urbana

cp .env.example .env
# Edite .env com os segredos de produção (o compose lê as variáveis da raiz)

docker compose up -d --build

# PostGIS (extensão + geometrias), primeira vez:
docker compose exec -T postgres psql -U urbana -d manutencao_urbana \
  -c "CREATE EXTENSION IF NOT EXISTS postgis;"
docker compose exec -T postgres psql -U urbana -d manutencao_urbana -c "
  ALTER TABLE municipios ADD COLUMN IF NOT EXISTS polygon_geom geometry(MultiPolygon, 4326);
  CREATE INDEX IF NOT EXISTS idx_municipios_polygon_geom ON municipios USING GIST (polygon_geom);
  ALTER TABLE defeitos ADD COLUMN IF NOT EXISTS geom geometry(Point, 4326)
    GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)) STORED;
  CREATE INDEX IF NOT EXISTS idx_defeitos_geom ON defeitos USING GIST (geom);"
```

O tráfego entra exclusivamente via **Cloudflare Tunnel** (`cloudflared`,
`tcc_tunnel`); as portas 80/443 da VPS ficam fechadas no firewall da nuvem. O
nginx usa o origin certificate em `./cloudflare/` (`cert.pem` + `key.pem`).

```bash
curl https://tcc.josemurilors.com.br/api/v1/health/
```

### App Mobile (Expo)

O app iOS/Android/web vive em [`mobile/`](mobile/) e consome a mesma API.

```bash
cd mobile && npm install && npm start   # QR code com o Expo Go
```

Detalhes de configuração e limitações: [`mobile/README.md`](mobile/README.md).

## Arquitetura

Diagramas da stack, do pipeline de deploy e da sequência de atendimento:
[`docs/arquitetura/diagramas.md`](docs/arquitetura/diagramas.md).

| Camada | Stack |
|---|---|
| Mobile | Expo SDK 57 + React Native 0.86 + Expo Router + react-native-maps (Leaflet no web) |
| Frontend | React 19 + Vite 8 + Leaflet + Framer Motion + Phosphor Icons |
| Backend | Django 5.2 + DRF (Gunicorn) + Redis |
| Database | PostgreSQL 16 + PostGIS 3.4 |
| IA | FastAPI + ONNX Runtime — paraphrase-multilingual-MiniLM-L12-v2 |
| Auth | simplejwt + BCrypt + login Google |
| Borda | Cloudflare (WAF/TLS) + Tunnel → nginx → backend |

O nginx serve o build da SPA e faz reverse-proxy de `/api/*` e `/uploads` para
o Django; o serviço de IA roda ao lado (profile `ia`), consumido pelo backend;
scheduler e backup (profiles próprios) usam a mesma imagem do backend. CI/CD:
GitHub Actions (`.github/workflows/deploy.yml`) — gitleaks, build, testes,
deploy via SSH e verificação de saúde. Backup: dump diário do Postgres com
retenção de 30 dias e upload opcional via rclone (`scripts/backup-postgres.sh`).

## API

A interface entre app, backend e documentação vive em
[`docs/arquitetura/contrato-v3.md`](docs/arquitetura/contrato-v3.md) — fonte
única das rotas, esquemas e vocabulário. Prefixos em `/api/v1/`:

| Prefixo | Conteúdo |
|---|---|
| `auth/` | entrada por e-mail, Google, perfil, push (VAPID) |
| `defeitos/` | chamados: criar, listar, apoiar, sinalizar, protocolo, operação |
| `operacao/` `bi/` `gestao/` `notificacoes/` | fila de campo, BI, administração, avisos |
| `transparencia/` `dados-abertos/` `open311/` | páginas públicas e dados abertos |
| `municipios/` `categorias/` | lookups (IBGE, categorias com SLA) |
| `health/` `csrf-token/` | verificação de saúde (200 se a API responde) e token CSRF |

## Segurança

- Senhas com bcrypt; JWT (simplejwt) com rotação de refresh; 2FA TOTP opcional
- CPF criptografado em repouso (AES-256-GCM) + HMAC para lookup único
- DRF `IsAuthenticated` por padrão; públicos com `AllowAny` explícito; CSRF
  `SameSite=Strict`; rate limiting com Redis
- Uploads: whitelist JPEG/PNG/WebP/AVIF, máx. 5 MB, compressão WebP ≤ 1200 px,
  blur de privacidade Gaussiano
- Contêiner Django sem root (uid 1001); HSTS e `SECURE_SSL_REDIRECT` em produção
- Segredos só por variáveis de ambiente (`ENCRYPTION_KEY`, `RESEND_API_KEY`,
  `GOOGLE_CLIENT_ID_*`, VAPID), nunca em código

## IA & Geoespacial

- **Classificação:** embeddings ONNX multilíngues (MiniLM-L12-v2, 384-dim) →
  7 centróides → softmax; fallback por palavras-chave se o serviço cair.
  Spam, duplicados, prioridade e roteamento no backend. Detalhe do pipeline:
  [`ia/README.md`](ia/README.md); métricas dos experimentos:
  [`ia/experimentos/RELATORIO_ACADEMICO.md`](ia/experimentos/RELATORIO_ACADEMICO.md)
- **Circuit breaker:** 3 falhas de IA → cooldown 60s; nunca bloqueia o relato
- **PostGIS:** `municipios.polygon_geom` (MultiPolygon IBGE, 5570 municípios) e
  `defeitos.geom` gerado por migração Django; validação de perímetro com
  `ST_Within` + buffer de tolerância

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

MIT — texto completo em [`LICENSE`](LICENSE).

---

**English version:** [docs/README.en.md](docs/README.en.md)
