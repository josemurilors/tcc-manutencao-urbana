/**
 * Superfície do mapa — implementação nativa (react-native-maps).
 *
 * A tela do mapa (`app/(tabs)/mapa.tsx`) fala só com esta interface. No web o
 * Metro resolve `map-surface.web.tsx`, que desenha o mesmo conteúdo com
 * Leaflet — `react-native-maps` chama `codegenNativeComponent`, que não existe
 * no react-native-web e quebraria o bundle.
 */

import { forwardRef, useImperativeHandle, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, Marker, Polyline } from 'react-native-maps';

import { MAPA_ESTILO_ESCURO } from '@/constants/map-style';
import { Radius } from '@/constants/theme';

import type { MapSurfaceHandle, MapSurfaceProps } from './map-surface.types';

/** Zoom de rua ao seguir o usuário (18 ≈ quarteirão inteiro na tela). */
const ZOOM_NAVEGACAO = 18;
const OURO = '#D4AF37';

export const MapSurface = forwardRef<MapSurfaceHandle, MapSurfaceProps>(function MapSurface(
  {
    regiaoInicial,
    circulos,
    marcadores,
    linhas = [],
    usuario,
    onLongPressMapa,
    onPressMarcador,
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
      {circulos.map((circulo) => (
        <Circle
          key={circulo.key}
          center={circulo.centro}
          radius={circulo.raio}
          strokeColor={circulo.corBorda ?? 'transparent'}
          strokeWidth={circulo.larguraBorda ?? 0}
          fillColor={circulo.corPreenchimento}
        />
      ))}

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

      {marcadores.map((marcador) => (
        <Marker
          key={marcador.key}
          coordinate={marcador.coordenada}
          onPress={() => onPressMarcador(marcador.key)}
          anchor={{ x: 0.5, y: 1 }}
          tracksViewChanges={false}
          zIndex={marcador.selecionado ? 2 : marcador.emAlcance ? 1 : 0}>
          <Pino
            cor={marcador.cor}
            icone={marcador.icone}
            emAlcance={!!marcador.emAlcance}
            selecionado={!!marcador.selecionado}
            rotulo={marcador.rotulo}
          />
        </Marker>
      ))}

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
}: {
  cor: string;
  icone?: string;
  emAlcance: boolean;
  selecionado: boolean;
  rotulo?: string;
}) {
  const balao = selecionado ? 40 : 32;
  const destaque = emAlcance ? OURO : '#fff';
  return (
    <View style={[styles.beacon, { height: balao + 26 }]}>
      <View
        style={[
          styles.beaconBalao,
          {
            width: balao,
            height: balao,
            backgroundColor: cor,
            borderColor: destaque,
            borderWidth: emAlcance || selecionado ? 3 : 2,
          },
        ]}>
        {icone ? <Text style={{ fontSize: balao * 0.5 }}>{icone}</Text> : null}
      </View>
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
