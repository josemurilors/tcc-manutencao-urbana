/**
 * Mapa de calor.
 *
 * O react-native-maps só traz `Heatmap` no provider Google (indisponível no
 * Apple Maps) e o `leaflet.heat` não está entre as dependências, então nas
 * duas plataformas a densidade é aproximada por um círculo translúcido por
 * célula, com raio e cor proporcionais ao peso. É uma camada opcional
 * (folha "Camadas"), ligada por qualquer pessoa, logada ou não.
 */

import type { Defeito } from '@/types';

export type HeatCell = {
  key: string;
  latitude: number;
  longitude: number;
  peso: number;
};

/** ~110m por 0.001 grau de latitude; a grade fica nessa ordem de grandeza. */
const PRECISAO_GRAU = 0.002;

export function agruparParaHeatmap(defeitos: Defeito[]): HeatCell[] {
  const celulas = new Map<string, HeatCell>();

  for (const d of defeitos) {
    if (typeof d.latitude !== 'number' || typeof d.longitude !== 'number') continue;
    const lat = Math.round(d.latitude / PRECISAO_GRAU) * PRECISAO_GRAU;
    const lng = Math.round(d.longitude / PRECISAO_GRAU) * PRECISAO_GRAU;
    const key = `${lat.toFixed(4)}:${lng.toFixed(4)}`;
    const atual = celulas.get(key);
    if (atual) atual.peso += 1;
    else celulas.set(key, { key, latitude: lat, longitude: lng, peso: 1 });
  }

  return [...celulas.values()];
}

/**
 * Gradiente frio -> quente, equivalente à escala padrão do leaflet.heat. A
 * legenda do mapa desenha as mesmas faixas, de "poucos" a "muitos".
 */
export const GRADIENTE_CALOR = [
  'rgba(74,144,217,0.35)',
  'rgba(212,175,55,0.35)',
  'rgba(249,115,22,0.40)',
  'rgba(207,68,68,0.45)',
] as const;

export function corDoPeso(peso: number, pesoMaximo: number) {
  const t = pesoMaximo <= 1 ? 0.35 : Math.min(peso / pesoMaximo, 1);
  if (t < 0.25) return GRADIENTE_CALOR[0];
  if (t < 0.5) return GRADIENTE_CALOR[1];
  if (t < 0.75) return GRADIENTE_CALOR[2];
  return GRADIENTE_CALOR[3];
}

/** Raio em metros: células mais densas ocupam mais área, como no blur do web. */
export function raioDoPeso(peso: number, pesoMaximo: number) {
  const t = pesoMaximo <= 1 ? 0.4 : Math.min(peso / pesoMaximo, 1);
  return 120 + t * 260;
}

/**
 * Raio em metros para uma célula de `celulaGraus` de lado: com o zoom
 * afastado a célula cobre quilômetros e o círculo precisa crescer junto para
 * continuar visível — mas sem passar de meia célula, senão as vizinhas se
 * sobrepõem numa mancha opaca.
 */
export function raioNaCelula(peso: number, pesoMaximo: number, celulaGraus: number) {
  const base = raioDoPeso(peso, pesoMaximo);
  if (!(celulaGraus > 0)) return base;
  const meiaCelulaM = (celulaGraus * 111_000) / 2;
  const escala = Math.max(1, (celulaGraus * 111_000) / 500);
  return Math.min(base * escala, Math.max(meiaCelulaM, 60));
}
