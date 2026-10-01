/**
 * Ordenação de paradas para o roteiro do operador (um TSP pequeno).
 *
 * Com até algumas dezenas de pontos, *vizinho mais próximo* seguido de *2-opt*
 * sobre distância haversine roda em milissegundos no aparelho e chega perto
 * do ótimo. Chamados prioritários (SLA vencido ou vencendo em 24 h, decidido
 * por quem chama) formam um bloco que vem antes dos demais — cada bloco é
 * otimizado separadamente, e o segundo parte de onde o primeiro terminou.
 *
 * É distância em linha reta, não por ruas; quando o OSRM responde
 * (`services/osrm.ts`), a geometria e a ordem por malha viária substituem
 * esta. Aqui é o fallback que sempre funciona, inclusive offline.
 */

import { haversineDistance, type LatLng } from '@/utils/geo';

export type Parada = LatLng & { prioritario?: boolean };

function dist(a: LatLng, b: LatLng) {
  return haversineDistance(a.latitude, a.longitude, b.latitude, b.longitude);
}

/** Vizinho mais próximo a partir de `origem`; devolve índices de `pontos`. */
function vizinhoMaisProximo(origem: LatLng, pontos: LatLng[]) {
  const restantes = pontos.map((_, i) => i);
  const ordem: number[] = [];
  let atual = origem;
  while (restantes.length > 0) {
    let melhor = 0;
    let melhorD = Infinity;
    for (let k = 0; k < restantes.length; k++) {
      const d = dist(atual, pontos[restantes[k]]);
      if (d < melhorD) {
        melhorD = d;
        melhor = k;
      }
    }
    const [idx] = restantes.splice(melhor, 1);
    ordem.push(idx);
    atual = pontos[idx];
  }
  return ordem;
}

/** Comprimento de um caminho aberto que começa em `origem` e passa por `ordem`. */
function comprimento(origem: LatLng, pontos: LatLng[], ordem: number[]) {
  let total = 0;
  let atual = origem;
  for (const i of ordem) {
    total += dist(atual, pontos[i]);
    atual = pontos[i];
  }
  return total;
}

/**
 * 2-opt para caminho aberto: inverte trechos enquanto isso encurtar o total.
 * Limita as passadas para nunca travar a tela com uma seleção grande.
 */
function doisOpt(origem: LatLng, pontos: LatLng[], ordem: number[]) {
  const n = ordem.length;
  if (n < 3) return ordem;
  let melhorou = true;
  let passadas = 0;
  while (melhorou && passadas < 50) {
    melhorou = false;
    passadas += 1;
    for (let i = 0; i < n - 1; i++) {
      const antesI = i === 0 ? origem : pontos[ordem[i - 1]];
      for (let j = i + 1; j < n; j++) {
        const depoisJ = j === n - 1 ? null : pontos[ordem[j + 1]];
        const a = pontos[ordem[i]];
        const b = pontos[ordem[j]];
        const atualCusto = dist(antesI, a) + (depoisJ ? dist(b, depoisJ) : 0);
        const novoCusto = dist(antesI, b) + (depoisJ ? dist(a, depoisJ) : 0);
        if (novoCusto + 1e-9 < atualCusto) {
          // Inverte ordem[i..j].
          let x = i;
          let y = j;
          while (x < y) {
            const t = ordem[x];
            ordem[x] = ordem[y];
            ordem[y] = t;
            x++;
            y--;
          }
          melhorou = true;
        }
      }
    }
  }
  return ordem;
}

function otimizarBloco(origem: LatLng, pontos: LatLng[]) {
  if (pontos.length === 0) return [] as number[];
  return doisOpt(origem, pontos, vizinhoMaisProximo(origem, pontos));
}

export type Roteiro<T extends Parada> = {
  /** Paradas na ordem de visita. */
  paradas: T[];
  /** Distância total em linha reta, em metros, partindo de `origem`. */
  distanciaM: number;
};

/**
 * Ordena `paradas` partindo de `origem`: prioritárias primeiro (otimizadas
 * entre si), depois as demais partindo da última prioritária.
 */
export function ordenarParadas<T extends Parada>(origem: LatLng, paradas: T[]): Roteiro<T> {
  const prioritarias = paradas.filter((p) => p.prioritario);
  const comuns = paradas.filter((p) => !p.prioritario);

  const ordemP = otimizarBloco(origem, prioritarias);
  const ultimaP = ordemP.length > 0 ? prioritarias[ordemP[ordemP.length - 1]] : origem;
  const ordemC = otimizarBloco(ultimaP, comuns);

  const ordenadas = [...ordemP.map((i) => prioritarias[i]), ...ordemC.map((i) => comuns[i])];
  return {
    paradas: ordenadas,
    distanciaM: comprimento(
      origem,
      ordenadas,
      ordenadas.map((_, i) => i),
    ),
  };
}

/** Os `n` pontos mais próximos de `origem`, para montar uma seleção rápida. */
export function maisProximos<T extends LatLng>(origem: LatLng, pontos: T[], n: number) {
  return [...pontos].sort((a, b) => dist(origem, a) - dist(origem, b)).slice(0, n);
}
