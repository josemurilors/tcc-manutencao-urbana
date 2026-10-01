# Contrato de domínio — CIU v3

Este documento fixa o vocabulário, o esquema de dados e as funções de serviço que
o backend (`backend-python/`) e o app (`mobile/`) compartilham. Toda feature nova
parte daqui. Ao mudar algo descrito aqui, atualize este arquivo no mesmo commit.

## 1. Ciclo de vida do chamado

Status canônicos (coluna `defeitos.status`):

| status         | rótulo cidadão  | rótulo operação | aberto? |
|----------------|-----------------|-----------------|---------|
| `pendente`     | Recebido        | Novo            | sim     |
| `em_analise`   | Em análise      | Em triagem      | sim     |
| `agendado`     | Programado      | Programado      | sim     |
| `em_andamento` | Em execução     | Em execução     | sim     |
| `concluido`    | Resolvido       | Concluído       | não     |
| `rejeitado`    | Não procede     | Rejeitado       | não     |

Legados, convertidos pelo `bootstrap_schema` (idempotente):
`vinculado_sem_resposta`, `vinculado_com_resposta` → `em_andamento`;
`atendido`, `encerrado` → `concluido`.

Transições permitidas (`defeitos/fluxo.py::TRANSICOES`):

```text
pendente     → em_analise | agendado | em_andamento | concluido | rejeitado
em_analise   → agendado | em_andamento | concluido | rejeitado
agendado     → em_analise | em_andamento | concluido | rejeitado
em_andamento → agendado | concluido | rejeitado
concluido    → pendente   (reabertura: autor até 30 dias, ou gestor+)
rejeitado    → pendente   (reabertura: gestor+)
```

- `rejeitado` exige `motivo_rejeicao` ∈ {`duplicado`, `fora_da_competencia`,
  `nao_localizado`, `ja_resolvido`, `improcedente`, `outro`}; `duplicado` exige
  `duplicado_de` (chamado aberto ou fechado do mesmo município).
- Mudar para `concluido` pela operação pode levar `resposta_publica` e foto de
  evidência (`depois`). A comunidade (regras.py) também conclui — o evento fica
  com `papel='comunidade'`.

Timestamps (todos `TIMESTAMPTZ NULL`, gravados **somente** por `fluxo.py`):
`triado_em` (1ª saída de `pendente`), `atribuido_em` (1ª atribuição a equipe ou
operador), `iniciado_em` (1º `em_andamento`), `resolvido_em` (último
`concluido`), `fechado_em` (último status fechado; zera ao reabrir).
`prazo_em` = `criado_em + prazo_sla_dias` (recalculado se o SLA muda).
`reaberturas INT DEFAULT 0`.

## 2. Esquema novo (em `core/management/commands/bootstrap_schema.py`)

Tudo com `IF NOT EXISTS`/`ADD COLUMN IF NOT EXISTS`, idempotente.

### `defeitos` — colunas novas

`protocolo TEXT UNIQUE` (formato `AAAA-NNNNNN`, sequência global
`defeitos_protocolo_seq`; backfill pela ordem de `criado_em`),
`categoria_id INT REFERENCES categorias(id)`,
`secretaria_id INT REFERENCES secretarias(id)`, `equipe_id INT REFERENCES equipes(id)`,
`triado_em`, `atribuido_em`, `iniciado_em`, `resolvido_em`, `fechado_em`, `prazo_em`,
`reaberturas INT NOT NULL DEFAULT 0`,
`resposta_publica TEXT NOT NULL DEFAULT ''`,
`motivo_rejeicao TEXT NOT NULL DEFAULT ''`,
`duplicado_de UUID REFERENCES defeitos(id) ON DELETE SET NULL`,
`avaliacao_nota SMALLINT CHECK (1..5)`, `avaliacao_comentario TEXT NOT NULL DEFAULT ''`,
`avaliado_em TIMESTAMPTZ`,
`removido_em TIMESTAMPTZ`, `removido_motivo TEXT NOT NULL DEFAULT ''` (soft delete;
listagens filtram `removido_em IS NULL`).

Índices: `(municipio_id, status)`, `(municipio_id, criado_em)`, `(prazo_em)` parcial
em abertos, `(equipe_id)`, `(protocolo)`.

### Tabelas novas

```sql
secretarias(id SERIAL PK, municipio_id TEXT NOT NULL, nome TEXT NOT NULL, sigla TEXT DEFAULT '',
            email TEXT DEFAULT '', ativo BOOL DEFAULT TRUE, criado_em TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(municipio_id, nome))
equipes(id SERIAL PK, municipio_id TEXT NOT NULL, secretaria_id INT REFERENCES secretarias(id),
        nome TEXT NOT NULL, ativo BOOL DEFAULT TRUE, criado_em TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(municipio_id, nome))
categoria_municipio(id SERIAL PK, municipio_id TEXT NOT NULL, categoria_id INT NOT NULL REFERENCES categorias(id),
        prazo_sla_dias INT, prioridade TEXT, secretaria_id INT REFERENCES secretarias(id),
        ativo BOOL DEFAULT TRUE, checklist JSONB DEFAULT '[]', UNIQUE(municipio_id, categoria_id))
municipio_config(municipio_id TEXT PK, contratado BOOL DEFAULT FALSE, nome_exibicao TEXT DEFAULT '',
        cor_primaria TEXT DEFAULT '', email_contato TEXT DEFAULT '', telefone TEXT DEFAULT '',
        site TEXT DEFAULT '', raio_duplicado_m INT DEFAULT 30, parametros JSONB DEFAULT '{}',
        atualizado_em TIMESTAMPTZ DEFAULT NOW())
defeito_eventos(id BIGSERIAL PK, defeito_id UUID NOT NULL REFERENCES defeitos(id) ON DELETE CASCADE,
        tipo TEXT NOT NULL, de_status TEXT, para_status TEXT,
        autor_id UUID REFERENCES users(id) ON DELETE SET NULL, papel TEXT NOT NULL DEFAULT '',
        publico BOOL NOT NULL DEFAULT TRUE, texto TEXT NOT NULL DEFAULT '', dados JSONB NOT NULL DEFAULT '{}',
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW())
        -- índices (defeito_id, criado_em), (tipo, criado_em)
defeito_anexos(id BIGSERIAL PK, defeito_id UUID NOT NULL REFERENCES defeitos(id) ON DELETE CASCADE,
        tipo TEXT NOT NULL CHECK (tipo IN ('cidadao','antes','depois')), imagem BYTEA NOT NULL,
        latitude DOUBLE PRECISION, longitude DOUBLE PRECISION,
        autor_id UUID REFERENCES users(id) ON DELETE SET NULL, criado_em TIMESTAMPTZ DEFAULT NOW())
respostas_padrao(id SERIAL PK, municipio_id TEXT NOT NULL, titulo TEXT NOT NULL, texto TEXT NOT NULL,
        categoria_id INT REFERENCES categorias(id), ativo BOOL DEFAULT TRUE, criado_em TIMESTAMPTZ DEFAULT NOW())
audit_log(id BIGSERIAL PK, usuario_id UUID REFERENCES users(id) ON DELETE SET NULL, municipio_id TEXT,
        acao TEXT NOT NULL, alvo_tipo TEXT DEFAULT '', alvo_id TEXT DEFAULT '', dados JSONB DEFAULT '{}',
        ip TEXT DEFAULT '', criado_em TIMESTAMPTZ DEFAULT NOW())   -- índice (municipio_id, criado_em)
notificacoes(id BIGSERIAL PK, usuario_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tipo TEXT NOT NULL, titulo TEXT NOT NULL, corpo TEXT DEFAULT '',
        defeito_id UUID REFERENCES defeitos(id) ON DELETE CASCADE, lida_em TIMESTAMPTZ,
        criado_em TIMESTAMPTZ DEFAULT NOW())                         -- índice (usuario_id, criado_em)
push_tokens(id SERIAL PK, usuario_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token TEXT NOT NULL UNIQUE, plataforma TEXT DEFAULT '', criado_em TIMESTAMPTZ DEFAULT NOW(),
        ultimo_uso TIMESTAMPTZ DEFAULT NOW())
```

Tipos de `defeito_eventos.tipo`: `criado`, `status`, `atribuido`, `resposta_publica`,
`nota_interna` (publico=false), `apoio`, `sinalizacao`, `anexo`, `avaliacao`,
`reaberto`, `prioridade`, `sla`, `removido`, `moderacao`.
`papel` do autor no momento: `cidadao`, `operador`, `gestor`, `admin_municipal`,
`super_admin`, `comunidade`, `sistema`.

### `users` — colunas novas

`papel TEXT NOT NULL DEFAULT 'cidadao'` ∈ {`cidadao`, `operador`, `gestor`,
`admin_municipal`, `super_admin`}; `secretaria_id INT`, `equipe_id INT`,
`suspenso_ate TIMESTAMPTZ`, `aceite_termos_em TIMESTAMPTZ`.
Backfill: `admin=1` → `admin_municipal` (o e-mail `SUPER_ADMIN_EMAIL` → `super_admin`).
`admin` continua existindo e é mantido em sincronia (`1` se papel ≠ cidadão)
para compatibilidade.

## 3. Papéis e permissões (`core/permissoes.py`)

Um servidor atua em **um** município (`users.municipio_id`). Hierarquia:
`operador` < `gestor` < `admin_municipal`; `super_admin` gere qualquer município,
mas opera só no seu.

| capacidade                                   | operador | gestor | admin_mun. |
|----------------------------------------------|:--------:|:------:|:----------:|
| ver fila / assumir / mudar status / evidência |    ✓     |   ✓    |     ✓      |
| rejeitar, marcar duplicado, reabrir           |          |   ✓    |     ✓      |
| atribuir a equipe/operador, alterar SLA       |          |   ✓    |     ✓      |
| BI, exportações                               |          |   ✓    |     ✓      |
| moderação (remover, suspender)                |          |   ✓    |     ✓      |
| equipe/papéis, secretarias, categorias, config|          |        |     ✓      |

API pública do módulo (assinaturas fixas):

```python
PAPEIS_EQUIPE = ('operador', 'gestor', 'admin_municipal', 'super_admin')
def papel(user) -> str
def eh_equipe(user) -> bool                      # operador+
def nivel(user) -> int                           # cidadao 0, operador 1, gestor 2, admin_municipal 3, super_admin 4
def pode_operar(user, defeito_ou_municipio_id) -> bool
def pode_gerir(user, municipio_id) -> bool       # gestor+ no município (super_admin: qualquer)
def pode_administrar(user, municipio_id) -> bool # admin_municipal+ (super_admin: qualquer)
class EhEquipe(BasePermission), EhGestor(BasePermission), EhAdminMunicipal(BasePermission)
```

Auditoria (`core/auditoria.py`): `registrar(request_ou_user, acao, alvo_tipo='', alvo_id='', dados=None, municipio_id=None)`.

## 4. Serviços de domínio

`defeitos/fluxo.py`:

```python
STATUS_ABERTOS, STATUS_FECHADOS, TRANSICOES, MOTIVOS_REJEICAO, ROTULOS_CIDADAO, ROTULOS_OPERACAO
class TransicaoInvalida(ValueError)
def transicionar(defeito, para, autor, *, papel=None, texto='', resposta_publica='', motivo='',
                 duplicado_de=None, dados=None) -> Defeito   # valida, grava timestamps e evento, notifica
def registrar_evento(defeito, tipo, autor=None, *, papel=None, publico=True, texto='', dados=None,
                     de_status=None, para_status=None) -> DefeitoEvento
def atribuir(defeito, autor, *, equipe_id=None, atendente_id=None) -> Defeito
```

`transicionar` chama `notificacoes.servico.ao_evento(defeito, evento)` em
`transaction.on_commit`; o import é tardio e tolera o app ausente.
(Na prática quem agenda é `registrar_evento`, para todo evento; `ao_evento`
filtra os públicos de `status`/`resposta_publica`.)

Extras de `fluxo.py`: `TransicaoNaoPermitida(TransicaoInvalida)` — transição
válida mas sem papel para ela (as views devolvem 403; `TransicaoInvalida`, 400);
`normalizar_status(s)` e `STATUS_LEGADOS` convertem valores antigos vindos de
apps desatualizados. `transicionar` também checa quem pode: equipe do município
(`pode_operar`); rejeitar/reabrir exige gestor+; o autor reabre o próprio
concluído até `REABERTURA_AUTOR_DIAS`; `papel='comunidade'` só conclui.
Soft delete: `Defeito.objects.ativos()` e `regras.remover(defeito, usuario, motivo)`.
`sla.py` traz ainda `normalizar`, `calcular_prazo`, `sla_vencido` e
`sla_restante_horas`. `notificacoes.servico.enviar_push(usuarios, titulo, corpo, dados)`
é no-op até existir o transporte de push.

Serializers de chamado nunca expõem `usuario`, `usuario_email` nem ids de
usuário: `autor_nome` sai mascarado ("Maria S.") e `atendente_id` nulo para quem
não é da equipe do município; `eh_autor` e `tem_atendente` cobrem o que o app
precisa saber. Histórico: `GET /api/v1/defeitos/<id>/eventos/` (internos só
para a equipe do município).

`defeitos/sla.py`: `regra_para(categoria_nome, municipio_id) -> {categoria_id, prazo_sla_dias,
prioridade, secretaria_id, secretaria_nome}` — `categoria_municipio` sobrepõe a
tabela `categorias`; busca por nome sem acento/caixa.

## 5. App (mobile)

- `services/api.ts` exporta `request`, `paginated` e `API_URL`. Cada área nova
  cria seu próprio `services/api-<area>.ts` e `types/<area>.ts` em vez de
  inflar `api.ts`/`types.ts`.
- `constants/status.ts` é a única fonte de rótulo/cor/ícone de status, com
  `rotuloCidadao(status)` e `rotuloOperacao(status)`.
- Nenhuma tela engole erro em `catch {}`: use o estado de erro do design system.

## 6. Onde mora cada modelo (Django, todos `managed=False`)

| app            | modelos                                                                  |
|----------------|--------------------------------------------------------------------------|
| `defeitos`     | `Defeito`, `Apoio`, `Sinalizacao`, `Strike`, `DefeitoEvento`, `DefeitoAnexo`, `RespostaPadrao` |
| `gestao` (novo)| `Secretaria`, `Equipe`, `CategoriaMunicipio`, `MunicipioConfig`, `AuditLog` |
| `notificacoes` (novo) | `Notificacao`, `PushToken`; `servico.py` com `ao_evento(defeito, evento)` |
| `bi` (novo)    | sem modelos; consultas sobre `defeitos` + `defeito_eventos`              |

Rotas: `api/v1/gestao/`, `api/v1/notificacoes/`, `api/v1/bi/`,
`api/v1/transparencia/` (pública), `api/v1/dados-abertos/` (pública),
`api/v1/operacao/` (fila e ações da equipe).

## 7. API v3 (contrato entre backend e app)

Convenções: JSON; datas ISO 8601; horas como float; listas grandes paginadas
no formato DRF (`{count, next, previous, results}`, `?page=`); erros
`{detail}` com status 400/403/404/409. "Município do usuário" = `users.municipio_id`;
`super_admin` pode passar `?municipio=<codigo>` nas rotas de gestão/BI.

### 7.1 Operação — `api/v1/operacao/` (equipe: operador+)

| método e rota | corpo / query | resposta |
|---|---|---|
| GET `fila/` | `status`, `categoria_id`, `equipe_id`, `atribuicao=meus\|equipe\|sem\|todos`, `vencidos=1`, `bairro`, `q`, `ordenar=score\|prazo\|antigos\|apoios\|distancia`, `lat`, `lng`, `page` | paginado de `ChamadoFila` |
| GET `resumo/` | — | `{abertos, meus, vencidos, vencem_24h, sem_atribuicao, sinalizados, concluidos_hoje}` |
| POST `chamados/<id>/transicao/` | `{para, texto?, resposta_publica?, motivo?, duplicado_de?, checklist?}`; multipart com `foto`, `latitude`, `longitude` quando houver evidência | detalhe do chamado |
| POST `chamados/<id>/atribuir/` | `{equipe_id?, atendente_id?}` (operador só pode `atendente_id`= si mesmo) | detalhe |
| POST `chamados/<id>/liberar/` | — | detalhe |
| POST `chamados/<id>/nota/` | `{texto}` | evento |
| POST `chamados/<id>/resposta/` | `{texto}` | evento |
| POST `chamados/<id>/evidencia/` | multipart `{foto, tipo: antes\|depois, latitude, longitude}` | anexo |
| GET `chamados/<id>/anexos/` | — | `[{id, tipo, url, latitude, longitude, autor_nome, criado_em}]` |
| GET `anexos/<id>/imagem/` | — | `image/jpeg` (equipe, ou público se o chamado é público) |
| POST `chamados/<id>/sla/` | `{prazo_sla_dias, motivo}` (gestor+) | detalhe |
| POST `chamados/<id>/prioridade/` | `{prioridade: baixa\|media\|alta\|urgente}` (gestor+) | detalhe |
| POST `lote/` | `{ids, acao: transicao\|atribuir, ...campos da ação}` | `{ok: [ids], erros: [{id, detail}]}` |
| GET/POST `respostas-padrao/`, PATCH/DELETE `respostas-padrao/<id>/` | `{titulo, texto, categoria_id?}` (escrita gestor+) | `RespostaPadrao` |
| GET `equipes/` | — | `[{id, nome, secretaria_nome, membros: [{id, nome, papel}]}]` |

`ChamadoFila` = campos da listagem de defeitos + `protocolo, score, prazo_em,
sla_restante_horas, sla_vencido, distancia_m, atendente_id, atendente_nome,
equipe_id, equipe_nome, total_apoios, total_resolvido, total_nao_existe,
checklist: string[]`. `score` (0–100) pondera prioridade, SLA restante,
apoios, idade e sinalizações; a fórmula fica documentada em `operacao/fila.py`.

Como o app usa a 7.1 (aba Operação):

- `fila/` sem `status` = só abertos. Para os contadores `vencem_24h` e
  `sinalizados` do resumo, o app manda também `vencem_24h=1` e `sinalizados=1`
  (opcionais: o backend pode ignorar, o app recorta a página no cliente).
- Ações mutáveis (`transicao`, `atribuir`, `liberar`, `nota`, `resposta`,
  `evidencia`, `lote`) levam o cabeçalho `Idempotency-Key: <uuid>`: a fila
  offline reenvia a mesma chave, e o backend deve devolver o mesmo resultado
  (ou tolerar a repetição). Sem suporte, o app confere `transicao` repetida
  pelo detalhe (status já igual a `para` = feito).
- `transicao/` multipart (com `foto`) manda `checklist` como string JSON.
- Rejeitar como duplicado busca o original por `GET defeitos/protocolo/<p>/`
  ou por `fila/?q=`.

### 7.2 Cidadão — `api/v1/defeitos/`

| método e rota | corpo / query | resposta |
|---|---|---|
| GET `<id>/eventos/` | — | `[{id, tipo, de_status, para_status, papel, texto, publico, criado_em}]` (internos só equipe) |
| POST `<id>/avaliar/` | `{nota: 1..5, comentario?}` (autor; só `concluido`; editável por 7 dias) | detalhe |
| POST `<id>/reabrir/` | `{motivo}` (autor até 30 dias após `resolvido_em`, ou gestor+) | detalhe |
| GET `proximos/` (público) | `lat, lng, categoria?, raio?` | `[{id, protocolo, titulo, categoria, status, distancia_m, criado_em, resolvido_em, total_apoios}]` (abertos no raio + fechados há ≤30 dias) |
| GET `protocolo/<protocolo>/` (público) | — | detalhe público |
| GET `area/` | + `situacao=abertos\|resolvidos\|todos` (padrão abertos), `categorias=<ids>` | como hoje, com `celulas` para todos os usuários |

### 7.3 Notificações — `api/v1/notificacoes/` (autenticado)

GET `/` (paginado `[{id, tipo, titulo, corpo, defeito_id, lida_em, criado_em}]`),
GET `nao-lidas/` → `{total}`, POST `<id>/lida/`, POST `todas-lidas/`,
POST `push-tokens/` `{token, plataforma}`, DELETE `push-tokens/` `{token}`.
Tipos: `status`, `resposta`, `avaliar`, `apoio_marco`, `sla_alerta`, `atribuido`, `moderacao`.

### 7.4 BI — `api/v1/bi/` (gestor+)

Filtros comuns: `inicio`, `fim` (YYYY-MM-DD; padrão últimos 30 dias),
`categoria_id`, `secretaria_id`, `equipe_id`, `bairro`.

| rota | resposta |
|---|---|
| GET `kpis/?comparar=1` | `{periodo:{inicio,fim}, anterior:{inicio,fim}, kpis, kpis_anterior}`; `kpis = {recebidos, resolvidos, rejeitados, backlog, backlog_vencido, pct_no_prazo, lead_time_p50_h, lead_time_p90_h, primeira_resposta_p50_h, taxa_resolucao, reabertura_pct, csat_media, csat_respostas, cidadaos_ativos}` |
| GET `series/?granularidade=dia\|semana\|mes` | `[{periodo, recebidos, resolvidos, backlog}]` |
| GET `distribuicao/?dimensao=categoria\|bairro\|secretaria\|equipe\|status` | `[{chave, rotulo, recebidos, abertos, resolvidos, vencidos, pct_no_prazo, lead_time_p50_h}]` |
| GET `aging/` | `[{faixa: "0-2d"\|"3-7d"\|"8-15d"\|"16-30d"\|">30d", total, vencidos}]` |
| GET `produtividade/` | `[{usuario_id, nome, equipe_nome, concluidos, lead_time_p50_h, em_andamento}]` |
| GET `hotspots/` | `{celulas: [{lat, lng, total, categoria_top}], reincidencia: [{bairro, rua, categoria, ocorrencias}]}` |
| GET `satisfacao/` | `{media, respostas, distribuicao: {1..5}, comentarios: [{nota, comentario, protocolo, criado_em}]}` |
| GET `exportar/?formato=csv\|xlsx` | arquivo |
| GET `relatorio/?mes=YYYY-MM` | PDF |

### 7.5 Transparência e dados abertos (públicos, sem PII)

- GET `api/v1/transparencia/<codigo>/` → `{municipio:{codigo,nome,uf_sigla}, contratado,
  kpis_90d:{recebidos, resolvidos, pct_no_prazo, tempo_mediano_dias, csat_media},
  por_categoria:[{categoria, icone, recebidos, resolvidos, tempo_mediano_dias, pct_no_prazo}],
  serie_mensal:[{mes, recebidos, resolvidos}], ultimos_resolvidos:[{id, protocolo, titulo,
  categoria, bairro, resolvido_em, tem_foto_depois}]}`
- GET `api/v1/dados-abertos/<codigo>/chamados.csv` e `.geojson` (coordenadas com 4 casas).
- Open311 GeoReport v2 (leitura): `api/v1/open311/v2/services.json`, `requests.json`.

### 7.6 Gestão — `api/v1/gestao/`

| rota | quem | nota |
|---|---|---|
| GET/PATCH `municipio/` | GET equipe, PATCH admin_municipal | `MunicipioConfig` + nome/uf |
| CRUD `secretarias/`, `equipes/` | admin_municipal (GET gestor+) | |
| GET/POST `membros/`, PATCH/DELETE `membros/<id>/` | GET gestor+, escrita admin_municipal | POST `{email, papel, secretaria_id?, equipe_id?}` vincula conta existente; DELETE volta a cidadão |
| GET `categorias/`, PATCH `categorias/<categoria_id>/` | GET equipe, PATCH admin_municipal | `{categoria_id, nome, icone, prazo_sla_dias, prioridade, secretaria_id, ativo, checklist}` |
| GET `moderacao/` | gestor+ | `{sinalizados, removidos, usuarios}` |
| POST `moderacao/defeitos/<id>/remover/` `{motivo}`, `.../restaurar/` | gestor+ | |
| POST `moderacao/usuarios/<id>/suspender/` `{dias, motivo}`, `.../reativar/` | gestor+ | |
| GET `auditoria/?acao=&usuario_id=` | admin_municipal | paginado |

Todas as escritas chamam `core.auditoria.registrar`.

### 7.7 Conta e LGPD — `api/v1/auth/`

POST `senha/esqueci/` `{email}` (resposta sempre 200), POST `senha/redefinir/`
`{email, codigo, nova_senha}`, POST `aceite-termos/`, GET `meus-dados/`
(exportação JSON). O objeto `user` passa a trazer `papel, municipio_id,
secretaria_id, equipe_id, aceite_termos_em, suspenso_ate`.
