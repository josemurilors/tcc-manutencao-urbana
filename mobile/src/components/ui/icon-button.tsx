/**
 * Botão só de ícone (fechar, voltar, centralizar no mapa...).
 *
 * `accessibilityLabel` é obrigatório na tipagem: sem texto visível, é a única
 * coisa que o leitor de tela tem para anunciar. O alvo de toque nunca fica
 * abaixo de 44x44 — tamanhos visuais menores ganham `hitSlop` até lá.
 */

import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { Elevation, hitSlopPara, Radius } from '@/constants/theme';
import { useColors } from '@/context/theme-context';

export type IconButtonVariant = 'ghost' | 'surface' | 'primary' | 'danger';

type Props = {
  icon: keyof typeof Ionicons.glyphMap;
  accessibilityLabel: string;
  accessibilityHint?: string;
  onPress?: () => void;
  variant?: IconButtonVariant;
  /** Lado visual: `sm` 36, `md` 44 (padrão), `lg` 56 (FAB). */
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  /** Botão de alternância (ex.: seguir GPS): vira `selected` para o leitor. */
  selected?: boolean;
  /** Sombra, para flutuar sobre o mapa. */
  floating?: boolean;
  style?: StyleProp<ViewStyle>;
};

const LADO = { sm: 36, md: 44, lg: 56 } as const;
const ICONE = { sm: 18, md: 22, lg: 26 } as const;

export function IconButton({
  icon,
  accessibilityLabel,
  accessibilityHint,
  onPress,
  variant = 'ghost',
  size = 'md',
  disabled,
  loading,
  selected,
  floating,
  style,
}: Props) {
  const colors = useColors();
  const lado = LADO[size];
  const inativo = disabled || loading;

  const ativo = selected || variant === 'primary';
  const paleta = {
    ghost: { bg: 'transparent', fg: colors.textSecondary, border: 'transparent' },
    surface: { bg: colors.surfaceRaised, fg: colors.textPrimary, border: colors.border },
    primary: { bg: colors.primary, fg: colors.onPrimary, border: colors.primary },
    danger: { bg: colors.dangerSubtle, fg: colors.danger, border: colors.danger },
  }[variant];
  const bg = selected && variant !== 'primary' ? colors.primary : paleta.bg;
  const fg = ativo ? colors.onPrimary : paleta.fg;

  return (
    <Pressable
      onPress={onPress}
      disabled={inativo}
      hitSlop={hitSlopPara(lado)}
      accessibilityRole={selected === undefined ? 'button' : 'togglebutton'}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inativo, busy: !!loading, selected }}
      style={({ pressed }) => [
        styles.base,
        {
          width: lado,
          height: lado,
          backgroundColor: bg,
          borderColor: selected ? colors.primary : paleta.border,
          opacity: inativo ? 0.5 : 1,
        },
        pressed && !inativo && { backgroundColor: variant === 'ghost' ? colors.surfacePressed : bg, opacity: 0.85 },
        floating && Elevation.md,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <Ionicons name={icon} size={ICONE[size]} color={fg} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Radius.full,
  },
});
