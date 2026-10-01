/**
 * Cabeçalho de seção dentro de uma tela: título, descrição opcional e uma ação
 * à direita ("Ver todos"). O título é marcado como `header` para quem navega
 * por cabeçalhos no leitor de tela.
 */

import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Spacing } from '@/constants/theme';

import { AppText } from './text';

type Props = {
  title: string;
  subtitle?: string;
  action?: { label: string; onPress: () => void; accessibilityLabel?: string };
  style?: StyleProp<ViewStyle>;
};

export function SectionHeader({ title, subtitle, action, style }: Props) {
  return (
    <View style={[styles.linha, style]}>
      <View style={styles.textos}>
        <AppText variant="title" accessibilityRole="header">
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="bodySm" tone="muted">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {action ? (
        <Pressable
          onPress={action.onPress}
          accessibilityRole="button"
          accessibilityLabel={action.accessibilityLabel ?? action.label}
          hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
          style={styles.acao}>
          <AppText variant="label" tone="brand" inControl>
            {action.label}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  linha: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing[3],
  },
  textos: {
    flex: 1,
    gap: Spacing[0.5],
  },
  acao: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: Spacing[1],
  },
});
