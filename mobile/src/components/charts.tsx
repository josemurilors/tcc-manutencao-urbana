/**
 * Gráficos do painel executivo, desenhados com react-native-svg.
 *
 * A primeira versão (porte do Recharts do web) não tinha eixo, valor nem
 * toque: um gráfico que o secretário não consegue ler. Esta tem o mínimo de
 * produto de mercado:
 * - eixo Y com marcas "redondas" e grade discreta; rótulos do eixo X
 *   alinhados aos pontos reais, no máximo 6 para não embolar;
 * - toque mostra o valor (linha-guia + caixa com todas as séries);
 * - legenda com texto sempre que há mais de uma série, e "Ver tabela" em todo
 *   cartão — a identidade nunca depende só da cor, e a tabela é a saída para
 *   leitor de tela e para quem quer o número exato;
 * - leitor de tela: cada gráfico tem um resumo falado e, na linha, as ações
 *   de ajuste (deslizar para cima/baixo) percorrem os pontos um a um.
 *
 * Uma escala só por gráfico: medidas de grandezas diferentes (entradas por
 * semana × backlog acumulado) vão em gráficos separados, nunca em dois eixos.
 */

import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type AccessibilityActionEvent,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { AppText } from '@/components/ui/text';
import { Elevation, Fonts, Layout, Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';

import { useCoresGrafico } from './bi/cores';

const FONTE_EIXO = 11;

/* ------------------------------------------------------------ utilidades */

/** Largura disponível do contêiner, medida no layout (o SVG precisa de px). */
function useLargura(inicial = 0) {
  const [largura, setLargura] = useState(inicial);
  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.floor(e.nativeEvent.layout.width);
    if (w > 0 && w !== largura) setLargura(w);
  };
  return [largura, onLayout] as const;
}

/**
 * Teto e passo "bonitos" (1, 2, 2,5, 5 × 10^n) para `marcas` divisões do eixo.
 * Contagens nunca ganham passo fracionário: "0,5 chamado" não existe.
 */
export function escalaBonita(maximo: number, marcas = 4, inteiro = true) {
  if (!(maximo > 0)) return { teto: marcas, passo: 1 };
  const bruto = maximo / marcas;
  const mag = Math.pow(10, Math.floor(Math.log10(bruto)));
  const norm = bruto / mag;
  let passo = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  if (inteiro) passo = Math.max(1, Math.ceil(passo));
  return { teto: passo * Math.ceil(maximo / passo), passo };
}

/** Índices rotulados no eixo X: as pontas e até `max` pontos equidistantes. */
function indicesRotulados(n: number, max = 6) {
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const set = new Set<number>();
  for (let j = 0; j < max; j++) set.add(Math.round((j * (n - 1)) / (max - 1)));
  return [...set];
}

const fmtPadrao = (v: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(v);

/* ------------------------------------------------------------- moldura */

export type TabelaGrafico = { colunas: string[]; linhas: (string | number)[][] };

type ChartCardProps = {
  title: string;
  subtitle?: string;
  /** Ação no canto ("Ver tudo"). */
  action?: { label: string; onPress: () => void; accessibilityLabel?: string };
  /** Mesmos dados em tabela: alternativa acessível e para conferir números. */
  tabela?: TabelaGrafico;
  children: React.ReactNode;
};

/** Cartão de gráfico: título, subtítulo, ação e alternância gráfico/tabela. */
export function ChartCard({ title, subtitle, action, tabela, children }: ChartCardProps) {
  const colors = useColors();
  const [verTabela, setVerTabela] = useState(false);

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.cardTopo}>
        <View style={styles.cardTitulos}>
          <AppText variant="label" accessibilityRole="header">
            {title}
          </AppText>
          {subtitle ? (
            <AppText variant="caption" tone="muted">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {action ? (
          <Pressable
            onPress={action.onPress}
            accessibilityRole="button"
            accessibilityLabel={action.accessibilityLabel ?? action.label}
            style={styles.cardAcao}>
            <AppText variant="caption" tone="brand" weight="600" inControl>
              {action.label}
            </AppText>
          </Pressable>
        ) : null}
      </View>

      {verTabela && tabela ? <TabelaDados tabela={tabela} /> : children}

      {tabela && tabela.linhas.length > 0 ? (
        <Pressable
          onPress={() => setVerTabela((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={verTabela ? `Ver ${title} como gráfico` : `Ver ${title} como tabela`}
          style={styles.alternar}>
          <Ionicons name={verTabela ? 'bar-chart-outline' : 'list-outline'} size={14} color={colors.textSecondary} />
          <AppText variant="caption" tone="secondary" inControl>
            {verTabela ? 'Ver gráfico' : 'Ver tabela'}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

function TabelaDados({ tabela }: { tabela: TabelaGrafico }) {
  const colors = useColors();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <View>
        <View style={[styles.tabelaLinha, { borderBottomColor: colors.borderStrong }]}>
          {tabela.colunas.map((c, i) => (
            <AppText
              key={c}
              variant="caption"
              weight="600"
              tone="secondary"
              style={[styles.tabelaCelula, i === 0 ? styles.tabelaPrimeira : styles.tabelaNumero]}>
              {c}
            </AppText>
          ))}
        </View>
        {tabela.linhas.map((linha, li) => (
          <View
            key={`${linha[0]}-${li}`}
            style={[styles.tabelaLinha, { borderBottomColor: colors.border }]}
            accessible
            accessibilityLabel={linha.map((v, i) => `${tabela.colunas[i]}: ${v}`).join(', ')}>
            {linha.map((v, i) => (
              <AppText
                key={i}
                variant="caption"
                style={[styles.tabelaCelula, i === 0 ? styles.tabelaPrimeira : styles.tabelaNumero]}>
                {String(v)}
              </AppText>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

export type ItemLegenda = { cor: string; rotulo: string; forma?: 'linha' | 'bloco' };

/** Legenda em texto: a cor acompanha, o rótulo é o que identifica. */
export function Legenda({ itens }: { itens: ItemLegenda[] }) {
  return (
    <View style={styles.legenda} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {itens.map((it) => (
        <View key={it.rotulo} style={styles.legendaItem}>
          <View
            style={
              it.forma === 'linha'
                ? [styles.legendaLinha, { backgroundColor: it.cor }]
                : [styles.legendaBloco, { backgroundColor: it.cor }]
            }
          />
          <AppText variant="caption" tone="secondary">
            {it.rotulo}
          </AppText>
        </View>
      ))}
    </View>
  );
}

function EmptyChart({ height, texto = 'Sem dados no período.' }: { height: number; texto?: string }) {
  return (
    <View style={[styles.vazio, { height }]}>
      <AppText variant="caption" tone="muted">
        {texto}
      </AppText>
    </View>
  );
}

/* ---------------------------------------------------------------- linha */

export type SerieLinha = {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
  /** Preenche a área sob a linha (uma série por gráfico, no máximo). */
  area?: boolean;
};

type LineChartProps = {
  series: SerieLinha[];
  /** Rótulo curto de cada ponto, para o eixo X ("12/08", "ago/26"). */
  rotulosX: string[];
  /** Rótulo completo, para a caixa do toque e o leitor de tela. */
  rotulosLongos?: string[];
  formatarValor?: (v: number) => string;
  height?: number;
  /** Nome do gráfico no resumo falado. */
  titulo: string;
};

export function LineChart({
  series,
  rotulosX,
  rotulosLongos,
  formatarValor = fmtPadrao,
  height = 200,
  titulo,
}: LineChartProps) {
  const colors = useColors();
  const cg = useCoresGrafico();
  const [largura, onLayout] = useLargura();
  const [ativo, setAtivo] = useState<number | null>(null);

  const n = rotulosX.length;
  const longos = rotulosLongos ?? rotulosX;
  const maximo = Math.max(0, ...series.flatMap((s) => s.values.map((v) => v ?? 0)));
  const { teto, passo } = escalaBonita(maximo);
  const marcas = Array.from({ length: Math.round(teto / passo) + 1 }, (_, i) => i * passo);

  const maiorRotulo = Math.max(...marcas.map((m) => formatarValor(m).length));
  const padLeft = Math.ceil(maiorRotulo * FONTE_EIXO * 0.62) + 8;
  const padRight = 12;
  const padTop = 10;
  const padBottom = 22;
  const plotW = Math.max(largura - padLeft - padRight, 1);
  const plotH = height - padTop - padBottom;

  const x = (i: number) => padLeft + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => padTop + plotH - (v / teto) * plotH;

  const caminhos = useMemo(
    () =>
      series.map((s) => {
        let d = '';
        let aberto = false;
        s.values.forEach((v, i) => {
          if (v == null) {
            aberto = false;
            return;
          }
          d += `${aberto ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
          aberto = true;
        });
        let area = '';
        if (s.area) {
          const validos = s.values.map((v, i) => [i, v] as const).filter(([, v]) => v != null);
          if (validos.length > 1) {
            area =
              `M ${x(validos[0][0])} ${y(0)} ` +
              validos.map(([i, v]) => `L ${x(i).toFixed(1)} ${y(v as number).toFixed(1)}`).join(' ') +
              ` L ${x(validos[validos.length - 1][0])} ${y(0)} Z`;
          }
        }
        return { key: s.key, d: d.trim(), area, color: s.color };
      }),
    // x/y dependem só de largura, teto e n, que já estão aqui.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, largura, teto, n],
  );

  if (n === 0 || maximo === 0) {
    return (
      <View onLayout={onLayout}>
        <EmptyChart height={height} texto={n === 0 ? 'Sem dados no período.' : 'Nenhum registro no período.'} />
      </View>
    );
  }

  function indiceDoToque(e: GestureResponderEvent) {
    const lx = e.nativeEvent.locationX;
    if (n <= 1) return 0;
    const i = Math.round(((lx - padLeft) / plotW) * (n - 1));
    return Math.min(n - 1, Math.max(0, i));
  }

  const resumo =
    `${titulo}. ` +
    series
      .map((s) => {
        const vals = s.values.map((v) => v ?? 0);
        const max = Math.max(...vals);
        const iMax = vals.indexOf(max);
        return `${s.label}: de ${formatarValor(vals[0])} em ${longos[0]} a ${formatarValor(
          vals[vals.length - 1],
        )} em ${longos[n - 1]}, máximo ${formatarValor(max)} em ${longos[iMax]}`;
      })
      .join('. ');

  const descreverPonto = (i: number) =>
    `${longos[i]}: ` + series.map((s) => `${s.label} ${formatarValor(s.values[i] ?? 0)}`).join(', ');

  function onAcao(e: AccessibilityActionEvent) {
    const atual = ativo ?? -1;
    if (e.nativeEvent.actionName === 'increment') setAtivo(Math.min(n - 1, atual + 1));
    if (e.nativeEvent.actionName === 'decrement') setAtivo(Math.max(0, atual <= 0 ? 0 : atual - 1));
  }

  const larguraCaixa = 168;
  const xAtivo = ativo != null ? x(ativo) : 0;
  const esquerdaCaixa = Math.min(Math.max(xAtivo - larguraCaixa / 2, 0), Math.max(largura - larguraCaixa, 0));

  return (
    <View
      onLayout={onLayout}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={resumo}
      accessibilityHint="Deslize para cima ou para baixo para ouvir cada ponto."
      accessibilityValue={{ text: ativo != null ? descreverPonto(ativo) : 'nenhum ponto selecionado' }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={onAcao}
      onStartShouldSetResponder={() => true}
      // Deixa a rolagem vertical da tela assumir quando o dedo arrasta.
      onResponderTerminationRequest={() => true}
      onResponderGrant={(e) => setAtivo(indiceDoToque(e))}
      onResponderMove={(e) => setAtivo(indiceDoToque(e))}
      style={{ height }}>
      {largura > 0 ? (
        <Svg width={largura} height={height}>
          {marcas.map((m) => (
            <Line
              key={`g${m}`}
              x1={padLeft}
              x2={padLeft + plotW}
              y1={y(m)}
              y2={y(m)}
              stroke={m === 0 ? cg.eixo : cg.grade}
              strokeWidth={1}
              strokeDasharray={m === 0 ? undefined : '3 4'}
            />
          ))}
          {marcas.map((m) => (
            <SvgText
              fontFamily={Fonts.sans}
              key={`t${m}`}
              x={padLeft - 6}
              y={y(m) + 4}
              fontSize={FONTE_EIXO}
              fill={colors.textMuted}
              textAnchor="end">
              {formatarValor(m)}
            </SvgText>
          ))}
          {indicesRotulados(n).map((i) => (
            <SvgText
              fontFamily={Fonts.sans}
              key={`x${i}`}
              x={x(i)}
              y={height - 6}
              fontSize={FONTE_EIXO}
              fill={colors.textMuted}
              textAnchor={n > 1 && i === 0 ? 'start' : n > 1 && i === n - 1 ? 'end' : 'middle'}>
              {rotulosX[i]}
            </SvgText>
          ))}
          {caminhos.map((c) =>
            c.area ? <Path key={`a${c.key}`} d={c.area} fill={c.color} fillOpacity={0.14} /> : null,
          )}
          {caminhos.map((c) => (
            <Path
              key={c.key}
              d={c.d}
              stroke={c.color}
              strokeWidth={2}
              fill="none"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {ativo != null ? (
            <>
              <Line
                x1={xAtivo}
                x2={xAtivo}
                y1={padTop}
                y2={padTop + plotH}
                stroke={colors.borderStrong}
                strokeWidth={1}
              />
              {series.map((s) =>
                s.values[ativo] == null ? null : (
                  <Rect
                    key={`p${s.key}`}
                    x={xAtivo - 5}
                    y={y(s.values[ativo] as number) - 5}
                    width={10}
                    height={10}
                    rx={5}
                    fill={s.color}
                    stroke={colors.surface}
                    strokeWidth={2}
                  />
                ),
              )}
            </>
          ) : null}
        </Svg>
      ) : null}

      {ativo != null ? (
        <View
          pointerEvents="none"
          style={[
            styles.caixa,
            Elevation.md,
            { left: esquerdaCaixa, width: larguraCaixa, backgroundColor: colors.surfaceRaised, borderColor: colors.border },
          ]}>
          <AppText variant="caption" weight="600">
            {longos[ativo]}
          </AppText>
          {series.map((s) => (
            <View key={s.key} style={styles.caixaLinha}>
              <View style={[styles.legendaLinha, { backgroundColor: s.color }]} />
              <AppText variant="caption" tone="secondary" style={styles.caixaRotulo} numberOfLines={1}>
                {s.label}
              </AppText>
              <AppText variant="caption" weight="600">
                {s.values[ativo] == null ? '—' : formatarValor(s.values[ativo] as number)}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------- barras horizontais */

export type ItemBarra = {
  chave: string;
  rotulo: string;
  valor: number;
  /** Parte do valor em destaque crítico (ex.: vencidos dentro dos abertos). */
  critico?: number;
  /** Linha secundária ("78% no prazo · 3,2 dias"). */
  detalhe?: string;
};

type BarrasProps = {
  itens: ItemBarra[];
  formatarValor?: (v: number) => string;
  cor?: string;
  /** Nome da parte crítica, que vai escrita ao lado: "vencidos". */
  rotuloCritico?: string;
  onPressItem?: (item: ItemBarra) => void;
  /** Dica falada do toque ("Abre a lista de chamados"). */
  dicaToque?: string;
  titulo: string;
  vazio?: string;
};

/**
 * Barras horizontais ranqueadas: rótulo em cima (cabe nome longo de bairro),
 * barra embaixo, valor à direita. Linha inteira tocável (≥ 44 px) para o
 * drill-down.
 */
export function HorizontalBarChart({
  itens,
  formatarValor = fmtPadrao,
  cor,
  rotuloCritico,
  onPressItem,
  dicaToque,
  titulo,
  vazio,
}: BarrasProps) {
  const colors = useColors();
  const cg = useCoresGrafico();
  const [largura, onLayout] = useLargura();
  const corBarra = cor ?? cg.unica;
  const max = Math.max(1, ...itens.map((i) => i.valor));

  if (itens.length === 0) {
    return <EmptyChart height={96} texto={vazio} />;
  }

  return (
    <View onLayout={onLayout} accessibilityLabel={titulo}>
      {itens.map((item, pos) => {
        const total = largura > 0 ? Math.max((item.valor / max) * largura, item.valor > 0 ? 4 : 0) : 0;
        const critico = Math.min(item.critico ?? 0, item.valor);
        const wCritico = item.valor > 0 ? (critico / item.valor) * total : 0;
        // 2 px de respiro entre os segmentos, como entre barras vizinhas.
        const wNormal = Math.max(total - wCritico - (wCritico > 0 && total - wCritico > 0 ? 2 : 0), 0);
        const falado = [
          `${pos + 1}º, ${item.rotulo}: ${formatarValor(item.valor)}`,
          critico > 0 && rotuloCritico ? `${formatarValor(critico)} ${rotuloCritico}` : null,
          item.detalhe ?? null,
        ]
          .filter(Boolean)
          .join(', ');

        const linha = (
          <>
            <View style={styles.barraTopo}>
              <AppText variant="caption" style={styles.barraRotulo} numberOfLines={2}>
                {item.rotulo}
              </AppText>
              <AppText variant="caption" weight="600">
                {formatarValor(item.valor)}
              </AppText>
            </View>
            {largura > 0 ? (
              <Svg width={largura} height={10}>
                <Rect x={0} y={0} width={largura} height={10} rx={4} fill={colors.bgSubtle} />
                {wNormal > 0 ? <Rect x={0} y={0} width={wNormal} height={10} rx={4} fill={corBarra} /> : null}
                {wCritico > 0 ? (
                  <Rect x={total - wCritico} y={0} width={wCritico} height={10} rx={4} fill={cg.critico} />
                ) : null}
              </Svg>
            ) : (
              <View style={{ height: 10 }} />
            )}
            {(critico > 0 && rotuloCritico) || item.detalhe ? (
              <View style={styles.barraRodape}>
                {critico > 0 && rotuloCritico ? (
                  <View style={styles.barraCritico}>
                    <Ionicons name="alarm" size={12} color={colors.danger} />
                    <AppText variant="caption" tone="danger" weight="600">
                      {formatarValor(critico)} {rotuloCritico}
                    </AppText>
                  </View>
                ) : null}
                {item.detalhe ? (
                  <AppText variant="caption" tone="muted" numberOfLines={1} style={styles.barraDetalhe}>
                    {item.detalhe}
                  </AppText>
                ) : null}
              </View>
            ) : null}
          </>
        );

        return onPressItem ? (
          <Pressable
            key={item.chave}
            onPress={() => onPressItem(item)}
            accessibilityRole="button"
            accessibilityLabel={falado}
            accessibilityHint={dicaToque}
            style={({ pressed }) => [styles.barraLinha, pressed && { backgroundColor: colors.surfacePressed }]}>
            {linha}
          </Pressable>
        ) : (
          <View key={item.chave} style={styles.barraLinha} accessible accessibilityLabel={falado}>
            {linha}
          </View>
        );
      })}
    </View>
  );
}

/* --------------------------------------------- colunas (empilhadas) */

export type ParteColuna = { valor: number; cor: string; rotulo: string };
export type ItemColuna = { chave: string; rotulo: string; partes: ParteColuna[] };

type ColunasProps = {
  itens: ItemColuna[];
  height?: number;
  formatarValor?: (v: number) => string;
  titulo: string;
  /** Texto do item tocado; o padrão lista as partes. */
  descrever?: (item: ItemColuna) => string;
  onPressItem?: (item: ItemColuna) => void;
};

/**
 * Colunas verticais, simples ou empilhadas (a primeira parte fica na base).
 * Tocar numa coluna mostra o detalhe embaixo do gráfico; com `onPressItem`,
 * o detalhe vira um link para o drill-down.
 */
export function ColumnChart({
  itens,
  height = 180,
  formatarValor = fmtPadrao,
  titulo,
  descrever,
  onPressItem,
}: ColunasProps) {
  const colors = useColors();
  const cg = useCoresGrafico();
  const [largura, onLayout] = useLargura();
  const [ativo, setAtivo] = useState<string | null>(null);

  const totais = itens.map((i) => i.partes.reduce((a, p) => a + p.valor, 0));
  const maximo = Math.max(0, ...totais);
  const { teto, passo } = escalaBonita(maximo);
  const marcas = Array.from({ length: Math.round(teto / passo) + 1 }, (_, i) => i * passo);

  if (itens.length === 0 || maximo === 0) {
    return <EmptyChart height={height} texto={itens.length === 0 ? undefined : 'Nenhum registro no período.'} />;
  }

  const padLeft = Math.ceil(Math.max(...marcas.map((m) => formatarValor(m).length)) * FONTE_EIXO * 0.62) + 8;
  const padTop = 18;
  const padBottom = 22;
  const plotW = Math.max(largura - padLeft, 1);
  const plotH = height - padTop - padBottom;
  const slot = plotW / itens.length;
  const larguraColuna = Math.min(48, slot * 0.62);
  const y = (v: number) => padTop + plotH - (v / teto) * plotH;

  const descricao = (item: ItemColuna) =>
    descrever?.(item) ??
    `${item.rotulo}: ` + item.partes.map((p) => `${formatarValor(p.valor)} ${p.rotulo}`).join(', ');
  const itemAtivo = itens.find((i) => i.chave === ativo) ?? null;

  return (
    <View style={{ gap: Spacing[2] }}>
      <View onLayout={onLayout} style={{ height }} accessible accessibilityRole="image" accessibilityLabel={`${titulo}. ${itens.map(descricao).join('. ')}`}>
        {largura > 0 ? (
          <Svg width={largura} height={height}>
            {marcas.map((m) => (
              <Line
                key={`g${m}`}
                x1={padLeft}
                x2={largura}
                y1={y(m)}
                y2={y(m)}
                stroke={m === 0 ? cg.eixo : cg.grade}
                strokeWidth={1}
                strokeDasharray={m === 0 ? undefined : '3 4'}
              />
            ))}
            {marcas.map((m) => (
              <SvgText key={`t${m}`} fontFamily={Fonts.sans} x={padLeft - 6} y={y(m) + 4} fontSize={FONTE_EIXO} fill={colors.textMuted} textAnchor="end">
                {formatarValor(m)}
              </SvgText>
            ))}
            {itens.map((item, i) => {
              const cx = padLeft + slot * i + slot / 2;
              let base = 0;
              const selecionado = ativo === item.chave;
              return (
                <G key={item.chave}>
                  {item.partes.map((p, pi) => {
                    if (p.valor <= 0) return null;
                    const y0 = y(base);
                    base += p.valor;
                    const y1 = y(base);
                    // 2 px de respiro entre partes empilhadas.
                    const h = Math.max(y0 - y1 - (pi > 0 ? 2 : 0), 1);
                    return (
                      <Rect
                        key={pi}
                        x={cx - larguraColuna / 2}
                        y={y1}
                        width={larguraColuna}
                        height={h}
                        rx={3}
                        fill={p.cor}
                        opacity={ativo && !selecionado ? 0.45 : 1}
                      />
                    );
                  })}
                  <SvgText
              fontFamily={Fonts.sans}
                    x={cx}
                    y={y(totais[i]) - 5}
                    fontSize={FONTE_EIXO}
                    fontWeight="600"
                    fill={colors.textPrimary}
                    textAnchor="middle">
                    {formatarValor(totais[i])}
                  </SvgText>
                  <SvgText fontFamily={Fonts.sans} x={cx} y={height - 6} fontSize={FONTE_EIXO} fill={colors.textMuted} textAnchor="middle">
                    {item.rotulo}
                  </SvgText>
                </G>
              );
            })}
          </Svg>
        ) : null}
        {/* Alvos de toque por coluna, maiores que a barra desenhada. */}
        <View style={[StyleSheet.absoluteFill, styles.alvos, { left: padLeft }]}>
          {itens.map((item) => (
            <Pressable
              key={item.chave}
              onPress={() => setAtivo((a) => (a === item.chave ? null : item.chave))}
              accessibilityElementsHidden
              importantForAccessibility="no"
              style={styles.alvo}
            />
          ))}
        </View>
      </View>

      {itemAtivo ? (
        onPressItem ? (
          <Pressable
            onPress={() => onPressItem(itemAtivo)}
            accessibilityRole="button"
            accessibilityLabel={`${descricao(itemAtivo)}. Abrir lista`}
            style={[styles.detalheColuna, { backgroundColor: colors.bgSubtle }]}>
            <AppText variant="caption" style={styles.flex1}>
              {descricao(itemAtivo)}
            </AppText>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </Pressable>
        ) : (
          <View style={[styles.detalheColuna, { backgroundColor: colors.bgSubtle }]} accessibilityLiveRegion="polite">
            <AppText variant="caption" style={styles.flex1}>
              {descricao(itemAtivo)}
            </AppText>
          </View>
        )
      ) : (
        <AppText variant="caption" tone="muted">
          Toque numa coluna para ver os números.
        </AppText>
      )}
    </View>
  );
}

/* ---------------------------------------------------------------- estilos */

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing[4],
    gap: Spacing[3],
  },
  cardTopo: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing[2],
  },
  cardTitulos: {
    flex: 1,
    gap: Spacing[0.5],
  },
  cardAcao: {
    minHeight: Layout.minTouch,
    minWidth: Layout.minTouch,
    marginTop: -Spacing[3],
    marginRight: -Spacing[2],
    paddingHorizontal: Spacing[2],
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  alternar: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing[1],
    minHeight: Layout.minTouch,
  },
  tabelaLinha: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing[1.5],
  },
  tabelaCelula: {
    paddingHorizontal: Spacing[1.5],
    fontVariant: ['tabular-nums'],
  },
  tabelaPrimeira: {
    width: 140,
  },
  tabelaNumero: {
    width: 84,
    textAlign: 'right',
  },
  legenda: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[3],
  },
  legendaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[1.5],
  },
  legendaLinha: {
    width: 14,
    height: 3,
    borderRadius: 2,
  },
  legendaBloco: {
    width: 10,
    height: 10,
    borderRadius: 2,
  },
  vazio: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  caixa: {
    position: 'absolute',
    top: 0,
    padding: Spacing[2],
    borderRadius: Radius.sm,
    borderWidth: 1,
    gap: 2,
  },
  caixaLinha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[1.5],
  },
  caixaRotulo: {
    flex: 1,
  },
  barraLinha: {
    minHeight: Layout.minTouch,
    paddingVertical: Spacing[1.5],
    gap: Spacing[1],
    borderRadius: Radius.sm,
  },
  barraTopo: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing[2],
  },
  barraRotulo: {
    flex: 1,
  },
  barraRodape: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
  barraCritico: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  barraDetalhe: {
    flex: 1,
  },
  alvos: {
    flexDirection: 'row',
  },
  alvo: {
    flex: 1,
  },
  detalheColuna: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    padding: Spacing[2],
    minHeight: Layout.minTouch,
    borderRadius: Radius.sm,
  },
  flex1: {
    flex: 1,
  },
});
