/**
 * Superfície do mapa — implementação web (Leaflet).
 *
 * O Metro resolve este arquivo no lugar de `map-surface.tsx` quando a
 * plataforma é web. Usa Leaflet + react-leaflet, o mesmo stack do frontend
 * Vite, porque `react-native-maps` depende de `codegenNativeComponent`, que
 * não existe no react-native-web.
 */

import 'leaflet/dist/leaflet.css';

import './map-surface.web.css';

import L, { type Map as LeafletMap } from 'leaflet';
import { forwardRef, useImperativeHandle, useRef } from 'react';
import { Circle, MapContainer, Marker, Polyline, TileLayer, useMapEvents } from 'react-leaflet';

import type { LatLng } from '@/utils/geo';

import type { MapSurfaceHandle, MapSurfaceProps, Regiao } from './map-surface.types';

// OpenStreetMap não exige chave (o Carto passou a exigir e estampa
// "API KEY REQUIRED" nos tiles). No tema escuro, `.tiles-escuro` inverte as
// cores via CSS — ver global.css.
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATRIBUICAO = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/** Zoom de rua ao seguir o usuário (18 ≈ quarteirão inteiro na tela). */
const ZOOM_NAVEGACAO = 18;

/** O react-native-maps pensa em deltas de grau; o Leaflet, em níveis de zoom. */
function zoomDaRegiao(regiao: Regiao) {
  const delta = Math.max(regiao.longitudeDelta, 0.0001);
  const zoom = Math.round(Math.log2(360 / delta)) + 1;
  return Math.min(Math.max(zoom, 3), 18);
}

/**
 * "Beacon": ponto exato no chão (com halo pulsante), haste subindo e o balão
 * com o ícone da categoria no topo. Ancorado no ponto do chão, então o lugar
 * do problema é onde a haste encosta no mapa. Estilos em map-surface.web.css.
 */
function iconePino(
  cor: string,
  icone: string | undefined,
  emAlcance: boolean,
  selecionado: boolean,
  rotulo?: string,
) {
  const balao = selecionado ? 40 : 32;
  const largura = 48;
  const altura = balao + 26;
  const classes = ['beacon', emAlcance && 'beacon-alcance', selecionado && 'beacon-selecionado']
    .filter(Boolean)
    .join(' ');
  return L.divIcon({
    className: '',
    iconSize: [largura, altura],
    iconAnchor: [largura / 2, altura],
    html: `<div class="${classes}" style="--cor:${cor};--balao:${balao}px;width:${largura}px;height:${altura}px">
      <div class="beacon-halo"></div>
      <div class="beacon-ponto"></div>
      <div class="beacon-haste"></div>
      <div class="beacon-balao">${icone ?? ''}</div>
      ${rotulo ? `<div class="beacon-rotulo">${rotulo}</div>` : ''}
    </div>`,
  });
}

/** Ponto azul com o cone da bússola (Google Maps); o cone some sem direção. */
function iconeUsuario(direcao: number | null) {
  const cone =
    direcao == null
      ? ''
      : `<div style="position:absolute;inset:0;border-radius:50%;background:conic-gradient(from -30deg at 50% 50%, rgba(59,130,246,.35) 0deg 60deg, transparent 60deg)"></div>`;
  return L.divIcon({
    className: '',
    iconSize: [72, 72],
    iconAnchor: [36, 36],
    html: `<div style="position:relative;width:72px;height:72px;transform:rotate(${direcao ?? 0}deg)">${cone}<div style="position:absolute;top:27px;left:27px;width:18px;height:18px;border-radius:50%;background:#3B82F6;border:3px solid #fff;box-sizing:border-box;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div></div>`,
  });
}

function EventosDoMapa({
  onLongPress,
  onArrastar,
  onRegiaoMudou,
}: {
  onLongPress: (coordenada: LatLng) => void;
  onArrastar: () => void;
  onRegiaoMudou?: (regiao: Regiao) => void;
}) {
  const mapa = useMapEvents({
    // Botão direito no desktop, toque longo no touch.
    contextmenu(e) {
      onLongPress({ latitude: e.latlng.lat, longitude: e.latlng.lng });
    },
    dragstart: onArrastar,
    // `moveend` também dispara ao fim do zoom e das animações de câmera.
    moveend() {
      if (!onRegiaoMudou) return;
      const b = mapa.getBounds();
      const c = b.getCenter();
      onRegiaoMudou({
        latitude: c.lat,
        longitude: c.lng,
        latitudeDelta: b.getNorth() - b.getSouth(),
        longitudeDelta: b.getEast() - b.getWest(),
      });
    },
  });
  return null;
}

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
  const mapRef = useRef<LeafletMap | null>(null);

  useImperativeHandle(ref, () => ({
    animarPara(regiao) {
      mapRef.current?.flyTo([regiao.latitude, regiao.longitude], zoomDaRegiao(regiao));
    },
    seguir(posicao) {
      mapRef.current?.setView([posicao.latitude, posicao.longitude], ZOOM_NAVEGACAO, {
        animate: true,
        duration: 0.7,
      });
    },
  }));

  return (
    <MapContainer
      ref={mapRef}
      center={[regiaoInicial.latitude, regiaoInicial.longitude]}
      zoom={zoomDaRegiao(regiaoInicial)}
      minZoom={3}
      zoomControl={false}
      attributionControl={false}
      whenReady={onPronto}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
      <TileLayer
        url={TILES}
        attribution={ATRIBUICAO}
        className={escuro ? 'tiles-escuro' : undefined}
        noWrap
      />
      <EventosDoMapa
        onLongPress={onLongPressMapa}
        onArrastar={onArrastar}
        onRegiaoMudou={onRegiaoMudou}
      />

      {circulos.map((circulo) => (
        <Circle
          key={circulo.key}
          center={[circulo.centro.latitude, circulo.centro.longitude]}
          radius={circulo.raio}
          pathOptions={{
            stroke: !!circulo.corBorda,
            color: circulo.corBorda,
            weight: circulo.larguraBorda ?? 0,
            fillColor: circulo.corPreenchimento,
            // As cores já vêm com alpha embutido no rgba().
            fillOpacity: 1,
            interactive: false,
          }}
        />
      ))}

      {linhas.map((linha) => (
        <Polyline
          key={linha.key}
          positions={linha.coordenadas.map((c) => [c.latitude, c.longitude] as [number, number])}
          pathOptions={{
            color: linha.cor,
            weight: linha.largura ?? 4,
            opacity: 0.9,
            dashArray: linha.tracejada ? '10 8' : undefined,
            lineCap: 'round',
            lineJoin: 'round',
            interactive: false,
          }}
        />
      ))}

      {marcadores.map((marcador) => (
        <Marker
          key={marcador.key}
          position={[marcador.coordenada.latitude, marcador.coordenada.longitude]}
          icon={iconePino(
            marcador.cor,
            marcador.icone,
            !!marcador.emAlcance,
            !!marcador.selecionado,
            marcador.rotulo,
          )}
          zIndexOffset={marcador.selecionado ? 200 : marcador.emAlcance ? 100 : 0}
          eventHandlers={{ click: () => onPressMarcador(marcador.key) }}
        />
      ))}

      {usuario ? (
        <>
          {usuario.precisao && usuario.precisao > 15 ? (
            <Circle
              center={[usuario.latitude, usuario.longitude]}
              radius={usuario.precisao}
              pathOptions={{
                color: 'rgba(59,130,246,0.35)',
                weight: 1,
                fillColor: 'rgba(59,130,246,0.12)',
                fillOpacity: 1,
                interactive: false,
              }}
            />
          ) : null}
          <Marker
            position={[usuario.latitude, usuario.longitude]}
            icon={iconeUsuario(direcao)}
            zIndexOffset={300}
            interactive={false}
          />
        </>
      ) : null}
    </MapContainer>
  );
});
