/**
 * Pontos críticos: concentração de chamados (células do mapa) e reincidência
 * (mesmo problema voltando na mesma rua). Lista, não mapa: o gestor quer
 * saber "onde" em texto para mandar a equipe; o mapa é um toque adiante.
 *
 * "Ver no mapa" abre o ponto no app de mapas do aparelho. O mapa do próprio
 * app só sabe abrir um chamado (`?abrir=<id>`), não uma coordenada solta —
 * quando aceitar `?lat=&lng=`, troque `abrirCoordenada` por uma rota interna.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/text';
import { Layout, Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import { useToast } from '@/context/toast-context';
import type { BiHotspots } from '@/types/bi';

import { fmtNumero } from './formato';

type Reincidencia = BiHotspots['reincidencia'][number];

type Props = {
  dados: BiHotspots;
  /** Reincidência -> chamados daquele bairro e categoria no período. */
  onAbrirReincidencia: (r: Reincidencia) => void;
  limite?: number;
};

export function ListaHotspots({ dados, onAbrirReincidencia, limite = 5 }: Props) {
  const colors = useColors();
  const toast = useToast();

  // Célula com um chamado só não é concentração: é ruído no topo da lista.
  const celulas = [...(dados.celulas ?? [])]
    .filter((c) => c.total >= 2)
    .sort((a, b) => b.total - a.total)
    .slice(0, limite);
  const reincidencia = [...(dados.reincidencia ?? [])]
    .sort((a, b) => b.ocorrencias - a.ocorrencias)
    .slice(0, limite);

  async function abrirCoordenada(lat: number, lng: number) {
    try {
      await Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível abrir o mapa.');
    }
  }

  return (
    <View style={styles.raiz}>
      <View style={styles.grupo}>
        <AppText variant="label">Onde mais chega chamado</AppText>
        {celulas.length === 0 ? (
          <AppText variant="bodySm" tone="muted">
            Sem concentração relevante no período.
          </AppText>
        ) : (
          celulas.map((c, i) => (
            <View key={`${c.lat},${c.lng}`} style={[styles.linha, { borderBottomColor: colors.border }]}>
              <View style={[styles.posicao, { backgroundColor: colors.bgSubtle }]}>
                <AppText variant="caption" weight="700">
                  {i + 1}
                </AppText>
              </View>
              <View style={styles.textos}>
                <AppText variant="bodySm" weight="600">
                  {fmtNumero(c.total)} chamados
                  {c.categoria_top ? ` · mais comum: ${c.categoria_top}` : ''}
                </AppText>
                <AppText variant="caption" tone="muted">
                  {c.bairro_top
                    ? `Área de cerca de 200 m em ${c.bairro_top}`
                    : `Área de cerca de 200 m em ${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`}
                </AppText>
              </View>
              <Pressable
                onPress={() => abrirCoordenada(c.lat, c.lng)}
                accessibilityRole="link"
                accessibilityLabel={`Ver no mapa a área ${i + 1}, com ${c.total} chamados`}
                style={styles.acao}>
                <Ionicons name="map-outline" size={16} color={colors.primaryText} />
                <AppText variant="caption" tone="brand" weight="600" inControl>
                  Ver no mapa
                </AppText>
              </Pressable>
            </View>
          ))
        )}
      </View>

      <View style={styles.grupo}>
        <AppText variant="label">Problemas que voltam</AppText>
        <AppText variant="caption" tone="muted">
          Mesma categoria repetida no mesmo trecho: sinal de reparo que não durou.
        </AppText>
        {reincidencia.length === 0 ? (
          <AppText variant="bodySm" tone="muted">
            Nenhuma reincidência no período.
          </AppText>
        ) : (
          reincidencia.map((r) => (
            <Pressable
              key={`${r.bairro}|${r.rua}|${r.categoria}`}
              onPress={() => onAbrirReincidencia(r)}
              accessibilityRole="button"
              accessibilityLabel={`${r.categoria} em ${r.rua || 'rua não informada'}, ${r.bairro}: ${r.ocorrencias} ocorrências`}
              accessibilityHint="Abre os chamados desta categoria neste bairro"
              style={({ pressed }) => [
                styles.linha,
                { borderBottomColor: colors.border },
                pressed && { backgroundColor: colors.surfacePressed },
              ]}>
              <Ionicons name="repeat" size={18} color={colors.warning} />
              <View style={styles.textos}>
                <AppText variant="bodySm" weight="600" numberOfLines={2}>
                  {r.rua || 'Rua não informada'}, {r.bairro || 'bairro não informado'}
                </AppText>
                <AppText variant="caption" tone="muted">
                  {r.categoria} · {fmtNumero(r.ocorrencias)} ocorrências
                </AppText>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </Pressable>
          ))
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  raiz: {
    gap: Spacing[5],
  },
  grupo: {
    gap: Spacing[1],
  },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    minHeight: Layout.minTouch + 8,
    paddingVertical: Spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  posicao: {
    width: 28,
    height: 28,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textos: {
    flex: 1,
    gap: 2,
  },
  acao: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[1],
    minHeight: Layout.minTouch,
    paddingHorizontal: Spacing[1],
  },
});
