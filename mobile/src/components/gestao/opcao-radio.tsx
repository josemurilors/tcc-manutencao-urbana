/**
 * Grupo de opções com explicação (ex.: escolher o papel de alguém). Cada
 * opção mostra o que ela permite — escolher papel sem saber o que ele dá foi
 * uma das críticas da tela antiga de usuários.
 */

import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/text';
import { Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';

export type OpcaoRadioItem<T extends string> = { value: T; label: string; descricao?: string };

type Props<T extends string> = {
  opcoes: OpcaoRadioItem<T>[];
  valor: T | null;
  onChange: (valor: T) => void;
  accessibilityLabel: string;
};

export function OpcaoRadio<T extends string>({ opcoes, valor, onChange, accessibilityLabel }: Props<T>) {
  const colors = useColors();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel} style={styles.grupo}>
      {opcoes.map((op, i) => {
        const ativo = op.value === valor;
        return (
          <Pressable
            key={op.value}
            onPress={() => onChange(op.value)}
            accessibilityRole="radio"
            accessibilityLabel={`${op.label}, ${i + 1} de ${opcoes.length}`}
            accessibilityHint={op.descricao}
            accessibilityState={{ checked: ativo, selected: ativo }}
            style={({ pressed }) => [
              styles.opcao,
              {
                borderColor: ativo ? colors.primary : colors.border,
                backgroundColor: ativo
                  ? colors.primarySubtle
                  : pressed
                    ? colors.surfacePressed
                    : colors.surface,
              },
            ]}>
            <Ionicons
              name={ativo ? 'radio-button-on' : 'radio-button-off'}
              size={22}
              color={ativo ? colors.primaryText : colors.textMuted}
            />
            <View style={styles.textos}>
              <AppText variant="label">{op.label}</AppText>
              {op.descricao ? (
                <AppText variant="bodySm" tone="secondary">
                  {op.descricao}
                </AppText>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grupo: {
    gap: Spacing[2],
  },
  opcao: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing[3],
    minHeight: 56,
    padding: Spacing[3],
    borderWidth: 1,
    borderRadius: Radius.md,
  },
  textos: {
    flex: 1,
    gap: Spacing[0.5],
  },
});
