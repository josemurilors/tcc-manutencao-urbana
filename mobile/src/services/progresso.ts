/**
 * Nível/EXP do usuário, compartilhado entre telas.
 *
 * Um store minúsculo (mesmo padrão do `gpsSimulado`): quem exibe o progresso
 * assina via `useProgresso`, e quem executa uma ação que rende XP (reportar,
 * confirmar, sinalizar) chama `recarregarProgresso()` — a barra atualiza na
 * hora em todas as telas, sem esperar a próxima montagem/foco.
 */

import { useEffect, useState } from 'react';

import type { Progresso } from '@/types';

import { api } from './api';

let atual: Progresso | null = null;
const ouvintes = new Set<(p: Progresso | null) => void>();

function emitir() {
  for (const ouvinte of ouvintes) ouvinte(atual);
}

/** Busca o progresso no backend e avisa todo mundo que exibe. */
export async function recarregarProgresso() {
  try {
    atual = await api.progresso();
  } catch {
    return;
  }
  emitir();
}

/** Zera o cache (logout); as telas escondem a barra pelo `isAuthenticated`. */
export function limparProgresso() {
  atual = null;
  emitir();
}

/**
 * Progresso atual do usuário logado. Devolve o cache na hora (sem piscar) e
 * dispara uma recarga ao montar quando `ativo`.
 */
export function useProgresso(ativo: boolean): Progresso | null {
  const [progresso, setProgresso] = useState<Progresso | null>(atual);

  useEffect(() => {
    if (!ativo) return;
    ouvintes.add(setProgresso);
    recarregarProgresso();
    return () => {
      ouvintes.delete(setProgresso);
    };
  }, [ativo]);

  return progresso;
}
