/**
 * Seções do portal público de transparência (`/transparencia/<codigo>`).
 *
 * Cada bloco responde a uma pergunta de quem chega pelo link da prefeitura,
 * na ordem em que ela costuma vir: a prefeitura resolve (KPIs)? Está
 * melhorando (série mensal)? Em quê é boa ou ruim (por tipo)? Prova
 * (últimos resolvidos, com link para o chamado)? E, para quem quer conferir
 * por conta própria, os dados abertos e o Open311.
 *
 * Tudo é público e sem dado pessoal (contrato v3 §7.5); nenhuma seção
 * depende de sessão.
 */

import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import { fmtMes, fmtNumero, fmtPct } from '@/components/bi/formato';
import { ChartCard, Legenda, LineChart } from '@/components/charts';
import { useCoresGrafico } from '@/components/bi/cores';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { AppText } from '@/components/ui/text';
import { Fonts, Layout, Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import { useToast } from '@/context/toast-context';
import { urlDadosAbertos, urlsOpen311 } from '@/services/api-transparencia';
import type {
  CategoriaTransparencia,
  FormatoDadosAbertos,
  KpisTransparencia,
  MesTransparencia,
  PortalTransparencia,
  ResolvidoTransparencia,
} from '@/types/transparencia';
import { formatarData } from '@/utils/format';

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** "2026-08" -> "ago/26" (eixo); o rótulo longo usa `fmtMes`. */
function mesCurto(yyyyMm: string) {
  const [a, m] = yyyyMm.split('-').map(Number);
  return `${MESES[(m || 1) - 1]}/${String(a).slice(-2)}`;
}

/** Dias com uma casa abaixo de 10 ("2,9 dias") e "—" sem dado. */
export function fmtDias(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return '—';
  const arredondado = n < 10 ? Math.round(n * 10) / 10 : Math.round(n);
  return arredondado === 1 ? '1 dia' : `${arredondado.toLocaleString('pt-BR')} dias`;
}

function fmtNota(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}/5`;
}

/** "01/10/2026 às 14:32" — o selo não precisa de segundos. */
function fmtAtualizado(iso: string) {
  const d = new Date(iso);
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${d.toLocaleDateString('pt-BR')} às ${hora}`;
}

async function abrirUrl(url: string, falhou: () => void) {
  try {
    await Linking.openURL(url);
  } catch {
    falhou();
  }
}

/* ------------------------------------------------------------- cabeçalho */

export function CabecalhoPortal({ dados }: { dados: PortalTransparencia }) {
  const colors = useColors();
  const { municipio } = dados;

  return (
    <View style={styles.hero}>
      <View style={styles.heroSelo}>
        <Ionicons name="shield-checkmark-outline" size={16} color={colors.primaryText} />
        <AppText variant="caption" tone="brand" weight="700" style={styles.caixaAlta}>
          Portal de transparência
        </AppText>
      </View>
      <AppText variant="display" accessibilityRole="header">
        {municipio.nome}
        <AppText variant="display" tone="muted">
          {' '}
          / {municipio.uf_sigla}
        </AppText>
      </AppText>
      <AppText variant="body" tone="secondary" style={styles.heroTexto}>
        Como a cidade responde aos problemas que os moradores registram: buracos, iluminação,
        entulho, calçadas. Números públicos, sem nenhum dado pessoal, para qualquer pessoa conferir.
      </AppText>
      <View style={styles.heroSelos}>
        {dados.atualizado_em ? (
          <Badge
            tone="info"
            icon="time-outline"
            label={`Dados atualizados em ${fmtAtualizado(dados.atualizado_em)}`}
          />
        ) : null}
        <Badge
          tone={dados.contratado ? 'success' : 'neutral'}
          icon={dados.contratado ? 'checkmark-circle' : 'people-outline'}
          label={dados.contratado ? 'Prefeitura atende pelo CIU' : 'Registros dos moradores'}
        />
      </View>
      {!dados.contratado ? (
        <View
          style={[styles.aviso, { backgroundColor: colors.infoSubtle, borderColor: colors.info }]}
          accessible
          accessibilityRole="text">
          <Ionicons name="information-circle" size={18} color={colors.info} />
          <AppText variant="bodySm" tone="secondary" style={styles.flex}>
            Esta prefeitura ainda não atende pelo CIU. Os números mostram o que os moradores
            registraram e o que foi marcado como resolvido na rua.
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ KPIs */

export function KpisPortal({ kpis }: { kpis: KpisTransparencia }) {
  return (
    <View style={styles.secao}>
      <Titulo
        titulo="Últimos 90 dias"
        subtitulo="Toque no ícone de informação de cada número para ver como ele é calculado."
      />
      <View style={styles.kpis}>
        <KpiCard
          icon="file-tray-full-outline"
          title="Problemas recebidos"
          value={fmtNumero(kpis.recebidos)}
          ajuda="Quantos problemas foram registrados na cidade nos últimos 90 dias, pelo app, pelo site ou pela prefeitura."
        />
        <KpiCard
          icon="checkmark-done-outline"
          title="Resolvidos"
          value={fmtNumero(kpis.resolvidos)}
          ajuda="Quantos chamados foram concluídos no período. Pode incluir pedidos abertos antes dos 90 dias."
        />
        <KpiCard
          icon="timer-outline"
          title="Resolvidos no prazo"
          value={fmtPct(kpis.pct_no_prazo)}
          valueA11y={kpis.pct_no_prazo == null ? 'sem dados' : undefined}
          ajuda="Dos resolvidos, a parte concluída dentro do prazo que a prefeitura definiu para cada tipo de problema."
        />
        <KpiCard
          icon="hourglass-outline"
          title="Tempo mediano para resolver"
          value={fmtDias(kpis.tempo_mediano_dias)}
          valueA11y={kpis.tempo_mediano_dias == null ? 'sem dados' : undefined}
          ajuda="Metade dos chamados resolvidos levou até este tempo, da abertura à conclusão. A mediana não é distorcida por poucos casos muito demorados."
        />
        <KpiCard
          icon="star-outline"
          title="Satisfação"
          value={fmtNota(kpis.csat_media)}
          valueA11y={kpis.csat_media == null ? 'sem avaliações ainda' : undefined}
          ajuda="Média das notas de 1 a 5 que quem reportou deu ao serviço depois que o chamado foi concluído."
        />
      </View>
    </View>
  );
}

/* --------------------------------------------------------- série mensal */

export function GraficoMensal({ serie }: { serie: MesTransparencia[] }) {
  const cg = useCoresGrafico();
  const longos = serie.map((m) => fmtMes(m.mes));

  return (
    <ChartCard
      title="Recebidos × resolvidos por mês"
      subtitle="Últimos 12 meses. Quando a linha de resolvidos acompanha a de recebidos, a fila não cresce."
      tabela={{
        colunas: ['Mês', 'Recebidos', 'Resolvidos'],
        linhas: serie.map((m, i) => [longos[i], m.recebidos, m.resolvidos]),
      }}>
      <Legenda
        itens={[
          { cor: cg.recebidos, rotulo: 'Recebidos', forma: 'linha' },
          { cor: cg.resolvidos, rotulo: 'Resolvidos', forma: 'linha' },
        ]}
      />
      <LineChart
        titulo="Chamados recebidos e resolvidos por mês"
        rotulosX={serie.map((m) => mesCurto(m.mes))}
        rotulosLongos={longos}
        formatarValor={fmtNumero}
        series={[
          { key: 'rec', label: 'Recebidos', color: cg.recebidos, values: serie.map((m) => m.recebidos) },
          { key: 'res', label: 'Resolvidos', color: cg.resolvidos, values: serie.map((m) => m.resolvidos) },
        ]}
      />
    </ChartCard>
  );
}

/* ---------------------------------------------------------- por categoria */

export function DesempenhoCategorias({ categorias }: { categorias: CategoriaTransparencia[] }) {
  const colors = useColors();
  const cg = useCoresGrafico();
  const ordenadas = [...categorias].sort((a, b) => b.recebidos - a.recebidos);
  const maximo = Math.max(1, ...ordenadas.map((c) => Math.max(c.recebidos, c.resolvidos)));

  return (
    <ChartCard
      title="Desempenho por tipo de problema"
      subtitle="Últimos 90 dias. O percentual à direita é a parte resolvida dentro do prazo."
      tabela={{
        colunas: ['Tipo', 'Recebidos', 'Resolvidos', 'No prazo', 'Tempo mediano'],
        linhas: ordenadas.map((c) => [
          c.categoria,
          c.recebidos,
          c.resolvidos,
          fmtPct(c.pct_no_prazo),
          fmtDias(c.tempo_mediano_dias),
        ]),
      }}>
      {ordenadas.length === 0 ? (
        <AppText variant="bodySm" tone="muted" style={styles.vazio}>
          Nenhum problema registrado nos últimos 90 dias.
        </AppText>
      ) : (
        <>
          <Legenda
            itens={[
              { cor: cg.recebidos, rotulo: 'Recebidos' },
              { cor: cg.resolvidos, rotulo: 'Resolvidos' },
            ]}
          />
          {ordenadas.map((c) => (
            <View
              key={c.categoria}
              style={styles.categoria}
              accessible
              accessibilityLabel={`${c.categoria}: ${c.recebidos} recebidos, ${c.resolvidos} resolvidos, ${
                c.pct_no_prazo == null ? 'sem dado de prazo' : `${fmtPct(c.pct_no_prazo)} no prazo`
              }, tempo mediano ${fmtDias(c.tempo_mediano_dias)}`}>
              <View style={styles.categoriaTopo}>
                <AppText style={styles.emoji}>{c.icone || '📋'}</AppText>
                <AppText variant="bodySm" weight="600" numberOfLines={1} style={styles.flex}>
                  {c.categoria}
                </AppText>
                <AppText variant="bodySm" weight="700">
                  {fmtPct(c.pct_no_prazo)}
                </AppText>
              </View>
              <View style={styles.barras}>
                <View style={[styles.trilho, { backgroundColor: colors.bgSubtle }]}>
                  <View
                    style={[
                      styles.barra,
                      { backgroundColor: cg.recebidos, width: `${(c.recebidos / maximo) * 100}%` },
                    ]}
                  />
                </View>
                <View style={[styles.trilho, { backgroundColor: colors.bgSubtle }]}>
                  <View
                    style={[
                      styles.barra,
                      { backgroundColor: cg.resolvidos, width: `${(c.resolvidos / maximo) * 100}%` },
                    ]}
                  />
                </View>
              </View>
              <AppText variant="caption" tone="muted" numberOfLines={2}>
                {fmtNumero(c.resolvidos)} de {fmtNumero(c.recebidos)} resolvidos
                {c.tempo_mediano_dias != null ? ` · resolve em ~${fmtDias(c.tempo_mediano_dias)}` : ''}
              </AppText>
            </View>
          ))}
        </>
      )}
    </ChartCard>
  );
}

/* -------------------------------------------------- últimos resolvidos */

export function UltimosResolvidos({ itens }: { itens: ResolvidoTransparencia[] }) {
  const colors = useColors();

  return (
    <Card style={styles.cartao}>
      <Titulo
        titulo="Resolvidos recentemente"
        subtitulo="Cada um tem protocolo e página pública com o histórico e as fotos."
      />
      {itens.length === 0 ? (
        <AppText variant="bodySm" tone="muted" style={styles.vazio}>
          Nenhum chamado público foi resolvido nos últimos 90 dias.
        </AppText>
      ) : (
        itens.map((r) => (
          <Link key={r.id} href={{ pathname: '/chamado/[id]', params: { id: r.id } }} asChild>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`${r.categoria || r.titulo}${r.bairro ? `, ${r.bairro}` : ''}, resolvido em ${formatarData(r.resolvido_em)}${
                r.protocolo ? `, protocolo ${r.protocolo}` : ''
              }${r.tem_foto_depois ? ', com foto da solução' : ''}. Abrir chamado`}
              style={({ pressed }) => [
                styles.resolvido,
                { borderBottomColor: colors.border },
                pressed && { backgroundColor: colors.surfacePressed },
              ]}>
              <Ionicons name="checkmark-circle" size={22} color={colors.success} />
              <View style={styles.flex}>
                <AppText variant="bodySm" weight="600" numberOfLines={1}>
                  {r.categoria || r.titulo}
                  {r.bairro ? ` · ${r.bairro}` : ''}
                </AppText>
                <AppText variant="caption" tone="muted" numberOfLines={1}>
                  Resolvido em {formatarData(r.resolvido_em)}
                  {r.protocolo ? ` · protocolo ${r.protocolo}` : ''}
                </AppText>
              </View>
              {r.tem_foto_depois ? (
                <Ionicons
                  name="camera-outline"
                  size={16}
                  color={colors.textMuted}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
              ) : null}
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </Pressable>
          </Link>
        ))
      )}
    </Card>
  );
}

/* ------------------------------------------------- dados abertos/Open311 */

export function DadosAbertos({ codigo }: { codigo: string }) {
  const colors = useColors();
  const toast = useToast();

  function baixar(formato: FormatoDadosAbertos) {
    abrirUrl(urlDadosAbertos(codigo, formato), () =>
      toast.error('Não foi possível abrir o download. Tente de novo.'),
    );
  }

  return (
    <Card style={styles.cartao}>
      <Titulo
        titulo="Dados abertos"
        subtitulo="Baixe todos os chamados públicos da cidade e faça sua própria análise."
      />
      <View style={styles.botoes}>
        <Button
          size="sm"
          variant="secondary"
          onPress={() => baixar('csv')}
          icon={<Ionicons name="document-text-outline" size={16} color={colors.textPrimary} />}
          accessibilityHint="Baixa a planilha com os chamados públicos">
          Planilha (CSV)
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onPress={() => baixar('geojson')}
          icon={<Ionicons name="map-outline" size={16} color={colors.textPrimary} />}
          accessibilityHint="Baixa o mapa dos chamados em GeoJSON">
          Mapa (GeoJSON)
        </Button>
      </View>
      <AppText variant="caption" tone="muted">
        Protocolo, tipo, situação, órgão responsável, bairro, rua, coordenadas aproximadas (cerca de
        11 m), datas, prazo e apoios. Sem nome, contato ou descrição de quem reportou. A planilha abre
        no Excel (separador “;”); o GeoJSON abre no QGIS ou no geojson.io.
      </AppText>
    </Card>
  );
}

export function Open311({ codigo }: { codigo: string }) {
  const colors = useColors();
  const toast = useToast();
  const urls = urlsOpen311(codigo);

  async function copiar(url: string) {
    const nav = Platform.OS === 'web' && typeof navigator !== 'undefined' ? navigator : undefined;
    if (!nav?.clipboard) return;
    try {
      await nav.clipboard.writeText(url);
      toast.success('Endereço copiado.');
    } catch {
      toast.error('Não foi possível copiar. Selecione o endereço e copie à mão.');
    }
  }

  const podeCopiar = Platform.OS === 'web';
  const enderecos: { rotulo: string; url: string }[] = [
    { rotulo: 'Tipos de serviço', url: urls.servicos },
    { rotulo: 'Chamados (últimos 90 dias)', url: urls.solicitacoes },
    { rotulo: 'Um chamado pelo protocolo', url: urls.solicitacao },
  ];

  return (
    <Card style={styles.cartao}>
      <Titulo titulo="Para desenvolvedores: Open311" />
      <AppText variant="bodySm" tone="secondary">
        Os chamados também saem no padrão aberto Open311 GeoReport v2, o mesmo usado por sistemas de
        atendimento urbano em vários países. Assim, imprensa, universidades e outros apps leem os dados
        direto, sem cadastro e sem depender desta tela.
      </AppText>
      {enderecos.map((e) => (
        <View key={e.rotulo} style={styles.endpoint}>
          <AppText variant="caption" tone="muted" weight="600">
            {e.rotulo}
          </AppText>
          <View style={[styles.codigo, { backgroundColor: colors.bgSubtle, borderColor: colors.border }]}>
            <AppText variant="caption" selectable style={[styles.mono, styles.flex]}>
              GET {e.url}
            </AppText>
            {podeCopiar ? (
              <Pressable
                onPress={() => copiar(e.url)}
                accessibilityRole="button"
                accessibilityLabel={`Copiar endereço: ${e.rotulo}`}
                hitSlop={8}
                style={styles.copiar}>
                <Ionicons name="copy-outline" size={16} color={colors.textSecondary} />
              </Pressable>
            ) : null}
          </View>
        </View>
      ))}
      <AppText variant="caption" tone="muted">
        Respostas em JSON. O parâmetro jurisdiction_id é o código IBGE da cidade ({codigo}); o
        service_request_id é o protocolo. Limite de 60 consultas por minuto.
      </AppText>
      <Pressable
        onPress={() =>
          abrirUrl('https://wiki.open311.org/GeoReport_v2/', () =>
            toast.error('Não foi possível abrir a especificação.'),
          )
        }
        accessibilityRole="link"
        style={styles.linkExterno}>
        <AppText variant="caption" tone="brand" weight="600">
          Ler a especificação GeoReport v2
        </AppText>
        <Ionicons name="open-outline" size={14} color={colors.primaryText} />
      </Pressable>
    </Card>
  );
}

/* --------------------------------------------------------------- comuns */

function Titulo({ titulo, subtitulo }: { titulo: string; subtitulo?: string }) {
  return (
    <View style={styles.titulo}>
      <AppText variant="title" accessibilityRole="header">
        {titulo}
      </AppText>
      {subtitulo ? (
        <AppText variant="caption" tone="muted">
          {subtitulo}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  caixaAlta: {
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  hero: {
    gap: Spacing[2],
  },
  heroSelo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[1],
  },
  heroTexto: {
    maxWidth: 720,
  },
  heroSelos: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
    marginTop: Spacing[1],
  },
  aviso: {
    flexDirection: 'row',
    gap: Spacing[2],
    padding: Spacing[3],
    borderWidth: 1,
    borderRadius: Radius.md,
    marginTop: Spacing[1],
  },
  secao: {
    gap: Spacing[3],
  },
  titulo: {
    gap: 2,
  },
  kpis: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
  },
  vazio: {
    paddingVertical: Spacing[3],
  },
  categoria: {
    gap: Spacing[1],
    paddingVertical: Spacing[2],
  },
  categoriaTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
  emoji: {
    fontSize: 18,
    lineHeight: 24,
  },
  barras: {
    gap: 3,
  },
  trilho: {
    height: 6,
    borderRadius: Radius.full,
    overflow: 'hidden',
  },
  barra: {
    height: 6,
    borderRadius: Radius.full,
  },
  cartao: {
    gap: Spacing[3],
  },
  resolvido: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    minHeight: Layout.minTouch,
    paddingVertical: Spacing[2],
    paddingHorizontal: Spacing[1],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sm,
  },
  botoes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
  },
  endpoint: {
    gap: Spacing[1],
  },
  codigo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    paddingVertical: Spacing[2],
    paddingHorizontal: Spacing[3],
    borderWidth: 1,
    borderRadius: Radius.md,
  },
  mono: {
    fontFamily: Fonts.mono,
  },
  copiar: {
    padding: Spacing[1],
  },
  linkExterno: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[1],
    alignSelf: 'flex-start',
    minHeight: Layout.minTouch,
  },
});
