/**
 * Única fonte de rótulo/cor de status do app (contrato v3, seção 1 —
 * `docs/arquitetura/contrato-v3.md`). Os status canônicos espelham
 * `defeitos/fluxo.py` no backend; os legados só chegam de dados antigos em
 * cache e são convertidos por `normalizarStatus`.
 */

export const STATUS = [
  'pendente',
  'em_analise',
  'agendado',
  'em_andamento',
  'concluido',
  'rejeitado',
] as const;

export type Status = (typeof STATUS)[number];

/** Valores antigos -> canônicos (o banco já foi convertido pelo bootstrap_schema). */
const STATUS_LEGADOS: Record<string, Status> = {
  vinculado_sem_resposta: 'em_andamento',
  vinculado_com_resposta: 'em_andamento',
  atendido: 'concluido',
  encerrado: 'concluido',
};

export function normalizarStatus(status: string): string {
  return STATUS_LEGADOS[status] ?? status;
}

export const STATUS_ABERTOS: string[] = ['pendente', 'em_analise', 'agendado', 'em_andamento'];

export const STATUS_FECHADOS: string[] = ['concluido', 'rejeitado'];

export function statusAberto(status: string) {
  return STATUS_ABERTOS.includes(normalizarStatus(status));
}

export function statusFechado(status: string) {
  return STATUS_FECHADOS.includes(normalizarStatus(status));
}

/** Como o cidadão lê o status (app público, notificações). */
const ROTULOS_CIDADAO: Record<Status, string> = {
  pendente: 'Recebido',
  em_analise: 'Em análise',
  agendado: 'Programado',
  em_andamento: 'Em execução',
  concluido: 'Resolvido',
  rejeitado: 'Não procede',
};

/** Como a equipe da prefeitura lê o status (fila, painel). */
const ROTULOS_OPERACAO: Record<Status, string> = {
  pendente: 'Novo',
  em_analise: 'Em triagem',
  agendado: 'Programado',
  em_andamento: 'Em execução',
  concluido: 'Concluído',
  rejeitado: 'Rejeitado',
};

export function rotuloCidadao(status: string) {
  const s = normalizarStatus(status) as Status;
  return ROTULOS_CIDADAO[s] ?? status;
}

export function rotuloOperacao(status: string) {
  const s = normalizarStatus(status) as Status;
  return ROTULOS_OPERACAO[s] ?? status;
}

const STATUS_COLORS: Record<Status, string> = {
  pendente: '#F97316',
  em_analise: '#EAB308',
  agendado: '#3B82F6',
  em_andamento: '#3B82F6',
  concluido: '#22C55E',
  rejeitado: '#6B7280',
};

/** Cores curtas usadas nos gráficos do painel. */
export const STATUS_CHART_COLORS: Record<string, string> = {
  pendente: '#4A90D9',
  em_analise: '#D4AF37',
  agendado: '#8E7CC3',
  em_andamento: '#D4AF37',
  concluido: '#4CAF7D',
  rejeitado: '#6B5B3E',
};

const UMA_SEMANA_MS = 7 * 24 * 60 * 60 * 1000;

function concluidoHaMaisDeUmaSemana(status: string, concluidoEm?: string | null) {
  if (!concluidoEm) return false;
  if (!statusFechado(status)) return false;
  return Date.now() - new Date(concluidoEm).getTime() >= UMA_SEMANA_MS;
}

export function getStatusColor(status: string, concluidoEm?: string | null) {
  if (concluidoHaMaisDeUmaSemana(status, concluidoEm)) return '#6B7280';
  return STATUS_COLORS[normalizarStatus(status) as Status] ?? STATUS_COLORS.pendente;
}

/** Rótulo do cidadão, com o aviso de "fechado há mais de uma semana" do mapa. */
export function getStatusLabel(status: string, concluidoEm?: string | null) {
  if (concluidoHaMaisDeUmaSemana(status, concluidoEm)) return 'Resolvido há +1 semana';
  return rotuloCidadao(status);
}

/**
 * Opções de alteração de status em lote (operação). Rejeitar fica de fora:
 * exige motivo e é decisão de gestor, feita chamado a chamado.
 */
export const BATCH_STATUS_OPTIONS: [string, string][] = [
  ['em_analise', ROTULOS_OPERACAO.em_analise],
  ['agendado', ROTULOS_OPERACAO.agendado],
  ['em_andamento', ROTULOS_OPERACAO.em_andamento],
  ['concluido', ROTULOS_OPERACAO.concluido],
];
