/**
 * Leitura do prazo (SLA) para o cidadão: "faltam 3 dias", "atrasado há 2 dias",
 * "resolvido dentro do prazo". O backend manda `prazo_em` e
 * `sla_restante_horas`; quando a hora restante não vem (backend antigo), ela é
 * calculada a partir de `prazo_em`.
 */

import { normalizarStatus } from '@/constants/status';
import type { Tom } from '@/constants/theme';
import type { Defeito } from '@/types';

export type LeituraPrazo = {
  /** Frase principal ("Faltam 3 dias", "Atrasado há 2 dias"). */
  titulo: string;
  /** Complemento ("Previsto até 12/10/2026"). */
  detalhe?: string;
  tom: Tom;
  /** Fração do prazo já consumida (0..1), para a barra; `null` sem barra. */
  fracao: number | null;
  atrasado: boolean;
};

const HORA_MS = 60 * 60 * 1000;

export function dataCurta(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR');
}

function dias(horas: number) {
  const n = Math.max(1, Math.round(Math.abs(horas) / 24));
  return n === 1 ? '1 dia' : `${n} dias`;
}

export function lerPrazo(d: Defeito): LeituraPrazo | null {
  const status = normalizarStatus(d.status);
  const prazo = d.prazo_em ? new Date(d.prazo_em).getTime() : NaN;
  const temPrazo = Number.isFinite(prazo);

  if (status === 'rejeitado') return null;

  if (status === 'concluido') {
    const resolvido = d.resolvido_em ?? d.atendido_em ?? null;
    const quando = resolvido ? new Date(resolvido).getTime() : NaN;
    if (!Number.isFinite(quando)) {
      return { titulo: 'Resolvido', tom: 'success', fracao: null, atrasado: false };
    }
    if (!temPrazo || quando <= prazo) {
      return {
        titulo: temPrazo ? 'Resolvido dentro do prazo' : 'Resolvido',
        detalhe: `Em ${dataCurta(resolvido)}`,
        tom: 'success',
        fracao: null,
        atrasado: false,
      };
    }
    return {
      titulo: `Resolvido ${dias((quando - prazo) / HORA_MS)} após o prazo`,
      detalhe: `Em ${dataCurta(resolvido)} · prazo era ${dataCurta(d.prazo_em)}`,
      tom: 'warning',
      fracao: null,
      atrasado: true,
    };
  }

  if (!temPrazo) {
    return {
      titulo: 'Prazo em definição',
      detalhe: 'A prefeitura ainda vai classificar este chamado.',
      tom: 'neutral',
      fracao: null,
      atrasado: false,
    };
  }

  const restante =
    typeof d.sla_restante_horas === 'number' ? d.sla_restante_horas : (prazo - Date.now()) / HORA_MS;
  const inicio = new Date(d.criado_em).getTime();
  const total = prazo - inicio;
  const fracao = total > 0 ? Math.min(1, Math.max(0, (prazo - restante * HORA_MS - inicio) / total)) : 1;
  const detalhe = `Previsto até ${dataCurta(d.prazo_em)}`;

  if (restante < 0 || d.sla_vencido) {
    return {
      titulo: `Atrasado há ${dias(restante)}`,
      detalhe: `O prazo era ${dataCurta(d.prazo_em)}`,
      tom: 'danger',
      fracao: 1,
      atrasado: true,
    };
  }
  if (restante < 24) {
    return {
      titulo: restante < 1 ? 'Vence em menos de 1 hora' : `Vence em ${Math.round(restante)} h`,
      detalhe,
      tom: 'warning',
      fracao,
      atrasado: false,
    };
  }
  return { titulo: `Faltam ${dias(restante)}`, detalhe, tom: 'info', fracao, atrasado: false };
}
