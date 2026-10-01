/**
 * Estado e drenagem da fila de ações offline da operação.
 *
 * Mesmo padrão do `OfflineSyncProvider` do cidadão: tenta ao montar, quando o
 * app volta ao primeiro plano, quando a rede volta e na hora agendada da
 * próxima tentativa. Mora na aba Operação (que fica montada depois da primeira
 * visita), porque só a equipe usa.
 */

import * as Network from 'expo-network';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/context/auth-context';
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

export function useSyncOperacao(onEnviou?: () => void) {
  const { user } = useAuth();
  const toast = useToast();
  const usuarioId = user?.id != null ? String(user.id) : null;

  const [acoes, setAcoes] = useState<AcaoPendente[]>([]);
  const [online, setOnline] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEnviouRef = useRef(onEnviou);
  const sincronizarRef = useRef<(forcar?: boolean) => Promise<void>>(async () => {});

  useEffect(() => {
    onEnviouRef.current = onEnviou;
  }, [onEnviou]);

  const reler = useCallback(async () => {
    const lista = await listarAcoes(usuarioId);
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
          onEnviouRef.current?.();
        }
        if (r.falhas > 0) {
          toast.error(
            `${plural(r.falhas, 'ação não pôde', 'ações não puderam')} ser enviada${r.falhas === 1 ? '' : 's'}. Veja as pendências.`,
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
    if (!usuarioId) return;
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

  /** Chamados com alguma ação ainda não enviada (selo "envio pendente"). */
  const idsPendentes = useMemo(() => {
    const ids = new Set<string>();
    for (const a of acoes) idsDaAcao(a.acao).forEach((id) => ids.add(id));
    return ids;
  }, [acoes]);

  return {
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
  };
}

export type SyncOperacao = ReturnType<typeof useSyncOperacao>;
