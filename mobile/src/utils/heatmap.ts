/**
 * Mapa de calor.
 *
 * A tela entrega cada célula como um `CirculoMapa` de chave `calor-...`, com
 * a cor de `corDoPeso` (um dos degraus da rampa) e o raio em metros. Cada
 * superfície desenha esses círculos como calor de verdade:
 * - web (`map-surface.web.tsx`): uma camada canvas própria, no estilo do
 *   leaflet.heat — manchas com borda difusa que se somam e são coloridas pela
 *   rampa, com o raio em metros (acompanha o zoom);
 * - nativo (`map-surface.tsx`): o react-native-maps não tem calor no Apple
 *   Maps, então cada célula vira anéis concêntricos translúcidos, do frio na
 *   borda ao quente no centro — um degradê radial, não um disco opaco.
 * A intensidade (0–1) volta da cor por `intensidadeDoCirculo`. É uma camada
 * opcional (folha "Camadas"), ligada por qualquer pessoa, logada ou não; a
 * legenda (`legenda-mapa.tsx`) desenha `GRADIENTE_CALOR`, de "poucos" a "muitos".
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

/** Prefixo da chave dos círculos de calor (a tela monta `calor-<célula>`). */
export const PREFIXO_CALOR = 'calor-';

/** Rampa frio -> quente (azul, verde-água, dourado, laranja, vermelho), como no leaflet.heat. */
const RAMPA: readonly [number, readonly [number, number, number]][] = [
  [0, [74, 144, 217]],
  [0.3, [45, 170, 160]],
  [0.55, [212, 175, 55]],
  [0.78, [249, 115, 22]],
  [1, [207, 68, 68]],
];

/** Cor da rampa em `t` (0–1), como [r, g, b]. */
export function rgbNaRampa(t: number): [number, number, number] {
  const x = Math.min(Math.max(t, 0), 1);
  for (let i = 1; i < RAMPA.length; i++) {
    const [t1, c1] = RAMPA[i];
    if (x <= t1) {
      const [t0, c0] = RAMPA[i - 1];
      const k = (x - t0) / (t1 - t0 || 1);
      return [0, 1, 2].map((j) => Math.round(c0[j] + (c1[j] - c0[j]) * k)) as [number, number, number];
    }
  }
  return [...RAMPA[RAMPA.length - 1][1]] as [number, number, number];
}

export function corNaRampa(t: number, alpha: number) {
  const [r, g, b] = rgbNaRampa(t);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Paradas da rampa para gradientes (canvas, legenda): [posição, cor sólida]. */
export const PARADAS_CALOR = RAMPA.map(([t]) => [t, corNaRampa(t, 1)] as const);

/**
 * Faixas da legenda, de "poucos" a "muitos" (a legenda troca o alpha para
 * ler a escala sobre o cartão).
 */
export const GRADIENTE_CALOR = RAMPA.map(([t]) => corNaRampa(t, 0.4));

/**
 * Degraus de intensidade: `corDoPeso` devolve um deles, e a superfície do
 * mapa recupera a intensidade pela cor (`intensidadeDoCirculo`) sem a tela
 * precisar passar outro campo.
 */
const DEGRAUS = 12;
const COR_DO_DEGRAU = Array.from({ length: DEGRAUS }, (_, i) =>
  corNaRampa((i + 1) / DEGRAUS, 0.4),
);
const DEGRAU_DA_COR = new Map(COR_DO_DEGRAU.map((cor, i) => [cor, (i + 1) / DEGRAUS]));

export function corDoPeso(peso: number, pesoMaximo: number) {
  const t = pesoMaximo <= 1 ? 0.35 : Math.min(peso / pesoMaximo, 1);
  // Raiz: poucos chamados ainda aparecem, sem apagar as diferenças no topo.
  const i = Math.min(DEGRAUS - 1, Math.max(0, Math.ceil(Math.sqrt(t) * DEGRAUS) - 1));
  return COR_DO_DEGRAU[i];
}

/** Intensidade (0–1) de um círculo de calor; `null` se não for um. */
export function intensidadeDoCirculo(c: { key: string; corPreenchimento: string }) {
  if (!c.key.startsWith(PREFIXO_CALOR)) return null;
  return DEGRAU_DA_COR.get(c.corPreenchimento) ?? 0.5;
}

/**
 * Anéis do calor no nativo, de fora para dentro: raio relativo, ponto da
 * rampa (relativo à intensidade da célula) e opacidade. Empilhados, o centro
 * fica mais quente e mais denso, e a borda some no mapa.
 */
export const ANEIS_CALOR = [
  { raio: 1, rampa: 0.35, alpha: 0.14 },
  { raio: 0.72, rampa: 0.6, alpha: 0.16 },
  { raio: 0.46, rampa: 0.85, alpha: 0.2 },
  { raio: 0.22, rampa: 1, alpha: 0.26 },
] as const;

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
