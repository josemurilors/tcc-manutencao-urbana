/**
 * Fila de operação: carga paginada no servidor (`operacao/fila/`), resumo,
 * filtros e o fallback para o cache quando não há rede.
 *
 * A fila é sempre a do município do usuário (decisão do produto: a operação
 * nunca mistura cidades); quem recorta é o backend.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/context/auth-context';
import { apiOperacao, ehErroDeRede } from '@/services/api-operacao';
import { lerCacheFila, salvarCacheFila } from '@/services/operacao-offline';
import type { ChamadoFila, Coordenada, FiltrosFila, ResumoFila } from '@/types/operacao';

import { sinalizado, venceEm24h } from './regras';

export const FILTROS_PADRAO: FiltrosFila = { ordenar: 'score', atribuicao: 'todos' };

export type EstadoFila = 'carregando' | 'pronto' | 'erro' | 'offline' | 'bloqueado';

/**
 * `vencem_24h` e `sinalizados` não estão na query do contrato: o backend pode
 * ignorá-los, então o recorte também é feito aqui, sobre a página recebida.
 */
function recortar(itens: ChamadoFila[], filtros: FiltrosFila) {
  return itens.filter(
    (c) => (!filtros.vencem_24h || venceEm24h(c)) && (!filtros.sinalizados || sinalizado(c)),
  );
}

/** Une páginas sem repetir chamado (a ordem por score pode mudar entre páginas). */
function unir(atuais: ChamadoFila[], novos: ChamadoFila[]) {
  const vistos = new Set(atuais.map((c) => String(c.id)));
  return [...atuais, ...novos.filter((c) => !vistos.has(String(c.id)))];
}

export function useFila(posicao: Coordenada | null) {
  const { user } = useAuth();
  const usuarioId = user?.id != null ? String(user.id) : null;

  const [filtros, setFiltrosState] = useState<FiltrosFila>(FILTROS_PADRAO);
  const [itens, setItens] = useState<ChamadoFila[]>([]);
  const [count, setCount] = useState(0);
  const [next, setNext] = useState<string | null>(null);
  const [resumo, setResumo] = useState<ResumoFila | null>(null);
  const [estado, setEstado] = useState<EstadoFila>('carregando');
  const [erro, setErro] = useState<string | null>(null);
  /** Quando a tela mostra o cache: a hora em que ele foi salvo. */
  const [cacheDe, setCacheDe] = useState<string | null>(null);
  const [atualizando, setAtualizando] = useState(false);
  const [carregandoMais, setCarregandoMais] = useState(false);
  /** Filtro trocado e a nova página ainda não chegou (a lista antiga fica esmaecida). */
  const [buscando, setBuscando] = useState(false);

  // A posição muda a cada passo; a fila só a lê na hora de buscar.
  const posicaoRef = useRef(posicao);
  useEffect(() => {
    posicaoRef.current = posicao;
  }, [posicao]);
  // Respostas de uma busca antiga (filtro trocado no meio) são descartadas.
  const geracao = useRef(0);

  // Nenhum setState antes do primeiro `await`: a carga roda dentro de efeito.
  const carregar = useCallback(
    async () => {
      const minha = ++geracao.current;
      try {
        const [pagina, novoResumo] = await Promise.all([
          apiOperacao.fila(filtros, 1, posicaoRef.current),
          // O resumo é acessório: se só ele falhar (fora a rede), a fila segue.
          apiOperacao.resumo().catch((err) => {
            if (ehErroDeRede(err)) throw err;
            if (__DEV__) console.warn('[fila] resumo indisponível', err);
            return null;
          }),
        ]);
        if (minha !== geracao.current) return;
        const visiveis = recortar(pagina.results ?? [], filtros);
        setItens(visiveis);
        setCount(pagina.count ?? visiveis.length);
        setNext(pagina.next ?? null);
        setResumo(novoResumo);
        setCacheDe(null);
        setErro(null);
        setEstado('pronto');
        salvarCacheFila({
          usuario_id: usuarioId,
          filtros,
          resultados: visiveis,
          count: pagina.count ?? visiveis.length,
          resumo: novoResumo,
        }).catch((err) => {
          if (__DEV__) console.warn('[fila] cache não salvo', err);
        });
      } catch (err) {
        if (minha !== geracao.current) return;
        const mensagem = err instanceof Error ? err.message : 'Erro ao carregar a fila.';
        if (ehErroDeRede(err)) {
          const cache = await lerCacheFila(usuarioId).catch(() => null);
          if (minha !== geracao.current) return;
          if (cache) {
            setItens(cache.resultados);
            setCount(cache.count);
            setNext(null);
            setResumo(cache.resumo);
            setCacheDe(cache.salvo_em);
            setEstado('pronto');
          } else {
            setEstado('offline');
          }
          return;
        }
        setErro(mensagem);
        // 403 do backend para quem não tem município de operação.
        setEstado(/munic[ií]pio|permiss/i.test(mensagem) ? 'bloqueado' : 'erro');
      } finally {
        if (minha === geracao.current) {
          setAtualizando(false);
          setBuscando(false);
        }
      }
    },
    [filtros, usuarioId],
  );

  useEffect(() => {
    carregar();
  }, [carregar]);

  /** Puxar para atualizar: mostra o indicador do RefreshControl. */
  const puxar = useCallback(() => {
    setAtualizando(true);
    return carregar();
  }, [carregar]);

  const carregarMais = useCallback(async () => {
    if (!next || carregandoMais || cacheDe) return;
    const minha = geracao.current;
    setCarregandoMais(true);
    try {
      const pagina = await apiOperacao.filaPorUrl(next);
      if (minha !== geracao.current) return;
      setItens((atuais) => unir(atuais, recortar(pagina.results ?? [], filtros)));
      setNext(pagina.next ?? null);
    } catch (err) {
      // A lista já carregada continua; o rodapé oferece tentar de novo.
      if (minha === geracao.current) {
        setErro(err instanceof Error ? err.message : 'Erro ao carregar mais.');
      }
    } finally {
      setCarregandoMais(false);
    }
  }, [next, carregandoMais, cacheDe, filtros]);

  const setFiltros = useCallback((mudanca: Partial<FiltrosFila> | ((f: FiltrosFila) => FiltrosFila)) => {
    setFiltrosState((atual) => (typeof mudanca === 'function' ? mudanca(atual) : { ...atual, ...mudanca }));
    setBuscando(true);
  }, []);

  /** Troca o chamado pela versão devolvida pelo servidor (ou um patch otimista). */
  const atualizarItem = useCallback((id: ChamadoFila['id'], patch: Partial<ChamadoFila>) => {
    setItens((atuais) => atuais.map((c) => (String(c.id) === String(id) ? { ...c, ...patch } : c)));
  }, []);

  const recarregarResumo = useCallback(() => {
    apiOperacao
      .resumo()
      .then(setResumo)
      .catch((err) => {
        // Sem resumo novo o topo fica com os números anteriores; não é bloqueante.
        if (__DEV__) console.warn('[fila] resumo', err);
      });
  }, []);

  return {
    filtros,
    setFiltros,
    itens,
    count,
    next,
    resumo,
    estado,
    erro,
    cacheDe,
    atualizando,
    buscando,
    carregandoMais,
    carregar,
    puxar,
    carregarMais,
    atualizarItem,
    recarregarResumo,
  };
}

export type Fila = ReturnType<typeof useFila>;
