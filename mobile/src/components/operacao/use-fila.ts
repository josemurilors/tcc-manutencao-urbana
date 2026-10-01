/**
 * Fila de operação: carga paginada no servidor (`operacao/fila/`), resumo,
 * filtros e o fallback para o cache quando não há rede.
 *
 * A fila é sempre a do município do usuário (decisão do produto: a operação
 * nunca mistura cidades); quem recorta é o backend.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { normalizarStatus, STATUS_ABERTOS, STATUS_FECHADOS } from '@/constants/status';
import { useAuth } from '@/context/auth-context';
import { apiOperacao, ehErroDeRede, type ResumoOperacao } from '@/services/api-operacao';
import { lerCacheFila, salvarCacheFila, type CacheFila } from '@/services/operacao-offline';
import type { ChamadoFila, Coordenada, FiltrosFila } from '@/types/operacao';

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

/** Status pedidos pelo filtro, como o backend expande (`abertos` quando vazio). */
function statusDoFiltro(status: string | undefined): Set<string> {
  const grupos: Record<string, string[]> = {
    abertos: STATUS_ABERTOS,
    fechados: STATUS_FECHADOS,
    todos: [...STATUS_ABERTOS, ...STATUS_FECHADOS],
  };
  const estados = new Set<string>();
  for (const s of (status || 'abertos').split(',').map((p) => p.trim()).filter(Boolean)) {
    (grupos[s] ?? [normalizarStatus(s)]).forEach((e) => estados.add(e));
  }
  return estados;
}

const texto = (v: unknown) => (v == null ? '' : String(v).trim().toLowerCase());

/**
 * O cache salvo contém tudo o que os filtros atuais pedem? Vale quando cada
 * recorte do cache é igual ao atual ou mais largo ("Todos" cobre "Vencidos",
 * o contrário não). "Da minha equipe" não dá para conferir no aparelho.
 */
function cacheCobre(salvo: FiltrosFila, atual: FiltrosFila) {
  const statusSalvo = statusDoFiltro(salvo.status);
  const mesmo = (a: unknown, b: unknown) => a == null || a === '' || texto(a) === texto(b);
  return (
    [...statusDoFiltro(atual.status)].every((s) => statusSalvo.has(s)) &&
    mesmo(salvo.categoria_id, atual.categoria_id) &&
    mesmo(salvo.equipe_id, atual.equipe_id) &&
    mesmo(salvo.bairro, atual.bairro) &&
    mesmo(salvo.q, atual.q) &&
    (!salvo.atribuicao || salvo.atribuicao === 'todos' || salvo.atribuicao === atual.atribuicao) &&
    (atual.atribuicao !== 'equipe' || salvo.atribuicao === 'equipe') &&
    (!salvo.vencidos || !!atual.vencidos) &&
    (!salvo.vencem_24h || !!atual.vencem_24h) &&
    (!salvo.sinalizados || !!atual.sinalizados)
  );
}

/** Mesmos recortes (a ordenação não muda quais chamados entram). */
function mesmosFiltros(a: FiltrosFila, b: FiltrosFila) {
  return cacheCobre(a, b) && cacheCobre(b, a);
}

/**
 * Sem rede, os filtros atuais são aplicados sobre o cache, o que dá para
 * conferir no aparelho (mesmas regras do `_filtrar_fila` do backend). Sem
 * isso, tocar em "Vencidos" offline mostrava a fila de "Todos" com o chip
 * novo aceso. Quando o recorte é outro, `aviso` diz isso na faixa offline.
 */
function filtrarCache(cache: CacheFila, filtros: FiltrosFila, usuarioId: string | null) {
  const estados = statusDoFiltro(filtros.status);
  const agora = Date.now();
  const termo = texto(filtros.q);
  const itens = recortar(cache.resultados, filtros).filter((c) => {
    if (!estados.has(normalizarStatus(c.status))) return false;
    if (filtros.categoria_id != null && c.categoria_id !== filtros.categoria_id) return false;
    if (filtros.equipe_id != null && c.equipe_id !== filtros.equipe_id) return false;
    if (filtros.atribuicao === 'meus' && (c.atendente_id == null || String(c.atendente_id) !== usuarioId)) {
      return false;
    }
    if (filtros.atribuicao === 'sem' && (c.atendente_id != null || c.equipe_id != null)) return false;
    if (filtros.vencidos) {
      const aberto = STATUS_ABERTOS.includes(normalizarStatus(c.status));
      if (!aberto || !c.prazo_em || Date.parse(c.prazo_em) >= agora) return false;
    }
    if (filtros.bairro && texto(c.bairro) !== texto(filtros.bairro)) return false;
    if (
      termo &&
      ![c.protocolo, c.titulo, c.descricao, c.rua, c.bairro].some((v) => texto(v).includes(termo))
    ) {
      return false;
    }
    return true;
  });
  const salvo = cache.filtros ?? FILTROS_PADRAO;
  const igual = mesmosFiltros(salvo, filtros);
  let aviso: string | null = null;
  if (!cacheCobre(salvo, filtros)) aviso = 'a fila salva usava outro filtro: pode faltar chamado';
  else if (!igual) aviso = 'filtro aplicado sobre a última fila salva';
  return { itens, count: igual ? cache.count : itens.length, aviso };
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
  const [resumo, setResumo] = useState<ResumoOperacao | null>(null);
  const [estado, setEstado] = useState<EstadoFila>('carregando');
  const [erro, setErro] = useState<string | null>(null);
  /** Quando a tela mostra o cache: a hora em que ele foi salvo. */
  const [cacheDe, setCacheDe] = useState<string | null>(null);
  /** Com cache: o recorte exibido difere do salvo (ver `filtrarCache`). */
  const [cacheAviso, setCacheAviso] = useState<string | null>(null);
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
  // A primeira carga costuma sair antes do GPS responder: a fila vem sem
  // `distancia_m`. Quando a posição chega, recarrega uma vez para o cartão
  // mostrar a distância e a ordenação "Mais perto" ficar disponível.
  const carregouSemPosicao = useRef(false);

  // Nenhum setState antes do primeiro `await`: a carga roda dentro de efeito.
  const carregar = useCallback(
    async () => {
      const minha = ++geracao.current;
      carregouSemPosicao.current = !posicaoRef.current;
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
        setCacheAviso(null);
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
            const recorte = filtrarCache(cache, filtros, usuarioId);
            setItens(recorte.itens);
            setCount(recorte.count);
            setNext(null);
            setResumo(cache.resumo);
            setCacheDe(cache.salvo_em);
            setCacheAviso(recorte.aviso);
            setEstado('pronto');
          } else {
            setEstado('offline');
          }
          return;
        }
        setErro(mensagem);
        // 403 do backend para quem não tem município de operação.
        setEstado(/munic[ií]pio|permiss|equipe da prefeitura/i.test(mensagem) ? 'bloqueado' : 'erro');
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

  const temPosicao = posicao != null;
  useEffect(() => {
    if (temPosicao && carregouSemPosicao.current) carregar();
  }, [temPosicao, carregar]);

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
    cacheAviso,
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
