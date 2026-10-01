/**
 * Superfície do mapa — implementação nativa (react-native-maps).
 *
 * A tela do mapa (`app/(tabs)/mapa.tsx`) fala só com esta interface. No web o
 * Metro resolve `map-surface.web.tsx`, que desenha o mesmo conteúdo com
 * Leaflet — `react-native-maps` chama `codegenNativeComponent`, que não existe
 * no react-native-web e quebraria o bundle.
 */

import { Ionicons } from '@expo/vector-icons';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, Marker, Polyline } from 'react-native-maps';

import { MAPA_ESTILO_ESCURO } from '@/constants/map-style';
import { Radius } from '@/constants/theme';
import { ANEIS_CALOR, corNaRampa, intensidadeDoCirculo } from '@/utils/heatmap';
import { ladoDoCluster, textoDoCluster } from '@/utils/rarear';

import type {
  ClusterMapa,
  MapSurfaceHandle,
  MapSurfaceProps,
  MarcadorMapa,
} from './map-surface.types';

/** Zoom de rua ao seguir o usuário (18 ≈ quarteirão inteiro na tela). */
const ZOOM_NAVEGACAO = 18;
const OURO = '#D4AF37';
/**
 * Quanto tempo o Marker fica rasterizando a view depois de nascer ou mudar.
 * Com `tracksViewChanges` sempre ligado o mapa redesenha todo pino a cada
 * quadro (pesa com centenas); sempre desligado, o Android congela o bitmap do
 * primeiro render — o emoji sai cortado e o pino não cresce ao ser
 * selecionado nem ganha o anel dourado ao entrar no alcance.
 */
const RASTERIZAR_MS = 600;

/** Liga `tracksViewChanges` por um instante sempre que `assinatura` muda. */
function useRasterizacaoTransitoria(assinatura: string) {
  const [rastreando, setRastreando] = useState(true);
  // Estado derivado da prop, ajustado no render (padrão do React para
  // "resetar quando a prop muda"), em vez de um setState dentro de efeito.
  const [vista, setVista] = useState(assinatura);
  if (vista !== assinatura) {
    setVista(assinatura);
    setRastreando(true);
  }
  useEffect(() => {
    if (!rastreando) return;
    const id = setTimeout(() => setRastreando(false), RASTERIZAR_MS);
    return () => clearTimeout(id);
  }, [rastreando, vista]);
  return rastreando;
}

/** Tudo que muda o desenho do pino; entra na key e no gatilho de rasterização. */
function assinaturaDoPino(m: MarcadorMapa) {
  return [
    m.cor,
    m.icone ?? '',
    m.selecionado ? 1 : 0,
    m.emAlcance ? 1 : 0,
    m.rotulo ?? '',
    m.resolvido ? 1 : 0,
  ].join('|');
}

export const MapSurface = forwardRef<MapSurfaceHandle, MapSurfaceProps>(function MapSurface(
  {
    regiaoInicial,
    circulos,
    marcadores,
    linhas = [],
    clusters = [],
    destino = null,
    usuario,
    onLongPressMapa,
    onPressMarcador,
    onPressCluster,
    onArrastar,
    onRegiaoMudou,
    onPronto,
    direcao,
    escuro,
  },
  ref,
) {
  const mapRef = useRef<MapView>(null);

  useImperativeHandle(ref, () => ({
    animarPara(regiao, duracaoMs = 600) {
      mapRef.current?.animateToRegion(regiao, duracaoMs);
    },
    seguir(posicao) {
      mapRef.current?.animateCamera(
        {
          center: { latitude: posicao.latitude, longitude: posicao.longitude },
          zoom: ZOOM_NAVEGACAO,
          heading: 0,
          pitch: 0,
        },
        { duration: 700 },
      );
    },
  }));

  return (
    <MapView
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      initialRegion={regiaoInicial}
      onLongPress={(e) => onLongPressMapa(e.nativeEvent.coordinate)}
      onPanDrag={onArrastar}
      onRegionChangeComplete={(regiao) => onRegiaoMudou?.(regiao)}
      onMapReady={onPronto}
      showsUserLocation={false}
      showsMyLocationButton={false}
      showsCompass={false}
      toolbarEnabled={false}
      userInterfaceStyle={escuro ? 'dark' : 'light'}
      customMapStyle={escuro ? MAPA_ESTILO_ESCURO : []}>
      {circulos.map((circulo) => {
        const calor = intensidadeDoCirculo(circulo);
        if (calor == null) {
          return (
            <Circle
              key={circulo.key}
              center={circulo.centro}
              radius={circulo.raio}
              strokeColor={circulo.corBorda ?? 'transparent'}
              strokeWidth={circulo.larguraBorda ?? 0}
              fillColor={circulo.corPreenchimento}
            />
          );
        }
        // Calor: anéis concêntricos translúcidos (degradê radial), ver utils/heatmap.
        return ANEIS_CALOR.map((anel, i) => (
          <Circle
            key={`${circulo.key}-${i}`}
            center={circulo.centro}
            radius={circulo.raio * anel.raio}
            strokeColor="transparent"
            strokeWidth={0}
            fillColor={corNaRampa(calor * anel.rampa, anel.alpha)}
          />
        ));
      })}

      {linhas.map((linha) => (
        <Polyline
          key={linha.key}
          coordinates={linha.coordenadas}
          strokeColor={linha.cor}
          strokeWidth={linha.largura ?? 4}
          lineDashPattern={linha.tracejada ? [10, 8] : undefined}
          lineCap="round"
          lineJoin="round"
        />
      ))}

      {clusters.map((cluster) => (
        // A key leva o total: a bolha com outro número é outro bitmap.
        <MarcadorCluster
          key={`${cluster.key}:${cluster.total}`}
          cluster={cluster}
          onPress={() => onPressCluster?.(cluster.key)}
        />
      ))}

      {marcadores.map((marcador) => (
        // A key leva o estado visual: mudar seleção/alcance/status remonta o
        // Marker, e o remonte já nasce rasterizando (ver RASTERIZAR_MS).
        <MarcadorPino
          key={`${marcador.key}:${assinaturaDoPino(marcador)}`}
          marcador={marcador}
          onPress={() => onPressMarcador(marcador.key)}
        />
      ))}

      {destino ? <MarcadorDestino coordenada={destino} /> : null}

      {usuario ? (
        <>
          {usuario.precisao && usuario.precisao > 15 ? (
            <Circle
              center={{ latitude: usuario.latitude, longitude: usuario.longitude }}
              radius={usuario.precisao}
              strokeColor="rgba(59,130,246,0.35)"
              strokeWidth={1}
              fillColor="rgba(59,130,246,0.12)"
            />
          ) : null}
          {/* Ponto azul com o cone da bússola, como no Google Maps. O cone só
              aparece quando há direção; a rotação gira o marcador inteiro. */}
          <Marker
            coordinate={{ latitude: usuario.latitude, longitude: usuario.longitude }}
            anchor={{ x: 0.5, y: 0.5 }}
            flat
            rotation={direcao ?? 0}
            zIndex={3}
            tracksViewChanges={false}>
            <View style={styles.usuarioCaixa}>
              {direcao != null ? <View style={styles.usuarioCone} /> : null}
              <View style={styles.usuarioPonto} />
            </View>
          </Marker>
        </>
      ) : null}
    </MapView>
  );
});

function MarcadorPino({ marcador, onPress }: { marcador: MarcadorMapa; onPress: () => void }) {
  const rastreando = useRasterizacaoTransitoria(assinaturaDoPino(marcador));
  return (
    <Marker
      coordinate={marcador.coordenada}
      onPress={onPress}
      anchor={{ x: 0.5, y: 1 }}
      tracksViewChanges={rastreando}
      zIndex={marcador.selecionado ? 2 : marcador.emAlcance ? 1 : 0}>
      <Pino
        cor={marcador.cor}
        icone={marcador.icone}
        emAlcance={!!marcador.emAlcance}
        selecionado={!!marcador.selecionado}
        rotulo={marcador.rotulo}
        resolvido={!!marcador.resolvido}
        rotuloAcessivel={marcador.rotuloAcessivel}
      />
    </Marker>
  );
}

function MarcadorCluster({ cluster, onPress }: { cluster: ClusterMapa; onPress: () => void }) {
  const rastreando = useRasterizacaoTransitoria(String(cluster.total));
  const lado = ladoDoCluster(cluster.total);
  return (
    <Marker
      coordinate={cluster.coordenada}
      onPress={onPress}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={rastreando}
      zIndex={0}>
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={`${cluster.total} chamados nesta região. Toque para aproximar.`}
        style={[styles.cluster, { width: lado, height: lado }]}>
        <Text style={styles.clusterTexto}>{textoDoCluster(cluster.total)}</Text>
      </View>
    </Marker>
  );
}

/** Alfinete do endereço buscado (fica até a pessoa fechar o cartão do destino). */
function MarcadorDestino({ coordenada }: { coordenada: { latitude: number; longitude: number } }) {
  const rastreando = useRasterizacaoTransitoria(`${coordenada.latitude}:${coordenada.longitude}`);
  return (
    <Marker coordinate={coordenada} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={rastreando} zIndex={4}>
      <View accessible accessibilityLabel="Endereço buscado" style={styles.destino}>
        <Ionicons name="location" size={40} color="#111827" />
      </View>
    </Marker>
  );
}

/**
 * "Beacon": ponto exato no chão (com halo), haste subindo e o balão com o
 * ícone da categoria no topo. O Marker é ancorado no pé (y = 1), então o lugar
 * do problema é onde a haste encosta no mapa. O halo aqui é estático:
 * animar dentro de um Marker exigiria `tracksViewChanges`, que pesa no mapa.
 */
function Pino({
  cor,
  icone,
  emAlcance,
  selecionado,
  rotulo,
  resolvido,
  rotuloAcessivel,
}: {
  cor: string;
  icone?: string;
  emAlcance: boolean;
  selecionado: boolean;
  rotulo?: string;
  resolvido: boolean;
  rotuloAcessivel?: string;
}) {
  const balao = selecionado ? 40 : 32;
  const destaque = emAlcance ? OURO : '#fff';
  return (
    <View
      accessible={!!rotuloAcessivel}
      accessibilityRole="button"
      accessibilityLabel={rotuloAcessivel}
      style={[styles.beacon, { height: balao + 26 }]}>
      <View
        style={[
          styles.beaconBalao,
          {
            width: balao,
            height: balao,
            backgroundColor: cor,
            borderColor: destaque,
            borderWidth: emAlcance || selecionado ? 3 : 2,
            opacity: resolvido && !selecionado ? 0.75 : 1,
          },
        ]}>
        {icone ? (
          // Altura de linha explícita: sem ela o Android corta o emoji no bitmap.
          <Text style={{ fontSize: balao * 0.5, lineHeight: balao * 0.62 }}>{icone}</Text>
        ) : null}
      </View>
      {resolvido ? (
        <View style={[styles.beaconCheck, { bottom: balao + 6 }]}>
          <Text style={styles.beaconCheckTexto}>{'\u2713'}</Text>
        </View>
      ) : null}
      {rotulo ? (
        <View style={[styles.beaconRotulo, { bottom: balao + 10 }]}>
          <Text style={styles.beaconRotuloTexto}>{rotulo}</Text>
        </View>
      ) : null}
      <View style={[styles.beaconHaste, { backgroundColor: cor }]} />
      <View style={[styles.beaconHalo, { backgroundColor: emAlcance ? OURO : cor }]} />
      <View style={[styles.beaconPonto, { backgroundColor: cor }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  beacon: {
    width: 48,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  beaconBalao: {
    position: 'absolute',
    bottom: 22,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  // Número da parada: etiqueta preta sobre o balão.
  beaconRotulo: {
    position: 'absolute',
    right: 2,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: Radius.full,
    backgroundColor: '#111',
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  beaconRotuloTexto: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  // Selo de "resolvido": o check diz o que a cor verde sozinha não diz.
  beaconCheck: {
    position: 'absolute',
    left: 2,
    width: 18,
    height: 18,
    borderRadius: Radius.full,
    backgroundColor: '#15803D',
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  beaconCheckTexto: {
    color: '#fff',
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '700',
  },
  // Bolha de agrupamento: neutra (não é status), com borda branca para
  // destacar de qualquer tile, claro ou escuro.
  cluster: {
    borderRadius: Radius.full,
    backgroundColor: '#1F2937',
    borderWidth: 3,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
  clusterTexto: {
    color: '#fff',
    fontSize: 15,
    lineHeight: 18,
    fontWeight: '700',
  },
  destino: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  beaconHaste: {
    position: 'absolute',
    bottom: 2,
    width: 2,
    height: 22,
    opacity: 0.9,
  },
  beaconHalo: {
    position: 'absolute',
    bottom: -2,
    width: 22,
    height: 10,
    borderRadius: Radius.full,
    opacity: 0.35,
  },
  beaconPonto: {
    position: 'absolute',
    bottom: -1,
    width: 8,
    height: 8,
    borderRadius: Radius.full,
    borderWidth: 2,
    borderColor: '#fff',
  },
  usuarioCaixa: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Triângulo translúcido saindo do ponto para cima (norte do marcador).
  usuarioCone: {
    position: 'absolute',
    top: 0,
    width: 0,
    height: 0,
    borderLeftWidth: 20,
    borderRightWidth: 20,
    borderTopWidth: 0,
    borderBottomWidth: 36,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: 'rgba(59,130,246,0.28)',
    transform: [{ scaleY: -1 }],
  },
  usuarioPonto: {
    width: 18,
    height: 18,
    borderRadius: Radius.full,
    backgroundColor: '#3B82F6',
    borderWidth: 3,
    borderColor: '#fff',
  },
});
