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
`prazo_em` = `criado_em + prazo_sla_dias` (recalculado se o SLA muda; na
reabertura vira `agora + prazo_sla_dias`, senão o chamado voltaria já vencido).
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
convites(id SERIAL PK, email TEXT NOT NULL, municipio_id TEXT NOT NULL, papel TEXT NOT NULL,
        secretaria_id INT REFERENCES secretarias(id) ON DELETE SET NULL,
        equipe_id INT REFERENCES equipes(id) ON DELETE SET NULL, token TEXT NOT NULL UNIQUE,
        convidado_por_id UUID REFERENCES users(id) ON DELETE SET NULL, criado_em TIMESTAMPTZ DEFAULT NOW(),
        expira_em TIMESTAMPTZ NOT NULL, aceito_em TIMESTAMPTZ,
        aceito_por_id UUID REFERENCES users(id) ON DELETE SET NULL)
        -- índices parciais (pendentes): lower(email), municipio_id
```

Tipos de `defeito_eventos.tipo`: `criado`, `status`, `atribuido`, `resposta_publica`,
`nota_interna` (publico=false), `apoio`, `sinalizacao`, `anexo`, `avaliacao`,
`reaberto`, `prioridade`, `sla`, `removido`, `moderacao`.
`apoio`: gravado por `POST <id>/apoiar/` quando quem apoia não é o autor
(público; `autor_nome` vazio para quem não é da equipe; desfazer o apoio apaga o
evento). O app agrega todos numa linha do histórico ("N pessoas confirmaram").
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
trata `status`/`reaberto`/`resposta_publica` públicos, `atribuido` e `removido` — ver 7.3.)

Extras de `fluxo.py`: `TransicaoNaoPermitida(TransicaoInvalida)` — transição
válida mas sem papel para ela (as views devolvem 403; `TransicaoInvalida`, 400);
`normalizar_status(s)` e `STATUS_LEGADOS` convertem valores antigos vindos de
apps desatualizados. `transicionar` também checa quem pode: equipe do município
(`pode_operar`); rejeitar/reabrir exige gestor+; o autor reabre o próprio
concluído até `REABERTURA_AUTOR_DIAS`; `papel='comunidade'` só conclui.
Soft delete: `Defeito.objects.ativos()` e `regras.remover(defeito, usuario, motivo)`.
`sla.py` traz ainda `normalizar`, `calcular_prazo`, `sla_vencido` e
`sla_restante_horas`. `notificacoes.servico.enviar_push(usuarios, titulo, corpo, dados)`
envia pelo Expo Push (ver 7.3).

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
| GET `fila/` | `status`, `categoria_id`, `secretaria_id`, `equipe_id`, `atribuicao=meus\|equipe\|sem\|todos`, `vencidos=1`, `bairro`, `q`, `ordenar=score\|prazo\|antigos\|apoios\|distancia`, `lat`, `lng`, `page` | paginado de `ChamadoFila` |
| GET `resumo/` | — | `{abertos, meus, vencidos, vencem_24h, sem_atribuicao, sinalizados, concluidos_hoje, parametros: {exigir_foto_conclusao, raio_evidencia_m}}` |
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

Detalhes da implementação (`backend-python/operacao/`):

- `fila/`: `status` aceita lista separada por vírgula e os grupos `abertos`
  (padrão), `fechados`, `todos`; `page_size` até 100 (padrão 20). Além dos
  campos acima, `ChamadoFila` traz `score_motivos: string[]` (o que mais pesou,
  em texto para o servidor). `distancia_m` só vem preenchido com `lat`/`lng`.
- As ações que devolvem "detalhe" usam o detalhe de defeitos mais os campos de
  `ChamadoFila`.
- `transicao/` para `concluido` exige foto (`foto` no multipart, ou uma
  evidência `depois` enviada antes por `evidencia/` desde a última reabertura)
  enquanto `municipio_config.parametros.exigir_foto_conclusao` não for `false`.
  A foto do ato vira anexo `depois` (ou `antes`, em outras transições).
  `checklist` aceita `string[]` (itens feitos), `[{item, feito}]` ou esse JSON
  como texto; é gravado normalizado em `dados.checklist` do evento de status.
- Evidências viram JPEG ≤ 1280 px sem EXIF; o evento `anexo` guarda
  `distancia_m` até o ponto e `fora_do_local: true` acima de
  `parametros.raio_evidencia_m` (padrão 150) — aceita, mas sinaliza.
- `atribuir/`: operador não toma chamado já assumido por outra pessoa (403);
  gestor reatribui. `liberar/` aceita `{motivo?}`; só o atendente ou gestor+.
- `anexos/` e `anexos/<id>/imagem/` são abertos para chamado público e
  ativo (restrito: equipe e autor); fora da equipe, `autor_nome` sai
  "Prefeitura" (antes/depois) ou mascarado (cidadão).
- `lote/` não leva foto: concluir em lote obedece à mesma exigência acima.
- Extra: GET `chamados/<id>/ordem-servico/` → PDF da OS (protocolo, equipe,
  responsável, prazo e checklist da categoria). As rotas legadas
  `GET defeitos/<id>/ordem_servico/` e `GET defeitos/operacao/` (fila sem
  paginação, teto de 2000) foram **removidas** (404); o app não as usa mais.
- `resumo/` traz `parametros` do município do usuário já com o padrão da
  plataforma no que a prefeitura não definiu (ou mandou `null`):
  `exigir_foto_conclusao` (padrão `true`) e `raio_evidencia_m` (150).
Como o app usa a 7.1 (aba Operação):

- `fila/` sem `status` = só abertos (`status=fechados` mostra os encerrados).
  `fila/` também aceita `vencem_24h=1` (prazo nas próximas 24 h, o mesmo
  recorte do contador do resumo) e `sinalizados=1` (algum "já resolvido" ou
  "não existe"); o app ainda recorta a página no cliente, por segurança.
  `secretaria_id` filtra pela secretaria efetiva: a do chamado ou, sem ela, a
  configurada para a categoria em `categoria_municipio` (mesma regra do BI).
- Ações mutáveis (`transicao`, `atribuir`, `liberar`, `nota`, `resposta`,
  `evidencia`, `lote`) levam a chave de idempotência — no cabeçalho
  `Idempotency-Key: <uuid>` (nativo) ou em `?idempotency_key=<uuid>` (web: o
  cabeçalho não está na lista do CORS e derrubaria o preflight). O backend
  guarda a primeira resposta 2xx por 24 h (por usuário e rota) e devolve a
  mesma com `Idempotent-Replayed: true` na repetição, sem executar de novo;
  erro não fica guardado; a mesma chave em paralelo recebe 409. O app ainda
  confere `transicao` repetida pelo detalhe (status já igual a `para` = feito).
- `transicao/` multipart (com `foto`) manda `checklist` como string JSON.
- `texto` em `transicao/` (e no `lote/`) é recado da equipe: vira um evento
  `nota_interna` (não público) separado do evento de status. Só na reabertura
  (fechado → `pendente`) ele é o motivo e fica no evento público `reaberto`.
- Rejeitar como duplicado busca o original por `GET defeitos/protocolo/<p>/`
  ou por `fila/?q=&status=todos` (o original pode estar fechado).
- A Ordem de Serviço da ficha usa `GET chamados/<id>/ordem-servico/`.
- "Concluir" lê `resumo.parametros.exigir_foto_conclusao`: com `false` a foto
  do depois fica opcional na folha; sem o campo (backend antigo) o app exige.
  O valor viaja no cache offline da fila junto com o resumo.
- A fila offline das ações drena com o app em qualquer tela
  (`OperacaoSyncProvider` no layout raiz), com uma pílula de pendências fora
  da aba Operação e a faixa dentro dela.
- A ficha mostra um bloco único de fotos: a do reporte (autor, ponto do
  reporte), os anexos `cidadao`/`antes`/`depois` (GPS e `autor_nome`) e, só
  quando não há anexo do mesmo tipo, as cópias legadas (`imagens_extra`,
  `foto_resolucao_url`). O visualizador em tela cheia manda
  `Authorization: Bearer` quando a URL é da API (anexo de chamado restrito).
- Ação em lote: botão "Selecionar" na lista (o web não tem toque longo), com
  "Marcar todos" os carregados; o toque longo segue valendo no celular.

### 7.2 Cidadão — `api/v1/defeitos/`

| método e rota | corpo / query | resposta |
|---|---|---|
| GET `<id>/eventos/` | — | `[{id, tipo, de_status, para_status, papel, texto, publico, criado_em}]` (internos só equipe) |
| POST `<id>/avaliar/` | `{nota: 1..5, comentario?}` (autor; só `concluido`; editável por 7 dias) | detalhe |
| POST `<id>/reabrir/` | `{motivo}` (autor até 30 dias após `resolvido_em`, ou gestor+) | detalhe |
| GET `proximos/` (público) | `lat, lng, categoria?, raio?` | `[{id, protocolo, titulo, categoria, status, distancia_m, criado_em, resolvido_em, total_apoios, raio_duplicado_m}]` (abertos no raio + resolvidos há ≤30 dias); cabeçalhos `X-Raio-Duplicado-M`, `X-Raio-M` |
| GET `protocolo/<protocolo>/` (público) | — | detalhe público |
| GET `area/` | + `situacao=abertos\|resolvidos\|todos` (padrão abertos), `categorias=<ids>` | como hoje, com `celulas` para todos os usuários |

Detalhes de 7.2 (implementação):

- `avaliar`: nota inteira 1–5 (3.5 é 400), `comentario` até 1000 caracteres.
  403 para quem não é o autor, 409 se o chamado não está `concluido` ou se a
  janela de edição (7 dias desde a 1ª avaliação **deste ciclo** de resolução)
  fechou; reaberto e resolvido de novo, vale avaliação nova. Grava
  `avaliacao_nota/_comentario/avaliado_em` e evento `avaliacao` público
  (`texto` = comentário, `dados = {nota, edicao}`). Gamificação:
  `XP_AVALIACAO` (5) uma vez por chamado avaliado; `progresso` e as linhas do
  ranking ganham `avaliacoes`. `avaliado_em` também sai na listagem
  (`meus/`, `area/`…): o app compara com `resolvido_em` para saber se a nota
  é da resolução atual (selo "Avaliar" depois de reaberto e resolvido de novo).
- `reabrir`: `motivo` com ≥5 caracteres (400). 409 se o chamado está aberto.
  Sem papel de gestão: 403 para terceiros, para o autor de chamado
  `rejeitado` e depois de `fluxo.REABERTURA_AUTOR_DIAS`. Passa por
  `fluxo.transicionar(…, 'pendente', texto=motivo)` (evento `reaberto`,
  `reaberturas += 1`).
- `proximos`: raio = `?raio=` (1–500 m), senão `municipio_config.raio_duplicado_m`
  do município do ponto, senão 30 m. O raio de duplicado do município (ou os
  30 m) vai em cada item (`raio_duplicado_m`) e no cabeçalho
  `X-Raio-Duplicado-M`, mesmo quando `?raio=` troca o raio da busca;
  `X-Raio-M` é o raio usado na busca. O app chama sem `?raio=` e usa
  `raio_duplicado_m` no "é o mesmo problema?" (mesma categoria, aberto, dentro
  do raio → apoiar o existente). **Desvio:** entram os abertos e só os
  `concluido` com `resolvido_em` ≤30 dias (rejeitados não ajudam quem vai
  reportar). `categoria` aceita id (`categoria_id`) ou nome (sem caixa). Ordem
  por distância, até 50 itens; cada item traz também `categoria_id`,
  `status_rotulo`, `latitude`, `longitude`.
- `protocolo/<protocolo>/`: sem diferenciar caixa; 404 para removido ou
  restrito que o visitante não pode ver (`regras.visivel_para`). Nome da rota:
  `defeitos-protocolo`.
- `area`: `resolvidos` = `concluido` com `resolvido_em` nos últimos 90 dias
  (`AREA_RESOLVIDOS_DIAS`); `todos` = abertos + esses resolvidos; rejeitados
  nunca. Na célula, abertos vêm antes dos resolvidos e a data de desempate é
  `resolvido_em` para resolvidos. `categorias=1,4` filtra por `categoria_id`
  (lixo → 400). A resposta ecoa `situacao`.
- Conta suspensa (`users.suspenso_ate` no futuro): criar, apoiar, sinalizar,
  anexar, avaliar e reabrir devolvem 403
  `{detail, codigo: 'conta_suspensa', suspenso_ate}`; ver e acompanhar segue
  liberado.
- Upload de foto (criar, `anexar`, `status` com `foto_resolucao`, `imagem`):
  até 8 MB, `Content-Type` `image/*` (ou vazio/`octet-stream`, que o Pillow
  decide); fora disso, 400 com mensagem. `imagem/` agora exige login.
- Limites (429, `users/throttles.py`, sobreponíveis por
  `settings.CIU_THROTTLE_TAXAS`): criar chamado 30/h por usuário, `imagem`
  30/h por usuário; ver 7.7 para as rotas de conta.

### 7.3 Notificações — `api/v1/notificacoes/` (autenticado)

GET `/` (paginado `[{id, tipo, titulo, corpo, defeito_id, lida_em, criado_em}]`),
GET `nao-lidas/` → `{total}`, POST `<id>/lida/`, POST `todas-lidas/`,
POST `push-tokens/` `{token, plataforma}`, DELETE `push-tokens/` `{token}`.
Tipos: `status`, `resposta`, `avaliar`, `apoio_marco`, `sla_alerta`, `atribuido`, `moderacao`,
`resumo` (resumo semanal do gestor; acrescentado na entrega das notificações).

Detalhes da implementação (`notificacoes/`):

- GET `/` aceita ainda `?nao_lidas=1` e `?tipo=`; sempre mais recentes primeiro.
  POST `<id>/lida/` devolve a notificação (404 se não for do usuário);
  POST `todas-lidas/` → `{atualizadas}`.
- POST `push-tokens/` aceita só tokens Expo (`ExponentPushToken[...]`/`ExpoPushToken[...]`,
  senão 400), responde `{token, plataforma}` com 201 (novo) ou 200 (já existia). O token
  é do aparelho: registrar numa conta move-o dessa conta para a nova. Até 10 por conta
  (os mais antigos saem). DELETE é idempotente (204); também aceita `?token=`.
- Push via Expo Push API (`notificacoes/push.py`): lotes de 100, timeout de 5 s,
  `DeviceNotRegistered` apaga o token. Payload `data` = `{tipo, defeito_id?, protocolo?}`
  — o app abre o chamado ao tocar. Settings/variáveis: `EXPO_PUSH_ENABLED` (padrão
  ligado; sempre desligado sob pytest se o setting não existir), `EXPO_PUSH_ASYNC`
  (padrão ligado: envio num pool de threads, fora da request), `EXPO_ACCESS_TOKEN`
  (opcional).
- Quem recebe o quê (`servico.ao_evento`): status público → autor ("Seu chamado
  2026-000123 (Buraco) está em execução") e apoiadores ("O chamado …, que você apoia,
  …"); ao concluir, o autor sem avaliação **deste ciclo** (nunca avaliou, ou
  `avaliado_em` < `resolvido_em` depois de reaberto) recebe `avaliar` no lugar de `status`;
  resposta pública → autor e apoiadores (`resposta`); atribuição → o operador
  atribuído, ou os membros da equipe se só ela foi definida (`atribuido`); remoção por
  moderação ou pela comunidade → o autor (`moderacao`); 5, 10 e 25 apoios de terceiros
  → o autor (`apoio_marco`, uma vez por marco; disparado pelo `post_save` de `Apoio`,
  já que apoiar não gera evento). Quem fez a ação nunca é avisado dela.
- `servico.notificar(usuarios, tipo, titulo, corpo='', defeito=None, *, com_push=True,
  dados_push=None)` é a porta de entrada para outros apps avisarem alguém (ex.:
  suspensão de conta → `moderacao`).
- `manage.py alertas_sla [--municipio X] [--vencidos-desde-dias 7] [--dry-run]` (rodar de
  hora em hora): chamados abertos que vencem em 24 h ou venceram → operador atribuído,
  membros da equipe e gestores/admins do município (gestor com `secretaria_id` só recebe
  os da sua secretaria). In-app um por chamado; push agrupado por pessoa. Sem repetir:
  a janela de deduplicação é `prazo_em - 24h` (vencendo) e `prazo_em` (vencido), então
  um prazo alterado volta a gerar alerta.
- `manage.py resumo_semanal [--municipio X] [--forcar] [--sem-email]` (segunda de manhã):
  `resumo` in-app para gestor/admin_municipal com recebidos, resolvidos (% no prazo),
  abertos, vencidos e CSAT da semana; e-mail também se `RESEND_API_KEY` estiver
  configurada. Não repete para quem recebeu nos últimos 6 dias.

Detalhes que o app assume: `lida/`, `todas-lidas/` e `push-tokens/` podem
responder 204 ou JSON; o token é o `ExponentPushToken[...]` e `plataforma` ∈
{`android`, `ios`}. O payload `data` do push leva `{defeito_id, tipo,
notificacao_id?}` — o toque abre `/chamado/<defeito_id>`; sem `defeito_id`,
`tipo: resumo` abre o painel (`/(tabs)/painel`) e os demais abrem a central
(`/notificacoes`). A central usa `?nao_lidas=1` no filtro "Não lidas". `aceite-termos/`
responde `{user}` (o app também aceita `{aceite_termos_em}`); sessão aberta com
`aceite_termos_em: null` (inclusive login Google de conta existente) é bloqueada
por um portão de aceite no layout raiz até aceitar ou sair.

### 7.4 BI — `api/v1/bi/` (gestor+)

Filtros comuns: `inicio`, `fim` (YYYY-MM-DD; padrão últimos 30 dias),
`categoria_id`, `secretaria_id`, `equipe_id`, `bairro`.
Percentuais (`pct_*`, `taxa_resolucao`, `reabertura_pct`) em 0–100; tempos
(`*_h`) em horas. `kpis_anterior` cobre a janela de mesma duração logo antes
de `inicio`; KPI sem dado vem `null` (o app mostra "—"). `relatorio/` aceita
também os filtros de recorte (`categoria_id`, `secretaria_id`, `equipe_id`,
`bairro`). Drill-down do painel: o app lista a fatia tocada por `bi/chamados/`
(mesmos filtros e mesma regra de contagem, então a lista bate com o número).
`categoria_id`/`secretaria_id`/`equipe_id`/`bairro` aceitam também as chaves
especiais de `distribuicao/`: `nenhum` (grupo "Sem ...") e, em categoria e
secretaria, `nome:<texto>` (legado sem id). A secretaria de um chamado é a
gravada nele ou, sem ela, a de `categoria_municipio` para a categoria
(secretaria efetiva — vale para filtro, distribuição, exportação e dados
públicos).

| rota | resposta |
|---|---|
| GET `kpis/?comparar=1` | `{periodo:{inicio,fim}, anterior:{inicio,fim}, kpis, kpis_anterior}`; `kpis = {recebidos, resolvidos, rejeitados, backlog, backlog_vencido, pct_no_prazo, lead_time_p50_h, lead_time_p90_h, primeira_resposta_p50_h, taxa_resolucao, reabertura_pct, csat_media, csat_respostas, cidadaos_ativos}` |
| GET `series/?granularidade=dia\|semana\|mes` | `[{periodo, recebidos, resolvidos, backlog}]` |
| GET `distribuicao/?dimensao=categoria\|bairro\|secretaria\|equipe\|status` | `[{chave, rotulo, recebidos, abertos, resolvidos, vencidos, pct_no_prazo, lead_time_p50_h}]` |
| GET `aging/` | `[{faixa: "0-2d"\|"3-7d"\|"8-15d"\|"16-30d"\|">30d", total, vencidos}]` |
| GET `produtividade/` | `[{usuario_id, nome, equipe_nome, concluidos, lead_time_p50_h, em_andamento}]` |
| GET `hotspots/` | `{celulas: [{lat, lng, total, categoria_top, bairro_top}], reincidencia: [{bairro, rua, categoria, categoria_id, ocorrencias}]}` |
| GET `satisfacao/` | `{media, respostas, distribuicao: {1..5}, comentarios: [{nota, comentario, protocolo, criado_em}]}` |
| GET `chamados/?recorte=abertos\|vencidos\|recebidos\|resolvidos\|rejeitados&status=&page=&page_size=` | página DRF `{count, next, previous, results: [{id, protocolo, titulo, status, status_rotulo, categoria_id, categoria_nome, bairro, rua, prioridade, latitude, longitude, secretaria_id, secretaria_nome, equipe_id, equipe_nome, atendente_nome, criado_em, resolvido_em, prazo_em, sla_vencido, sla_restante_horas, no_prazo}]}` |
| GET `exportar/?formato=csv\|xlsx` | arquivo |
| GET `relatorio/?mes=YYYY-MM` | PDF |

Definições (implementadas em `bi/consultas.py`; limites do período à meia-noite
de America/Sao_Paulo, `fim` inclusivo, máximo 731 dias):

- `resolvidos` = hoje em `concluido` com `resolvido_em` no período (resolvido e
  reaberto deixa de contar); `rejeitados` = hoje em `rejeitado`, fechado no período;
  `backlog` = abertos no fim do período; `backlog_vencido` = do backlog, `prazo_em`
  antes do corte (fim do período, ou agora se ele não acabou).
- `pct_no_prazo` = resolvidos com `resolvido_em <= prazo_em` / resolvidos **com
  prazo** (sem SLA não há prazo a perder); `lead_time_*` = `resolvido_em - criado_em`
  (`percentile_cont`); `primeira_resposta_p50_h` = dos recebidos, o menor entre o
  1º evento público da equipe (≠ `criado`) e `triado_em`; `taxa_resolucao` = dos
  recebidos no período, % já resolvidos no fim dele; `reabertura_pct` = resolvidos
  com `reaberturas > 0` / resolvidos; `csat_*` por `avaliado_em`;
  `cidadaos_ativos` = autores ou apoiadores distintos. Percentuais 0–100 com 1 casa;
  `null` quando o denominador é zero.
- `kpis/`: sem `comparar=1`, `anterior` e `kpis_anterior` vêm `null`. A janela
  anterior tem o mesmo número de dias, imediatamente antes.
- `series/`: buckets com zero preenchidos; semana começa na segunda; `periodo` é a
  data de início do bucket já cortada no período (`AAAA-MM` em `mes`); `backlog` é o
  estoque aberto no fim do bucket.
- `distribuicao/`: `chave` é o id em texto (categoria/secretaria efetiva/equipe),
  `nome:<texto>` para chamados antigos sem id ou `nenhum` para o grupo sem valor;
  bairro em minúsculas; status canônico. Toda chave volta como filtro.
- `chamados/`: `recorte` (padrão `abertos`) usa a mesma flag do número —
  `abertos` = backlog no fim do período, `vencidos` = `backlog_vencido`,
  `recebidos`/`resolvidos`/`rejeitados` = os KPIs homônimos; `status` restringe
  à situação atual. `page_size` padrão 20, máximo 100. `sla_*` medidos agora
  (só para abertos); `no_prazo` só para resolvidos com prazo.
- `aging/` sempre traz as 5 faixas (idade em dias completos no corte).
- `produtividade/`: servidores do município (e quem atendeu algo no escopo);
  `em_andamento` = abertos hoje com o servidor como atendente.
- `hotspots/`: células de 0,002° (~200 m) dos recebidos, com o bairro mais comum
  (`bairro_top`); `reincidencia` = mesma rua+bairro+categoria com 2+ chamados no
  período (até 20).
- `exportar/`: um chamado recebido no período por linha (até 50 mil), sem dado do
  cidadão; CSV com BOM e `;` (Excel pt-BR); XLSX gerado sem dependência extra.
  Colunas em `consultas.COLUNAS_EXPORTACAO`. Gera `audit_log` `bi.exportar`.
- `relatorio/`: `mes` padrão = mês anterior; compara com o mês civil anterior;
  aceita os filtros comuns (impressos pelo nome na capa); gera `audit_log` `bi.relatorio`.
- `?municipio=` de gestor apontando para outra cidade → 403 (não cai em silêncio
  no próprio município).

### 7.5 Transparência e dados abertos (públicos, sem PII)

- GET `api/v1/transparencia/<codigo>/` → `{municipio:{codigo,nome,uf_sigla}, contratado,
  kpis_90d:{recebidos, resolvidos, pct_no_prazo, tempo_mediano_dias, csat_media},
  por_categoria:[{categoria, icone, recebidos, resolvidos, tempo_mediano_dias, pct_no_prazo}],
  serie_mensal:[{mes, recebidos, resolvidos}], ultimos_resolvidos:[{id, protocolo, titulo,
  categoria, bairro, resolvido_em, tem_foto_depois}]}`
- GET `api/v1/dados-abertos/<codigo>/chamados.csv` e `.geojson` (coordenadas com 4 casas).
- Open311 GeoReport v2 (leitura): `api/v1/open311/v2/services.json`, `requests.json`.

Detalhes (implementados em `bi/publico.py`, throttle anônimo 60/min):

- Transparência: cache de 10 min; campo extra `atualizado_em`; município
  inexistente → 404. Agregados contam todos os chamados não removidos; listas
  (`ultimos_resolvidos`, dados abertos, Open311) só os `visibilidade='publica'`.
- Dados abertos: colunas `protocolo, categoria, status, situacao (rótulo cidadão),
  orgao_responsavel, bairro, rua, latitude, longitude, criado_em, prazo_em,
  resolvido_em, no_prazo, total_apoios`; `?inicio=&fim=` (AAAA-MM-DD) opcionais sobre
  a abertura; sem título/descrição; até 100 mil linhas; CSV com BOM e `;`.
- Open311: `jurisdiction_id` (código IBGE) obrigatório; `service_request_id` =
  protocolo; `service_code` = id da categoria; sem filtro de data/id devolve os
  últimos 90 dias, até 1000; também `v2/requests/<protocolo>.json`; erros no formato
  `[{code, description}]`. Só JSON (sem XML).

### 7.6 Gestão — `api/v1/gestao/`

| rota | quem | nota |
|---|---|---|
| GET/PATCH `municipio/` | GET equipe, PATCH admin_municipal | `MunicipioConfig` + nome/uf |
| CRUD `secretarias/`, `equipes/` | admin_municipal (GET gestor+) | |
| GET/POST `membros/`, PATCH/DELETE `membros/<id>/` | GET gestor+, escrita admin_municipal | GET paginado; POST `{email, papel, secretaria_id?, equipe_id?}` vincula conta existente ou, sem conta, cria convite; DELETE volta a cidadão |
| GET `convites/`, DELETE `convites/<id>/`, POST `convites/<id>/reenviar/` | GET gestor+, escrita admin_municipal | convites pendentes de quem ainda não tem conta |
| GET `categorias/`, PATCH `categorias/<categoria_id>/` | GET equipe, PATCH admin_municipal | `{categoria_id, nome, icone, prazo_sla_dias, prioridade, secretaria_id, ativo, checklist}` |
| GET `moderacao/` | gestor+ | `{sinalizados, removidos, usuarios}` |
| POST `moderacao/defeitos/<id>/remover/` `{motivo}`, `.../restaurar/` | gestor+ | |
| POST `moderacao/usuarios/<id>/suspender/` `{dias, motivo}`, `.../reativar/` | gestor+ | |
| GET `auditoria/?acao=&usuario_id=` | admin_municipal | paginado; `?formato=csv` exporta |

Todas as escritas chamam `core.auditoria.registrar`.

Detalhes da implementação (`gestao/views.py`, regras em `gestao/servicos.py`):

- Município da rota: o do usuário; `?municipio=` só vale para o `super_admin`
  (outro papel com código diferente do seu → 403; código inexistente → 404).
  Servidor sem município → 400. Ids de outra cidade → 404.
- Erros 400 trazem `{detail, campos?}` (`campos` = erros por campo do DRF).
- `municipio/`: `{municipio_id, nome, uf_sigla, contratado, nome_exibicao, cor_primaria (#RRGGBB),
  email_contato, telefone, site, raio_duplicado_m (5..500), parametros, atualizado_em}`;
  `contratado` só o `super_admin` altera (403 para os demais). `parametros` é substituído
  inteiro no PATCH; chaves conhecidas (lidas pela operação, padrão entre parênteses):
  `exigir_foto_conclusao` bool (ausente = `true`), `raio_evidencia_m` inteiro 20..2000 (150).
  Tipo errado → 400.
- `secretarias/` e `equipes/` devolvem **lista** (não paginada).
  Secretaria: `{id, nome, sigla, email, ativo, criado_em, total_equipes}`.
  Equipe: `{id, nome, secretaria_id, secretaria_nome, ativo, criado_em, total_membros}`.
  Filtros: `?ativo=1`; equipes também `?secretaria_id=`. Nome repetido (sem caixa) → 409.
  DELETE → 204: apaga se nada aponta para ela, senão só desativa (`ativo=false`).
  Secretaria/equipe referenciada no corpo precisa estar ativa, salvo se for o vínculo que o
  registro já tem (reenviar o valor atual não dá 400).
- `membros/` é **paginado** (DRF, 30 por página, `page_size` ≤ 100; ordem: papel mais alto,
  depois nome) com itens `{id, nome, email, papel, nivel, secretaria_id, secretaria_nome,
  equipe_id, equipe_nome, suspenso_ate, chamados_abertos, criado_em}`; filtros `q`, `papel`,
  `equipe_id`, `secretaria_id`, `page`. POST: `email` é buscado sem caixa entre as contas
  existentes (não exige domínio com ponto). E-mail sem conta → 201
  `{convite, email_enviado}` (ver convites abaixo; `papel=super_admin` por convite → 400);
  servidor de outra cidade ou já da equipe → 409; `papel=super_admin` só pelo super admin (403). Equipe informada puxa a
  secretaria dela. Ninguém muda o próprio papel nem se revoga (400); ninguém mexe em papel
  acima do seu (403); rebaixar/revogar o último `admin_municipal` → 409. DELETE → 200
  `{id, papel: "cidadao", chamados_liberados}`: os chamados abertos dele perdem o atendente
  (evento interno `atribuido` com `dados.motivo = "membro_revogado"`).
- `convites/`: **lista** dos pendentes (não aceitos, inclusive vencidos) do município,
  `{id, email, papel, secretaria_id, secretaria_nome, equipe_id, equipe_nome,
  convidado_por_nome, criado_em, expira_em, expirado}` (o `token` não sai na API). Convidar
  de novo um e-mail com convite pendente no mesmo município atualiza papel/lotação e renova o
  prazo (não duplica). Validade: 14 dias. O e-mail sai por `services.email_service` (Resend);
  sem `RESEND_API_KEY` ou com falha, o convite vale assim mesmo e `email_enviado = false`.
  `reenviar/` → 200 `{convite, email_enviado}` (renova o prazo, inclusive de vencido);
  DELETE → 204 (cancela). Id de outra cidade ou já aceito → 404.
  **Aceite:** ao entrar com o e-mail **verificado** — `verificar-email/`, `login/` (conta já
  verificada) ou `google/` — `gestao.servicos.aplicar_convite` aplica o convite pendente e
  válido mais recente: `papel`, `municipio_id` e a lotação (secretaria/equipe ainda ativas),
  marca `aceito_em`/`aceito_por_id` e audita `convite.aceitar`. Só o cadastro (`register/`,
  e-mail ainda não verificado) não aplica. Quem já é da equipe não é alterado.
  Auditoria: `convite.{criar,reenviar,cancelar,aceitar}`.
- `categorias/` devolve **lista** com, além dos campos acima, `personalizado` e
  `base: {prazo_sla_dias, prioridade}`. PATCH aceita `prazo_sla_dias` (1..365), `prioridade`,
  `secretaria_id` (`null` nesses três = volta ao padrão), `ativo`, `checklist` (≤20 itens) e
  responde a regra efetiva + `chamados_recalculados`. Mudou o prazo efetivo → os chamados
  abertos da categoria no município que ainda tinham o prazo antigo ganham o novo
  `prazo_sla_dias`/`prazo_em` e um evento interno `sla` (`dados.origem = "categoria"`);
  prazo ajustado à mão num chamado prevalece.
- `moderacao/`: `sinalizados` (abertos com sinalização, até 100: dados do chamado +
  `autor_id, autor_nome, total_resolvido, total_nao_existe, total_apoios`), `removidos`
  (até 50, + `removido_em, removido_motivo, removido_texto`), `usuarios` (cidadãos ligados ao município
  suspensos ou com strike ativo: `{id, nome, suspenso_ate, suspenso, strikes_ativos,
  em_quarentena, chamados_removidos}`) e `contagens: {sinalizados, removidos, suspensos,
  em_quarentena}`. `removido_motivo` é a ORIGEM (`moderacao` | `comunidade` | `autor`);
  `removido_texto` é o texto do último evento `removido` (o motivo escrito pelo gestor).
  Remover grava `removido_motivo = "moderacao"` via `regras.remover` (evento `removido` com
  `texto` = motivo digitado, que vira o corpo do aviso ao autor) e responde
  `{id, protocolo, removido_em, removido_motivo, removido_texto}`; restaurar grava evento
  `moderacao` e, se a remoção foi comunitária, retira o strike do autor
  (`strike_retirado`). Já removido/não removido → 409. Suspender (`dias` 1..365) e reativar
  avisam o cidadão (`notificacoes.servico.notificar`, tipo `moderacao`, com push) e respondem
  `{id, nome, suspenso_ate, suspenso}`; servidor ou a si mesmo → 400; reativar quem não
  está suspenso → 409. `gestao.servicos.usuario_suspenso(user)` é o teste que as rotas de
  chamado devem usar para barrar suspensos.
- `auditoria/`: paginado (30 por página, `page_size` ≤ 100) `{id, acao, usuario_id, usuario_nome,
  municipio_id, alvo_tipo, alvo_id, dados, ip, criado_em}`; filtros `acao` (exata ou prefixo:
  `acao=membro` traz `membro.*`), `usuario_id`, `alvo_tipo`, `alvo_id`, `inicio`, `fim`.
  `?formato=csv` devolve os mesmos filtros em CSV (`text/csv`, `;`, BOM UTF-8, até 20.000
  linhas, `Content-Disposition: attachment; filename="auditoria-<municipio>-<data>.csv"`):
  colunas `data_hora, usuario, usuario_id, acao, alvo_tipo, alvo_id, ip, dados` (`dados` em JSON).
  Ações: `municipio.config`, `secretaria.{criar,alterar,desativar,excluir}`,
  `equipe.{criar,alterar,desativar,excluir}`, `membro.{vincular,alterar,revogar}`,
  `categoria.alterar`, `moderacao.{remover,restaurar}`, `usuario.{suspender,reativar}`.
  `dados` traz `nome` do alvo (pessoa, secretaria, equipe, categoria) ou `protocolo`/`titulo`
  (chamado), e `antes`/`depois` nas alterações. Outras apps também auditam aqui:
  `defeito.{remover,sla,prioridade}` (`dados.de/para`), `resposta_padrao.{criar,editar,excluir}`,
  `bi.{exportar,relatorio}`, `lgpd.exportacao`, `usuario.{papel,municipio}` (rotas antigas).
  `ip` = `X-Real-IP` do nginx, senão o último item do `X-Forwarded-For` (o primeiro é forjável).
- `python manage.py seed_gestao_demo <codigo>` cria (idempotente) as secretarias de Obras e
  Infraestrutura, Serviços Urbanos, Trânsito e Mobilidade e Meio Ambiente, seis equipes e o
  roteamento das categorias base para elas.

### 7.7 Conta e LGPD — `api/v1/auth/`

POST `senha/esqueci/` `{email}` (resposta sempre 200), POST `senha/redefinir/`
`{email, codigo, nova_senha}`, POST `aceite-termos/`, GET `meus-dados/`
(exportação JSON). O objeto `user` passa a trazer `papel, municipio_id,
secretaria_id, equipe_id, aceite_termos_em, suspenso_ate`.

Detalhes de 7.7 (implementação):

- `senha/esqueci/`: e-mail malformado é 400; fora isso, sempre 200
  `{message}` igual, exista a conta ou não. O código de 6 dígitos usa
  `codigo_2fa`/`codigo_2fa_expira` (10 min, o mesmo da verificação de
  e-mail) e no máximo 5 envios por conta por hora (`requestsCount`/
  `requestsResetAt`).
- `senha/redefinir/`: nova senha ≥6 caracteres; erro único 400 para conta
  inexistente, código errado ou expirado. Sucesso: troca a senha, apaga o
  código, marca o e-mail como verificado.
- `register/` aceita `aceite_termos: true` (grava `aceite_termos_em`).
  `aceite-termos/` (autenticado) grava agora e devolve `{user}`.
- `meus-dados/` (autenticado): `{gerado_em, usuario, chamados (inclusive
  removidos), apoios, sinalizacoes, avaliacoes, strikes, notificacoes}`, com
  `Content-Disposition: attachment`; registra `lgpd.exportacao` na auditoria.
- Limites (429): `login/` 10/min por IP e 20/h por e-mail; `existe/` 10/min
  por IP; `verificar-email/` 5 a cada 10 min por usuário; `reenviar-codigo/`
  5/h; `senha/esqueci/` 5/h por IP e por e-mail; `senha/redefinir/` 5 a cada
  10 min por e-mail; `meus-dados/` 10/h. Cache Redis com fail-open.
No app: `aceite-termos/` recebe `{versao}` (hoje `2026-10`; campo opcional para
o backend) e pode responder o `user` ou `{aceite_termos_em}`. `aceite_termos_em:
null` no `user` faz o app pedir o aceite antes de abrir a sessão (ausente = não
pede). O app chama `aceite-termos/` logo após `register/`, com o token recém-
emitido. `senha/redefinir/` não precisa devolver tokens: o app faz login com a
senha nova. O app relê `GET auth/profile/` a cada boot (papel, suspensão).
