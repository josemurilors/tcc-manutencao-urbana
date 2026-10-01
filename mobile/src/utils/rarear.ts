/**
 * Rarefação dos pinos conforme o zoom — espelho de `DefeitoViewSet.area` no
 * backend (mesma grade e mesmos limites).
 *
 * O retângulo visível vira uma grade de ~`GRADE` células por lado e cada
 * célula mostra no máximo `POR_CELULA` chamados. A célula é uma potência de 2
 * em graus, alinhada ao globo: arrastar o mapa no mesmo zoom não troca quais
 * pinos aparecem, e afastar o zoom só junta células.
 *
 * Cortar em silêncio fazia o cidadão subestimar o volume (30 chamados num
 * bairro viravam 4 pinos). Por isso `agruparEmClusters` troca a célula que
 * teve corte por uma bolha com a contagem real — o número que o backend já
 * manda em `celulas[].total`.
 */

import type { Regiao } from '@/components/map-surface.types';
import type { Defeito } from '@/types';

export const GRADE = 8;
export const POR_CELULA = 4;

/** Folga pedida além da tela, para arrastar um pouco sem nova busca. */
const FOLGA = 0.25;

export type Caixa = { min_lat: number; max_lat: number; min_lng: number; max_lng: number };

/** Retângulo visível da região, com `FOLGA` de cada lado. */
export function caixaComFolga(regiao: Regiao): Caixa {
  const meiaLat = (regiao.latitudeDelta * (1 + 2 * FOLGA)) / 2;
  const meiaLng = (regiao.longitudeDelta * (1 + 2 * FOLGA)) / 2;
  return {
    min_lat: Math.max(regiao.latitude - meiaLat, -90),
    max_lat: Math.min(regiao.latitude + meiaLat, 90),
    min_lng: Math.max(regiao.longitude - meiaLng, -180),
    max_lng: Math.min(regiao.longitude + meiaLng, 180),
  };
}

/** Lado da célula para esta caixa — mesma conta do backend. */
export function celulaDaCaixa(caixa: Caixa) {
  const vao = Math.max(caixa.max_lat - caixa.min_lat, caixa.max_lng - caixa.min_lng, 1e-6);
  return 2 ** Math.round(Math.log2(vao / GRADE));
}

/** A região visível (sem folga) cabe inteira dentro da caixa já buscada? */
export function regiaoDentroDaCaixa(regiao: Regiao, caixa: Caixa) {
  return (
    regiao.latitude - regiao.latitudeDelta / 2 >= caixa.min_lat &&
    regiao.latitude + regiao.latitudeDelta / 2 <= caixa.max_lat &&
    regiao.longitude - regiao.longitudeDelta / 2 >= caixa.min_lng &&
    regiao.longitude + regiao.longitudeDelta / 2 <= caixa.max_lng
  );
}

const PESO_PRIORIDADE: Record<string, number> = { urgente: 0, alta: 1, media: 2 };

/** Corte no cliente, para listas que já vêm inteiras (visão do município). */
export function rarear(defeitos: Defeito[], regiao: Regiao) {
  const celula = celulaDaCaixa(caixaComFolga(regiao));
  const ordenados = [...defeitos].sort(
    (a, b) =>
      (b.total_apoios ?? 0) - (a.total_apoios ?? 0) ||
      (PESO_PRIORIDADE[a.prioridade ?? ''] ?? 3) - (PESO_PRIORIDADE[b.prioridade ?? ''] ?? 3) ||
      String(b.criado_em).localeCompare(String(a.criado_em)),
  );
  const porCelula = new Map<string, number>();
  return ordenados.filter((d) => {
    const chave = `${Math.floor(d.latitude / celula)}:${Math.floor(d.longitude / celula)}`;
    const n = porCelula.get(chave) ?? 0;
    if (n >= POR_CELULA) return false;
    porCelula.set(chave, n + 1);
    return true;
  });
}

/** Contagem real de uma célula (centro de massa), como em `AreaDoMapa.celulas`. */
export type CelulaContagem = { latitude: number; longitude: number; total: number };

/** Bolha de agrupamento: os chamados de uma célula que não cabem como pinos. */
export type Cluster = {
  key: string;
  latitude: number;
  longitude: number;
  /** Quantos chamados a bolha representa (o total da célula menos os pinos mantidos). */
  total: number;
};

/**
 * Abaixo desta célula (~110 m de lado, zoom de rua) não agrupa: é o zoom do
 * "modo navegação", em que cada pino precisa estar à vista para ser
 * confirmado no local, e o Leaflet não aproxima além do 18 para abrir a bolha.
 */
export const CELULA_MINIMA_CLUSTER = 2 ** -10;

export function chaveDaCelula(latitude: number, longitude: number, celula: number) {
  return `${Math.floor(latitude / celula)}:${Math.floor(longitude / celula)}`;
}

/** Contagem e centro de massa por célula, para listas que já vêm inteiras. */
export function celulasDe(defeitos: Defeito[], celula: number): CelulaContagem[] {
  const somas = new Map<string, { lat: number; lng: number; n: number }>();
  for (const d of defeitos) {
    const chave = chaveDaCelula(d.latitude, d.longitude, celula);
    const s = somas.get(chave) ?? { lat: 0, lng: 0, n: 0 };
    s.lat += d.latitude;
    s.lng += d.longitude;
    s.n += 1;
    somas.set(chave, s);
  }
  return [...somas.values()].map((s) => ({
    latitude: s.lat / s.n,
    longitude: s.lng / s.n,
    total: s.n,
  }));
}

/**
 * Separa o que vira pino do que vira bolha. Uma célula cujo total real passa
 * dos pinos recebidos vira uma bolha só (com o total), menos os pinos que
 * `manter` segura à vista — o selecionado e os que estão no alcance de
 * confirmação não podem sumir dentro de uma bolha.
 *
 * O centro de massa de uma célula cai dentro dela (a célula é convexa), então
 * a chave calculada a partir dele é a mesma dos pinos.
 */
export function agruparEmClusters<T extends Pick<Defeito, 'latitude' | 'longitude'>>(
  pinos: T[],
  celulas: CelulaContagem[],
  celula: number,
  manter: (pino: T) => boolean = () => false,
): { pinos: T[]; clusters: Cluster[] } {
  if (!(celula > CELULA_MINIMA_CLUSTER) || celulas.length === 0) return { pinos, clusters: [] };

  const pinosPorCelula = new Map<string, T[]>();
  for (const p of pinos) {
    const chave = chaveDaCelula(p.latitude, p.longitude, celula);
    const lista = pinosPorCelula.get(chave);
    if (lista) lista.push(p);
    else pinosPorCelula.set(chave, [p]);
  }

  const agrupadas = new Set<string>();
  const clusters: Cluster[] = [];
  for (const c of celulas) {
    const chave = chaveDaCelula(c.latitude, c.longitude, celula);
    const daCelula = pinosPorCelula.get(chave) ?? [];
    if (c.total <= daCelula.length) continue;
    const mantidos = daCelula.filter(manter).length;
    const total = c.total - mantidos;
    agrupadas.add(chave);
    if (total <= 0) continue;
    clusters.push({ key: `cluster-${chave}`, latitude: c.latitude, longitude: c.longitude, total });
  }

  return {
    pinos: pinos.filter(
      (p) => manter(p) || !agrupadas.has(chaveDaCelula(p.latitude, p.longitude, celula)),
    ),
    clusters,
  };
}

/** Lado da bolha em px: cresce com o log do total, de 40 a 56 (as duas plataformas usam). */
export function ladoDoCluster(total: number) {
  return Math.round(40 + Math.min(16, Math.log10(Math.max(total, 1)) * 8));
}

/** Número curto para caber na bolha (acima de 999 vira "1k+"). */
export function textoDoCluster(total: number) {
  return total > 999 ? `${Math.floor(total / 1000)}k+` : String(total);
}
