/**
 * Paleta de cores do app, em duas camadas: primitivos (escala dourada da marca)
 * e tokens semânticos por tema.
 *
 * Fica separada de `theme.ts` porque não importa nada do React Native: assim o
 * `scripts/check-contrast.mjs` consegue ler estes valores direto no Node e
 * reprovar qualquer par abaixo do WCAG AA (4,5:1 texto, 3:1 ícone/borda).
 *
 * Regra de uso nas telas: texto dourado sobre fundo usa `primaryText`; o
 * `primary`/`gold500` é cor de preenchimento e leva `onPrimary` por cima.
 */

/** Escala da marca. Não usar direto em texto: o contraste varia por tema. */
export const Gold = {
  300: '#E6C762',
  500: '#D4AF37',
  600: '#AA7C11',
  700: '#8B6508',
} as const;

/** Status canônicos do contrato v3 (docs/arquitetura/contrato-v3.md §1). */
export type StatusChave =
  | 'pendente'
  | 'em_analise'
  | 'agendado'
  | 'em_andamento'
  | 'concluido'
  | 'rejeitado';

/** Cor de selo: `fg` serve para texto e ícone sobre `bg` e sobre o fundo da tela. */
export type CorDeTom = { fg: string; bg: string; border: string };

type CoresSemanticas = {
  // Fundos e superfícies, do mais baixo para o mais alto.
  bg: string;
  bgSubtle: string;
  surface: string;
  surfaceRaised: string;
  surfaceSunken: string;
  surfacePressed: string;
  // Texto. `textMuted` é o mínimo legível; `textDisabled` só em controle inativo.
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textDisabled: string;
  // Bordas: `border` é decorativa; `borderStrong` delimita controles (3:1).
  border: string;
  borderStrong: string;
  borderSubtle: string;
  focus: string;
  // Marca.
  primary: string;
  primaryPressed: string;
  onPrimary: string;
  primaryText: string;
  primarySubtle: string;
  // Feedback. `*Subtle` é o fundo de selo/banner; o texto por cima é a cor cheia.
  danger: string;
  onDanger: string;
  dangerSubtle: string;
  success: string;
  onSuccess: string;
  successSubtle: string;
  warning: string;
  onWarning: string;
  warningSubtle: string;
  info: string;
  onInfo: string;
  infoSubtle: string;
  // Sobreposições: `overlay` escurece o conteúdo atrás de folhas; `scrim` é
  // mais forte, para diálogos que bloqueiam a tela.
  overlay: string;
  scrim: string;
};

/**
 * Nomes da primeira versão (portados do CSS do web). Continuam valendo para
 * não quebrar as telas, mas apontam para os tokens semânticos acima.
 */
type CoresLegadas = {
  gold300: string;
  gold400: string;
  gold500: string;
  gold600: string;
  gold700: string;
  goldMuted: string;
  icon: string;
  burgundy: string;
  sangria: string;
  error: string;
  bgPrimary: string;
  bgSecondary: string;
  bgSurface: string;
  bgElevated: string;
  bgInput: string;
  bgHover: string;
  textInverse: string;
  borderDefault: string;
  borderHover: string;
  borderGold: string;
};

export type Paleta = CoresSemanticas &
  CoresLegadas & {
    status: Record<StatusChave, CorDeTom>;
  };

const dark: CoresSemanticas & { status: Record<StatusChave, CorDeTom> } = {
  bg: '#000000',
  bgSubtle: '#0A0A0A',
  surface: '#0A0A0A',
  surfaceRaised: '#141414',
  surfaceSunken: '#0D0D0D',
  surfacePressed: '#1A1A1A',
  textPrimary: '#FFFFFF',
  textSecondary: '#A0A0A0',
  // Era #555 (2,8:1 sobre o preto); #8A8A8A passa de 5:1 em todas as superfícies.
  textMuted: '#8A8A8A',
  textDisabled: '#5C5C5C',
  // Era #1A1A1A, invisível sobre #0A0A0A: os cards sumiam no fundo.
  border: '#2A2A2A',
  borderStrong: '#6E6E6E',
  borderSubtle: '#161616',
  focus: Gold[300],
  primary: Gold[500],
  primaryPressed: Gold[600],
  onPrimary: '#000000',
  primaryText: Gold[300],
  primarySubtle: '#2A2410',
  danger: '#F07167',
  onDanger: '#000000',
  dangerSubtle: '#2A1212',
  success: '#5CC08C',
  onSuccess: '#000000',
  successSubtle: '#0F2A1C',
  warning: '#E3B341',
  onWarning: '#000000',
  warningSubtle: '#2E2208',
  info: '#7FB0E8',
  onInfo: '#000000',
  infoSubtle: '#0F1E33',
  overlay: 'rgba(0, 0, 0, 0.6)',
  scrim: 'rgba(0, 0, 0, 0.75)',
  status: {
    pendente: { fg: '#8AB4F8', bg: '#0F1E36', border: '#2C4A7A' },
    em_analise: { fg: '#C4B5FD', bg: '#1F1736', border: '#4A3A80' },
    agendado: { fg: '#67D4E8', bg: '#0B2930', border: '#1E5A66' },
    em_andamento: { fg: '#F5A524', bg: '#2E1E06', border: '#6B4710' },
    concluido: { fg: '#5CC08C', bg: '#0F2A1C', border: '#2A6646' },
    rejeitado: { fg: '#A3A9B3', bg: '#1C1E22', border: '#4A4F57' },
  },
};

const light: CoresSemanticas & { status: Record<StatusChave, CorDeTom> } = {
  bg: '#F5F0E8',
  bgSubtle: '#EDE8DD',
  surface: '#FFFFFF',
  surfaceRaised: '#F0EBE0',
  surfaceSunken: '#FFFFFF',
  surfacePressed: '#E8E3D8',
  textPrimary: '#1A1A14',
  // Eram #8B7A4E (3,7:1) e #C8B890 (1,7:1): ilegíveis no bege.
  textSecondary: '#5E5236',
  textMuted: '#6B5F42',
  textDisabled: '#A59A7E',
  border: '#D8D0C0',
  borderStrong: '#8C8064',
  borderSubtle: '#E8E3D8',
  focus: '#7A5800',
  primary: Gold[500],
  primaryPressed: Gold[600],
  // Texto escuro sobre o dourado, como no tema escuro: branco dava 2,1:1.
  onPrimary: '#1A1A14',
  primaryText: '#7A5800',
  primarySubtle: '#F6ECCB',
  danger: '#B42318',
  onDanger: '#FFFFFF',
  dangerSubtle: '#FBEAE8',
  success: '#18703F',
  onSuccess: '#FFFFFF',
  successSubtle: '#E3F1E8',
  warning: '#8A5300',
  onWarning: '#FFFFFF',
  warningSubtle: '#FBEFD6',
  info: '#2B5C8F',
  onInfo: '#FFFFFF',
  infoSubtle: '#E4EDF7',
  overlay: 'rgba(0, 0, 0, 0.4)',
  scrim: 'rgba(0, 0, 0, 0.6)',
  status: {
    pendente: { fg: '#1D4ED8', bg: '#E6EDFB', border: '#9DB5EE' },
    em_analise: { fg: '#6D28D9', bg: '#EFE7FB', border: '#C2A8EE' },
    agendado: { fg: '#0B6278', bg: '#E0F2F6', border: '#8CC6D4' },
    em_andamento: { fg: '#9A4A05', bg: '#FBEBD9', border: '#E0AE7A' },
    concluido: { fg: '#166534', bg: '#E3F1E8', border: '#8CC4A0' },
    rejeitado: { fg: '#4B5563', bg: '#ECEDEF', border: '#B4B9C2' },
  },
};

/** Monta os aliases antigos a partir dos tokens semânticos de cada tema. */
function comAliases(
  t: CoresSemanticas & { status: Record<StatusChave, CorDeTom> },
  extras: { goldMuted: string; borderGold: string; bgSecondary: string },
): Paleta {
  return {
    ...t,
    gold300: Gold[300],
    gold400: Gold[300],
    gold500: Gold[500],
    gold600: Gold[600],
    gold700: Gold[700],
    goldMuted: extras.goldMuted,
    icon: t.textSecondary,
    burgundy: '#4A0E17',
    sangria: '#6B121A',
    error: t.danger,
    bgPrimary: t.bg,
    bgSecondary: extras.bgSecondary,
    bgSurface: t.surface,
    bgElevated: t.surfaceRaised,
    bgInput: t.surfaceSunken,
    bgHover: t.surfacePressed,
    // Nas telas, `textInverse` é sempre texto sobre preenchimento dourado.
    textInverse: t.onPrimary,
    borderDefault: t.border,
    borderHover: t.borderStrong,
    borderGold: extras.borderGold,
  };
}

export const Colors: Record<'dark' | 'light', Paleta> = {
  dark: comAliases(dark, {
    goldMuted: 'rgba(212, 175, 55, 0.12)',
    borderGold: 'rgba(212, 175, 55, 0.3)',
    bgSecondary: '#0A0A0A',
  }),
  light: comAliases(light, {
    goldMuted: 'rgba(212, 175, 55, 0.16)',
    borderGold: '#B8901F',
    bgSecondary: '#EDE8DD',
  }),
};

/**
 * Pares que precisam passar no WCAG AA, conferidos pelo check-contrast.
 * `min` 4.5 = texto normal; 3 = ícone, borda de controle e texto grande.
 */
export const ParesDeContraste: { fg: keyof CoresSemanticas; bg: keyof CoresSemanticas; min: number }[] = [
  ...(['bg', 'surface', 'surfaceRaised', 'bgSubtle'] as const).flatMap((bg) =>
    (
      ['textPrimary', 'textSecondary', 'textMuted', 'primaryText', 'danger', 'success', 'warning', 'info'] as const
    ).map((fg) => ({ fg, bg, min: 4.5 })),
  ),
  ...(['bg', 'surface'] as const).flatMap((bg) =>
    (['borderStrong', 'focus'] as const).map((fg) => ({ fg, bg, min: 3 })),
  ),
  { fg: 'onPrimary', bg: 'primary', min: 4.5 },
  { fg: 'onPrimary', bg: 'primaryPressed', min: 3 },
  { fg: 'onDanger', bg: 'danger', min: 4.5 },
  { fg: 'onSuccess', bg: 'success', min: 4.5 },
  { fg: 'onWarning', bg: 'warning', min: 4.5 },
  { fg: 'onInfo', bg: 'info', min: 4.5 },
  { fg: 'danger', bg: 'dangerSubtle', min: 4.5 },
  { fg: 'success', bg: 'successSubtle', min: 4.5 },
  { fg: 'warning', bg: 'warningSubtle', min: 4.5 },
  { fg: 'info', bg: 'infoSubtle', min: 4.5 },
  { fg: 'primaryText', bg: 'primarySubtle', min: 4.5 },
];
