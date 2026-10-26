# Backend (`backend-python/`)

API REST em Django 5.2 + DRF que atende o app (Android, iOS e web): chamados e
fluxo de atendimento, operação de campo, BI da gestão, administração do
município, transparência pública e notificações. Banco PostgreSQL 16 + PostGIS
3.4; Redis para cache, limites de taxa e o disjuntor da IA.

## Apps

| App | Papel |
| --- | --- |
| `defeitos/` | Chamados, fluxo de status (`fluxo.py`), SLA, protocolo, apoio, sinalização |
| `operacao/` | Fila de campo, transições, evidências, ordem de serviço, ações em lote |
| `bi/` | Painel da gestão, exportação, sugestões por regra e da IA leve (`sugestoes_ia.py`), transparência e dados abertos |
| `gestao/` | Secretarias, equipes, categorias por município, convites, auditoria |
| `users/` | Contas, entrada por código de e-mail, login com Google, papéis |
| `notificacoes/` | Avisos in-app e Expo Push |
| `services/` | Cliente da IA, e-mail, imagens, criptografia, ordem de serviço |
| `core/` | Configurações, permissões por papel, comandos (`seed_demo`, `alertas_sla`…) |

## Rodar

Pela raiz do repositório:

```bash
cp .env.example backend-python/.env
docker compose -f docker-compose.dev.yml up -d backend redis
docker compose -f docker-compose.dev.yml exec backend python manage.py migrate
curl http://localhost:8000/api/v1/health/
```

## Testes

```bash
scripts/test-backend.sh            # suíte inteira, num container com banco próprio
scripts/test-backend.sh -k bi      # por nome
```

Contrato da API: [`docs/arquitetura/contrato-v3.md`](../docs/arquitetura/contrato-v3.md).
