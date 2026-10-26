/**
 * Superfície do mapa — implementação web (Leaflet).
 *
 * O Metro resolve este arquivo no lugar de `map-surface.tsx` quando a
 * plataforma é web. Usa Leaflet + react-leaflet porque `react-native-maps` depende de `codegenNativeComponent`, que
 * não existe no react-native-web.
 */

import 'leaflet/dist/leaflet.css';

import './map-surface.web.css';

import L, { type Map as LeafletMap } from 'leaflet';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import {
  Circle,
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';

import type { LatLng } from '@/utils/geo';
import { intensidadeDoCirculo, PARADAS_CALOR } from '@/utils/heatmap';
import { ladoDoCluster, textoDoCluster } from '@/utils/rarear';

import type { CirculoMapa, MapSurfaceHandle, MapSurfaceProps, Regiao } from './map-surface.types';

// OpenStreetMap não exige chave (o Carto passou a exigir e estampa
// "API KEY REQUIRED" nos tiles). No tema escuro, `.tiles-escuro` inverte as
// cores via CSS — ver global.css. Em produção (venda a prefeituras) o
// servidor público do OSM não serve: a política dele proíbe uso intenso e
// exige atribuição. `EXPO_PUBLIC_TILES_URL`/`_ATTRIB` apontam para o provedor
// contratado (MapTiler, Stadia, tileserver próprio) sem mexer no código.
const TILES = process.env.EXPO_PUBLIC_TILES_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATRIBUICAO =
  process.env.EXPO_PUBLIC_TILES_ATTRIB ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/**
 * O divIcon do Leaflet é HTML cru: qualquer texto que venha do backend (ícone
 * da categoria, rótulo) precisa ser escapado, senão um nome de categoria com
 * `<img onerror>` executaria script na página.
 */
function escapeHtml(texto: string) {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A cor entra num `style=""`: só aceita hex ou rgb(a), o resto vira cinza. */
function corSegura(cor: string) {
  return /^#[0-9a-f]{3,8}$/i.test(cor) || /^rgba?\([\d.,\s%]+\)$/i.test(cor) ? cor : '#6B7280';
}

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
  resolvido?: boolean,
  rotuloAcessivel?: string,
) {
  const balao = selecionado ? 40 : 32;
  const largura = 48;
  const altura = balao + 26;
  const classes = [
    'beacon',
    emAlcance && 'beacon-alcance',
    selecionado && 'beacon-selecionado',
    resolvido && 'beacon-resolvido',
  ]
    .filter(Boolean)
    .join(' ');
  const titulo = rotuloAcessivel ? ` role="img" aria-label="${escapeHtml(rotuloAcessivel)}" title="${escapeHtml(rotuloAcessivel)}"` : '';
  return L.divIcon({
    className: '',
    iconSize: [largura, altura],
    iconAnchor: [largura / 2, altura],
    html: `<div class="${classes}"${titulo} style="--cor:${corSegura(cor)};--balao:${balao}px;width:${largura}px;height:${altura}px">
      <div class="beacon-halo"></div>
      <div class="beacon-ponto"></div>
      <div class="beacon-haste"></div>
      <div class="beacon-balao">${escapeHtml(icone ?? '')}</div>
      ${resolvido ? '<div class="beacon-check" aria-hidden="true">&#10003;</div>' : ''}
      ${rotulo ? `<div class="beacon-rotulo">${escapeHtml(rotulo)}</div>` : ''}
    </div>`,
  });
}

/** Bolha com a contagem real da célula (ver `agruparEmClusters`). */
function iconeCluster(total: number) {
  const lado = ladoDoCluster(total);
  const rotulo = `${total} chamados nesta região. Toque para aproximar.`;
  return L.divIcon({
    className: '',
    iconSize: [lado, lado],
    iconAnchor: [lado / 2, lado / 2],
    html: `<div class="cluster" role="button" aria-label="${rotulo}" title="${rotulo}" style="width:${lado}px;height:${lado}px">${textoDoCluster(total)}</div>`,
  });
}

/** Alfinete do endereço buscado. */
const ICONE_DESTINO = L.divIcon({
  className: '',
  iconSize: [36, 44],
  iconAnchor: [18, 44],
  html: '<div class="destino" role="img" aria-label="Endereço buscado"><div class="destino-cabeca"></div><div class="destino-ponta"></div></div>',
});

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

type PontoCalor = { lat: number; lng: number; raio: number; intensidade: number };

/** Opacidade máxima do calor: as ruas continuam legíveis por baixo. */
const CALOR_OPACIDADE_MAX = 0.72;

/** Paleta de 256 cores da rampa (índice = densidade acumulada). */
let paletaCalor: Uint8ClampedArray | null = null;
function paleta() {
  if (paletaCalor) return paletaCalor;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new Uint8ClampedArray(256 * 4);
  const grad = ctx.createLinearGradient(0, 0, 256, 0);
  for (const [t, cor] of PARADAS_CALOR) grad.addColorStop(t, cor);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 1);
  paletaCalor = ctx.getImageData(0, 0, 256, 1).data;
  return paletaCalor;
}

/**
 * Mapa de calor em canvas (o algoritmo do leaflet.heat/simpleheat, sem a
 * dependência): cada ponto pinta uma mancha de borda difusa em tons de
 * cinza, as manchas se somam e a densidade resultante é colorida pela rampa.
 * O raio vem em metros e é convertido a cada zoom, então a mancha cobre a
 * mesma área no chão. Redesenha ao fim de cada movimento; durante a animação
 * de zoom fica escondido (`leaflet-zoom-hide`).
 */
function CamadaCalor({ pontos }: { pontos: PontoCalor[] }) {
  const mapa = useMap();
  const pontosRef = useRef(pontos);
  const redesenharRef = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = L.DomUtil.create('canvas', 'leaflet-zoom-hide camada-calor') as HTMLCanvasElement;
    canvas.style.pointerEvents = 'none';
    canvas.setAttribute('aria-hidden', 'true');
    mapa.getPanes().overlayPane.appendChild(canvas);

    function redesenhar() {
      const tamanho = mapa.getSize();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(tamanho.x * dpr);
      canvas.height = Math.round(tamanho.y * dpr);
      canvas.style.width = `${tamanho.x}px`;
      canvas.style.height = `${tamanho.y}px`;
      L.DomUtil.setPosition(canvas, mapa.containerPointToLayerPoint([0, 0]));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const lista = pontosRef.current;
      if (lista.length === 0) return;

      // 1) Densidade: manchas radiais em preto com alpha, somadas.
      for (const p of lista) {
        const centro = mapa.latLngToContainerPoint([p.lat, p.lng]);
        const borda = mapa.latLngToContainerPoint([p.lat + p.raio / 111_320, p.lng]);
        const r = Math.max(Math.abs(centro.y - borda.y), 10) * dpr;
        const x = centro.x * dpr;
        const y = centro.y * dpr;
        if (x < -r || y < -r || x > canvas.width + r || y > canvas.height + r) continue;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        const a = 0.25 + 0.75 * p.intensidade;
        grad.addColorStop(0, `rgba(0,0,0,${a})`);
        grad.addColorStop(0.45, `rgba(0,0,0,${a * 0.6})`);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // 2) Cor: a densidade (alpha) vira índice na rampa.
      const imagem = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const px = imagem.data;
      const cores = paleta();
      for (let i = 3; i < px.length; i += 4) {
        const alpha = px[i];
        if (!alpha) continue;
        const j = alpha * 4;
        px[i - 3] = cores[j];
        px[i - 2] = cores[j + 1];
        px[i - 1] = cores[j + 2];
        px[i] = Math.min(alpha * 1.4, 255 * CALOR_OPACIDADE_MAX);
      }
      ctx.putImageData(imagem, 0, 0);
    }

    redesenharRef.current = redesenhar;
    redesenhar();
    mapa.on('moveend zoomend resize viewreset', redesenhar);
    return () => {
      mapa.off('moveend zoomend resize viewreset', redesenhar);
      canvas.remove();
      redesenharRef.current = () => {};
    };
  }, [mapa]);

  useEffect(() => {
    pontosRef.current = pontos;
    redesenharRef.current();
  }, [pontos]);

  return null;
}

/** Separa os círculos de calor (camada canvas) dos demais (círculos comuns). */
function separarCalor(circulos: CirculoMapa[]) {
  const comuns: CirculoMapa[] = [];
  const calor: PontoCalor[] = [];
  for (const c of circulos) {
    const intensidade = intensidadeDoCirculo(c);
    if (intensidade == null) comuns.push(c);
    else calor.push({ lat: c.centro.latitude, lng: c.centro.longitude, raio: c.raio, intensidade });
  }
  return { comuns, calor };
}

/** Tira o "Leaflet" da atribuição: sobra só a dos dados, que é a obrigatória. */
function PrefixoAtribuicao() {
  const mapa = useMap();
  useEffect(() => {
    mapa.attributionControl?.setPrefix(false);
  }, [mapa]);
  return null;
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
  const mapRef = useRef<LeafletMap | null>(null);
  const { comuns, calor } = useMemo(() => separarCalor(circulos), [circulos]);

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
      // Atribuição é exigência da licença dos dados (ODbL); fica compacta no
      // canto, sem o prefixo do Leaflet.
      attributionControl
      whenReady={onPronto}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
      <TileLayer
        url={TILES}
        attribution={ATRIBUICAO}
        className={escuro ? 'tiles-escuro' : undefined}
        noWrap
      />
      <PrefixoAtribuicao />
      <EventosDoMapa
        onLongPress={onLongPressMapa}
        onArrastar={onArrastar}
        onRegiaoMudou={onRegiaoMudou}
      />

      {calor.length ? <CamadaCalor pontos={calor} /> : null}

      {comuns.map((circulo) => (
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

      {clusters.map((cluster) => (
        <Marker
          key={cluster.key}
          position={[cluster.coordenada.latitude, cluster.coordenada.longitude]}
          icon={iconeCluster(cluster.total)}
          zIndexOffset={-100}
          eventHandlers={{ click: () => onPressCluster?.(cluster.key) }}
        />
      ))}

      {destino ? (
        <Marker
          position={[destino.latitude, destino.longitude]}
          icon={ICONE_DESTINO}
          zIndexOffset={400}
          interactive={false}
        />
      ) : null}

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
            marcador.resolvido,
            marcador.rotuloAcessivel,
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
