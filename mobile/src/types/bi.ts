/**
 * Tipos do painel executivo (BI), espelhando a seção 7.4 do contrato v3
 * (`docs/arquitetura/contrato-v3.md`). Percentuais chegam em 0–100 e tempos
 * em horas (float), como fixa o contrato; a conversão para dias é do app.
 */

import type { Defeito } from '@/types';

/** Atalhos de período da barra de filtros; `personalizado` usa `inicio`/`fim`. */
export type PeriodoRapido = '7d' | '30d' | '90d' | '12m' | 'personalizado';

/** Filtros comuns a todas as rotas de BI. Datas em `YYYY-MM-DD`. */
export type BiFiltros = {
  periodo: PeriodoRapido;
  inicio: string;
  fim: string;
  categoria_id?: string | null;
  secretaria_id?: string | null;
  equipe_id?: string | null;
  bairro?: string | null;
};

export type BiIntervalo = { inicio: string; fim: string };

export type BiKpis = {
  recebidos: number;
  resolvidos: number;
  rejeitados: number;
  backlog: number;
  backlog_vencido: number;
  pct_no_prazo: number | null;
  lead_time_p50_h: number | null;
  lead_time_p90_h: number | null;
  primeira_resposta_p50_h: number | null;
  taxa_resolucao: number | null;
  reabertura_pct: number | null;
  csat_media: number | null;
  csat_respostas: number;
  cidadaos_ativos: number;
};

export type BiChaveKpi = keyof BiKpis;

/** GET bi/kpis/?comparar=1 */
export type BiKpisResposta = {
  periodo: BiIntervalo;
  anterior?: BiIntervalo | null;
  kpis: BiKpis;
  kpis_anterior?: Partial<BiKpis> | null;
};

export type Granularidade = 'dia' | 'semana' | 'mes';

/** GET bi/series/ — `periodo` é a data ISO do início do balde. */
export type BiSeriePonto = {
  periodo: string;
  recebidos: number;
  resolvidos: number;
  backlog: number;
};

export type DimensaoBi = 'categoria' | 'bairro' | 'secretaria' | 'equipe' | 'status';

/** GET bi/distribuicao/?dimensao= */
export type BiDistribuicaoLinha = {
  chave: string | number;
  rotulo: string;
  recebidos: number;
  abertos: number;
  resolvidos: number;
  vencidos: number;
  pct_no_prazo: number | null;
  lead_time_p50_h: number | null;
};

export type FaixaAging = '0-2d' | '3-7d' | '8-15d' | '16-30d' | '>30d';

/** GET bi/aging/ */
export type BiAgingFaixa = { faixa: FaixaAging; total: number; vencidos: number };

/** GET bi/produtividade/ */
export type BiProdutividadeLinha = {
  usuario_id: string | number;
  nome: string;
  equipe_nome: string | null;
  concluidos: number;
  lead_time_p50_h: number | null;
  em_andamento: number;
};

/** GET bi/hotspots/ */
export type BiHotspots = {
  celulas: { lat: number; lng: number; total: number; categoria_top: string | null }[];
  reincidencia: { bairro: string; rua: string; categoria: string; ocorrencias: number }[];
};

/** GET bi/satisfacao/ — `distribuicao` vem como `{ "1": n, ..., "5": n }`. */
export type BiSatisfacao = {
  media: number | null;
  respostas: number;
  distribuicao: Record<string, number>;
  comentarios: { nota: number; comentario: string; protocolo: string | null; criado_em: string }[];
};

export type FormatoExportacao = 'csv' | 'xlsx';

/** Opção dos seletores de filtro (categoria, secretaria, equipe, bairro). */
export type OpcaoFiltro = { value: string; label: string };

/**
 * Item da fila de operação (contrato 7.1, `ChamadoFila`), usado no drill-down.
 * Só os campos que a lista do painel lê; o resto vem de `Defeito`.
 */
export type ChamadoFilaBi = Omit<Defeito, 'id'> & {
  id: string | number;
  protocolo?: string | null;
  sla_vencido?: boolean;
  sla_restante_horas?: number | null;
  atendente_nome?: string | null;
  equipe_nome?: string | null;
};

/** Página DRF devolvida pela fila. */
export type PaginaBi<T> = { count: number; next: string | null; previous: string | null; results: T[] };
