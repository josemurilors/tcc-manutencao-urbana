/**
 * Linha do tempo do chamado.
 *
 * Cada marcador leva o ícone do evento (e não só uma cor), então "Resolvido" e
 * "Não procede" se distinguem para quem não enxerga cores. Itens com
 * `emphasis` (resposta da prefeitura) ganham fundo de destaque: é o que o
 * cidadão mais procura no histórico.
 */

import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { corDoTom, Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import type { TimelineItem } from '@/utils/timeline';

import { AppText } from './text';

const MARCADOR = 28;

export function Timeline({ items }: { items: TimelineItem[] }) {
  const colors = useColors();
  if (items.length === 0) return null;

  return (
    <View style={styles.container} accessibilityRole="list">
      {items.map((item, i) => {
        const tom = corDoTom(colors, item.tone ?? 'neutral');
        const ultimo = i === items.length - 1;
        const rotulo = [item.title, item.description, item.date, item.meta].filter(Boolean).join('. ');
        return (
          <View key={item.id} style={styles.linha} accessible accessibilityLabel={rotulo}>
            <View style={styles.coluna}>
              <View
                style={[styles.marcador, { backgroundColor: tom.bg, borderColor: tom.border }]}>
                <Ionicons name={item.icon ?? 'ellipse'} size={14} color={tom.fg} />
              </View>
              {!ultimo ? <View style={[styles.trilho, { backgroundColor: colors.border }]} /> : null}
            </View>
            <View
              style={[
                styles.cartao,
                !ultimo && styles.espaco,
                item.emphasis
                  ? { backgroundColor: colors.primarySubtle, borderColor: colors.primary }
                  : { backgroundColor: colors.surface, borderColor: colors.border },
              ]}>
              <AppText variant="label">{item.title}</AppText>
              {item.description ? (
                <AppText variant="bodySm" tone={item.emphasis ? 'primary' : 'secondary'}>
                  {item.description}
                </AppText>
              ) : null}
              {item.date || item.meta ? (
                <View style={styles.rodape}>
                  {item.date ? (
                    <AppText variant="caption" tone="muted">
                      {item.date}
                    </AppText>
                  ) : null}
                  {item.meta ? (
                    <AppText variant="caption" tone="muted">
                      {item.meta}
                    </AppText>
                  ) : null}
                </View>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 0,
  },
  linha: {
    flexDirection: 'row',
    gap: Spacing[3],
  },
  coluna: {
    width: MARCADOR,
    alignItems: 'center',
  },
  marcador: {
    width: MARCADOR,
    height: MARCADOR,
    borderRadius: Radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing[2],
  },
  trilho: {
    flex: 1,
    width: 2,
    marginTop: Spacing[1],
  },
  cartao: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing[3],
    gap: Spacing[1],
  },
  espaco: {
    marginBottom: Spacing[3],
  },
  rodape: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: Spacing[2],
  },
});
