/**
 * Estado e drenagem da fila de ações offline da operação.
 *
 * Mesmo padrão do `OfflineSyncProvider` do cidadão: tenta ao montar, quando o
 * app volta ao primeiro plano, quando a rede volta e na hora agendada da
 * próxima tentativa. Roda **uma vez para o app inteiro**, pelo
 * `OperacaoSyncProvider` do layout raiz (`context/offline-sync-context.tsx`):
 * antes morava na aba Operação e só drenava enquanto ela estava montada —
 * quem registrava algo offline e ia para o mapa ou o painel ficava com a
 * ação parada até voltar à aba.
 *
 * Só liga para a equipe (operador+): o cidadão não tem ações de operação e
 * não paga a leitura do AsyncStorage a cada volta ao primeiro plano.
 */

import * as Network from 'expo-network';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { ehEquipe, useAuth } from '@/context/auth-context';
import { useToast } from '@/context/toast-context';
import {
  drenarAcoes,
  idsDaAcao,
  listarAcoes,
  onAcoesChange,
  proximaTentativaEm,
  reativarAcao,
  removerAcao,
  type AcaoPendente,
} from '@/services/operacao-offline';

function plural(n: number, um: string, varios: string) {
  return `${n} ${n === 1 ? um : varios}`;
}

export function useSyncOperacaoEstado() {
  const { user, isAuthenticated } = useAuth();
  const toast = useToast();
  const ativo = isAuthenticated && ehEquipe(user);
  const usuarioId = ativo && user?.id != null ? String(user.id) : null;

  const [acoes, setAcoes] = useState<AcaoPendente[]>([]);
  const [online, setOnline] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [painelAberto, setPainelAberto] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sincronizarRef = useRef<(forcar?: boolean) => Promise<void>>(async () => {});
  // Telas que querem recarregar quando algo da fila chega ao servidor (a fila
  // da Operação, por exemplo). Fora do estado: não re-renderiza ninguém.
  const ouvintesEnvio = useRef(new Set<() => void>());

  const reler = useCallback(async () => {
    const lista = usuarioId ? await listarAcoes(usuarioId) : [];
    setAcoes(lista);
    return lista;
  }, [usuarioId]);

  const agendar = useCallback((lista: AcaoPendente[]) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const espera = proximaTentativaEm(lista);
    if (espera != null) timer.current = setTimeout(() => sincronizarRef.current(), espera);
  }, []);

  const sincronizar = useCallback(
    async (forcar = false) => {
      if (!usuarioId) return;
      const pendentes = (await reler()).filter((a) => a.status === 'pendente');
      if (pendentes.length === 0) return;
      setSincronizando(true);
      try {
        const r = await drenarAcoes(usuarioId, { forcar });
        if (r.semRede) setOnline(false);
        if (r.enviadas > 0) {
          setOnline(true);
          toast.success(`${plural(r.enviadas, 'ação enviada', 'ações enviadas')} da fila offline.`);
          ouvintesEnvio.current.forEach((o) => o());
        }
        if (r.falhas > 0) {
          toast.error(
            `${plural(r.falhas, 'ação não pôde', 'ações não puderam')} ser enviada${r.falhas === 1 ? '' : 's'}.`,
            { action: { label: 'Ver', onPress: () => setPainelAberto(true) } },
          );
        }
      } catch (err) {
        // Falha ao ler/gravar o AsyncStorage: nada se perdeu, a próxima rodada tenta.
        if (__DEV__) console.warn('[sync-operacao]', err);
      } finally {
        setSincronizando(false);
        agendar(await reler().catch(() => []));
      }
    },
    [usuarioId, reler, agendar, toast],
  );

  useEffect(() => {
    sincronizarRef.current = sincronizar;
  }, [sincronizar]);

  useEffect(() => {
    if (!usuarioId) {
      // Deslogou ou deixou de ser da equipe: some da tela, mas a fila fica
      // guardada para o dono (cada item tem `usuario_id`).
      if (timer.current) clearTimeout(timer.current);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAcoes([]);
      setPainelAberto(false);
      return;
    }
    sincronizarRef.current();
    const app = AppState.addEventListener('change', (s) => {
      if (s === 'active') sincronizarRef.current();
    });
    const rede = Network.addNetworkStateListener((s) => {
      const conectado = !!s.isConnected && s.isInternetReachable !== false;
      setOnline(conectado);
      if (conectado) sincronizarRef.current(true);
    });
    const desinscrever = onAcoesChange(() => {
      reler()
        .then(agendar)
        .catch((err) => {
          if (__DEV__) console.warn('[sync-operacao] releitura', err);
        });
    });
    return () => {
      app.remove();
      rede.remove();
      desinscrever();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [usuarioId, reler, agendar]);

  const tentarDeNovo = useCallback(
    async (id: string) => {
      await reativarAcao(id);
      await sincronizar(true);
    },
    [sincronizar],
  );

  const descartar = useCallback(
    async (id: string) => {
      await removerAcao(id);
      await reler();
    },
    [reler],
  );

  /** Avisa quando ações da fila chegam ao servidor; devolve o cancelamento. */
  const aoEnviar = useCallback((ouvinte: () => void) => {
    const ouvintes = ouvintesEnvio.current;
    ouvintes.add(ouvinte);
    return () => {
      ouvintes.delete(ouvinte);
    };
  }, []);

  /** Chamados com alguma ação ainda não enviada (selo "envio pendente"). */
  const idsPendentes = useMemo(() => {
    const ids = new Set<string>();
    for (const a of acoes) idsDaAcao(a.acao).forEach((id) => ids.add(id));
    return ids;
  }, [acoes]);

  const abrirPainel = useCallback(() => setPainelAberto(true), []);
  const fecharPainel = useCallback(() => setPainelAberto(false), []);

  return useMemo(
    () => ({
      ativo: !!usuarioId,
      acoes,
      pendentes: acoes.filter((a) => a.status === 'pendente').length,
      falhas: acoes.filter((a) => a.status === 'falhou').length,
      idsPendentes,
      online,
      setOnline,
      sincronizando,
      sincronizar,
      tentarDeNovo,
      descartar,
      aoEnviar,
      painelAberto,
      abrirPainel,
      fecharPainel,
    }),
    [
      usuarioId,
      acoes,
      idsPendentes,
      online,
      sincronizando,
      sincronizar,
      tentarDeNovo,
      descartar,
      aoEnviar,
      painelAberto,
      abrirPainel,
      fecharPainel,
    ],
  );
}

export type SyncOperacao = ReturnType<typeof useSyncOperacaoEstado>;
