/**
 * Última posição conhecida do usuário, guardada entre sessões.
 *
 * O GPS pode demorar a responder (no desktop, o `navigator.geolocation` leva
 * dezenas de segundos). Para o mapa não nascer num enquadramento genérico e
 * voar até o usuário, ele abre na última posição vista e o GPS só refina.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export type Ponto = { latitude: number; longitude: number };

const CHAVE = 'ultima_posicao';
/** Intervalo mínimo entre gravações; o watch do GPS dispara a cada poucos segundos. */
const INTERVALO_GRAVACAO_MS = 10_000;

/** `undefined` enquanto o armazenamento ainda não foi lido. */
let cache: Ponto | null | undefined;
let leitura: Promise<Ponto | null> | null = null;
let ultimaGravacao = 0;

function paraPonto(raw: string | null): Ponto | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<Ponto>;
    return Number.isFinite(p.latitude) && Number.isFinite(p.longitude)
      ? { latitude: p.latitude as number, longitude: p.longitude as number }
      : null;
  } catch {
    return null;
  }
}

/** Valor já em memória: `undefined` se ainda não foi lido do armazenamento. */
export function ultimaPosicaoEmCache(): Ponto | null | undefined {
  return cache;
}

export function lerUltimaPosicao(): Promise<Ponto | null> {
  if (cache !== undefined) return Promise.resolve(cache);
  leitura ??= AsyncStorage.getItem(CHAVE)
    .then(paraPonto)
    .catch(() => null)
    .then((p) => {
      // Uma posição nova pode ter chegado enquanto lia; ela vale mais.
      if (cache === undefined) cache = p;
      return cache;
    });
  return leitura;
}

export function salvarUltimaPosicao(p: Ponto) {
  cache = { latitude: p.latitude, longitude: p.longitude };
  const agora = Date.now();
  if (agora - ultimaGravacao < INTERVALO_GRAVACAO_MS) return;
  ultimaGravacao = agora;
  AsyncStorage.setItem(CHAVE, JSON.stringify(cache)).catch(() => {});
}
