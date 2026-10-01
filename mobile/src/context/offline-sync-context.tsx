/**
 * Sincronização da fila offline — uma instância para o app inteiro.
 *
 * Antes o `useOfflineSync` só rodava dentro do `SyncIndicator`, que só aparecia
 * num header que nenhuma tela usava: a fila nunca era drenada. Agora o provider
 * fica no layout raiz e roda sempre que o app volta ao primeiro plano, a rede
 * volta, o usuário loga ou chega a hora de uma nova tentativa.
 *
 * Como cada erro é tratado:
 * - rede: nova tentativa com espera crescente (`esperaAposTentativas`) e para
 *   o lote — sem conexão não adianta tentar os próximos;
 * - sessão expirada: para sem contar tentativa; volta quando houver login;
 * - recusa do backend (409 duplicado, 400/422 validação): vira `falhou`, com a
 *   mensagem, visível na folha da fila — sem travar os itens seguintes;
 * - qualquer outro erro do servidor: tenta de novo com espera; depois de
 *   `MAX_TENTATIVAS_AMBIGUAS` vira `falhou` (continua na fila, nunca some).
 */

import * as Network from 'expo-network';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/context/auth-context';
import { useToast } from '@/context/toast-context';
import { DefeitoDuplicadoError, postDefeitoDireto } from '@/services/api';
import {
  esperaAposTentativas,
  fotoExiste,
  getQueue,
  onQueueChange,
  removeFromQueue,
  updateQueueItem,
  type PendingDefeito,
} from '@/services/offline-queue';
import { getTokenSync } from '@/services/storage';

/**
 * Sem o código HTTP (o `request` de api.ts só repassa a mensagem), um erro
 * genérico pode ser 400 ou 500. Tentamos algumas vezes antes de mostrar como
 * falha, para não desistir de um chamado por instabilidade passageira.
 */
const MAX_TENTATIVAS_AMBIGUAS = 3;

export type SyncState = {
  /** Itens do usuário atual aguardando envio. */
  pendentes: number;
  /** Itens recusados ou que esgotaram as tentativas; pedem ação do usuário. */
  falhas: number;
  sincronizando: boolean;
  online: boolean;
  itens: PendingDefeito[];
};

type ContextValue = SyncState & {
  /** `forcar` ignora a espera entre tentativas (toque do usuário). */
  sincronizar: (opcoes?: { forcar?: boolean }) => Promise<void>;
  /** Mantido da versão anterior: relê a fila e devolve os itens. */
  atualizarPendentes: () => Promise<PendingDefeito[]>;
  tentarDeNovo: (id: string) => Promise<void>;
  descartar: (id: string) => Promise<void>;
  painelAberto: boolean;
  abrirPainel: () => void;
  fecharPainel: () => void;
};

const OfflineSyncContext = createContext<ContextValue | null>(null);

type TipoErro = 'rede' | 'sessao' | 'recusado' | 'servidor';

function classificar(err: unknown): TipoErro {
  // Preparado para quando o api.ts passar a anexar o status ao erro.
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status === 'number') {
    if (status === 401 || status === 403) return 'sessao';
    if (status === 400 || status === 409 || status === 422) return 'recusado';
    return 'servidor';
  }
  if (err instanceof DefeitoDuplicadoError) return 'recusado';
  const msg = err instanceof Error ? err.message : String(err);
  if (msg === 'Network request failed' || msg === 'Failed to fetch' || msg.includes('NetworkError')) {
    return 'rede';
  }
  if (msg.startsWith('Sessão expirada')) return 'sessao';
  return 'servidor';
}

function plural(n: number, um: string, varios: string) {
  return `${n} ${n === 1 ? um : varios}`;
}

function estaOnline(status: Network.NetworkState) {
  return !!status.isConnected && status.isInternetReachable !== false;
}

export function OfflineSyncProvider({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  const toast = useToast();
  const usuarioId = user?.id != null ? String(user.id) : null;

  const [itens, setItens] = useState<PendingDefeito[]>([]);
  const [online, setOnline] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [painelAberto, setPainelAberto] = useState(false);
  const rodando = useRef(false);
  const agendado = useRef<ReturnType<typeof setTimeout> | null>(null);
  // O agendamento chama a versão mais recente de `sincronizar` sem recriar o timer.
  const sincronizarRef = useRef<(opcoes?: { forcar?: boolean }) => Promise<void>>(async () => {});

  /** Itens visíveis para quem está logado (os sem dono vieram de versão antiga). */
  const doUsuario = useCallback(
    (fila: PendingDefeito[]) =>
      fila.filter((i) => !i.usuario_id || (usuarioId && i.usuario_id === usuarioId)),
    [usuarioId],
  );

  const atualizarPendentes = useCallback(async () => {
    const fila = doUsuario(await getQueue());
    setItens(fila);
    return fila;
  }, [doUsuario]);

  const agendarProxima = useCallback((fila: PendingDefeito[]) => {
    if (agendado.current) clearTimeout(agendado.current);
    agendado.current = null;
    // Item sem data marcada (acabou de entrar na fila, ou o lote parou antes
    // dele) é tentado de novo em 30 s, mesmo sem evento de rede.
    const proximas = fila
      .filter((i) => (i.status ?? 'pendente') === 'pendente')
      .map((i) => (i.proxima_tentativa_em ? Date.parse(i.proxima_tentativa_em) : Date.now() + 30_000));
    if (proximas.length === 0) return;
    const espera = Math.max(1000, Math.min(...proximas) - Date.now());
    agendado.current = setTimeout(() => sincronizarRef.current(), espera);
  }, []);

  const sincronizar = useCallback(
    async ({ forcar = false }: { forcar?: boolean } = {}) => {
      // Sem token não adianta tentar: o backend exige autenticação para criar.
      if (rodando.current || !getTokenSync() || !usuarioId) return;
      rodando.current = true;
      try {
        const rede = await Network.getNetworkStateAsync().catch(() => null);
        const conectado = rede ? estaOnline(rede) : true;
        setOnline(conectado);
        if (!conectado) return;

        const agora = Date.now();
        const fila = doUsuario(await getQueue()).filter(
          (i) =>
            (i.status ?? 'pendente') === 'pendente' &&
            (forcar || !i.proxima_tentativa_em || Date.parse(i.proxima_tentativa_em) <= agora),
        );
        if (fila.length === 0) return;

        setSincronizando(true);
        let enviados = 0;
        let novasFalhas = 0;

        for (const item of fila) {
          if (!fotoExiste(item)) {
            // O backend não aceita chamado sem foto: em vez de descartar em
            // silêncio (como antes), mostra o que houve e deixa decidir.
            await updateQueueItem(item.id, {
              status: 'falhou',
              erro: 'A foto se perdeu. Descarte e reporte de novo com outra foto.',
            });
            novasFalhas++;
            continue;
          }
          try {
            // Itens antigos não têm usuario_id: passam a pertencer a quem enviou.
            await postDefeitoDireto(item);
            await removeFromQueue(item.id);
            enviados++;
          } catch (err) {
            const tipo = classificar(err);
            const mensagem = err instanceof Error ? err.message : 'Erro ao enviar.';
            const tentativas = (item.tentativas ?? 0) + 1;

            if (tipo === 'sessao') break;
            if (tipo === 'recusado' || (tipo === 'servidor' && tentativas >= MAX_TENTATIVAS_AMBIGUAS)) {
              await updateQueueItem(item.id, { status: 'falhou', erro: mensagem, tentativas });
              novasFalhas++;
              continue;
            }
            await updateQueueItem(item.id, {
              tentativas,
              erro: mensagem,
              proxima_tentativa_em: new Date(Date.now() + esperaAposTentativas(tentativas)).toISOString(),
            });
            if (tipo === 'rede') {
              setOnline(false);
              break;
            }
          }
        }

        if (enviados > 0) {
          toast.success(`${plural(enviados, 'chamado enviado', 'chamados enviados')} da fila offline.`);
        }
        if (novasFalhas > 0) {
          toast.error(
            `${plural(novasFalhas, 'chamado não pôde', 'chamados não puderam')} ser enviado${novasFalhas === 1 ? '' : 's'}.`,
            { action: { label: 'Ver', onPress: () => setPainelAberto(true) } },
          );
        }
      } catch (err) {
        // Falha ao ler/gravar a fila (AsyncStorage): nada foi perdido, só
        // não sincronizou desta vez. A próxima rodada tenta de novo.
        if (__DEV__) console.warn('[offline-sync]', err);
      } finally {
        rodando.current = false;
        setSincronizando(false);
        agendarProxima(await atualizarPendentes().catch(() => []));
      }
    },
    [usuarioId, doUsuario, atualizarPendentes, agendarProxima, toast],
  );

  useEffect(() => {
    sincronizarRef.current = sincronizar;
  }, [sincronizar]);

  const tentarDeNovo = useCallback(
    async (id: string) => {
      await updateQueueItem(id, {
        status: 'pendente',
        tentativas: 0,
        proxima_tentativa_em: null,
        erro: null,
      });
      await sincronizar({ forcar: true });
    },
    [sincronizar],
  );

  const descartar = useCallback(
    async (id: string) => {
      await removeFromQueue(id);
      await atualizarPendentes();
    },
    [atualizarPendentes],
  );

  // Dispara no boot, a cada login/troca de usuário, ao voltar ao primeiro
  // plano e quando a conexão retorna.
  useEffect(() => {
    if (!isAuthenticated) {
      // Deslogado: some a lista da tela, mas a fila fica guardada para o dono.
      if (agendado.current) clearTimeout(agendado.current);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setItens([]);
      return;
    }
    sincronizar();

    const appState = AppState.addEventListener('change', (status) => {
      if (status === 'active') sincronizar();
    });
    const rede = Network.addNetworkStateListener((status) => {
      const conectado = estaOnline(status);
      setOnline(conectado);
      if (conectado) sincronizar({ forcar: true });
    });

    return () => {
      appState.remove();
      rede.remove();
    };
  }, [isAuthenticated, sincronizar]);

  // Chamado salvo offline pela tela de novo chamado aparece na hora no indicador.
  useEffect(() => {
    if (!isAuthenticated) return;
    return onQueueChange(() => {
      atualizarPendentes()
        .then((fila) => {
          // Durante o sync quem reagenda é o próprio sync, no fim do lote.
          if (!rodando.current) agendarProxima(fila);
        })
        .catch(() => {});
    });
  }, [isAuthenticated, atualizarPendentes, agendarProxima]);

  useEffect(
    () => () => {
      if (agendado.current) clearTimeout(agendado.current);
    },
    [],
  );

  const abrirPainel = useCallback(() => setPainelAberto(true), []);
  const fecharPainel = useCallback(() => setPainelAberto(false), []);

  const value = useMemo<ContextValue>(
    () => ({
      itens,
      pendentes: itens.filter((i) => (i.status ?? 'pendente') === 'pendente').length,
      falhas: itens.filter((i) => i.status === 'falhou').length,
      online,
      sincronizando,
      sincronizar,
      atualizarPendentes,
      tentarDeNovo,
      descartar,
      painelAberto,
      abrirPainel,
      fecharPainel,
    }),
    [
      itens,
      online,
      sincronizando,
      sincronizar,
      atualizarPendentes,
      tentarDeNovo,
      descartar,
      painelAberto,
      abrirPainel,
      fecharPainel,
    ],
  );

  return <OfflineSyncContext.Provider value={value}>{children}</OfflineSyncContext.Provider>;
}

export function useOfflineSyncContext() {
  const ctx = useContext(OfflineSyncContext);
  if (!ctx) throw new Error('useOfflineSync precisa estar dentro de <OfflineSyncProvider>');
  return ctx;
}
