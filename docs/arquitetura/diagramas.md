# Diagramas da arquitetura

Gerado a partir de `docker-compose.yml`, `nginx.prod.conf`, `Dockerfile.postgres` e
`.github/workflows/deploy.yml`. Atualize junto com o código (regra de manutenção do
`contrato-v3.md`).

## 1. Arquitetura de runtime (produção)

```mermaid
flowchart TB
    subgraph clientes["Clientes"]
        W["Navegador PWA<br/>(frontend React/Vite)"]
        M["App móvel<br/>(Expo/React Native)"]
    end

    subgraph CF["Borda Cloudflare"]
        EDGE["Edge + WAF + rate limit<br/>TLS 1.3 no cliente"]
        TUN["tcc_tunnel (cloudflared)<br/>única entrada na VPS"]
    end

    subgraph VPS["VPS Hetzner (ARM64) — rede Docker interna"]
        NG["nginx :8080<br/>SPA + proxy /api + /uploads<br/>real-IP via ranges CF"]
        BE["Django/Gunicorn :8000<br/>JWT, RBAC, throttling,<br/>blur de privacidade nas fotos"]
        SCH["scheduler<br/>alertas_sla (hora em hora)<br/>resumo_semanal (seg 8h)"]
        PG[("PostgreSQL 16 + PostGIS<br/>imagem nativa: Dockerfile.postgres")]
        RD[("Redis 7<br/>cache/filas, máx. 64 MB")]
        IA["FastAPI :8000 (profile ia)<br/>classificação ONNX + fallback HF"]
        BK["backup (profile backup)<br/>dump diário 03:00 + rotação 30d"]
    end

    EXT1["Resend (e-mail)"]
    EXT2["Expo Push / VAPID"]
    EXT3["Hugging Face API<br/>(fallback opcional)"]
    EXT4["OSRM (rota/roteirização)"]

    W --> EDGE
    M --> EDGE
    EDGE --> TUN
    TUN -->|"http://nginx:8080"| NG
    NG -->|/api| BE
    BE --> PG
    BE --> RD
    BE -->|IA_URL| IA
    IA -->|classificação| EXT3
    BE --> EXT1
    BE --> EXT2
    M -->|rota| EXT4
    SCH -->|mesma imagem/env| BE
    BK -->|pg_dump| PG
```

Nenhuma porta da VPS é alcançável pela internet além de SSH (22): o bind 80/443
existe por herança de era pré-túnel e está bloqueado pelo firewall da nuvem; o
tráfego entra exclusivamente via Cloudflare Tunnel. O backend **não publica porta
no host** desde `e91b2b4` — só nginx alcança `backend:8000` pela rede interna.

## 2. Pipeline de deploy (GitHub Actions → VPS)

```mermaid
flowchart LR
    PUSH["git push master"] --> GL["gitleaks<br/>scan de segredos"]
    GL --> BUILD["docker compose build<br/>(CI amd64, mesma Dockerfile)"]
    BUILD --> TEST["PostgreSQL efêmero +<br/>pytest (Django) + lint/build frontend"]
    TEST -->|tudo verde| SSH["appleboy/ssh-action<br/>deploy_user@VPS (chave ed25519)"]
    SSH --> PULL["cd /opt/tcc-manutencao-urbana<br/>git pull origin master"]
    PULL --> DEP["compose build + up postgres +<br/>migracão PostGIS (GIN/geom) +<br/>up -d --build + image prune"]
    TEST -->|qualquer falha| STOP["deploy NÃO roda<br/>(VPS intacta)"]

    subgraph SEC["Secrets do GitHub"]
        S1["VPS_HOST / VPS_USER / VPS_SSH_KEY"]
    end
    SEC -.-> SSH
```

## 3. Sequência de uma solicitação de cidadão

```mermaid
sequenceDiagram
    participant U as Cidadão (PWA/app)
    participant CF as Cloudflare edge
    participant NG as nginx (VPS)
    participant BE as Django REST
    participant IA as Serviço de IA
    participant PG as PostGIS

    U->>CF: POST /api/v1/defeitos (foto + GPS)
    CF->>NG: via túnel (CF-Connecting-IP)
    NG->>BE: proxy /api (rate limit de uploads)
    BE->>BE: blur de privacidade na imagem
    BE->>IA: classificação do texto
    IA-->>BE: categoria (ONNX ou fallback HF)
    BE->>PG: INSERT + geometria (SRID 4326)
    BE-->>U: protocolo, status 201
    Note over BE: scheduler avisa SLA e envia<br/>push (Expo/VAPID) e e-mail (Resend)
```
