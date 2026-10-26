/** Selo de status. */

import { StyleSheet, Text, View } from 'react-native';

import { getStatusColor, getStatusLabel } from '@/constants/status';
import { FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';

type Props = {
  status: string;
  concluidoEm?: string | null;
  /** Só o ponto colorido, sem o rótulo. */
  compact?: boolean;
};

export function StatusBadge({ status, concluidoEm, compact }: Props) {
  const color = getStatusColor(status, concluidoEm);
  const label = getStatusLabel(status, concluidoEm);

  if (compact) {
    return <View style={[styles.dot, { backgroundColor: color }]} accessibilityLabel={label} />;
  }

  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.label, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[1] + 2,
    paddingHorizontal: Spacing[2] + 2,
    paddingVertical: 3,
    borderWidth: 1,
    borderRadius: Radius.full,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: Radius.full,
  },
  label: {
    fontSize: FontSize.xs - 1,
    fontWeight: FontWeight.semibold,
  },
});
