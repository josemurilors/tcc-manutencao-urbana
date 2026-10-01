/**
 * Estado da barra de filtros do painel, persistido por usuário.
 *
 * O gestor abre o painel todo dia no mesmo recorte (a secretaria dele, os
 * últimos 30 dias): refazer a escolha a cada visita é atrito. Guardamos o
 * atalho, não as datas — "últimos 30 dias" salvo ontem precisa terminar hoje.
 * Só o período personalizado guarda início e fim.
 *
 * Os rótulos das escolhas (nome da categoria etc.) vão junto para o chip não
 * aparecer como "Categoria #12" enquanto as opções carregam.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import type { BiFiltros, PeriodoRapido } from '@/types/bi';

import { intervaloDoPeriodo } from './formato';

export type RotulosFiltro = { categoria?: string; secretaria?: string; equipe?: string; bairro?: string };

type Salvo = { filtros: BiFiltros; rotulos: RotulosFiltro };

const CHAVE = (usuario: string | number | undefined) => `ciu.painel.filtros.${usuario ?? 'anon'}`;

export function filtrosPadrao(): BiFiltros {
  return { periodo: '30d', ...intervaloDoPeriodo('30d') };
}

/** Recalcula as datas de um atalho para terminar hoje. */
function atualizarDatas(f: BiFiltros): BiFiltros {
  if (f.periodo === 'personalizado') return f;
  return { ...f, ...intervaloDoPeriodo(f.periodo) };
}

export function useFiltrosBi(usuarioId: string | number | undefined) {
  const [estado, setEstado] = useState<Salvo>(() => ({ filtros: filtrosPadrao(), rotulos: {} }));
  // Enquanto lê o salvo, o painel não dispara as consultas com o padrão (e
  // depois de novo com o salvo): seria o dobro de requisições e um "pisca".
  const [pronto, setPronto] = useState(false);
  // Só grava depois de uma escolha do usuário, nunca o padrão por cima do salvo.
  const [alterado, setAlterado] = useState(false);
  const [erroPersistencia, setErroPersistencia] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    AsyncStorage.getItem(CHAVE(usuarioId))
      .then((bruto) => {
        if (cancelado || !bruto) return;
        const salvo = JSON.parse(bruto) as Partial<Salvo>;
        if (salvo.filtros?.inicio && salvo.filtros?.fim && salvo.filtros?.periodo) {
          setEstado({ filtros: atualizarDatas(salvo.filtros), rotulos: salvo.rotulos ?? {} });
        }
      })
      .catch((err: unknown) => {
        // Preferência corrompida ou armazenamento indisponível: segue com o
        // padrão, mas avisa a tela (o gestor perderia o recorte sem saber).
        if (!cancelado) setErroPersistencia(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelado) setPronto(true);
      });
    return () => {
      cancelado = true;
    };
  }, [usuarioId]);

  useEffect(() => {
    if (!alterado) return;
    AsyncStorage.setItem(CHAVE(usuarioId), JSON.stringify(estado)).catch((err: unknown) =>
      setErroPersistencia(err instanceof Error ? err.message : String(err)),
    );
  }, [estado, alterado, usuarioId]);

  const aplicar = useCallback((mudanca: Partial<BiFiltros>, rotulosNovos?: Partial<RotulosFiltro>) => {
    setAlterado(true);
    setEstado((atual) => ({
      filtros: { ...atual.filtros, ...mudanca },
      rotulos: { ...atual.rotulos, ...rotulosNovos },
    }));
  }, []);

  const escolherPeriodo = useCallback(
    (p: Exclude<PeriodoRapido, 'personalizado'>) => aplicar({ periodo: p, ...intervaloDoPeriodo(p) }),
    [aplicar],
  );

  const limparRecortes = useCallback(
    () =>
      aplicar(
        { categoria_id: null, secretaria_id: null, equipe_id: null, bairro: null },
        { categoria: undefined, secretaria: undefined, equipe: undefined, bairro: undefined },
      ),
    [aplicar],
  );

  return {
    filtros: estado.filtros,
    rotulos: estado.rotulos,
    pronto,
    erroPersistencia,
    aplicar,
    escolherPeriodo,
    limparRecortes,
  };
}
