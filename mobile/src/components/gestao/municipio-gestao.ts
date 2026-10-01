/**
 * Município sobre o qual a gestão age, para o super_admin (contrato v3,
 * 7.6: `?municipio=<codigo>`). Os outros papéis gerem só o próprio
 * município, e para eles isto fica sempre vazio.
 *
 * Estado de módulo (não de tela): a escolha vale para todas as telas de
 * `app/admin/` até sair do app. `services/api-gestao.ts` acrescenta o
 * parâmetro em toda chamada e os hooks de carga (`useDados`,
 * `useListaPaginada`) recarregam quando ele muda.
 */

import { useSyncExternalStore } from 'react';

export type MunicipioEscolhido = { codigo: string; nome: string; uf_sigla: string };

let atual: MunicipioEscolhido | null = null;
const ouvintes = new Set<() => void>();

export function municipioGestao() {
  return atual;
}

export function escolherMunicipioGestao(m: MunicipioEscolhido | null) {
  if ((m?.codigo ?? null) === (atual?.codigo ?? null)) return;
  atual = m;
  ouvintes.forEach((o) => o());
}

function assinar(ouvinte: () => void) {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

/** Município escolhido pelo super_admin (`null` = o do próprio usuário). */
export function useMunicipioGestao() {
  return useSyncExternalStore(assinar, municipioGestao, municipioGestao);
}
