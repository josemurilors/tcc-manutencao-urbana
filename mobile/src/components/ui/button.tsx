/**
 * Botão — porte de `frontend/src/components/ui/button.jsx`.
 *
 * Alturas são mínimas (crescem com a fonte do sistema) e os tamanhos menores
 * que 44 px ganham `hitSlop` até o alvo de toque mínimo.
 */

import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { FontSize, Layout, Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';

import { AppText } from './text';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'xs' | 'sm' | 'md';

type Props = {
  children: React.ReactNode;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  /** Ocupa toda a largura disponível. */
  block?: boolean;
  icon?: React.ReactNode;
  style?: ViewStyle;
  accessibilityLabel?: string;
  accessibilityHint?: string;
};

const HEIGHTS: Record<ButtonSize, number> = { xs: 36, sm: 40, md: 48 };
const PADDINGS: Record<ButtonSize, number> = { xs: Spacing[3], sm: Spacing[3], md: Spacing[6] };
const FONT_SIZES: Record<ButtonSize, number> = {
  xs: FontSize.xs,
  sm: FontSize.sm,
  md: FontSize.sm,
};

export function Button({
  children,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled,
  loading,
  block,
  icon,
  style,
  accessibilityLabel,
  accessibilityHint,
}: Props) {
  const colors = useColors();
  const inativo = disabled || loading;

  const paleta: Record<ButtonVariant, { bg: string; fg: string; border: string; pressed: string }> = {
    primary: {
      bg: colors.primary,
      fg: colors.onPrimary,
      border: colors.primary,
      pressed: colors.primaryPressed,
    },
    secondary: {
      bg: 'transparent',
      fg: colors.textPrimary,
      border: colors.borderStrong,
      pressed: colors.surfacePressed,
    },
    danger: {
      bg: colors.dangerSubtle,
      fg: colors.danger,
      border: colors.danger,
      pressed: colors.dangerSubtle,
    },
    ghost: {
      bg: 'transparent',
      fg: colors.textSecondary,
      border: 'transparent',
      pressed: colors.surfacePressed,
    },
  };
  const { bg, fg, border, pressed: corPressionado } = paleta[variant];
  // Só folga vertical: botões lado a lado não podem disputar o mesmo toque.
  const folga = Math.ceil(Math.max(0, Layout.minTouch - HEIGHTS[size]) / 2);

  return (
    <Pressable
      onPress={onPress}
      disabled={inativo}
      hitSlop={{ top: folga, bottom: folga }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inativo, busy: !!loading }}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: HEIGHTS[size],
          paddingHorizontal: PADDINGS[size],
          backgroundColor: pressed && !inativo ? corPressionado : bg,
          borderColor: border,
          opacity: inativo ? 0.5 : 1,
          alignSelf: block ? 'stretch' : 'flex-start',
        },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <View style={styles.conteudo}>
          {icon}
          <AppText
            variant="label"
            inControl
            style={{ color: fg, fontSize: FONT_SIZES[size], lineHeight: FONT_SIZES[size] + 6 }}>
            {children}
          </AppText>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing[1],
  },
  conteudo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
});
