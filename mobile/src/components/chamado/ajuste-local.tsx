/**
 * Ajuste fino do ponto do chamado antes de enviar.
 *
 * O GPS urbano erra 5–15 m — o suficiente para pôr o buraco na calçada do
 * outro lado ou na rua de trás. Aqui a pessoa arrasta o mapinha até o alvo
 * fixo do centro ficar sobre o problema (padrão Uber/99), ou usa as setas,
 * que também servem a quem não consegue arrastar (leitor de tela, tremor).
 * O ponto fica preso a `limiteM` de onde a pessoa está: reportar exige estar
 * no local, e o backend recusa deslocamentos impossíveis.
 */

import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { MapSurface } from '@/components/map-surface';
import type { MapSurfaceHandle, Regiao } from '@/components/map-surface.types';
import { IconButton } from '@/components/ui/icon-button';
import { AppText } from '@/components/ui/text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/context/theme-context';
import { DELTA_NAVEGACAO, formatarDistancia, haversineDistance, type LatLng } from '@/utils/geo';

/** Quanto cada toque nas setas move o ponto. */
const PASSO_M = 4;
const METROS_POR_GRAU = 111320;

type Props = {
  origem: LatLng;
  ponto: LatLng;
  onChange: (ponto: LatLng) => void;
  limiteM: number;
  /** O dedo está no mapa: a tela trava a rolagem para o arrasto não virar scroll. */
  onInteragindo?: (ativo: boolean) => void;
};

export function distanciaDaOrigem(origem: LatLng, ponto: LatLng) {
  return haversineDistance(origem.latitude, origem.longitude, ponto.latitude, ponto.longitude);
}

export function AjusteLocal({ origem, ponto, onChange, limiteM, onInteragindo }: Props) {
  const { theme, colors } = useTheme();
  const mapa = useRef<MapSurfaceHandle>(null);
  const deltas = useRef({ latitudeDelta: DELTA_NAVEGACAO, longitudeDelta: DELTA_NAVEGACAO });
  // A região inicial é fixa: o MapView não deve ser recentrado a cada render.
  const [regiaoInicial] = useState<Regiao>(() => ({
    ...origem,
    latitudeDelta: DELTA_NAVEGACAO,
    longitudeDelta: DELTA_NAVEGACAO,
  }));

  const afastamento = distanciaDaOrigem(origem, ponto);
  const foraDoLimite = afastamento > limiteM;

  function irPara(alvo: LatLng) {
    onChange(alvo);
    mapa.current?.animarPara({ ...alvo, ...deltas.current }, 250);
  }

  function mover(norteM: number, lesteM: number) {
    const cosLat = Math.max(Math.cos((ponto.latitude * Math.PI) / 180), 0.2);
    irPara({
      latitude: ponto.latitude + norteM / METROS_POR_GRAU,
      longitude: ponto.longitude + lesteM / (METROS_POR_GRAU * cosLat),
    });
  }

  function aoMudarRegiao(r: Regiao) {
    deltas.current = { latitudeDelta: r.latitudeDelta, longitudeDelta: r.longitudeDelta };
    // Ignora o "mudou" de micrograus que o mapa nativo emite ao assentar.
    if (Math.abs(r.latitude - ponto.latitude) < 1e-7 && Math.abs(r.longitude - ponto.longitude) < 1e-7) return;
    onChange({ latitude: r.latitude, longitude: r.longitude });
  }

  return (
    <View style={styles.container}>
      <View
        style={[styles.mapa, { borderColor: foraDoLimite ? colors.danger : colors.borderStrong }]}
        onTouchStart={() => onInteragindo?.(true)}
        onTouchEnd={() => onInteragindo?.(false)}
        onTouchCancel={() => onInteragindo?.(false)}
        // O mapa em si é inacessível ao leitor de tela; as setas abaixo fazem o mesmo.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        <MapSurface
          ref={mapa}
          regiaoInicial={regiaoInicial}
          circulos={[
            {
              key: 'limite',
              centro: origem,
              raio: limiteM,
              corPreenchimento: 'rgba(212, 175, 55, 0.08)',
              corBorda: 'rgba(212, 175, 55, 0.7)',
              larguraBorda: 1,
            },
          ]}
          marcadores={[]}
          usuario={null}
          direcao={null}
          onLongPressMapa={irPara}
          onPressMarcador={() => {}}
          onArrastar={() => {}}
          onRegiaoMudou={aoMudarRegiao}
          escuro={theme === 'dark'}
        />
        {/* Alvo fixo no centro: quem se move é o mapa. A ponta do pino marca o ponto. */}
        <View pointerEvents="none" style={styles.alvo}>
          <Ionicons name="location" size={40} color={foraDoLimite ? colors.danger : colors.primary} style={styles.pino} />
          <View style={[styles.ponto, { backgroundColor: colors.textPrimary }]} />
        </View>
      </View>

      <View style={styles.controles}>
        <View style={styles.setas} accessibilityLabel="Ajustar o ponto do problema">
          <IconButton icon="arrow-up" size="sm" variant="surface" accessibilityLabel={`Mover o ponto ${PASSO_M} metros para o norte`} onPress={() => mover(PASSO_M, 0)} />
          <IconButton icon="arrow-down" size="sm" variant="surface" accessibilityLabel={`Mover o ponto ${PASSO_M} metros para o sul`} onPress={() => mover(-PASSO_M, 0)} />
          <IconButton icon="arrow-back" size="sm" variant="surface" accessibilityLabel={`Mover o ponto ${PASSO_M} metros para o oeste`} onPress={() => mover(0, -PASSO_M)} />
          <IconButton icon="arrow-forward" size="sm" variant="surface" accessibilityLabel={`Mover o ponto ${PASSO_M} metros para o leste`} onPress={() => mover(0, PASSO_M)} />
        </View>
        <IconButton
          icon="locate"
          size="sm"
          variant="surface"
          accessibilityLabel="Voltar o ponto para onde estou"
          onPress={() => irPara(origem)}
          disabled={afastamento < 1}
        />
      </View>

      <View style={styles.linha} accessibilityLiveRegion="polite">
        <Ionicons
          name={foraDoLimite ? 'alert-circle' : 'information-circle-outline'}
          size={16}
          color={foraDoLimite ? colors.danger : colors.textSecondary}
        />
        <AppText variant="caption" tone={foraDoLimite ? 'danger' : 'secondary'} style={styles.flex}>
          {foraDoLimite
            ? `O ponto está a ${formatarDistancia(afastamento)} de você. Aproxime até ${limiteM} m para enviar.`
            : afastamento >= 1
              ? `Ponto ajustado a ${formatarDistancia(afastamento)} de onde você está.`
              : 'Arraste o mapa até o alvo ficar sobre o problema.'}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing[2],
  },
  mapa: {
    height: 200,
    borderWidth: 1,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  alvo: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    // Acima dos panes do Leaflet (z-index 400–700) no web.
    zIndex: 1000,
  },
  pino: {
    // Sobe o ícone para a ponta (e não o meio) cair no centro do mapa.
    transform: [{ translateY: -18 }],
  },
  ponto: {
    position: 'absolute',
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  controles: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  setas: {
    flexDirection: 'row',
    gap: Spacing[2],
  },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[1.5],
  },
  flex: {
    flex: 1,
  },
});
