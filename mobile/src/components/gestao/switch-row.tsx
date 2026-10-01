/**
 * Linha com interruptor: rótulo, explicação e o `Switch` do sistema. A linha
 * inteira é o alvo de toque (o Switch sozinho tem ~31 px de altura) e o
 * leitor de tela lê o rótulo com o estado "ligado/desligado".
 */

import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { AppText } from '@/components/ui/text';
import { Layout, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';

type Props = {
  label: string;
  descricao?: string;
  valor: boolean;
  onChange: (valor: boolean) => void;
  disabled?: boolean;
};

export function SwitchRow({ label, descricao, valor, onChange, disabled }: Props) {
  const colors = useColors();
  return (
    <Pressable
      onPress={() => !disabled && onChange(!valor)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={descricao}
      accessibilityState={{ checked: valor, disabled: !!disabled }}
      style={[styles.linha, disabled && { opacity: 0.6 }]}>
      <View style={styles.textos}>
        <AppText variant="body">{label}</AppText>
        {descricao ? (
          <AppText variant="bodySm" tone="secondary">
            {descricao}
          </AppText>
        ) : null}
      </View>
      <AppText variant="caption" tone={valor ? 'success' : 'muted'} weight="600">
        {valor ? 'Sim' : 'Não'}
      </AppText>
      <Switch
        value={valor}
        onValueChange={onChange}
        disabled={disabled}
        // O Pressable já anuncia; o Switch não pode virar um segundo foco.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        trackColor={{ true: colors.primary, false: colors.borderStrong }}
        thumbColor={colors.surface}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    minHeight: Layout.minTouch + 12,
    paddingVertical: Spacing[2],
  },
  textos: {
    flex: 1,
    gap: Spacing[0.5],
  },
});
