/**
 * Formatação do painel executivo: números em pt-BR, tempos em dias e datas
 * curtas. Fica junto do BI (e não em `utils/format.ts`) porque as regras são
 * de leitura de indicador — "—" para sem dado, dias para prazos urbanos.
 */

import type { Granularidade, PeriodoRapido } from '@/types/bi';

const NUMERO = new Intl.NumberFormat('pt-BR');
const UMA_CASA = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 0 });

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function fmtNumero(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return '—';
  return NUMERO.format(Math.round(n));
}

export function fmtDecimal(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return '—';
  return UMA_CASA.format(n);
}

/** Percentual que já chega em 0–100 (contrato §7.4). */
export function fmtPct(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${UMA_CASA.format(n)}%`;
}

/**
 * Horas -> texto curto. Chamado urbano se mede em dias; abaixo de um dia, em
 * horas, para não virar "0,2 d" no tempo de primeira resposta.
 */
export function fmtHoras(h: number | null | undefined) {
  if (h == null || !Number.isFinite(h)) return '—';
  if (h < 1) return '< 1 h';
  if (h < 24) return `${Math.round(h)} h`;
  const dias = h / 24;
  return `${UMA_CASA.format(dias)} ${dias < 1.05 ? 'dia' : 'dias'}`;
}

/** Versão por extenso para leitor de tela ("3,5 dias", "5 horas"). */
export function fmtHorasExtenso(h: number | null | undefined) {
  if (h == null || !Number.isFinite(h)) return 'sem dado';
  if (h < 1) return 'menos de uma hora';
  if (h < 24) return `${Math.round(h)} horas`;
  return `${UMA_CASA.format(h / 24)} dias`;
}

// ---------------------------------------------------------------------------
// Datas. O app trabalha com o calendário local (o servidor resolve o fuso de
// Brasília); `YYYY-MM-DD` é montado à mão para não cair no UTC do toISOString.

export function isoLocal(d: Date) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** `YYYY-MM-DD` -> Date à meia-noite local (o `new Date(iso)` seria UTC). */
export function dataDeIso(iso: string) {
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(a, (m || 1) - 1, d || 1);
}

export function fmtDataCurta(iso: string) {
  const d = dataDeIso(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function fmtDataLonga(iso: string) {
  const d = dataDeIso(iso);
  return `${fmtDataCurta(iso)}/${d.getFullYear()}`;
}

/** `dd/mm/aaaa` -> `YYYY-MM-DD`, ou null se a data não existe. */
export function isoDeTextoBr(texto: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texto.trim());
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  if (d.getDate() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1) return null;
  return isoLocal(d);
}

export function textoBrDeIso(iso: string) {
  return fmtDataLonga(iso);
}

/** Rótulo do eixo X conforme a granularidade da série. */
export function fmtBalde(iso: string, gran: Granularidade) {
  const d = dataDeIso(iso);
  if (gran === 'mes') return `${MESES[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`;
  return fmtDataCurta(iso);
}

/** Rótulo completo do balde para tooltip e leitor de tela. */
export function fmtBaldeLongo(iso: string, gran: Granularidade) {
  const d = dataDeIso(iso);
  if (gran === 'mes') return `${MESES[d.getMonth()]} de ${d.getFullYear()}`;
  if (gran === 'semana') return `semana de ${fmtDataLonga(iso)}`;
  return fmtDataLonga(iso);
}

export function fmtMes(yyyyMm: string) {
  const [a, m] = yyyyMm.split('-').map(Number);
  return `${MESES[(m || 1) - 1]}/${a}`;
}

/** Intervalo do atalho de período, terminando hoje (inclusive). */
export function intervaloDoPeriodo(p: Exclude<PeriodoRapido, 'personalizado'>, hoje = new Date()) {
  const fim = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const inicio = new Date(fim);
  if (p === '12m') {
    inicio.setFullYear(inicio.getFullYear() - 1);
    inicio.setDate(inicio.getDate() + 1);
  } else {
    const dias = p === '7d' ? 7 : p === '30d' ? 30 : 90;
    inicio.setDate(inicio.getDate() - (dias - 1));
  }
  return { inicio: isoLocal(inicio), fim: isoLocal(fim) };
}

/** Dias do intervalo, inclusive nas duas pontas. */
export function diasNoIntervalo(inicio: string, fim: string) {
  const ms = dataDeIso(fim).getTime() - dataDeIso(inicio).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

/** Série diária fica ilegível acima de ~60 pontos; semanas, acima de ~26. */
export function granularidadePara(inicio: string, fim: string): Granularidade {
  const dias = diasNoIntervalo(inicio, fim);
  if (dias <= 45) return 'dia';
  if (dias <= 200) return 'semana';
  return 'mes';
}

export function descreverPeriodo(p: PeriodoRapido, inicio: string, fim: string) {
  switch (p) {
    case '7d':
      return 'Últimos 7 dias';
    case '30d':
      return 'Últimos 30 dias';
    case '90d':
      return 'Últimos 90 dias';
    case '12m':
      return 'Últimos 12 meses';
    default:
      return `${fmtDataLonga(inicio)} a ${fmtDataLonga(fim)}`;
  }
}

/** Mês anterior ao atual (`YYYY-MM`): o relatório fechado mais recente. */
export function mesAnterior(hoje = new Date()) {
  const d = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function ultimosMeses(n: number, hoje = new Date()) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
}
