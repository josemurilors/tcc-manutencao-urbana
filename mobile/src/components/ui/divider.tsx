/** Linha divisória, horizontal ou vertical, opcionalmente com rótulo ("ou"). */

import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';

import { AppText } from './text';

type Props = {
  vertical?: boolean;
  /** Recuo à esquerda, para alinhar com o texto de uma lista com ícone. */
  inset?: number;
  /** Texto no meio da linha (ex.: "ou"). */
  label?: string;
  /** Espaço acima e abaixo (ou dos lados, se vertical). */
  spacing?: number;
  style?: StyleProp<ViewStyle>;
};

export function Divider({ vertical, inset = 0, label, spacing = 0, style }: Props) {
  const colors = useColors();

  if (label) {
    return (
      <View style={[styles.comRotulo, { marginVertical: spacing }, style]} accessibilityRole="text">
        <View style={[styles.linha, { backgroundColor: colors.border }]} />
        <AppText variant="caption" tone="muted">
          {label}
        </AppText>
        <View style={[styles.linha, { backgroundColor: colors.border }]} />
      </View>
    );
  }

  return (
    <View
      // Puramente visual: o leitor de tela não precisa passar por ela.
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[
        vertical
          ? { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', marginHorizontal: spacing }
          : { height: StyleSheet.hairlineWidth, marginLeft: inset, marginVertical: spacing },
        { backgroundColor: colors.border },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  comRotulo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
  },
  linha: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
});
