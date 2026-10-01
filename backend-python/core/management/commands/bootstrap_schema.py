from django.core.management.base import BaseCommand
from django.db import connection


SCHEMA = [
    """
    CREATE EXTENSION IF NOT EXISTS postgis
    """,
    """
    CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nome TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        senha TEXT NOT NULL,
        admin INTEGER NOT NULL DEFAULT 0,
        municipio_id TEXT,
        cpf TEXT,
        cpf_hash TEXT UNIQUE,
        email_verificado INTEGER NOT NULL DEFAULT 0,
        codigo_2fa TEXT,
        codigo_2fa_expira TEXT,
        requestsresetat TEXT,
        requestscount INTEGER NOT NULL DEFAULT 0,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS municipios (
        codigo TEXT PRIMARY KEY,
        nome TEXT NOT NULL,
        uf TEXT NOT NULL,
        uf_sigla TEXT NOT NULL,
        min_lat DOUBLE PRECISION,
        max_lat DOUBLE PRECISION,
        min_lng DOUBLE PRECISION,
        max_lng DOUBLE PRECISION,
        poligono_json JSONB,
        polygon_geom geometry(MultiPolygon, 4326)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS categorias (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL UNIQUE,
        icone TEXT NOT NULL DEFAULT '',
        prioridade_base TEXT NOT NULL DEFAULT 'media',
        prazo_sla_dias INTEGER NOT NULL DEFAULT 7
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS defeitos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        usuario UUID REFERENCES users(id) ON DELETE SET NULL,
        titulo TEXT NOT NULL,
        descricao TEXT NOT NULL DEFAULT '',
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        localizacao geometry(Point, 4326),
        rua TEXT NOT NULL DEFAULT '',
        bairro TEXT NOT NULL DEFAULT '',
        imagem_url TEXT NOT NULL DEFAULT '',
        categoria TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pendente',
        prioridade TEXT NOT NULL DEFAULT '',
        previsao_conclusao TEXT NOT NULL DEFAULT '',
        atendido_em TEXT NOT NULL DEFAULT '',
        secretaria_responsavel TEXT NOT NULL DEFAULT '',
        prazo_sla_dias INTEGER NOT NULL DEFAULT 0,
        usuario_email TEXT NOT NULL DEFAULT '',
        imagem_thumbnail BYTEA,
        foto_resolucao BYTEA,
        imagens_extra TEXT NOT NULL DEFAULT '[]',
        atualizacoes TEXT NOT NULL DEFAULT '[]',
        atendente_id UUID REFERENCES users(id) ON DELETE SET NULL,
        municipio_id TEXT,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_defeitos_usuario ON defeitos(usuario)
    """,
    """
    ALTER TABLE defeitos ADD COLUMN IF NOT EXISTS municipio_id TEXT
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_defeitos_municipio ON defeitos(municipio_id)
    """,
    # Chamados anteriores à coluna (ou cujo município não resolveu na hora)
    # ganham a cidade pelo polígono. Idempotente: só toca em quem está nulo.
    """
    UPDATE defeitos d SET municipio_id = m.codigo
    FROM municipios m
    WHERE d.municipio_id IS NULL
      AND d.latitude IS NOT NULL AND d.longitude IS NOT NULL
      AND m.polygon_geom IS NOT NULL
      AND ST_Contains(m.polygon_geom::geometry, ST_SetSRID(ST_MakePoint(d.longitude, d.latitude), 4326))
    """,
    """
    ALTER TABLE defeitos ADD COLUMN IF NOT EXISTS secretaria_responsavel TEXT NOT NULL DEFAULT ''
    """,
    """
    ALTER TABLE defeitos ADD COLUMN IF NOT EXISTS prazo_sla_dias INTEGER NOT NULL DEFAULT 0
    """,
    """
    ALTER TABLE defeitos ADD COLUMN IF NOT EXISTS foto_resolucao BYTEA
    """,
    """
    CREATE TABLE IF NOT EXISTS apoios (
        id SERIAL PRIMARY KEY,
        usuario_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        defeito_id UUID NOT NULL REFERENCES defeitos(id) ON DELETE CASCADE,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (usuario_id, defeito_id)
    )
    """,
    """
    -- 'publica' ou 'restrita' (autor em quarentena: só quem está perto vê).
    ALTER TABLE defeitos ADD COLUMN IF NOT EXISTS visibilidade TEXT NOT NULL DEFAULT 'publica'
    """,
    """
    -- Um strike por chamado apagado como "nunca existiu" pela comunidade. O
    -- chamado em si é apagado de verdade; guardamos só quem reportou e quando.
    CREATE TABLE IF NOT EXISTS strikes (
        id SERIAL PRIMARY KEY,
        usuario_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        titulo TEXT NOT NULL DEFAULT '',
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    """
    -- Sinalização do cidadão sobre um chamado aberto: "já foi resolvido" ou
    -- "não existe". Uma por usuário por chamado (o tipo pode ser trocado).
    CREATE TABLE IF NOT EXISTS sinalizacoes (
        id SERIAL PRIMARY KEY,
        usuario_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        defeito_id UUID NOT NULL REFERENCES defeitos(id) ON DELETE CASCADE,
        tipo TEXT NOT NULL CHECK (tipo IN ('resolvido', 'nao_existe')),
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (usuario_id, defeito_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY,
        usuario_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint TEXT NOT NULL,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
]

# Esquema v3 (docs/arquitetura/contrato-v3.md, seção 2). Tudo idempotente:
# o comando roda a cada subida do container.
SCHEMA_V3 = [
    # --- Estrutura da prefeitura -------------------------------------------
    """
    CREATE TABLE IF NOT EXISTS secretarias (
        id SERIAL PRIMARY KEY,
        municipio_id TEXT NOT NULL,
        nome TEXT NOT NULL,
        sigla TEXT DEFAULT '',
        email TEXT DEFAULT '',
        ativo BOOLEAN DEFAULT TRUE,
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (municipio_id, nome)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS equipes (
        id SERIAL PRIMARY KEY,
        municipio_id TEXT NOT NULL,
        secretaria_id INT REFERENCES secretarias(id),
        nome TEXT NOT NULL,
        ativo BOOLEAN DEFAULT TRUE,
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (municipio_id, nome)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS categoria_municipio (
        id SERIAL PRIMARY KEY,
        municipio_id TEXT NOT NULL,
        categoria_id INT NOT NULL REFERENCES categorias(id),
        prazo_sla_dias INT,
        prioridade TEXT,
        secretaria_id INT REFERENCES secretarias(id),
        ativo BOOLEAN DEFAULT TRUE,
        checklist JSONB DEFAULT '[]',
        UNIQUE (municipio_id, categoria_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS municipio_config (
        municipio_id TEXT PRIMARY KEY,
        contratado BOOLEAN DEFAULT FALSE,
        nome_exibicao TEXT DEFAULT '',
        cor_primaria TEXT DEFAULT '',
        email_contato TEXT DEFAULT '',
        telefone TEXT DEFAULT '',
        site TEXT DEFAULT '',
        raio_duplicado_m INT DEFAULT 30,
        parametros JSONB DEFAULT '{}',
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
    )
    """,
    # --- Chamados: colunas novas -------------------------------------------
    "CREATE SEQUENCE IF NOT EXISTS defeitos_protocolo_seq",
    "ALTER TABLE defeitos ADD COLUMN IF NOT EXISTS protocolo TEXT UNIQUE",
    "ALTER TABLE defeitos ADD COLUMN IF NOT EXISTS categoria_id INT REFERENCES categorias(id)",
    "ALTER TABLE defeitos ADD COLUMN IF NOT EXISTS secretaria_id INT REFERENCES secretarias(id)",
    "ALTER TABLE defeitos ADD COLUMN IF NOT EXISTS equipe_id INT REFERENCES equipes(id)",
    "ALTER TABLE defeitos ADD COLUMN IF NOT EXISTS triado_em TIMESTAMPTZ",
    "ALTER TABLE defeitos ADD COLUMN IF NOT EXISTS atribuido_em TIMESTAMPTZ",
    "ALTER TABLE defeitos ADD COLUMN IF NOT EXISTS iniciado_em TIMESTAMPTZ",
    "ALTER TABLE defeitos ADD COLUMN IF NOT EXISTS resolvido_em TIMESTAMPTZ",
    "ALTER TABLE defeitos ADD COLUMN IF NOT EXISTS fechado_em TIMESTAMPTZ",
    "ALTER TABLE defeitos ADD COLUMN IF NOT EXISTS prazo_em TIMESTAMPTZ",
    "ALTER TABLE defeitos ADD COLUMN IF NOT EXISTS reaberturas INT NOT NULL DEFAULT 0",
    "ALTER TABLE defeitos ADD COLUMN IF NOT EXISTS resposta_publica TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE defeitos ADD COLUMN IF NOT EXISTS motivo_rejeicao TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE defeitos ADD COLUMN IF NOT EXISTS duplicado_de UUID REFERENCES defeitos(id) ON DELETE SET NULL",
    """
    ALTER TABLE defeitos ADD COLUMN IF NOT EXISTS avaliacao_nota SMALLINT
        CHECK (avaliacao_nota BETWEEN 1 AND 5)
    """,
    "ALTER TABLE defeitos ADD COLUMN IF NOT EXISTS avaliacao_comentario TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE defeitos ADD COLUMN IF NOT EXISTS avaliado_em TIMESTAMPTZ",
    # Soft delete: listagens filtram `removido_em IS NULL`; o dado continua no
    # BI e na auditoria.
    "ALTER TABLE defeitos ADD COLUMN IF NOT EXISTS removido_em TIMESTAMPTZ",
    "ALTER TABLE defeitos ADD COLUMN IF NOT EXISTS removido_motivo TEXT NOT NULL DEFAULT ''",
    "CREATE INDEX IF NOT EXISTS idx_defeitos_municipio_status ON defeitos(municipio_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_defeitos_municipio_criado ON defeitos(municipio_id, criado_em)",
    """
    CREATE INDEX IF NOT EXISTS idx_defeitos_prazo_abertos ON defeitos(prazo_em)
        WHERE status IN ('pendente', 'em_analise', 'agendado', 'em_andamento')
    """,
    "CREATE INDEX IF NOT EXISTS idx_defeitos_equipe ON defeitos(equipe_id)",
    "CREATE INDEX IF NOT EXISTS idx_defeitos_protocolo ON defeitos(protocolo)",
    # --- Histórico, anexos e respostas --------------------------------------
    """
    CREATE TABLE IF NOT EXISTS defeito_eventos (
        id BIGSERIAL PRIMARY KEY,
        defeito_id UUID NOT NULL REFERENCES defeitos(id) ON DELETE CASCADE,
        tipo TEXT NOT NULL,
        de_status TEXT,
        para_status TEXT,
        autor_id UUID REFERENCES users(id) ON DELETE SET NULL,
        papel TEXT NOT NULL DEFAULT '',
        publico BOOLEAN NOT NULL DEFAULT TRUE,
        texto TEXT NOT NULL DEFAULT '',
        dados JSONB NOT NULL DEFAULT '{}',
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_eventos_defeito ON defeito_eventos(defeito_id, criado_em)",
    "CREATE INDEX IF NOT EXISTS idx_eventos_tipo ON defeito_eventos(tipo, criado_em)",
    """
    CREATE TABLE IF NOT EXISTS defeito_anexos (
        id BIGSERIAL PRIMARY KEY,
        defeito_id UUID NOT NULL REFERENCES defeitos(id) ON DELETE CASCADE,
        tipo TEXT NOT NULL CHECK (tipo IN ('cidadao', 'antes', 'depois')),
        imagem BYTEA NOT NULL,
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        autor_id UUID REFERENCES users(id) ON DELETE SET NULL,
        criado_em TIMESTAMPTZ DEFAULT NOW()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_anexos_defeito ON defeito_anexos(defeito_id)",
    """
    CREATE TABLE IF NOT EXISTS respostas_padrao (
        id SERIAL PRIMARY KEY,
        municipio_id TEXT NOT NULL,
        titulo TEXT NOT NULL,
        texto TEXT NOT NULL,
        categoria_id INT REFERENCES categorias(id),
        ativo BOOLEAN DEFAULT TRUE,
        criado_em TIMESTAMPTZ DEFAULT NOW()
    )
    """,
    # --- Auditoria e notificações --------------------------------------------
    """
    CREATE TABLE IF NOT EXISTS audit_log (
        id BIGSERIAL PRIMARY KEY,
        usuario_id UUID REFERENCES users(id) ON DELETE SET NULL,
        municipio_id TEXT,
        acao TEXT NOT NULL,
        alvo_tipo TEXT DEFAULT '',
        alvo_id TEXT DEFAULT '',
        dados JSONB DEFAULT '{}',
        ip TEXT DEFAULT '',
        criado_em TIMESTAMPTZ DEFAULT NOW()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_audit_municipio ON audit_log(municipio_id, criado_em)",
    """
    CREATE TABLE IF NOT EXISTS notificacoes (
        id BIGSERIAL PRIMARY KEY,
        usuario_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tipo TEXT NOT NULL,
        titulo TEXT NOT NULL,
        corpo TEXT DEFAULT '',
        defeito_id UUID REFERENCES defeitos(id) ON DELETE CASCADE,
        lida_em TIMESTAMPTZ,
        criado_em TIMESTAMPTZ DEFAULT NOW()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_notificacoes_usuario ON notificacoes(usuario_id, criado_em)",
    """
    CREATE TABLE IF NOT EXISTS push_tokens (
        id SERIAL PRIMARY KEY,
        usuario_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token TEXT NOT NULL UNIQUE,
        plataforma TEXT DEFAULT '',
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        ultimo_uso TIMESTAMPTZ DEFAULT NOW()
    )
    """,
    # --- Usuários: papéis ----------------------------------------------------
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS papel TEXT NOT NULL DEFAULT 'cidadao'",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS secretaria_id INT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS equipe_id INT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS suspenso_ate TIMESTAMPTZ",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS aceite_termos_em TIMESTAMPTZ",
]

# Backfills do v3, na ordem. Cada um só toca em quem ainda não foi convertido,
# então rodar de novo não muda nada.
BACKFILL_V3 = [
    # Status legados -> canônicos (contrato, seção 1).
    """
    UPDATE defeitos SET status = 'em_andamento'
    WHERE status IN ('vinculado_sem_resposta', 'vinculado_com_resposta')
    """,
    "UPDATE defeitos SET status = 'concluido' WHERE status IN ('atendido', 'encerrado')",
    # Papel: admin=1 vira admin_municipal; `admin` segue espelhando o papel.
    "UPDATE users SET papel = 'admin_municipal' WHERE admin = 1 AND papel = 'cidadao'",
    """
    UPDATE users SET admin = CASE WHEN papel = 'cidadao' THEN 0 ELSE 1 END
    WHERE admin <> CASE WHEN papel = 'cidadao' THEN 0 ELSE 1 END
    """,
    # Timestamps dos chamados antigos. `atendido_em` é TEXT ISO (legado) e era
    # gravado ao ASSUMIR o chamado; para o fechamento vale o maior entre ele e
    # `atualizado_em` (o fechamento não pode ter sido antes de nenhum dos dois).
    """
    UPDATE defeitos SET atribuido_em = atendido_em::timestamptz
    WHERE atribuido_em IS NULL AND atendente_id IS NOT NULL
      AND atendido_em ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
    """,
    """
    UPDATE defeitos SET
        fechado_em = GREATEST(
            atualizado_em,
            CASE WHEN atendido_em ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN atendido_em::timestamptz END
        ),
        resolvido_em = CASE WHEN status = 'concluido' THEN GREATEST(
            atualizado_em,
            CASE WHEN atendido_em ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN atendido_em::timestamptz END
        ) END
    WHERE fechado_em IS NULL AND status IN ('concluido', 'rejeitado')
    """,
    """
    UPDATE defeitos SET iniciado_em = COALESCE(atribuido_em, atualizado_em)
    WHERE iniciado_em IS NULL AND status = 'em_andamento'
    """,
    """
    UPDATE defeitos SET triado_em = COALESCE(atribuido_em, fechado_em, atualizado_em)
    WHERE triado_em IS NULL AND status <> 'pendente'
    """,
    # Histórico sintético: todo chamado ganha o evento 'criado' e os já
    # fechados, um 'status' com a data do fechamento. `dados.sintetico` separa
    # esses dos eventos reais nos relatórios.
    """
    INSERT INTO defeito_eventos (defeito_id, tipo, para_status, autor_id, papel, publico, dados, criado_em)
    SELECT d.id, 'criado', 'pendente', d.usuario, 'cidadao', TRUE, '{"sintetico": true}', d.criado_em
    FROM defeitos d
    WHERE NOT EXISTS (SELECT 1 FROM defeito_eventos e WHERE e.defeito_id = d.id AND e.tipo = 'criado')
    """,
    """
    INSERT INTO defeito_eventos (defeito_id, tipo, para_status, papel, publico, dados, criado_em)
    SELECT d.id, 'status', d.status, 'sistema', TRUE, '{"sintetico": true}',
           COALESCE(d.fechado_em, d.atualizado_em)
    FROM defeitos d
    WHERE d.status IN ('concluido', 'rejeitado')
      AND NOT EXISTS (SELECT 1 FROM defeito_eventos e WHERE e.defeito_id = d.id AND e.tipo = 'status')
    """,
]

# Secretaria que o roteamento antigo gravava para 'Outro' (sem acento).
SECRETARIA_OUTRO_LEGADA = 'Secretaria de Servicos Urbanos'

SEED_CATEGORIAS = [
    ("Buraco", "🕳️", "alta", 7),
    ("Iluminação", "💡", "alta", 5),
    ("Semáforo", "🚦", "urgente", 2),
    ("Árvore Caída", "🌳", "urgente", 2),
    ("Entulho", "🗑️", "media", 15),
    ("Calçada Danificada", "🚶", "media", 7),
    ("Outro", "📋", "baixa", 15),
]


class Command(BaseCommand):
    help = 'Cria o schema do banco (tabelas managed=False) e popula categorias base'

    def handle(self, *args, **options):
        self.stdout.write('Criando schema do banco...')
        with connection.cursor() as cur:
            for stmt in SCHEMA:
                cur.execute(stmt)
            self.stdout.write('  - tabelas criadas/verificadas')

            self.stdout.write('Populando categorias base...')
            for nome, icone, prioridade, prazo in SEED_CATEGORIAS:
                cur.execute(
                    """
                    INSERT INTO categorias (nome, icone, prioridade_base, prazo_sla_dias)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (nome) DO NOTHING
                    """,
                    [nome, icone, prioridade, prazo],
                )
            self.stdout.write('  - categorias semeadas')

            for stmt in SCHEMA_V3:
                cur.execute(stmt)
            self.stdout.write('  - esquema v3 criado/verificado')

            for stmt in BACKFILL_V3:
                cur.execute(stmt)
            self._super_admin(cur)
            self._categorias_e_sla(cur)
            self._protocolos(cur)
            self.stdout.write('  - backfills v3 aplicados')

        self.stdout.write(self.style.SUCCESS('Schema pronto!'))

    def _super_admin(self, cur):
        from django.conf import settings
        email = (getattr(settings, 'SUPER_ADMIN_EMAIL', '') or '').strip()
        if not email:
            return
        cur.execute(
            """
            UPDATE users SET papel = 'super_admin', admin = 1
            WHERE lower(email) = lower(%s) AND papel <> 'super_admin'
            """,
            [email],
        )

    def _categorias_e_sla(self, cur):
        """
        `categoria_id` pelo nome sem acento/caixa, e o SLA corrigido para quem
        caiu no bug do roteamento (chaves sem acento em `ia_client`: Iluminação,
        Semáforo etc. ganhavam a regra de 'Outro'). Depois disso, `prazo_em`.
        """
        from defeitos import sla

        cur.execute('SELECT DISTINCT categoria FROM defeitos WHERE categoria_id IS NULL AND categoria <> %s', [''])
        for (nome,) in cur.fetchall():
            regra = sla.regra_para(nome, None)
            if regra['categoria_id'] is None:
                continue
            cur.execute(
                'UPDATE defeitos SET categoria_id = %s WHERE categoria = %s AND categoria_id IS NULL',
                [regra['categoria_id'], nome],
            )
            if sla.normalizar(nome) != sla.CATEGORIA_OUTRO:
                # Só quem ficou com a regra de 'Outro' por engano (e ainda não
                # tem prazo calculado: chamados novos já nascem certos).
                cur.execute(
                    """
                    UPDATE defeitos SET secretaria_responsavel = %s, prazo_sla_dias = %s
                    WHERE categoria = %s AND secretaria_responsavel = %s AND prazo_em IS NULL
                    """,
                    [regra['secretaria_nome'], regra['prazo_sla_dias'], nome, SECRETARIA_OUTRO_LEGADA],
                )
            cur.execute(
                "UPDATE defeitos SET prioridade = %s WHERE categoria = %s AND prioridade = ''",
                [regra['prioridade'], nome],
            )
        cur.execute(
            """
            UPDATE defeitos SET prazo_em = criado_em + prazo_sla_dias * INTERVAL '1 day'
            WHERE prazo_em IS NULL AND prazo_sla_dias > 0
            """
        )

    def _protocolos(self, cur):
        """
        Protocolo `AAAA-NNNNNN` (sequência global) para quem ainda não tem, na
        ordem de criação; depois alinha a sequência para os novos continuarem
        dali sem colidir.
        """
        cur.execute("SELECT last_value, is_called FROM defeitos_protocolo_seq")
        ultimo, chamado = cur.fetchone()
        base = ultimo if chamado else ultimo - 1
        cur.execute(
            """
            UPDATE defeitos d
            SET protocolo = to_char(o.criado_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY')
                            || '-' || lpad((%s + o.rn)::text, 6, '0')
            FROM (
                SELECT id, criado_em, row_number() OVER (ORDER BY criado_em, id) AS rn
                FROM defeitos WHERE protocolo IS NULL
            ) o
            WHERE d.id = o.id
            """,
            [base],
        )
        cur.execute(
            r"""
            SELECT COALESCE(MAX(split_part(protocolo, '-', 2)::bigint), 0)
            FROM defeitos WHERE protocolo ~ '^\d{4}-\d+$'
            """
        )
        maior = max(cur.fetchone()[0], base)
        if maior > 0:
            cur.execute("SELECT setval('defeitos_protocolo_seq', %s, true)", [maior])
