/** Histórico do chamado — porte de `frontend/src/utils/timeline.js`. */

import { normalizarStatus } from '@/constants/status';
import type { Defeito } from '@/types';

import { formatarDataHora, maskName } from './format';

export type TimelineItem = {
  id: string;
  title: string;
  description?: string;
  date?: string;
  meta?: string;
};

export function getTimelineItems(d: Defeito): TimelineItem[] {
  const status = normalizarStatus(d.status);
  const items: TimelineItem[] = [
    {
      id: 'criado',
      title: 'Chamado Criado',
      description: d.descricao?.slice(0, 120),
      date: formatarDataHora(d.criado_em),
      // O backend já manda o nome mascarado para quem não é da prefeitura.
      meta: `Por ${d.autor_nome || maskName(d.usuario?.nome)}`,
    },
  ];

  if (d.triado_em) {
    items.push({ id: 'triado', title: 'Em análise', date: formatarDataHora(d.triado_em) });
  }

  if (d.iniciado_em || status === 'em_andamento') {
    items.push({
      id: 'execucao',
      title: 'Em execução',
      date: formatarDataHora(d.iniciado_em ?? d.atualizado_em),
    });
  }

  if (d.resposta_publica) {
    items.push({ id: 'resposta', title: 'Resposta da prefeitura', description: d.resposta_publica });
  }

  if (status === 'concluido') {
    items.push({
      id: 'concluido',
      title: 'Chamado Resolvido',
      date: formatarDataHora(d.resolvido_em ?? d.atendido_em),
      meta: ultimaAtualizacao(d),
    });
  }

  if (status === 'rejeitado') {
    items.push({ id: 'rejeitado', title: 'Não procede', date: formatarDataHora(d.fechado_em) });
  }

  return items;
}

/** Último registro automático do backend (ex.: "Concluído por confirmação de cidadãos"). */
function ultimaAtualizacao(d: Defeito): string | undefined {
  if (!d.atualizacoes) return undefined;
  try {
    const lista = JSON.parse(d.atualizacoes) as { texto?: string }[];
    const texto = lista[lista.length - 1]?.texto;
    return texto || undefined;
  } catch {
    return undefined;
  }
}
