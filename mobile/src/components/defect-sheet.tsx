/**
 * Detalhe do chamado para o **cidadão** em bottom sheet (mapa e lista).
 *
 * Conteúdo de `DefectDetail` (transparência, resposta, fotos, histórico) +
 * ações de `AcoesCidadao`. Atender, responder e finalizar são trabalho de
 * operador e vivem em `operacao-sheet.tsx` — mesmo um admin navegando por
 * aqui não vê essas ações, para o mapa do cidadão não virar painel de operação.
 */

import { AcoesCidadao } from '@/components/chamado/acoes-cidadao';
import { DefectDetail } from '@/components/defect-detail';
import type { Defeito, TipoSinalizacao } from '@/types';

type Props = {
  defeito: Defeito | null;
  apoiado: boolean;
  onClose: () => void;
  /** Aplica uma alteração parcial na lista do pai. */
  onPatch: (id: number, patch: Partial<Defeito>) => void;
  /** Substitui o chamado pelo objeto recarregado do backend. */
  onReplace: (defeito: Defeito) => void;
  onApoioToggle: (id: number, apoiado: boolean) => void;
  /** Sinalização do usuário logado neste chamado (`null` = nenhuma). */
  sinalizacao?: TipoSinalizacao | null;
  onSinalizacaoChange?: (id: number, tipo: TipoSinalizacao | null) => void;
  /** O chamado deixou de existir (apagado como "não existe"): tira da lista e fecha. */
  onRemove?: (id: number) => void;
  /**
   * Distância do usuário até o chamado, em metros. Quando informada (tela do
   * mapa), o "Apoiar" vira "Confirmar no local", liberado só dentro de
   * `RAIO_CONFIRMACAO_M` — o usuário atesta que a demanda existe estando lá.
   * `null` = GPS indisponível; `undefined` = contexto sem GPS (lista).
   */
  distanciaM?: number | null;
};

export function DefectSheet({ defeito, onClose, distanciaM, ...acoes }: Props) {
  if (!defeito) return null;

  return (
    <DefectDetail
      defeito={defeito}
      onClose={onClose}
      rotuloApoios={distanciaM !== undefined ? 'confirmacoes' : 'apoios'}>
      <AcoesCidadao
        {...acoes}
        defeito={defeito}
        modo="sheet"
        distanciaM={distanciaM}
        onClose={onClose}
      />
    </DefectDetail>
  );
}
