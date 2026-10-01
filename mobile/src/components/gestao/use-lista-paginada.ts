/**
 * Lista paginada (formato DRF) com rolagem infinita, puxar para atualizar e
 * os estados do design system (carregando / erro / sem rede).
 *
 * `chave` identifica a consulta (filtros serializados): mudou, a tela volta
 * ao esqueleto e busca a página 1. O resultado guarda a chave de onde veio e
 * respostas atrasadas de uma consulta anterior são descartadas — sem isso,
 * digitar rápido na busca podia deixar na tela o resultado de "an" depois do
 * de "ana".
 */

import { useEffect, useEffectEvent, useRef, useState } from 'react';

import type { Pagina } from '@/types/gestao';

import { ehErroDeRede, mensagemDeErro } from './confirmar';
import { useMunicipioGestao } from './municipio-gestao';

export type EstadoLista = 'carregando' | 'pronto' | 'erro' | 'offline';

type Resultado<T> = {
  /** Consulta (chave + versão) que produziu este resultado. */
  origem: string;
  itens: T[];
  total: number;
  pagina: number;
  temMais: boolean;
  estado: Exclude<EstadoLista, 'carregando'>;
  erro: string;
};

export function useListaPaginada<T>(
  buscar: (page: number) => Promise<Pagina<T>>,
  chave: string,
) {
  const [versao, setVersao] = useState(0);
  const [res, setRes] = useState<Resultado<T> | null>(null);
  const [atualizando, setAtualizando] = useState(false);
  const [carregandoMais, setCarregandoMais] = useState(false);
  // Pedido de "mais" em andamento: evita duas páginas iguais quando o
  // onEndReached dispara duas vezes seguidas.
  const pedindoMais = useRef(false);

  // Trocar o município (super_admin) é outra consulta: volta à página 1.
  const municipio = useMunicipioGestao()?.codigo ?? '';
  const origem = `${chave}@${municipio}#${versao}`;
  const buscarAgora = useEffectEvent((page: number) => buscar(page));

  useEffect(() => {
    let cancelado = false;
    buscarAgora(1).then(
      (p) => {
        if (cancelado) return;
        setRes({
          origem,
          itens: p.results,
          total: p.count,
          pagina: 1,
          temMais: !!p.next,
          estado: 'pronto',
          erro: '',
        });
        setAtualizando(false);
      },
      (err: unknown) => {
        if (cancelado) return;
        setRes({
          origem,
          itens: [],
          total: 0,
          pagina: 0,
          temMais: false,
          estado: ehErroDeRede(err) ? 'offline' : 'erro',
          erro: mensagemDeErro(err),
        });
        setAtualizando(false);
      },
    );
    return () => {
      cancelado = true;
    };
  }, [origem]);

  // Puxar para atualizar mantém a lista anterior na tela enquanto busca.
  const atual = res && (res.origem === origem || atualizando) ? res : null;
  const estado: EstadoLista = atual ? atual.estado : 'carregando';

  async function carregarMais() {
    if (!atual || !atual.temMais || atual.estado !== 'pronto' || pedindoMais.current) return;
    pedindoMais.current = true;
    setCarregandoMais(true);
    const daOrigem = atual.origem;
    try {
      const p = await buscar(atual.pagina + 1);
      setRes((r) =>
        r && r.origem === daOrigem
          ? {
              ...r,
              itens: [...r.itens, ...p.results],
              pagina: r.pagina + 1,
              temMais: !!p.next,
            }
          : r,
      );
    } catch (err) {
      // Falha só na página seguinte: mantém o que já está na tela e para de
      // pedir mais (o usuário pode puxar para atualizar).
      console.warn('[lista] próxima página falhou:', err);
      setRes((r) => (r && r.origem === daOrigem ? { ...r, temMais: false } : r));
    } finally {
      pedindoMais.current = false;
      setCarregandoMais(false);
    }
  }

  /** Troca (ou remove, com `null`) um item já carregado sem recarregar. */
  function substituir(filtro: (item: T) => boolean, novo: T | null) {
    setRes((r) =>
      r
        ? {
            ...r,
            itens:
              novo === null ? r.itens.filter((i) => !filtro(i)) : r.itens.map((i) => (filtro(i) ? novo : i)),
            total: novo === null ? Math.max(0, r.total - 1) : r.total,
          }
        : r,
    );
  }

  return {
    itens: atual?.itens ?? [],
    total: atual?.total ?? 0,
    estado,
    erro: atual?.erro ?? '',
    temMais: !!atual?.temMais,
    carregandoMais,
    atualizando,
    carregarMais,
    /** Volta ao esqueleto e busca a página 1 ("Tentar de novo", depois de convidar). */
    recarregar: () => {
      setRes(null);
      setVersao((v) => v + 1);
    },
    /** Busca a página 1 mantendo a lista na tela (puxar para atualizar). */
    atualizar: () => {
      setAtualizando(true);
      setVersao((v) => v + 1);
    },
    substituir,
  };
}
