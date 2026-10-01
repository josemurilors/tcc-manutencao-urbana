/**
 * Preferências do mapa guardadas no aparelho: filtros da folha "Camadas",
 * legenda aberta/recolhida e se as dicas de primeira vez já foram vistas.
 *
 * Tudo é conveniência: se o AsyncStorage falhar (web em aba anônima, cota),
 * o mapa segue com o padrão e a falha só vai para o log — não há o que a
 * pessoa possa fazer com um aviso na tela.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import { FILTROS_PADRAO, type FiltrosMapa, type SituacaoMapa } from '@/types/mapa';

const CHAVE_FILTROS = 'ciu_mapa_filtros_v1';
const CHAVE_LEGENDA = 'ciu_mapa_legenda_aberta_v1';
const CHAVE_DICAS = 'ciu_mapa_dicas_vistas_v1';

const SITUACOES: SituacaoMapa[] = ['abertos', 'resolvidos', 'todos'];

function avisar(acao: string, err: unknown) {
  console.warn(`[mapa] não foi possível ${acao} as preferências do mapa`, err);
}

/** Valida o que veio do disco: versão antiga ou JSON torto cai no padrão. */
function lerFiltros(bruto: string | null): FiltrosMapa {
  if (!bruto) return FILTROS_PADRAO;
  try {
    const v = JSON.parse(bruto) as Partial<FiltrosMapa>;
    return {
      situacao: SITUACOES.includes(v.situacao as SituacaoMapa)
        ? (v.situacao as SituacaoMapa)
        : FILTROS_PADRAO.situacao,
      categorias: Array.isArray(v.categorias)
        ? v.categorias.filter((n): n is number => typeof n === 'number')
        : [],
      calor: typeof v.calor === 'boolean' ? v.calor : FILTROS_PADRAO.calor,
    };
  } catch (err) {
    avisar('ler', err);
    return FILTROS_PADRAO;
  }
}

/** Filtros do mapa com persistência; `carregado` evita buscar duas vezes no boot. */
export function useFiltrosMapa() {
  const [filtros, setFiltrosEstado] = useState<FiltrosMapa>(FILTROS_PADRAO);
  const [carregado, setCarregado] = useState(false);

  useEffect(() => {
    let cancelado = false;
    AsyncStorage.getItem(CHAVE_FILTROS)
      .then((bruto) => {
        if (!cancelado) setFiltrosEstado(lerFiltros(bruto));
      })
      .catch((err) => avisar('ler', err))
      .finally(() => {
        if (!cancelado) setCarregado(true);
      });
    return () => {
      cancelado = true;
    };
  }, []);

  const setFiltros = useCallback((proximos: FiltrosMapa) => {
    setFiltrosEstado(proximos);
    AsyncStorage.setItem(CHAVE_FILTROS, JSON.stringify(proximos)).catch((err) =>
      avisar('salvar', err),
    );
  }, []);

  return { filtros, setFiltros, carregado };
}

/** Flag booleana persistida (legenda aberta, dicas vistas). `null` = ainda lendo. */
function useFlagPersistida(chave: string, padrao: boolean) {
  const [valor, setValorEstado] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelado = false;
    AsyncStorage.getItem(chave)
      .then((v) => {
        if (!cancelado) setValorEstado(v == null ? padrao : v === '1');
      })
      .catch((err) => {
        avisar('ler', err);
        if (!cancelado) setValorEstado(padrao);
      });
    return () => {
      cancelado = true;
    };
  }, [chave, padrao]);

  const setValor = useCallback(
    (v: boolean) => {
      setValorEstado(v);
      AsyncStorage.setItem(chave, v ? '1' : '0').catch((err) => avisar('salvar', err));
    },
    [chave],
  );

  return [valor, setValor] as const;
}

/** Legenda começa aberta na primeira vez e lembra se a pessoa recolheu. */
export function useLegendaAberta() {
  return useFlagPersistida(CHAVE_LEGENDA, true);
}

/** Dicas de primeira vez do mapa. */
export function useDicasVistas() {
  return useFlagPersistida(CHAVE_DICAS, false);
}

/** Quantos filtros fogem do padrão (vai no selo do botão "Camadas"). */
export function filtrosAtivos(f: FiltrosMapa) {
  return (f.situacao !== 'abertos' ? 1 : 0) + (f.categorias.length > 0 ? 1 : 0) + (f.calor ? 1 : 0);
}
