/**
 * Estado da fila offline.
 *
 * No web o service worker drenava a fila via Background Sync. Aqui quem drena
 * é o `OfflineSyncProvider`, montado uma vez no layout raiz; este hook só lê o
 * estado dele. (Antes cada componente que chamava o hook criava a própria
 * sincronização — e o único que chamava não era renderizado em lugar nenhum.)
 */

import { useOfflineSyncContext } from '@/context/offline-sync-context';

export type { SyncState } from '@/context/offline-sync-context';

export function useOfflineSync() {
  return useOfflineSyncContext();
}
