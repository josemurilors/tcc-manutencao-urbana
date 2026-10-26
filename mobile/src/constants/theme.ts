/**
 * Tokens de design do app.
 *
 * Têm duas camadas: as cores (primitivos + semânticos por tema) moram em `palette.ts`,
 * conferidas pelo `scripts/check-contrast.mjs`; aqui ficam tipografia,
 * espaçamento, forma, elevação e movimento.
 *
 * Os nomes antigos (`FontSize`, `Radius`, `ControlHeight`, `bgPrimary`...)
 * continuam exportados para as telas migrarem aos poucos.
 */

import { Platform, type TextStyle, type ViewStyle } from 'react-native';

import { Colors, type CorDeTom, type Paleta, type StatusChave } from './palette';

export { Colors, Gold } from './palette';
export type { CorDeTom, Paleta, StatusChave } from './palette';

export type ThemeName = keyof typeof Colors;
/** Alias antigo de `Paleta`. */
export type Palette = Paleta;

// ---------------------------------------------------------------------------
// Tipografia

export const FontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

/**
 * Escala tipográfica com altura de linha. Nada abaixo de 12: os `xs - 1` e
 * `fontSize: 10` espalhados pelas telas devem migrar para `caption`.
 */
export const Typography = {
  caption: { fontSize: 12, lineHeight: 16, fontWeight: FontWeight.regular },
  label: { fontSize: 14, lineHeight: 20, fontWeight: FontWeight.semibold },
  bodySm: { fontSize: 14, lineHeight: 20, fontWeight: FontWeight.regular },
  body: { fontSize: 16, lineHeight: 24, fontWeight: FontWeight.regular },
  title: { fontSize: 18, lineHeight: 24, fontWeight: FontWeight.semibold },
  headline: { fontSize: 22, lineHeight: 28, fontWeight: FontWeight.bold },
  display: { fontSize: 28, lineHeight: 34, fontWeight: FontWeight.bold },
} as const satisfies Record<string, TextStyle>;

export type TypographyVariant = keyof typeof Typography;

/** Tamanhos soltos da primeira versão. Prefira `Typography`. */
export const FontSize = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 20,
  xxl: 24,
  xxxl: 30,
} as const;

/**
 * Teto do `maxFontSizeMultiplier`. Texto corrido cresce até 2x com a fonte do
 * sistema; texto dentro de controle de altura mínima (botão, selo, pílula)
 * para em 1,6x para não estourar o layout — o controle cresce junto, porque
 * usa `minHeight` e não `height`.
 */
export const MaxFontScale = {
  text: 2,
  control: 1.6,
} as const;

export const Fonts = Platform.select({
  ios: { sans: 'system-ui', mono: 'ui-monospace' },
  default: { sans: 'normal', mono: 'monospace' },
  web: { sans: 'system-ui, sans-serif', mono: 'ui-monospace, monospace' },
}) as { sans: string; mono: string };

// ---------------------------------------------------------------------------
// Espaço e forma

export const Spacing = {
  0.5: 2,
  1: 4,
  1.5: 6,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

/** Medidas de layout recorrentes, para as telas não reinventarem. */
export const Layout = {
  /** Margem lateral das telas. */
  gutter: Spacing[4],
  /** Distância entre seções de uma tela. */
  sectionGap: Spacing[6],
  /** Alvo de toque mínimo (WCAG 2.5.8 / Material / HIG). */
  minTouch: 44,
} as const;

/**
 * Raios. A primeira versão era toda reta (estética "industrial" do web), mas
 * pílulas e círculos já apareciam em todo canto e as duas linguagens brigavam.
 * Fica: 8 para cards, campos e botões; `full` só para avatar, FAB e pílula.
 */
export const Radius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 999,
} as const;

/** Altura padrão de campos e botões primários (mínima: cresce com a fonte). */
export const ControlHeight = 48;

/** Alturas mínimas de controle por tamanho. */
export const ControlSize = {
  sm: 40,
  md: 48,
  lg: 56,
} as const;

/**
 * hitSlop que leva um alvo visual menor até 44x44 sem mudar o layout. Ex.: um
 * ícone de 32 px ganha 6 px de cada lado.
 */
export function hitSlopPara(largura: number, altura: number = largura) {
  const h = Math.max(0, Math.ceil((Layout.minTouch - largura) / 2));
  const v = Math.max(0, Math.ceil((Layout.minTouch - altura) / 2));
  return { top: v, bottom: v, left: h, right: h };
}

// ---------------------------------------------------------------------------
// Elevação

/**
 * Sombras por nível. No tema escuro a sombra quase não aparece, por isso a
 * hierarquia também vem da superfície (`surface` < `surfaceRaised`).
 */
export const Elevation = {
  none: {},
  sm: {
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  md: {
    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  lg: {
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
} as const satisfies Record<string, ViewStyle>;

export type ElevationLevel = keyof typeof Elevation;

// ---------------------------------------------------------------------------
// Movimento

export const Duration = {
  fast: 120,
  normal: 200,
  slow: 320,
} as const;

// ---------------------------------------------------------------------------
// Tons de feedback

/** Tons usados por selo, banner, toast e estados vazios/erro. */
export type Tom = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

/** Resolve as cores de um tom no tema atual (texto/ícone, fundo e borda). */
export function corDoTom(colors: Paleta, tom: Tom): CorDeTom {
  switch (tom) {
    case 'primary':
      return { fg: colors.primaryText, bg: colors.primarySubtle, border: colors.primary };
    case 'success':
      return { fg: colors.success, bg: colors.successSubtle, border: colors.success };
    case 'warning':
      return { fg: colors.warning, bg: colors.warningSubtle, border: colors.warning };
    case 'danger':
      return { fg: colors.danger, bg: colors.dangerSubtle, border: colors.danger };
    case 'info':
      return { fg: colors.info, bg: colors.infoSubtle, border: colors.info };
    default:
      return { fg: colors.textSecondary, bg: colors.surfaceRaised, border: colors.border };
  }
}

/** Cor de um status canônico; status legado ou desconhecido cai no cinza. */
export function corDoStatus(colors: Paleta, status: string): CorDeTom {
  return colors.status[status as StatusChave] ?? colors.status.rejeitado;
}
