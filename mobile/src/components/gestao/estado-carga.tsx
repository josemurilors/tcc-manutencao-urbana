/**
 * Ponte entre o estado dos hooks de carga e o `StateView`: a tela só decide
 * o texto do vazio; carregando, erro e sem rede saem iguais em toda a gestão.
 */

import { StateView } from '@/components/ui/state-view';

import type { EstadoLista } from './use-lista-paginada';

type Props = {
  estado: EstadoLista;
  erro?: string;
  onRetry: () => void;
  /** Nome do que carrega, para o leitor de tela ("Carregando a equipe"). */
  oQue?: string;
};

/** Devolve o StateView do estado, ou `null` quando já está pronto. */
export function EstadoCarga({ estado, erro, onRetry, oQue }: Props) {
  if (estado === 'carregando') {
    return <StateView kind="loading" title={oQue ? `Carregando ${oQue}` : undefined} />;
  }
  if (estado === 'offline') return <StateView kind="offline" onRetry={onRetry} />;
  if (estado === 'erro') {
    return (
      <StateView
        kind="error"
        description={erro || undefined}
        onRetry={onRetry}
      />
    );
  }
  return null;
}
