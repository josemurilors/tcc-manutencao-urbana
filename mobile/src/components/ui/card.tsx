/**
 * Cartão: base visual de listas e blocos de conteúdo.
 *
 * `outlined` é o padrão (borda, sem sombra — funciona nos dois temas);
 * `raised` sobe um nível de superfície e ganha sombra; `filled` é para blocos
 * dentro de outro card. Com `onPress` vira um botão inteiro, com estado de
 * pressionado e rótulo para o leitor de tela.
 */

import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Elevation, Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';

export type CardVariant = 'outlined' | 'raised' | 'filled';

type Props = {
  children: React.ReactNode;
  variant?: CardVariant;
  /** Espaçamento interno; `0` para conteúdo que encosta na borda (imagem). */
  padding?: number;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Obrigatório na prática quando há `onPress`: resume o card numa frase. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Card({
  children,
  variant = 'outlined',
  padding = Spacing[4],
  onPress,
  onLongPress,
  accessibilityLabel,
  accessibilityHint,
  selected,
  style,
}: Props) {
  const colors = useColors();

  const base: ViewStyle = {
    padding,
    backgroundColor:
      variant === 'raised' ? colors.surfaceRaised : variant === 'filled' ? colors.bgSubtle : colors.surface,
    borderColor: selected ? colors.primary : variant === 'filled' ? 'transparent' : colors.border,
    borderWidth: selected ? 2 : 1,
    ...(variant === 'raised' ? Elevation.sm : null),
  };

  if (!onPress && !onLongPress) {
    return <View style={[styles.card, base, style]}>{children}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={selected === undefined ? undefined : { selected }}
      style={({ pressed }) => [
        styles.card,
        base,
        pressed && { backgroundColor: colors.surfacePressed },
        style,
      ]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.md,
    gap: Spacing[2],
  },
});
