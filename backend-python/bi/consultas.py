"""
Consultas do BI (contrato v3, seções 7.4 e 7.5).

Tudo sai de `defeitos` + `defeito_eventos` em SQL agregado — uma consulta por
indicador, sem laço por mês/bairro/usuário (o painel antigo fazia ~25+N).
As métricas usam só os timestamps gravados por `defeitos/fluxo.py`:

- recebidos: `criado_em` no período;
- resolvidos: chamados hoje em `concluido` com `resolvido_em` no período (um
  resolvido e depois reaberto deixa de contar — ainda não foi resolvido);
- rejeitados: hoje em `rejeitado`, fechados no período;
- backlog: abertos no fim do período (aberto hoje, ou fechado depois do fim);
- backlog_vencido: do backlog, os com `prazo_em` antes do instante de corte
  (fim do período, ou agora se o período ainda não acabou);
- pct_no_prazo: resolvidos com `resolvido_em <= prazo_em` / resolvidos que
  têm prazo (chamado sem SLA não tem prazo a cumprir nem a perder);
- lead time: `resolvido_em - criado_em` dos resolvidos (P50/P90 por
  `percentile_cont`; média engana com os poucos chamados esquecidos);
- primeira resposta: dos recebidos no período, o que vier antes entre o
  primeiro evento público da equipe e `triado_em`;
- taxa_resolucao: dos recebidos no período, quantos já estavam resolvidos no
  fim dele (coorte, fica entre 0 e 100);
- reabertura_pct: resolvidos com `reaberturas > 0` / resolvidos;
- csat: avaliações (`avaliado_em`) no período;
- cidadaos_ativos: autores ou apoiadores distintos no período.

Os limites do período são meia-noite no fuso do projeto (America/Sao_Paulo):
a sessão do banco roda em UTC, então os instantes vão prontos do Python e a
geração de buckets da série usa `AT TIME ZONE` explícito.
"""
from dataclasses import dataclass, replace
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import connection
from django.utils import timezone

from defeitos.fluxo import ROTULOS_CIDADAO, ROTULOS_OPERACAO, STATUS_ABERTOS

PAPEIS_EQUIPE = ('operador', 'gestor', 'admin_municipal', 'super_admin')

FAIXAS_AGING = (
    # (rótulo, idade mínima em dias, idade máxima exclusiva)
    ('0-2d', 0, 3),
    ('3-7d', 3, 8),
    ('8-15d', 8, 16),
    ('16-30d', 16, 31),
    ('>30d', 31, None),
)

# ~220 m de lado: fino o bastante para apontar a rua, grosso o bastante para
# não virar um ponto por chamado.
GRADE_HOTSPOT_GRAUS = 0.002
LIMITE_CELULAS = 500
LIMITE_REINCIDENCIA = 20
LIMITE_COMENTARIOS = 30


def fuso():
    return ZoneInfo(settings.TIME_ZONE)


def hoje():
    return timezone.localtime(timezone.now(), fuso()).date()


def inicio_do_dia(dia):
    return datetime.combine(dia, time.min, tzinfo=fuso())


# Valor de recorte para "sem categoria/secretaria/equipe/bairro" — a chave que
# `distribuicao/` devolve para o grupo sem valor, aceita de volta nos filtros.
SEM = 'nenhum'
# Prefixo das chaves de chamados antigos agrupados pelo nome em texto.
PREFIXO_NOME = 'nome:'


def secretaria_efetiva(alias='d'):
    """
    Secretaria responsável pelo chamado: a gravada nele ou, sem ela (chamados
    anteriores ao roteamento), a que o município configurou para a categoria
    em `categoria_municipio`. Sem isso o filtro por secretaria do painel
    zerava toda a base legada.
    """
    return (
        f'COALESCE({alias}.secretaria_id, (SELECT cm.secretaria_id FROM categoria_municipio cm '
        f'WHERE cm.municipio_id = {alias}.municipio_id AND cm.categoria_id = {alias}.categoria_id))'
    )


def _nome_categoria_texto(alias='d'):
    return f"COALESCE(NULLIF(btrim({alias}.categoria), ''), 'Sem categoria')"


@dataclass(frozen=True)
class Escopo:
    """
    Município + período (datas locais, `fim` inclusivo) + filtros do painel.
    `categoria_id`/`secretaria_id`/`equipe_id` são o id (int), `SEM` (o grupo
    sem valor) ou, para categoria e secretaria, `nome:<texto>` (legado sem id).
    """
    municipio_id: str
    inicio: date
    fim: date
    categoria_id: int | str | None = None
    secretaria_id: int | str | None = None
    equipe_id: int | str | None = None
    bairro: str | None = None

    @property
    def ini_dt(self):
        return inicio_do_dia(self.inicio)

    @property
    def fim_dt(self):
        """Instante exclusivo: meia-noite do dia seguinte a `fim`."""
        return inicio_do_dia(self.fim + timedelta(days=1))

    @property
    def dias(self):
        return (self.fim - self.inicio).days + 1

    @property
    def corte(self):
        """Quando medir backlog/atraso: o fim do período, ou agora se ainda não chegou."""
        return min(self.fim_dt, timezone.now())

    def anterior(self):
        """Janela de mesmo tamanho imediatamente antes (sem comparar mês parcial com cheio)."""
        n = self.dias
        return replace(self, inicio=self.inicio - timedelta(days=n), fim=self.inicio - timedelta(days=1))

    def periodo(self):
        return {'inicio': self.inicio.isoformat(), 'fim': self.fim.isoformat()}


# --- montagem do SQL ---------------------------------------------------------

def _sem_prefixo(valor):
    if isinstance(valor, str) and valor.startswith(PREFIXO_NOME):
        return valor[len(PREFIXO_NOME):]
    return None


def _params(escopo, **extra):
    p = {
        'categoria_nome_f': _sem_prefixo(escopo.categoria_id),
        'secretaria_nome_f': _sem_prefixo(escopo.secretaria_id),
        'mun': str(escopo.municipio_id),
        'ini': escopo.ini_dt,
        'fim': escopo.fim_dt,
        'corte': escopo.corte,
        'abertos': tuple(STATUS_ABERTOS),
        'equipe_papeis': PAPEIS_EQUIPE,
        'categoria_id': escopo.categoria_id,
        'secretaria_id': escopo.secretaria_id,
        'equipe_id': escopo.equipe_id,
        'bairro': (escopo.bairro or '').strip(),
    }
    p.update(extra)
    return p


def _filtro(escopo, alias='d'):
    a = alias
    partes = [f'{a}.municipio_id = %(mun)s', f'{a}.removido_em IS NULL']
    cat = escopo.categoria_id
    if cat == SEM:
        partes.append(f"{a}.categoria_id IS NULL AND NULLIF(btrim({a}.categoria), '') IS NULL")
    elif _sem_prefixo(cat) is not None:
        partes.append(f'{a}.categoria_id IS NULL AND lower({_nome_categoria_texto(a)}) = %(categoria_nome_f)s')
    elif cat is not None:
        partes.append(f'{a}.categoria_id = %(categoria_id)s')
    sec = escopo.secretaria_id
    sec_ef = secretaria_efetiva(a)
    if sec == SEM:
        partes.append(f"{sec_ef} IS NULL AND NULLIF(btrim({a}.secretaria_responsavel), '') IS NULL")
    elif _sem_prefixo(sec) is not None:
        partes.append(f'{sec_ef} IS NULL AND lower(btrim({a}.secretaria_responsavel)) = %(secretaria_nome_f)s')
    elif sec is not None:
        partes.append(f'{sec_ef} = %(secretaria_id)s')
    if escopo.equipe_id == SEM:
        partes.append(f'{a}.equipe_id IS NULL')
    elif escopo.equipe_id is not None:
        partes.append(f'{a}.equipe_id = %(equipe_id)s')
    bairro = (escopo.bairro or '').strip()
    if bairro == SEM:
        partes.append(f"NULLIF(btrim({a}.bairro), '') IS NULL")
    elif bairro:
        partes.append(f'lower(btrim({a}.bairro)) = lower(%(bairro)s)')
    return ' AND '.join(partes)


# Quando o chamado fechou. Legados convertidos pelo bootstrap podem não ter
# `fechado_em`; caem no `resolvido_em` e, por fim, na última atualização.
_FECHADO = 'COALESCE(d.fechado_em, d.resolvido_em, d.atualizado_em)'


def _cte_base(escopo):
    """
    CTE `m`: um chamado por linha com as flags de cada métrica já calculadas.
    Só entram chamados que podem pesar no período (criados nele, abertos,
    fechados nele ou avaliados nele) — os fechados antes ficam de fora e a
    série não multiplica o histórico inteiro pelos buckets.
    """
    return f"""
    m AS (
        SELECT d.id, d.protocolo, d.usuario, d.status, d.criado_em, d.resolvido_em,
               d.prazo_em, d.triado_em, d.reaberturas, d.avaliacao_nota,
               d.avaliacao_comentario, d.avaliado_em, d.atendente_id, d.latitude,
               d.longitude, d.bairro, d.rua, d.secretaria_id, d.equipe_id,
               {secretaria_efetiva('d')} AS secretaria_ef,
               d.secretaria_responsavel, d.prioridade, d.motivo_rejeicao, d.titulo,
               d.categoria_id, d.iniciado_em, d.atribuido_em, d.visibilidade,
               COALESCE(c.nome, NULLIF(btrim(d.categoria), ''), 'Sem categoria') AS categoria_nome,
               {_FECHADO} AS fechado_ref,
               (d.criado_em >= %(ini)s) AS recebido,
               (d.status = 'concluido' AND d.resolvido_em >= %(ini)s
                    AND d.resolvido_em < %(fim)s) AS resolvido,
               (d.status = 'rejeitado' AND {_FECHADO} >= %(ini)s
                    AND {_FECHADO} < %(fim)s) AS rejeitado,
               (d.status IN %(abertos)s OR {_FECHADO} >= %(fim)s) AS aberto_fim,
               EXTRACT(EPOCH FROM (d.resolvido_em - d.criado_em)) / 3600.0 AS lead_h
          FROM defeitos d
          LEFT JOIN categorias c ON c.id = d.categoria_id
         WHERE {_filtro(escopo)}
           AND d.criado_em < %(fim)s
           AND (d.criado_em >= %(ini)s OR d.status IN %(abertos)s
                OR {_FECHADO} >= %(ini)s OR d.avaliado_em >= %(ini)s)
    )"""


def _executar(sql, params):
    with connection.cursor() as cur:
        cur.execute(sql, params)
        colunas = [c[0] for c in cur.description]
        return [dict(zip(colunas, linha)) for linha in cur.fetchall()]


def _iterar(sql, params, lote=2000):
    """
    Como `_executar`, mas em lotes por cursor do lado do servidor: a
    exportação de dados abertos (até 100 mil linhas) não fica inteira na
    memória do worker antes do primeiro byte sair.
    """
    with connection.chunked_cursor() as cur:
        cur.execute(sql, params)
        colunas = None
        while True:
            linhas = cur.fetchmany(lote)
            if not linhas:
                break
            if colunas is None:
                colunas = [c[0] for c in cur.description]
            for linha in linhas:
                yield dict(zip(colunas, linha))


def _r(valor, casas=1):
    return None if valor is None else round(float(valor), casas)


def _pct(parte, total):
    return None if not total else round(100.0 * parte / total, 1)


# --- KPIs --------------------------------------------------------------------

def kpis(escopo):
    sql = f"""
    WITH {_cte_base(escopo)},
    resposta AS (
        SELECT e.defeito_id, MIN(e.criado_em) AS em
          FROM defeito_eventos e
          JOIN m ON m.id = e.defeito_id AND m.recebido
         WHERE e.publico AND e.papel IN %(equipe_papeis)s AND e.tipo <> 'criado'
         GROUP BY e.defeito_id
    ),
    ativos AS (
        SELECT m.usuario AS u FROM m WHERE m.recebido AND m.usuario IS NOT NULL
        UNION
        SELECT a.usuario_id FROM apoios a
          JOIN defeitos d ON d.id = a.defeito_id
         WHERE {_filtro(escopo)} AND a.criado_em >= %(ini)s AND a.criado_em < %(fim)s
    )
    SELECT
        COUNT(*) FILTER (WHERE m.recebido) AS recebidos,
        COUNT(*) FILTER (WHERE m.resolvido) AS resolvidos,
        COUNT(*) FILTER (WHERE m.rejeitado) AS rejeitados,
        COUNT(*) FILTER (WHERE m.aberto_fim) AS backlog,
        COUNT(*) FILTER (WHERE m.aberto_fim AND m.prazo_em < %(corte)s) AS backlog_vencido,
        COUNT(*) FILTER (WHERE m.resolvido AND m.prazo_em IS NOT NULL) AS resolvidos_com_prazo,
        COUNT(*) FILTER (WHERE m.resolvido AND m.resolvido_em <= m.prazo_em) AS resolvidos_no_prazo,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY m.lead_h) FILTER (WHERE m.resolvido) AS lead_p50,
        percentile_cont(0.9) WITHIN GROUP (ORDER BY m.lead_h) FILTER (WHERE m.resolvido) AS lead_p90,
        percentile_cont(0.5) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (LEAST(r.em, m.triado_em) - m.criado_em)) / 3600.0
        ) FILTER (WHERE m.recebido AND LEAST(r.em, m.triado_em) IS NOT NULL) AS resposta_p50,
        COUNT(*) FILTER (WHERE m.recebido AND m.status = 'concluido'
                         AND m.resolvido_em < %(fim)s) AS recebidos_resolvidos,
        COUNT(*) FILTER (WHERE m.resolvido AND m.reaberturas > 0) AS resolvidos_reabertos,
        AVG(m.avaliacao_nota) FILTER (WHERE m.avaliado_em >= %(ini)s AND m.avaliado_em < %(fim)s
                                       AND m.avaliacao_nota IS NOT NULL) AS csat_media,
        COUNT(*) FILTER (WHERE m.avaliado_em >= %(ini)s AND m.avaliado_em < %(fim)s
                         AND m.avaliacao_nota IS NOT NULL) AS csat_respostas,
        (SELECT COUNT(*) FROM ativos) AS cidadaos_ativos
      FROM m
      LEFT JOIN resposta r ON r.defeito_id = m.id
    """
    linha = _executar(sql, _params(escopo))[0]
    return {
        'recebidos': linha['recebidos'],
        'resolvidos': linha['resolvidos'],
        'rejeitados': linha['rejeitados'],
        'backlog': linha['backlog'],
        'backlog_vencido': linha['backlog_vencido'],
        'pct_no_prazo': _pct(linha['resolvidos_no_prazo'], linha['resolvidos_com_prazo']),
        'lead_time_p50_h': _r(linha['lead_p50']),
        'lead_time_p90_h': _r(linha['lead_p90']),
        'primeira_resposta_p50_h': _r(linha['resposta_p50']),
        'taxa_resolucao': _pct(linha['recebidos_resolvidos'], linha['recebidos']),
        'reabertura_pct': _pct(linha['resolvidos_reabertos'], linha['resolvidos']),
        'csat_media': _r(linha['csat_media'], 2),
        'csat_respostas': linha['csat_respostas'],
        'cidadaos_ativos': linha['cidadaos_ativos'],
    }


# --- série temporal ----------------------------------------------------------

GRANULARIDADES = {'dia': '1 day', 'semana': '1 week', 'mes': '1 month'}
_TRUNC = {'dia': 'day', 'semana': 'week', 'mes': 'month'}


def serie(escopo, granularidade='dia'):
    """
    [{periodo, recebidos, resolvidos, backlog}] com zeros preenchidos
    (generate_series + LEFT JOIN: um bucket sem chamados aparece, e não some
    da linha). Semana começa na segunda; o 1º e o último bucket são cortados
    nos limites do período. `backlog` é o estoque aberto no fim do bucket.
    """
    sql = f"""
    WITH {_cte_base(escopo)},
    buckets AS (
        SELECT GREATEST(g::date, %(d_ini)s::date) AS rotulo,
               GREATEST(g AT TIME ZONE %(tz)s, %(ini)s) AS b_ini,
               LEAST((g + %(passo)s::interval) AT TIME ZONE %(tz)s, %(fim)s) AS b_fim
          FROM generate_series(date_trunc(%(trunc)s, %(d_ini)s::timestamp),
                               %(d_fim)s::timestamp, %(passo)s::interval) AS g
    )
    SELECT b.rotulo,
           COUNT(m.id) FILTER (WHERE m.criado_em >= b.b_ini) AS recebidos,
           COUNT(m.id) FILTER (WHERE m.status = 'concluido' AND m.resolvido_em >= b.b_ini
                               AND m.resolvido_em < b.b_fim) AS resolvidos,
           COUNT(m.id) FILTER (WHERE m.status IN %(abertos)s OR m.fechado_ref >= b.b_fim) AS backlog
      FROM buckets b
      LEFT JOIN m ON m.criado_em < b.b_fim
     GROUP BY b.rotulo
     ORDER BY b.rotulo
    """
    params = _params(
        escopo, tz=settings.TIME_ZONE, passo=GRANULARIDADES[granularidade],
        trunc=_TRUNC[granularidade], d_ini=escopo.inicio, d_fim=escopo.fim,
    )
    resultado = []
    for linha in _executar(sql, params):
        rotulo = linha['rotulo']
        resultado.append({
            'periodo': rotulo.strftime('%Y-%m') if granularidade == 'mes' else rotulo.isoformat(),
            'recebidos': linha['recebidos'],
            'resolvidos': linha['resolvidos'],
            'backlog': linha['backlog'],
        })
    return resultado


# --- distribuição por dimensão ----------------------------------------------

# (expressão da chave, expressão do rótulo, join extra). Chamados antigos sem
# `categoria_id`/`secretaria_id` agrupam pelo nome em texto (`nome:<texto>`);
# o grupo sem valor vem com a chave `SEM`. Toda chave volta como filtro.
DIMENSOES = {
    'categoria': (
        "COALESCE(m.categoria_id::text, 'nome:' || lower(m.categoria_nome))",
        'm.categoria_nome',
        '',
    ),
    'bairro': (
        f"COALESCE(NULLIF(lower(btrim(m.bairro)), ''), '{SEM}')",
        "COALESCE(NULLIF(btrim(m.bairro), ''), 'Sem bairro')",
        '',
    ),
    'secretaria': (
        "COALESCE(m.secretaria_ef::text, 'nome:' || NULLIF(lower(btrim(m.secretaria_responsavel)), ''),"
        f" '{SEM}')",
        "COALESCE(s.nome, NULLIF(btrim(m.secretaria_responsavel), ''), 'Sem secretaria')",
        'LEFT JOIN secretarias s ON s.id = m.secretaria_ef',
    ),
    'equipe': (
        f"COALESCE(m.equipe_id::text, '{SEM}')",
        "COALESCE(e.nome, 'Sem equipe')",
        'LEFT JOIN equipes e ON e.id = m.equipe_id',
    ),
    'status': ('m.status', 'm.status', ''),
}


def distribuicao(escopo, dimensao='categoria'):
    chave, rotulo, join = DIMENSOES[dimensao]
    sql = f"""
    WITH {_cte_base(escopo)}
    SELECT {chave} AS chave,
           MIN({rotulo}) AS rotulo,
           COUNT(*) FILTER (WHERE m.recebido) AS recebidos,
           COUNT(*) FILTER (WHERE m.aberto_fim) AS abertos,
           COUNT(*) FILTER (WHERE m.resolvido) AS resolvidos,
           COUNT(*) FILTER (WHERE m.aberto_fim AND m.prazo_em < %(corte)s) AS vencidos,
           COUNT(*) FILTER (WHERE m.resolvido AND m.prazo_em IS NOT NULL) AS com_prazo,
           COUNT(*) FILTER (WHERE m.resolvido AND m.resolvido_em <= m.prazo_em) AS no_prazo,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY m.lead_h) FILTER (WHERE m.resolvido) AS lead_p50
      FROM m {join}
     GROUP BY 1
    HAVING COUNT(*) FILTER (WHERE m.recebido OR m.aberto_fim OR m.resolvido OR m.rejeitado) > 0
     ORDER BY recebidos DESC, abertos DESC, rotulo
    """
    resultado = []
    for linha in _executar(sql, _params(escopo)):
        rot = linha['rotulo']
        if dimensao == 'status':
            rot = ROTULOS_OPERACAO.get(rot, rot)
        resultado.append({
            'chave': linha['chave'] or '',
            'rotulo': rot,
            'recebidos': linha['recebidos'],
            'abertos': linha['abertos'],
            'resolvidos': linha['resolvidos'],
            'vencidos': linha['vencidos'],
            'pct_no_prazo': _pct(linha['no_prazo'], linha['com_prazo']),
            'lead_time_p50_h': _r(linha['lead_p50']),
        })
    return resultado


# --- lista de chamados (drill-down) -----------------------------------------

# Recorte da lista -> condição sobre as flags do CTE `m`. É a mesma flag que
# alimenta o número tocado, então a lista bate com o número do painel.
RECORTES_LISTA = {
    'abertos': 'm.aberto_fim',
    'vencidos': 'm.aberto_fim AND m.prazo_em < %(corte)s',
    'recebidos': 'm.recebido',
    'resolvidos': 'm.resolvido',
    'rejeitados': 'm.rejeitado',
}
_ORDEM_LISTA = {
    'abertos': 'm.prazo_em ASC NULLS LAST, m.criado_em ASC',
    'vencidos': 'm.prazo_em ASC NULLS LAST, m.criado_em ASC',
    'recebidos': 'm.criado_em DESC',
    'resolvidos': 'm.resolvido_em DESC',
    'rejeitados': 'm.fechado_ref DESC',
}


def chamados(escopo, recorte='abertos', status=None, limite=20, deslocamento=0):
    """
    (total, itens) dos chamados do escopo que compõem um número do painel.
    O prazo (`sla_*`) é o de agora, para o gestor agir: um chamado da fila do
    fim do período que já foi fechado aparece com a situação atual.
    """
    condicao = RECORTES_LISTA[recorte]
    if status:
        condicao += ' AND m.status = %(status)s'
    params = _params(escopo, status=status, limite=limite, deslocamento=deslocamento)
    total = _executar(f"""
    WITH {_cte_base(escopo)}
    SELECT COUNT(*) AS total FROM m WHERE {condicao}
    """, params)[0]['total']
    linhas = _executar(f"""
    WITH {_cte_base(escopo)}
    SELECT m.id, m.protocolo, m.titulo, m.status, m.categoria_id, m.categoria_nome,
           m.bairro, m.rua, m.prioridade, m.criado_em, m.resolvido_em, m.prazo_em,
           m.latitude, m.longitude, m.equipe_id, m.secretaria_ef AS secretaria_id,
           COALESCE(s.nome, NULLIF(btrim(m.secretaria_responsavel), '')) AS secretaria_nome,
           e.nome AS equipe_nome, u.nome AS atendente_nome
      FROM m
      LEFT JOIN secretarias s ON s.id = m.secretaria_ef
      LEFT JOIN equipes e ON e.id = m.equipe_id
      LEFT JOIN users u ON u.id = m.atendente_id
     WHERE {condicao}
     ORDER BY {_ORDEM_LISTA[recorte]}, m.id
     LIMIT %(limite)s OFFSET %(deslocamento)s
    """, params)
    agora = timezone.now()
    tz = fuso()

    def iso(valor):
        return timezone.localtime(valor, tz).isoformat() if valor else None

    itens = []
    for linha in linhas:
        aberto = linha['status'] in STATUS_ABERTOS
        prazo = linha['prazo_em']
        resolvido = linha['status'] == 'concluido' and linha['resolvido_em'] is not None
        itens.append({
            'id': str(linha['id']),
            'protocolo': linha['protocolo'],
            'titulo': linha['titulo'],
            'status': linha['status'],
            'status_rotulo': ROTULOS_OPERACAO.get(linha['status'], linha['status']),
            'categoria_id': linha['categoria_id'],
            'categoria_nome': linha['categoria_nome'],
            'bairro': linha['bairro'] or '',
            'rua': linha['rua'] or '',
            'prioridade': linha['prioridade'],
            'latitude': linha['latitude'],
            'longitude': linha['longitude'],
            'secretaria_id': linha['secretaria_id'],
            'secretaria_nome': linha['secretaria_nome'],
            'equipe_id': linha['equipe_id'],
            'equipe_nome': linha['equipe_nome'],
            'atendente_nome': linha['atendente_nome'],
            'criado_em': iso(linha['criado_em']),
            'resolvido_em': iso(linha['resolvido_em']) if resolvido else None,
            'prazo_em': iso(prazo),
            'sla_vencido': bool(aberto and prazo is not None and prazo < agora),
            'sla_restante_horas': (
                round((prazo - agora).total_seconds() / 3600, 1) if aberto and prazo is not None else None
            ),
            'no_prazo': (linha['resolvido_em'] <= prazo) if resolvido and prazo is not None else None,
        })
    return total, itens


def rotulos_dos_filtros(escopo):
    """Nomes legíveis dos recortes ativos ("Buraco", "Secretaria de Obras"...), para o PDF."""
    partes = []

    def nome(sql, valor, **extra):
        linhas = _executar(sql, {'v': valor, **extra})
        return linhas[0]['nome'] if linhas else None

    for campo, rotulo, tabela in (
        ('categoria_id', 'Categoria', 'categorias'),
        ('secretaria_id', 'Secretaria', 'secretarias'),
        ('equipe_id', 'Equipe', 'equipes'),
    ):
        valor = getattr(escopo, campo)
        if valor is None:
            continue
        if valor == SEM:
            texto = 'não informada'
        elif _sem_prefixo(valor) is not None:
            texto = _sem_prefixo(valor)
        else:
            texto = nome(f'SELECT nome FROM {tabela} WHERE id = %(v)s', valor) or f'#{valor}'
        partes.append(f'{rotulo}: {texto}')
    bairro = (escopo.bairro or '').strip()
    if bairro == SEM:
        partes.append('Bairro: não informado')
    elif bairro:
        # O filtro chega em minúsculas (chave da distribuição): volta à grafia cadastrada.
        grafia = nome(
            'SELECT MIN(btrim(bairro)) AS nome FROM defeitos '
            'WHERE municipio_id = %(m)s AND lower(btrim(bairro)) = lower(%(v)s)',
            bairro, m=str(escopo.municipio_id),
        )
        partes.append(f'Bairro: {grafia or bairro}')
    return ', '.join(partes)


# --- aging do backlog -------------------------------------------------------

def aging(escopo):
    """Backlog no corte por faixa de idade (dias completos desde a abertura)."""
    casos = ' '.join(
        f"WHEN idade < {fim} THEN '{rotulo}'" for rotulo, _ini, fim in FAIXAS_AGING if fim is not None
    )
    sql = f"""
    WITH {_cte_base(escopo)},
    a AS (
        SELECT FLOOR(EXTRACT(EPOCH FROM (%(corte)s - m.criado_em)) / 86400) AS idade, m.prazo_em
          FROM m WHERE m.aberto_fim
    )
    SELECT CASE {casos} ELSE '{FAIXAS_AGING[-1][0]}' END AS faixa,
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE a.prazo_em < %(corte)s) AS vencidos
      FROM a GROUP BY 1
    """
    por_faixa = {linha['faixa']: linha for linha in _executar(sql, _params(escopo))}
    return [
        {
            'faixa': rotulo,
            'total': por_faixa.get(rotulo, {}).get('total', 0),
            'vencidos': por_faixa.get(rotulo, {}).get('vencidos', 0),
        }
        for rotulo, _ini, _fim in FAIXAS_AGING
    ]


# --- produtividade -----------------------------------------------------------

def produtividade(escopo):
    """
    Por servidor da equipe do município (mais quem atendeu algo no escopo):
    concluídos no período, mediana do lead time e chamados abertos hoje sob
    sua responsabilidade.
    """
    # 'nenhum' (drill-down de distribuicao?dimensao=equipe) = servidores sem equipe.
    if escopo.equipe_id == SEM:
        filtro_equipe = 'AND u.equipe_id IS NULL'
    elif escopo.equipe_id is not None:
        filtro_equipe = 'AND u.equipe_id = %(equipe_id)s'
    else:
        filtro_equipe = ''
    sql = f"""
    WITH {_cte_base(escopo)}
    SELECT u.id AS usuario_id, u.nome, MIN(e.nome) AS equipe_nome,
           COUNT(m.id) FILTER (WHERE m.resolvido) AS concluidos,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY m.lead_h) FILTER (WHERE m.resolvido) AS lead_p50,
           COUNT(m.id) FILTER (WHERE m.status IN %(abertos)s) AS em_andamento
      FROM users u
      LEFT JOIN equipes e ON e.id = u.equipe_id
      LEFT JOIN m ON m.atendente_id = u.id
     WHERE (u.municipio_id = %(mun)s AND u.papel IN %(equipe_papeis)s {filtro_equipe})
        OR u.id IN (SELECT atendente_id FROM m WHERE atendente_id IS NOT NULL)
     GROUP BY u.id, u.nome
     ORDER BY concluidos DESC, em_andamento DESC, u.nome
    """
    return [
        {
            'usuario_id': str(linha['usuario_id']),
            'nome': linha['nome'],
            'equipe_nome': linha['equipe_nome'],
            'concluidos': linha['concluidos'],
            'lead_time_p50_h': _r(linha['lead_p50']),
            'em_andamento': linha['em_andamento'],
        }
        for linha in _executar(sql, _params(escopo))
    ]


# --- hotspots ----------------------------------------------------------------

def hotspots(escopo):
    """
    Células de ~200 m com os chamados recebidos no período (e a categoria
    mais comum de cada uma) e reincidência: mesma rua + categoria com 2+
    chamados no período.
    """
    params = _params(escopo, grade=GRADE_HOTSPOT_GRAUS, limite=LIMITE_CELULAS,
                     limite_reinc=LIMITE_REINCIDENCIA)
    sql_celulas = f"""
    WITH {_cte_base(escopo)}
    SELECT ROUND(m.latitude / %(grade)s) * %(grade)s AS lat,
           ROUND(m.longitude / %(grade)s) * %(grade)s AS lng,
           COUNT(*) AS total,
           mode() WITHIN GROUP (ORDER BY m.categoria_nome) AS categoria_top,
           mode() WITHIN GROUP (ORDER BY NULLIF(btrim(m.bairro), '')) AS bairro_top
      FROM m
     WHERE m.recebido AND m.latitude IS NOT NULL AND m.longitude IS NOT NULL
     GROUP BY 1, 2
     ORDER BY total DESC, lat, lng
     LIMIT %(limite)s
    """
    sql_reinc = f"""
    WITH {_cte_base(escopo)}
    SELECT MIN(btrim(m.bairro)) AS bairro, MIN(btrim(m.rua)) AS rua,
           m.categoria_nome AS categoria, MIN(m.categoria_id) AS categoria_id,
           COUNT(*) AS ocorrencias
      FROM m
     WHERE m.recebido AND btrim(m.rua) <> ''
     GROUP BY lower(btrim(m.bairro)), lower(btrim(m.rua)), m.categoria_nome
    HAVING COUNT(*) >= 2
     ORDER BY ocorrencias DESC, rua
     LIMIT %(limite_reinc)s
    """
    celulas = [
        {'lat': round(c['lat'], 6), 'lng': round(c['lng'], 6), 'total': c['total'],
         'categoria_top': c['categoria_top'], 'bairro_top': c['bairro_top']}
        for c in _executar(sql_celulas, params)
    ]
    return {'celulas': celulas, 'reincidencia': _executar(sql_reinc, params)}


# --- satisfação --------------------------------------------------------------

def satisfacao(escopo):
    params = _params(escopo, limite=LIMITE_COMENTARIOS)
    no_periodo = 'm.avaliado_em >= %(ini)s AND m.avaliado_em < %(fim)s AND m.avaliacao_nota IS NOT NULL'
    sql = f"""
    WITH {_cte_base(escopo)}
    SELECT m.avaliacao_nota AS nota, COUNT(*) AS total
      FROM m WHERE {no_periodo} GROUP BY 1
    """
    sql_coment = f"""
    WITH {_cte_base(escopo)}
    SELECT m.avaliacao_nota AS nota, m.avaliacao_comentario AS comentario, m.protocolo,
           m.avaliado_em AS criado_em
      FROM m WHERE {no_periodo} AND btrim(m.avaliacao_comentario) <> ''
     ORDER BY m.avaliado_em DESC
     LIMIT %(limite)s
    """
    distribuicao_notas = {str(n): 0 for n in range(1, 6)}
    soma = respostas = 0
    for linha in _executar(sql, params):
        distribuicao_notas[str(linha['nota'])] = linha['total']
        soma += linha['nota'] * linha['total']
        respostas += linha['total']
    comentarios = [
        {**c, 'criado_em': c['criado_em'].isoformat()} for c in _executar(sql_coment, params)
    ]
    return {
        'media': round(soma / respostas, 2) if respostas else None,
        'respostas': respostas,
        'distribuicao': distribuicao_notas,
        'comentarios': comentarios,
    }


# --- exportação (equipe de gestão) ------------------------------------------

LIMITE_EXPORTACAO = 50000

COLUNAS_EXPORTACAO = (
    'protocolo', 'criado_em', 'status', 'situacao', 'categoria', 'secretaria', 'equipe',
    'prioridade', 'bairro', 'rua', 'latitude', 'longitude', 'triado_em', 'atribuido_em',
    'iniciado_em', 'resolvido_em', 'prazo_em', 'no_prazo', 'lead_time_h', 'reaberturas',
    'motivo_rejeicao', 'total_apoios', 'avaliacao_nota', 'atendente_nome',
)


def linhas_exportacao(escopo):
    """
    Uma linha por chamado recebido no período. Sem dado pessoal do cidadão
    (nome, e-mail, id); o servidor que atendeu sai pelo nome — é ato de ofício.
    """
    sql = f"""
    WITH {_cte_base(escopo)},
    ap AS (
        SELECT a.defeito_id, COUNT(*) AS total
          FROM apoios a JOIN m ON m.id = a.defeito_id AND m.recebido
         GROUP BY a.defeito_id
    )
    SELECT m.protocolo, m.criado_em, m.status, m.categoria_nome AS categoria,
           COALESCE(s.nome, NULLIF(m.secretaria_responsavel, '')) AS secretaria,
           e.nome AS equipe, m.prioridade, m.bairro, m.rua, m.latitude, m.longitude,
           m.triado_em, m.atribuido_em, m.iniciado_em, m.resolvido_em, m.prazo_em,
           m.lead_h, m.reaberturas, m.motivo_rejeicao, COALESCE(ap.total, 0) AS total_apoios,
           m.avaliacao_nota, u.nome AS atendente_nome
      FROM m
      LEFT JOIN secretarias s ON s.id = m.secretaria_ef
      LEFT JOIN equipes e ON e.id = m.equipe_id
      LEFT JOIN users u ON u.id = m.atendente_id
      LEFT JOIN ap ON ap.defeito_id = m.id
     WHERE m.recebido
     ORDER BY m.criado_em
     LIMIT %(limite)s
    """
    tz = fuso()

    def data(valor):
        return timezone.localtime(valor, tz).strftime('%Y-%m-%d %H:%M') if valor else ''

    for linha in _executar(sql, _params(escopo, limite=LIMITE_EXPORTACAO)):
        resolvido = linha['status'] == 'concluido' and linha['resolvido_em'] is not None
        no_prazo = ''
        if resolvido and linha['prazo_em'] is not None:
            no_prazo = 'sim' if linha['resolvido_em'] <= linha['prazo_em'] else 'não'
        yield {
            'protocolo': linha['protocolo'] or '',
            'criado_em': data(linha['criado_em']),
            'status': linha['status'],
            'situacao': ROTULOS_OPERACAO.get(linha['status'], linha['status']),
            'categoria': linha['categoria'],
            'secretaria': linha['secretaria'] or '',
            'equipe': linha['equipe'] or '',
            'prioridade': linha['prioridade'] or '',
            'bairro': linha['bairro'] or '',
            'rua': linha['rua'] or '',
            'latitude': linha['latitude'],
            'longitude': linha['longitude'],
            'triado_em': data(linha['triado_em']),
            'atribuido_em': data(linha['atribuido_em']),
            'iniciado_em': data(linha['iniciado_em']),
            'resolvido_em': data(linha['resolvido_em']) if resolvido else '',
            'prazo_em': data(linha['prazo_em']),
            'no_prazo': no_prazo,
            'lead_time_h': _r(linha['lead_h']) if resolvido else None,
            'reaberturas': linha['reaberturas'],
            'motivo_rejeicao': linha['motivo_rejeicao'] or '',
            'total_apoios': linha['total_apoios'],
            'avaliacao_nota': linha['avaliacao_nota'],
            'atendente_nome': linha['atendente_nome'] or '',
        }


# --- dados públicos (transparência, dados abertos, Open311) -----------------

CASAS_COORDENADA = 4


def chamados_publicos(municipio_id, *, inicio=None, fim=None, protocolos=None,
                      categoria_ids=None, situacao=None, limite=None):
    """
    Chamados para fora da prefeitura: sem autor, e-mail, ids de usuário,
    descrição livre nem notas internas; só os públicos e não removidos
    (os 'restrita' — autor em quarentena — ficam de fora); coordenadas com
    4 casas (~11 m). `inicio`/`fim` são instantes sobre `criado_em`;
    `situacao` = 'open' | 'closed'.
    """
    partes = ["d.municipio_id = %(mun)s", "d.removido_em IS NULL", "d.visibilidade = 'publica'"]
    params = {'mun': str(municipio_id), 'abertos': tuple(STATUS_ABERTOS), 'casas': CASAS_COORDENADA}
    if inicio is not None:
        partes.append('d.criado_em >= %(inicio)s')
        params['inicio'] = inicio
    if fim is not None:
        partes.append('d.criado_em < %(fim)s')
        params['fim'] = fim
    if protocolos:
        partes.append('d.protocolo IN %(protocolos)s')
        params['protocolos'] = tuple(protocolos)
    if categoria_ids:
        partes.append('d.categoria_id IN %(categorias)s')
        params['categorias'] = tuple(categoria_ids)
    if situacao == 'open':
        partes.append('d.status IN %(abertos)s')
    elif situacao == 'closed':
        partes.append('d.status NOT IN %(abertos)s')
    limite_sql = ''
    if limite:
        limite_sql = 'LIMIT %(limite)s'
        params['limite'] = limite
    sql = f"""
    SELECT d.protocolo, d.titulo, d.status, d.criado_em, d.atualizado_em, d.resolvido_em,
           d.prazo_em, d.bairro, d.rua, d.categoria_id, d.resposta_publica,
           COALESCE(c.nome, NULLIF(btrim(d.categoria), ''), 'Sem categoria') AS categoria,
           COALESCE(s.nome, NULLIF(d.secretaria_responsavel, '')) AS orgao_responsavel,
           ROUND(d.latitude::numeric, %(casas)s)::float AS latitude,
           ROUND(d.longitude::numeric, %(casas)s)::float AS longitude,
           (SELECT COUNT(*) FROM apoios a WHERE a.defeito_id = d.id) AS total_apoios
      FROM defeitos d
      LEFT JOIN categorias c ON c.id = d.categoria_id
      LEFT JOIN secretarias s ON s.id = {secretaria_efetiva('d')}
     WHERE {' AND '.join(partes)}
     ORDER BY d.criado_em DESC
     {limite_sql}
    """
    for linha in _iterar(sql, params):
        aberto = linha['status'] in STATUS_ABERTOS
        resolvido_em = linha['resolvido_em'] if linha['status'] == 'concluido' else None
        no_prazo = None
        if resolvido_em is not None and linha['prazo_em'] is not None:
            no_prazo = resolvido_em <= linha['prazo_em']
        linha.update({
            'aberto': aberto,
            'situacao': ROTULOS_CIDADAO.get(linha['status'], linha['status']),
            'resolvido_em': resolvido_em,
            'no_prazo': no_prazo,
        })
        yield linha


def municipio_publico(codigo):
    """{codigo, nome, uf_sigla, contratado} ou None se o código não existe."""
    linhas = _executar(
        """
        SELECT m.codigo, m.nome, m.uf_sigla, COALESCE(mc.contratado, FALSE) AS contratado
          FROM municipios m
          LEFT JOIN municipio_config mc ON mc.municipio_id = m.codigo
         WHERE m.codigo = %(codigo)s
        """,
        {'codigo': str(codigo)},
    )
    return linhas[0] if linhas else None
