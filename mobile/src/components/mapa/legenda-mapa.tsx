/**
 * Legenda compacta do mapa, recolhível: explica a cor do pino (situação), o
 * selo de resolvido, o anel dourado de "dá para confirmar", a bolha com número
 * e, com o calor ligado, o gradiente. Recolhida, vira um botão "Legenda".
 *
 * As cores vêm de `getStatusColor`, a mesma função que pinta os pinos — a
 * legenda nunca descola do mapa.
 */

import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/text';
import { getStatusColor, rotuloCidadao } from '@/constants/status';
import { Elevation, Layout, Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import type { SituacaoMapa } from '@/types/mapa';
import { GRADIENTE_CALOR } from '@/utils/heatmap';

type Props = {
  aberta: boolean;
  onAlternar: () => void;
  situacao: SituacaoMapa;
  calor: boolean;
  /** Sem login não há anel de confirmação — não faz sentido explicá-lo. */
  mostrarAlcance: boolean;
};

const OURO = '#D4AF37';

function Bolinha({ cor, check }: { cor: string; check?: boolean }) {
  return (
    <View style={[styles.bolinha, { backgroundColor: cor }]}>
      {check ? <Ionicons name="checkmark" size={10} color="#fff" /> : null}
    </View>
  );
}

export function LegendaMapa({ aberta, onAlternar, situacao, calor, mostrarAlcance }: Props) {
  const colors = useColors();

  if (!aberta) {
    return (
      <Pressable
        onPress={onAlternar}
        accessibilityRole="button"
        accessibilityLabel="Mostrar legenda do mapa"
        style={({ pressed }) => [
          styles.pilula,
          Elevation.md,
          {
            backgroundColor: pressed ? colors.surfacePressed : colors.surfaceRaised,
            borderColor: colors.border,
          },
        ]}>
        <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} />
        <AppText variant="caption" weight="600" inControl>
          Legenda
        </AppText>
      </Pressable>
    );
  }

  const abertos = situacao !== 'resolvidos';
  const resolvidos = situacao !== 'abertos';

  return (
    <View
      style={[
        styles.cartao,
        Elevation.md,
        { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
      ]}>
      <View style={styles.cabecalho}>
        <AppText variant="caption" weight="700" accessibilityRole="header" style={styles.flex}>
          Legenda
        </AppText>
        <Pressable
          onPress={onAlternar}
          accessibilityRole="button"
          accessibilityLabel="Recolher legenda"
          hitSlop={12}
          style={styles.recolher}>
          <Ionicons name="chevron-up" size={18} color={colors.textSecondary} />
        </Pressable>
      </View>

      {abertos ? (
        <>
          <Item texto={rotuloCidadao('pendente')}>
            <Bolinha cor={getStatusColor('pendente')} />
          </Item>
          <Item texto={rotuloCidadao('em_analise')}>
            <Bolinha cor={getStatusColor('em_analise')} />
          </Item>
          <Item texto="Programado ou em execução">
            <Bolinha cor={getStatusColor('em_andamento')} />
          </Item>
        </>
      ) : null}
      {resolvidos ? (
        <Item texto="Resolvido">
          <Bolinha cor={getStatusColor('concluido')} check />
        </Item>
      ) : null}
      {mostrarAlcance ? (
        <Item texto="Perto de você: dá para confirmar">
          <View style={[styles.anel, { borderColor: OURO }]} />
        </Item>
      ) : null}
      <Item texto="Vários chamados: toque para aproximar">
        <View style={styles.cluster}>
          <AppText variant="caption" weight="700" style={styles.clusterTexto}>
            9
          </AppText>
        </View>
      </Item>
      {calor ? (
        <View style={styles.calor} accessible accessibilityLabel="Mapa de calor: do azul, poucos chamados, ao vermelho, muitos">
          <View style={styles.gradiente}>
            {GRADIENTE_CALOR.map((cor) => (
              // No mapa a cor é translúcida sobre as ruas; aqui, sobre o
              // cartão, precisa ser quase opaca para dar para ler a escala.
              <View
                key={cor}
                style={[styles.faixa, { backgroundColor: cor.replace(/[\d.]+\)$/, '0.9)') }]}
              />
            ))}
          </View>
          <View style={styles.extremos}>
            <AppText variant="caption" tone="muted">
              poucos
            </AppText>
            <AppText variant="caption" tone="muted">
              muitos
            </AppText>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function Item({ texto, children }: { texto: string; children: React.ReactNode }) {
  return (
    <View style={styles.item} accessible accessibilityLabel={texto}>
      <View style={styles.simbolo}>{children}</View>
      <AppText variant="caption" tone="secondary" style={styles.flex}>
        {texto}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  pilula: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[1],
    minHeight: Layout.minTouch,
    paddingHorizontal: Spacing[3],
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  cartao: {
    width: 220,
    padding: Spacing[3],
    paddingTop: Spacing[1],
    gap: Spacing[1.5],
    borderWidth: 1,
    borderRadius: Radius.lg,
  },
  cabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  recolher: {
    width: Layout.minTouch - 8,
    height: Layout.minTouch - 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -Spacing[2],
  },
  flex: {
    flex: 1,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
  simbolo: {
    width: 24,
    alignItems: 'center',
  },
  bolinha: {
    width: 16,
    height: 16,
    borderRadius: Radius.full,
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  anel: {
    width: 18,
    height: 18,
    borderRadius: Radius.full,
    borderWidth: 3,
  },
  cluster: {
    width: 22,
    height: 22,
    borderRadius: Radius.full,
    backgroundColor: '#1F2937',
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clusterTexto: {
    color: '#fff',
    fontSize: 11,
    lineHeight: 13,
  },
  calor: {
    gap: Spacing[0.5],
    marginTop: Spacing[1],
  },
  gradiente: {
    flexDirection: 'row',
    height: 8,
    borderRadius: Radius.full,
    overflow: 'hidden',
  },
  faixa: {
    flex: 1,
  },
  extremos: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
