/**
 * Peças de layout responsivo para as telas dos servidores, que a gestão usa
 * no computador (web largo). No celular tudo continua em uma coluna: estas
 * peças só mudam a composição a partir dos pontos de quebra abaixo.
 *
 * - `useBreakpoint`: em que faixa de largura a janela está.
 * - `ResponsiveGrid`: grade de N colunas iguais (N por faixa), linhas
 *   alinhadas e última linha completada com células vazias.
 * - `SplitView`: lista à esquerda e painel de detalhe à direita, lado a lado.
 * - `ContentWidth`: limita a largura do conteúdo e centraliza.
 */

import { Children, Fragment, isValidElement } from 'react';
import { StyleSheet, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';

/** Pontos de quebra (largura da janela, em dp/px). */
export const Breakpoints = {
  /** Tablet / janela média. */
  tablet: 768,
  /** Computador: a partir daqui as telas da gestão mudam de composição. */
  desktop: 1024,
} as const;

/** Largura máxima do conteúdo em telas largas (painel, admin...). */
export const LARGURA_MAX_CONTEUDO = 1200;

export type Faixa = 'celular' | 'tablet' | 'desktop';

export function faixaDaLargura(largura: number): Faixa {
  if (largura >= Breakpoints.desktop) return 'desktop';
  if (largura >= Breakpoints.tablet) return 'tablet';
  return 'celular';
}

/** Faixa de largura atual; re-renderiza quando a janela muda de tamanho. */
export function useBreakpoint() {
  const { width, height } = useWindowDimensions();
  const faixa = faixaDaLargura(width);
  return {
    largura: width,
    altura: height,
    faixa,
    /** ≥ 768 */
    tablet: faixa !== 'celular',
    /** ≥ 1024 */
    desktop: faixa === 'desktop',
  };
}

/** Escolhe um valor por faixa; faixas omitidas herdam a menor anterior. */
export function porFaixa<T>(faixa: Faixa, valores: { celular: T; tablet?: T; desktop?: T }): T {
  if (faixa === 'desktop') return valores.desktop ?? valores.tablet ?? valores.celular;
  if (faixa === 'tablet') return valores.tablet ?? valores.celular;
  return valores.celular;
}

/** Desfaz fragmentos e descarta `null`/`false`, para contar as células de verdade. */
function itens(children: React.ReactNode): React.ReactNode[] {
  const lista: React.ReactNode[] = [];
  Children.forEach(children, (c) => {
    if (c == null || typeof c === 'boolean') return;
    if (isValidElement<{ children?: React.ReactNode }>(c) && c.type === Fragment) {
      lista.push(...itens(c.props.children));
    } else {
      lista.push(c);
    }
  });
  return lista;
}

type GridProps = {
  children: React.ReactNode;
  /** Colunas por faixa (padrão: 1 no celular). Um número vale para todas. */
  columns: number | { celular?: number; tablet?: number; desktop?: number };
  /** Espaço entre células, nas duas direções. */
  gap?: number;
  style?: StyleProp<ViewStyle>;
  /** Estilo de cada célula (ex.: `flexDirection: 'row'` para filhos com `flexBasis`). */
  itemStyle?: StyleProp<ViewStyle>;
};

/**
 * Grade de colunas iguais. Com 1 coluna vira uma pilha simples (o layout do
 * celular não muda). As linhas são montadas à mão em vez de `flexWrap` com
 * porcentagem, para o `gap` não estourar a largura.
 */
export function ResponsiveGrid({ children, columns, gap = Spacing[3], style, itemStyle }: GridProps) {
  const { faixa } = useBreakpoint();
  const n = Math.max(
    1,
    typeof columns === 'number'
      ? columns
      : porFaixa(faixa, { celular: columns.celular ?? 1, tablet: columns.tablet, desktop: columns.desktop }),
  );
  const lista = itens(children);

  if (n === 1) {
    return <View style={[{ gap }, style]}>{lista}</View>;
  }

  const linhas: React.ReactNode[][] = [];
  for (let i = 0; i < lista.length; i += n) linhas.push(lista.slice(i, i + n));

  return (
    <View style={[{ gap }, style]}>
      {linhas.map((linha, i) => (
        <View key={i} style={[styles.linha, { gap }]}>
          {linha.map((item, j) => (
            <View key={j} style={[styles.celula, itemStyle]}>
              {item}
            </View>
          ))}
          {Array.from({ length: n - linha.length }, (_, j) => (
            <View key={`vazia-${j}`} style={styles.celula} />
          ))}
        </View>
      ))}
    </View>
  );
}

type SplitProps = {
  /** Lado esquerdo (lista). */
  lista: React.ReactNode;
  /** Lado direito (detalhe). */
  detalhe: React.ReactNode;
  /** Largura da lista. Padrão: 40% da janela, entre 360 e 520. */
  larguraLista?: number;
  style?: StyleProp<ViewStyle>;
};

/** Visão dividida: lista à esquerda, detalhe à direita, com divisória. */
export function SplitView({ lista, detalhe, larguraLista, style }: SplitProps) {
  const colors = useColors();
  const { largura } = useBreakpoint();
  const w = larguraLista ?? Math.min(520, Math.max(360, Math.round(largura * 0.4)));
  return (
    <View style={[styles.split, style]}>
      <View style={[styles.splitLista, { width: w }]}>{lista}</View>
      <View style={[styles.splitDetalhe, { borderLeftColor: colors.border }]}>{detalhe}</View>
    </View>
  );
}

/** Limita a largura do conteúdo e centraliza na janela. */
export function ContentWidth({
  children,
  maxWidth = LARGURA_MAX_CONTEUDO,
  style,
}: {
  children: React.ReactNode;
  maxWidth?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.limite, { maxWidth }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  linha: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  celula: {
    flex: 1,
    minWidth: 0,
  },
  split: {
    flex: 1,
    flexDirection: 'row',
  },
  splitLista: {
    flexShrink: 0,
  },
  splitDetalhe: {
    flex: 1,
    minWidth: 0,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  limite: {
    width: '100%',
    alignSelf: 'center',
  },
});
