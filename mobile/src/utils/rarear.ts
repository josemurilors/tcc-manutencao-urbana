/**
 * Rarefação dos pinos conforme o zoom — espelho de `DefeitoViewSet.area` no
 * backend (mesma grade e mesmos limites).
 *
 * O retângulo visível vira uma grade de ~`GRADE` células por lado e cada
 * célula mostra no máximo `POR_CELULA` chamados. A célula é uma potência de 2
 * em graus, alinhada ao globo: arrastar o mapa no mesmo zoom não troca quais
 * pinos aparecem, e afastar o zoom só junta células.
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
