/**
 * Utilidades geoespaciais (mapa de calor, raio e ponto no polígono).
 */

import type { Defeito } from '@/types';

const EARTH_RADIUS_M = 6371000;

export type LatLng = { latitude: number; longitude: number };

/** Ray casting. `poligono` vem em pares [lng, lat], como no GeoJSON. */
export function pointInPolygon(point: [number, number], poligono: [number, number][]) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const [xi, yi] = poligono[i];
    const [xj, yj] = poligono[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function filterByRadius(defeitos: Defeito[], lat: number, lng: number, raio: number) {
  return defeitos.filter((d) => haversineDistance(lat, lng, d.latitude, d.longitude) <= raio);
}

/** Região que enquadra uma bounding box inteira, com folga de 15%. */
export function regiaoDaCaixa(caixa: {
  min_lat: number;
  max_lat: number;
  min_lng: number;
  max_lng: number;
}) {
  return {
    latitude: (caixa.min_lat + caixa.max_lat) / 2,
    longitude: (caixa.min_lng + caixa.max_lng) / 2,
    latitudeDelta: Math.max((caixa.max_lat - caixa.min_lat) * 1.15, 0.02),
    longitudeDelta: Math.max((caixa.max_lng - caixa.min_lng) * 1.15, 0.02),
  };
}

/**
 * Menor caixa que contem todos os pontos, ou null se a lista estiver vazia.
 * Usada para enquadrar so a area onde ha chamados, em vez do municipio
 * inteiro (em cidades enormes o zoom-out deixaria tudo invisivel).
 */
export function caixaDosPontos(pontos: { latitude: number; longitude: number }[]) {
  const validos = pontos.filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
  if (validos.length === 0) return null;
  return validos.reduce(
    (c, p) => ({
      min_lat: Math.min(c.min_lat, p.latitude),
      max_lat: Math.max(c.max_lat, p.latitude),
      min_lng: Math.min(c.min_lng, p.longitude),
      max_lng: Math.max(c.max_lng, p.longitude),
    }),
    { min_lat: Infinity, max_lat: -Infinity, min_lng: Infinity, max_lng: -Infinity },
  );
}

/** Enquadramento de fallback quando não há GPS nem chamados (São Paulo/SP). */
export const REGIAO_PADRAO = {
  latitude: -23.5505,
  longitude: -46.6333,
  latitudeDelta: 0.2,
  longitudeDelta: 0.2,
};

/**
 * Delta equivalente ao zoom de rua usado ao seguir o usuário (zoom 18 no
 * Leaflet: 360 / 2^17 graus), para o mapa já nascer como fica ao navegar.
 */
export const DELTA_NAVEGACAO = 360 / 2 ** 17;

export function regiaoEmTorno(lat: number, lng: number, delta = 0.08) {
  return { latitude: lat, longitude: lng, latitudeDelta: delta, longitudeDelta: delta };
}

/** Distância em metros de um chamado até um ponto. */
export function distanciaAte(defeito: Defeito, lat: number, lng: number) {
  return haversineDistance(lat, lng, defeito.latitude, defeito.longitude);
}

/** "85 m", "1,2 km". */
export function formatarDistancia(metros: number) {
  if (!Number.isFinite(metros)) return '';
  if (metros < 1000) return `${Math.round(metros)} m`;
  return `${(metros / 1000).toFixed(metros < 10000 ? 1 : 0).replace('.', ',')} km`;
}

/** Região que enquadra um círculo de `raio` metros em torno do ponto. */
export function regiaoParaRaio(lat: number, lng: number, raio: number) {
  // 1 grau de latitude ≈ 111 km; a longitude encolhe com o cosseno da latitude.
  const latitudeDelta = (raio * 2 * 1.4) / 111000;
  const longitudeDelta = latitudeDelta / Math.max(Math.cos((lat * Math.PI) / 180), 0.2);
  return { latitude: lat, longitude: lng, latitudeDelta, longitudeDelta };
}
