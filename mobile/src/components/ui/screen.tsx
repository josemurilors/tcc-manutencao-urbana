/** Blocos de layout reaproveitados pelas telas internas. */

import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { FontSize, FontWeight, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';

import { Card } from './card';
import { StateView } from './state-view';

/** Container de tela com o fundo do tema. */
export function Screen({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const colors = useColors();
  return <View style={[styles.screen, { backgroundColor: colors.bgPrimary }, style]}>{children}</View>;
}

/** Título + subtítulo no topo das telas, como no web. */
export function PageHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  const colors = useColors();
  return (
    <View style={styles.heading}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>{subtitle}</Text>
      ) : null}
    </View>
  );
}

export function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  const colors = useColors();
  return (
    <View style={styles.sectionHeading}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.textPrimary }]}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>{subtitle}</Text>
      ) : null}
    </View>
  );
}

/** Atalho antigo para `<StateView kind="loading" skeleton={0} />`. */
export function LoadingState({ label = 'Carregando...' }: { label?: string }) {
  return <StateView kind="loading" skeleton={0} title={label} />;
}

/**
 * Atalho antigo para `<StateView kind="empty" />`. Prefira passar `icon`,
 * `description` e `action`: vazio bom diz o que fazer em seguida.
 */
export function EmptyState({
  label,
  description,
  icon,
  action,
}: {
  label: string;
  description?: string;
  icon?: React.ComponentProps<typeof StateView>['icon'];
  action?: { label: string; onPress: () => void };
}) {
  return <StateView kind="empty" title={label} description={description} icon={icon} action={action} />;
}

/** O cartão mora em `card.tsx`; reexportado aqui pelos imports antigos. */
export { Card };

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  heading: {
    gap: Spacing[1],
    paddingHorizontal: Spacing[4],
    paddingTop: Spacing[4],
    paddingBottom: Spacing[3],
  },
  title: {
    fontSize: FontSize.lg,
    lineHeight: 24,
    fontWeight: FontWeight.bold,
  },
  sectionHeading: {
    gap: 2,
  },
  sectionTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
  },
  subtitle: {
    fontSize: FontSize.xs,
  },
});
