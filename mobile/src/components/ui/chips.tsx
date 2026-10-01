/**
 * Filtros em pílula, equivalentes aos botões de filtro da lista do web.
 *
 * Semântica de `radiogroup`/`radio` (e não `tablist`/`tab`): os chips filtram a
 * mesma lista, não trocam de painel. Altura mínima de 40 + folga de toque.
 */

import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { FontSize, FontWeight, MaxFontScale, Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';

export type ChipOption<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  options: ChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Rótulo do grupo para leitores de tela. */
  accessibilityLabel?: string;
};

export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: Props<T>) {
  const colors = useColors();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      contentContainerStyle={styles.container}>
      {options.map((option) => {
        const ativo = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: ativo, checked: ativo }}
            hitSlop={{ top: 2, bottom: 2 }}
            style={[
              styles.chip,
              {
                backgroundColor: ativo ? colors.primary : 'transparent',
                borderColor: ativo ? colors.primary : colors.borderStrong,
              },
            ]}>
            <Text
              maxFontSizeMultiplier={MaxFontScale.control}
              style={[
                styles.label,
                { color: ativo ? colors.onPrimary : colors.textPrimary },
              ]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing[1],
    paddingHorizontal: Spacing[4],
  },
  chip: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[1],
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  label: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.medium,
  },
});
