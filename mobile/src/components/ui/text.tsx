/**
 * Texto do design system: aplica a escala tipográfica, a cor do tema e a
 * política de fonte grande (`MaxFontScale`) num lugar só. As telas migram para
 * ele aos poucos; os primitivos de `components/ui` já usam.
 */

import { Text, useWindowDimensions, type TextProps, type TextStyle } from 'react-native';

import { MaxFontScale, Typography, type Paleta, type TypographyVariant } from '@/constants/theme';
import { useColors } from '@/context/theme-context';

export type TextTone =
  | 'primary'
  | 'secondary'
  | 'muted'
  | 'disabled'
  | 'brand'
  | 'onPrimary'
  | 'danger'
  | 'success'
  | 'warning'
  | 'info';

const COR_DO_TOM: Record<TextTone, Exclude<keyof Paleta, 'status'>> = {
  primary: 'textPrimary',
  secondary: 'textSecondary',
  muted: 'textMuted',
  disabled: 'textDisabled',
  brand: 'primaryText',
  onPrimary: 'onPrimary',
  danger: 'danger',
  success: 'success',
  warning: 'warning',
  info: 'info',
};

type Props = TextProps & {
  variant?: TypographyVariant;
  tone?: TextTone;
  /** Sobrescreve o peso da variante. */
  weight?: TextStyle['fontWeight'];
  align?: TextStyle['textAlign'];
  /** Texto dentro de controle (botão, selo): cresce menos com a fonte do sistema. */
  inControl?: boolean;
};

export function AppText({
  variant = 'body',
  tone = 'primary',
  weight,
  align,
  inControl,
  style,
  ...rest
}: Props) {
  const colors = useColors();
  return (
    <Text
      maxFontSizeMultiplier={inControl ? MaxFontScale.control : MaxFontScale.text}
      {...rest}
      style={[
        Typography[variant],
        { color: colors[COR_DO_TOM[tone]] },
        weight ? { fontWeight: weight } : null,
        align ? { textAlign: align } : null,
        style,
      ]}
    />
  );
}

/**
 * Fator de fonte do sistema, já limitado pelo teto do design system. Útil para
 * dimensionar o que não é texto (ícones, alturas) junto com a fonte.
 */
export function useFontScale(teto: number = MaxFontScale.text) {
  const { fontScale } = useWindowDimensions();
  return Math.min(fontScale || 1, teto);
}
