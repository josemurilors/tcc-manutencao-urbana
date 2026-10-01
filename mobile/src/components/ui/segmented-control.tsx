/**
 * Controle segmentado: escolha única entre 2 a 4 opções curtas (ex.: tema
 * Automático/Claro/Escuro, período Semana/Mês). Para mais opções ou rótulos
 * longos, use `FilterChips` (rola) ou `Select`.
 *
 * Semântica de `radiogroup`/`radio`: escolher um segmento desmarca os outros, e
 * o leitor de tela anuncia "selecionado, 2 de 3".
 */

import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Layout, Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';

import { AppText } from './text';

export type SegmentOption<T extends string> = {
  value: T;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
};

type Props<T extends string> = {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Nome do grupo para o leitor de tela (ex.: "Tema"). */
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  style,
}: Props<T>) {
  const colors = useColors();

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      style={[styles.trilho, { backgroundColor: colors.bgSubtle, borderColor: colors.border }, style]}>
      {options.map((option, i) => {
        const ativo = option.value === value;
        const fg = ativo ? colors.onPrimary : colors.textSecondary;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityLabel={`${option.label}, ${i + 1} de ${options.length}`}
            accessibilityState={{ selected: ativo, checked: ativo }}
            style={({ pressed }) => [
              styles.segmento,
              ativo
                ? { backgroundColor: colors.primary }
                : pressed && { backgroundColor: colors.surfacePressed },
            ]}>
            {option.icon ? <Ionicons name={option.icon} size={16} color={fg} /> : null}
            <AppText variant="label" inControl numberOfLines={1} style={{ color: fg }}>
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  trilho: {
    flexDirection: 'row',
    padding: Spacing[0.5],
    gap: Spacing[0.5],
    borderWidth: 1,
    borderRadius: Radius.md,
  },
  segmento: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[1.5],
    // O trilho soma 2+1 de cada lado: o segmento de 38 fecha os 44 do alvo.
    minHeight: Layout.minTouch - 6,
    paddingHorizontal: Spacing[2],
    borderRadius: Radius.md - 2,
  },
});
