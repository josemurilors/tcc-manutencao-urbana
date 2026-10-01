/**
 * Contador de notificações não lidas, compartilhado entre o sino do
 * cabeçalho e a central (marcar como lida lá zera o selo aqui sem esperar o
 * próximo ciclo).
 *
 * Polling leve: a cada 60 s, só com a tela em foco e o app em primeiro plano
 * — aba escondida ou app em segundo plano não gastam bateria nem servidor.
 */

import { useFocusEffect } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useCallback, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';

import { useAuth } from '@/context/auth-context';
import { notificacoesApi } from '@/services/api-notificacoes';

const INTERVALO_MS = 60_000;

/** `null` = ainda não sabemos (ou o servidor falhou): o sino fica sem selo. */
let total: number | null = null;
const ouvintes = new Set<() => void>();

function emitir() {
  ouvintes.forEach((ouvir) => ouvir());
}

/** Atualiza o contador local e o selo do ícone do app. */
export function definirNaoLidas(valor: number | null) {
  total = valor === null ? null : Math.max(0, valor);
  emitir();
  if (Platform.OS !== 'web' && total !== null) {
    Notifications.setBadgeCountAsync(total).catch((err) =>
      console.warn('[notificações] não foi possível atualizar o selo do ícone', err),
    );
  }
}

/** Uma a menos (marcou uma como lida). */
export function decrementarNaoLidas() {
  if (total !== null) definirNaoLidas(total - 1);
}

/** Busca o total no servidor. Erro sobe para quem chamou decidir. */
export async function recarregarNaoLidas() {
  const { total: novo } = await notificacoesApi.naoLidas();
  definirNaoLidas(novo);
  return novo;
}

function assinar(ouvir: () => void) {
  ouvintes.add(ouvir);
  return () => {
    ouvintes.delete(ouvir);
  };
}

/** Só lê o contador (sem polling). */
export function useTotalNaoLidas() {
  return useSyncExternalStore(assinar, () => total, () => total);
}

/**
 * Lê o contador e mantém o polling enquanto a tela que usa está em foco.
 * Sem sessão não há contador.
 */
export function useNaoLidas() {
  const { isAuthenticated } = useAuth();
  const valor = useTotalNaoLidas();

  useFocusEffect(
    useCallback(() => {
      if (!isAuthenticated) {
        definirNaoLidas(null);
        return;
      }
      const buscar = () => {
        if (AppState.currentState !== 'active') return;
        recarregarNaoLidas().catch((err) => {
          // Falha de rede no contador não merece toast a cada minuto: o sino
          // só perde o selo até a próxima tentativa, e a central mostra o
          // erro de verdade quando aberta.
          console.warn('[notificações] contador indisponível', err);
          definirNaoLidas(null);
        });
      };
      buscar();
      const timer = setInterval(buscar, INTERVALO_MS);
      const sub = AppState.addEventListener('change', (estado) => {
        if (estado === 'active') buscar();
      });
      return () => {
        clearInterval(timer);
        sub.remove();
      };
    }, [isAuthenticated]),
  );

  return isAuthenticated ? valor : null;
}
