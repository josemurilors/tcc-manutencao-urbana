/**
 * Placeholders de carregamento. Na primeira carga de uma lista mostram o
 * formato do conteúdo, em vez de um spinner que troca a tela inteira e pisca.
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, View, type DimensionValue, type ViewStyle } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';

type Props = {
  width?: DimensionValue;
  height?: number;
  /** Círculo (avatar). Usa `height` como diâmetro. */
  circle?: boolean;
  radius?: number;
  style?: ViewStyle;
};

/** Pulso compartilhado: respeita "reduzir movimento" (fica parado em 0,6). */
function usePulso() {
  const [valor] = useState(() => new Animated.Value(0.6));

  useEffect(() => {
    let laco: Animated.CompositeAnimation | null = null;
    let cancelado = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduzir) => {
        if (reduzir || cancelado) return;
        laco = Animated.loop(
          Animated.sequence([
            Animated.timing(valor, { toValue: 1, duration: 700, useNativeDriver: true }),
            Animated.timing(valor, { toValue: 0.5, duration: 700, useNativeDriver: true }),
          ]),
        );
        laco.start();
      });
    return () => {
      cancelado = true;
      laco?.stop();
    };
  }, [valor]);

  return valor;
}

export function Skeleton({ width = '100%', height = 14, circle, radius, style }: Props) {
  const colors = useColors();
  const opacidade = usePulso();
  return (
    <Animated.View
      // Decorativo: quem anuncia o carregamento é o contêiner (StateView/SkeletonList).
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width: circle ? height : width,
          height,
          borderRadius: circle ? Radius.full : (radius ?? Radius.sm),
          backgroundColor: colors.surfacePressed,
          opacity: opacidade,
        },
        style,
      ]}
    />
  );
}

/** Esqueleto de um card de lista: miniatura + duas linhas + selo. */
export function SkeletonCard() {
  const colors = useColors();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Skeleton height={56} width={56} radius={Radius.md} />
      <View style={styles.linhas}>
        <Skeleton width="70%" height={16} />
        <Skeleton width="45%" height={12} />
        <Skeleton width={84} height={20} radius={Radius.full} />
      </View>
    </View>
  );
}

/** N cards esqueleto, anunciados como "Carregando" para o leitor de tela. */
export function SkeletonList({ count = 3, label = 'Carregando' }: { count?: number; label?: string }) {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
      style={styles.lista}>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: Spacing[3],
    padding: Spacing[3],
    borderWidth: 1,
    borderRadius: Radius.md,
  },
  linhas: {
    flex: 1,
    gap: Spacing[2],
    justifyContent: 'center',
  },
  lista: {
    gap: Spacing[3],
  },
});
