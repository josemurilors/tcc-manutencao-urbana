// Mesmos status de `defeitos/fluxo.py` (STATUS_ABERTOS / STATUS_FECHADOS).
export const STATUS_ABERTOS = ['pendente', 'em_analise', 'agendado', 'em_andamento'];
export const STATUS_FECHADOS = ['concluido', 'rejeitado'];

const STATUS_COLORS = {
  pendente: '#F97316',
  em_analise: '#EAB308',
  agendado: '#8B5CF6',
  em_andamento: '#3B82F6',
  concluido: '#22C55E',
  rejeitado: '#6B7280',
  critico: '#CF4444',
  aberto: '#F97316',
  resolvido: '#22C55E',
};

// Rótulos de operação (`fluxo.ROTULOS_OPERACAO`).
const labels = {
  pendente: 'Novo',
  em_analise: 'Em triagem',
  agendado: 'Programado',
  em_andamento: 'Em execução',
  concluido: 'Concluído',
  rejeitado: 'Rejeitado',
  critico: 'Crítico',
  aberto: 'Novo',
  resolvido: 'Concluído',
};

export function getStatusColor(status, concluido_em) {
  if (status === 'concluido' && concluido_em) {
    const diff = Date.now() - new Date(concluido_em).getTime();
    if (diff >= 7 * 24 * 60 * 60 * 1000) return '#6B7280';
  }
  return STATUS_COLORS[status] || STATUS_COLORS.pendente;
}

export function getStatusLabel(status, concluido_em) {
  if (status === 'concluido' && concluido_em) {
    const diff = Date.now() - new Date(concluido_em).getTime();
    if (diff >= 7 * 24 * 60 * 60 * 1000) return 'Concluído há +1 semana';
  }
  return labels[status] || status;
}
