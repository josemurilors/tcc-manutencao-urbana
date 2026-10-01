/**
 * Regras da operação no app: espelho do ciclo de vida (`defeitos/fluxo.py`) e
 * dos papéis (`core/permissoes.py`) do contrato v3, §1 e §3.
 *
 * O backend é quem decide — aqui só serve para não oferecer um botão que
 * certamente vai dar 403/400. Se divergir, vale a resposta do servidor.
 */

import type { Tom } from '@/constants/theme';
import type { User } from '@/types';
import type { ChamadoFila, MotivoRejeicao, Papel, Prioridade } from '@/types/operacao';
import type { MotivoPulo } from '@/services/operacao-offline';

export const NIVEIS: Record<Papel, number> = {
  cidadao: 0,
  operador: 1,
  gestor: 2,
  admin_municipal: 3,
  super_admin: 4,
};

/** Nível do usuário; contas antigas sem `papel` mas com `admin` contam como admin municipal. */
export function nivelDe(user: User | null | undefined): number {
  if (!user) return 0;
  const papel = user.papel as Papel | undefined;
  if (papel && papel in NIVEIS) return NIVEIS[papel];
  return user.admin ? NIVEIS.admin_municipal : 0;
}

export function ehGestor(user: User | null | undefined) {
  return nivelDe(user) >= NIVEIS.gestor;
}

export const TRANSICOES: Record<string, string[]> = {
  pendente: ['em_analise', 'agendado', 'em_andamento', 'concluido', 'rejeitado'],
  em_analise: ['agendado', 'em_andamento', 'concluido', 'rejeitado'],
  agendado: ['em_analise', 'em_andamento', 'concluido', 'rejeitado'],
  em_andamento: ['agendado', 'concluido', 'rejeitado'],
  concluido: ['pendente'],
  rejeitado: ['pendente'],
};

/** Transições que o papel do usuário pode fazer a partir de `status`. */
export function transicoesPermitidas(status: string, user: User | null | undefined) {
  const gestor = ehGestor(user);
  // Rejeitar e reabrir são decisões de gestão (contrato §3).
  return (TRANSICOES[status] ?? []).filter((para) => gestor || (para !== 'rejeitado' && para !== 'pendente'));
}

/** Verbo do botão para cada destino — a equipe pensa em ação, não em status. */
export const VERBO_TRANSICAO: Record<string, { rotulo: string; icone: string }> = {
  em_analise: { rotulo: 'Triar', icone: 'search' },
  agendado: { rotulo: 'Programar', icone: 'calendar' },
  em_andamento: { rotulo: 'Iniciar execução', icone: 'play' },
  concluido: { rotulo: 'Concluir', icone: 'checkmark-done' },
  rejeitado: { rotulo: 'Rejeitar', icone: 'close-circle' },
  pendente: { rotulo: 'Reabrir', icone: 'refresh' },
};

export const MOTIVOS_REJEICAO: { value: MotivoRejeicao; label: string; ajuda: string }[] = [
  { value: 'duplicado', label: 'Duplicado', ajuda: 'Já existe outro chamado para o mesmo problema.' },
  {
    value: 'fora_da_competencia',
    label: 'Fora da competência',
    ajuda: 'Não é responsabilidade da prefeitura (ex.: concessionária, área privada).',
  },
  { value: 'nao_localizado', label: 'Não localizado', ajuda: 'A equipe foi ao local e não encontrou o problema.' },
  { value: 'ja_resolvido', label: 'Já resolvido', ajuda: 'O problema já tinha sido resolvido.' },
  { value: 'improcedente', label: 'Improcedente', ajuda: 'O relato não descreve um problema de zeladoria.' },
  { value: 'outro', label: 'Outro motivo', ajuda: 'Explique no texto ao cidadão.' },
];

export const PRIORIDADES: { value: Prioridade; label: string }[] = [
  { value: 'urgente', label: 'Urgente' },
  { value: 'alta', label: 'Alta' },
  { value: 'media', label: 'Média' },
  { value: 'baixa', label: 'Baixa' },
];

export const MOTIVOS_PULO: { value: MotivoPulo; label: string; icone: string }[] = [
  { value: 'sem_acesso', label: 'Sem acesso ao local', icone: 'lock-closed' },
  { value: 'falta_material', label: 'Falta material', icone: 'cube' },
  { value: 'outra_equipe', label: 'Precisa de outra equipe', icone: 'people' },
  { value: 'ja_resolvido', label: 'Já estava resolvido', icone: 'checkmark-circle' },
  { value: 'nao_localizado', label: 'Problema não localizado', icone: 'help-circle' },
];

/** O chamado está comigo? */
export function souAtendente(chamado: ChamadoFila, user: User | null | undefined) {
  return !!user && chamado.atendente_id != null && String(chamado.atendente_id) === String(user.id);
}

export type SlaInfo = { texto: string; tom: Tom; icone: 'alarm' | 'time' | 'checkmark-circle' };

function emHorasOuDias(horas: number) {
  const h = Math.abs(horas);
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} d`;
}

/**
 * SLA restante como texto e tom: vencido (vermelho), vence em 24 h (âmbar),
 * no prazo (verde). O texto sempre diz o estado — a cor só reforça.
 */
export function slaDe(chamado: Pick<ChamadoFila, 'sla_restante_horas' | 'sla_vencido'>): SlaInfo | null {
  const h = chamado.sla_restante_horas;
  if (h == null) return chamado.sla_vencido ? { texto: 'Prazo vencido', tom: 'danger', icone: 'alarm' } : null;
  if (h < 0 || chamado.sla_vencido) return { texto: `Vencido há ${emHorasOuDias(h)}`, tom: 'danger', icone: 'alarm' };
  if (h <= 24) return { texto: `Vence em ${emHorasOuDias(h)}`, tom: 'warning', icone: 'time' };
  return { texto: `No prazo · ${emHorasOuDias(h)}`, tom: 'success', icone: 'checkmark-circle' };
}

/** Faixa do score (0–100) para o selo de prioridade calculada. */
export function tomDoScore(score: number): Tom {
  if (score >= 70) return 'danger';
  if (score >= 40) return 'warning';
  return 'neutral';
}

export function venceEm24h(c: ChamadoFila) {
  const h = c.sla_restante_horas;
  return h != null && h >= 0 && h <= 24 && !c.sla_vencido;
}

export function sinalizado(c: ChamadoFila) {
  const r = c.total_resolvido ?? c.sinalizacoes?.resolvido ?? 0;
  const n = c.total_nao_existe ?? c.sinalizacoes?.nao_existe ?? 0;
  return r + n > 0;
}

export function nomeCategoria(c: ChamadoFila) {
  return c.categoria_nome || c.categoria || c.titulo;
}

/** Protocolo legível, ou um trecho do id para chamados antigos sem protocolo. */
export function identificador(c: Pick<ChamadoFila, 'protocolo' | 'id'>) {
  return c.protocolo || `#${String(c.id).slice(0, 8)}`;
}

export const REGEX_PROTOCOLO = /^\d{4}-\d{6}$/;
