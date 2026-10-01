/**
 * Rota por ruas via OSRM.
 *
 * - `trip`: resolve a ordem das paradas pela malha viária e devolve a
 *   geometria — a "rota inteligente" de verdade.
 * - `route`: só a geometria/distância para uma ordem já decidida (usada
 *   quando há paradas prioritárias, que precisam vir primeiro).
 *
 * O servidor vem de `EXPO_PUBLIC_OSRM_URL` (instância própria da prefeitura
 * ou provedor contratado). O servidor público de demonstração do projeto
 * proíbe uso em produção e não tem SLA, então só é usado em desenvolvimento;
 * num build de produção sem a variável, o roteiro cai direto no traçado em
 * linha reta (`utils/rota.ts`). Toda chamada tem timeout curto pelo mesmo
 * motivo: no campo, esperar a rota não pode travar o operador.
 */

import type { LatLng } from '@/utils/geo';

const OSRM_DEMO = 'https://router.project-osrm.org';
const OSRM_URL = (process.env.EXPO_PUBLIC_OSRM_URL || (__DEV__ ? OSRM_DEMO : '')).replace(/\/+$/, '');
/** Perfil do OSRM (`driving`, ou o que a instância própria expuser, ex.: `truck`). */
const PERFIL = process.env.EXPO_PUBLIC_OSRM_PERFIL || 'driving';

/** Há servidor de rotas configurado? Sem ele o app nem tenta (linha reta direto). */
export const osrmDisponivel = OSRM_URL !== '';
const TIMEOUT_MS = 8000;

export type RotaOsrm = {
  /** Posição de cada ponto de entrada na ordem de visita (só no `trip`). */
  ordem: number[];
  /** Traçado pela rua, em lat/lng. */
  geometria: LatLng[];
  distanciaM: number;
  duracaoS: number;
};

function coords(pontos: LatLng[]) {
  return pontos.map((p) => `${p.longitude},${p.latitude}`).join(';');
}

async function chamar(url: string) {
  if (!osrmDisponivel) throw new Error('Servidor de rotas não configurado');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) throw new Error(`OSRM ${resp.status}`);
    const json = await resp.json();
    if (json.code !== 'Ok') throw new Error(`OSRM ${json.code}`);
    return json;
  } finally {
    clearTimeout(timer);
  }
}

function geometriaPara(geo: { coordinates: [number, number][] }): LatLng[] {
  return geo.coordinates.map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
}

/**
 * Ordem ótima por ruas partindo de `origem` (fixa como primeira parada, sem
 * voltar ao início). `pontos` são as paradas; `ordem` volta como índices
 * de `pontos` na sequência de visita.
 */
export async function tripOsrm(origem: LatLng, pontos: LatLng[]): Promise<RotaOsrm> {
  const url =
    `${OSRM_URL}/trip/v1/${PERFIL}/${coords([origem, ...pontos])}` +
    `?source=first&roundtrip=false&geometries=geojson&overview=full`;
  const json = await chamar(url);
  const trip = json.trips?.[0];
  if (!trip) throw new Error('OSRM sem rota');
  // waypoints[i].waypoint_index = posição do ponto i na viagem (0 = origem).
  const posicoes: { i: number; pos: number }[] = json.waypoints
    .map((w: { waypoint_index: number }, i: number) => ({ i: i - 1, pos: w.waypoint_index }))
    .filter((x: { i: number }) => x.i >= 0);
  posicoes.sort((a, b) => a.pos - b.pos);
  return {
    ordem: posicoes.map((x) => x.i),
    geometria: geometriaPara(trip.geometry),
    distanciaM: trip.distance,
    duracaoS: trip.duration,
  };
}

/** Geometria/distância por ruas para uma ordem já definida. */
export async function routeOsrm(pontos: LatLng[]): Promise<RotaOsrm> {
  const url = `${OSRM_URL}/route/v1/${PERFIL}/${coords(pontos)}?geometries=geojson&overview=full`;
  const json = await chamar(url);
  const rota = json.routes?.[0];
  if (!rota) throw new Error('OSRM sem rota');
  return {
    ordem: pontos.slice(1).map((_, i) => i),
    geometria: geometriaPara(rota.geometry),
    distanciaM: rota.distance,
    duracaoS: rota.duration,
  };
}
