/**
 * Tipos da operação de campo (contrato v3, seção 7.1 — `api/v1/operacao/`).
 *
 * Ficam fora de `types.ts` de propósito (contrato §5): cada área mantém os
 * seus. `ChamadoFila` estende o `Defeito` da listagem para continuar cabendo
 * nos componentes que já recebem um chamado (detalhe, mapa, roteiro).
 */

import type { Defeito } from '@/types';

/**
 * Id de chamado. No backend é UUID; o `Defeito` ainda o tipa como número por
 * herança do app antigo, então a operação usa o tipo dele e compara sempre por
 * `String(id)` para não depender disso.
 */
export type IdChamado = Defeito['id'];

export type Papel = 'cidadao' | 'operador' | 'gestor' | 'admin_municipal' | 'super_admin';

export type Prioridade = 'baixa' | 'media' | 'alta' | 'urgente';

export type MotivoRejeicao =
  | 'duplicado'
  | 'fora_da_competencia'
  | 'nao_localizado'
  | 'ja_resolvido'
  | 'improcedente'
  | 'outro';

/** Item da fila: campos da listagem de defeitos + os da operação. */
export type ChamadoFila = Defeito & {
  protocolo?: string | null;
  /** 0–100; pondera prioridade, SLA restante, apoios, idade e sinalizações. */
  score?: number | null;
  prazo_em?: string | null;
  sla_restante_horas?: number | null;
  sla_vencido?: boolean;
  /** Só vem quando a fila recebeu `lat`/`lng`. */
  distancia_m?: number | null;
  atendente_id?: string | number | null;
  atendente_nome?: string | null;
  equipe_id?: number | null;
  equipe_nome?: string | null;
  total_apoios?: number;
  total_resolvido?: number;
  total_nao_existe?: number;
  /** Itens do checklist da categoria, conferidos ao concluir. */
  checklist?: string[];
  imagem_url?: string | null;
};

/** GET `operacao/resumo/`. */
export type ResumoFila = {
  abertos: number;
  meus: number;
  vencidos: number;
  vencem_24h: number;
  sem_atribuicao: number;
  sinalizados: number;
  concluidos_hoje: number;
};

export type OrdemFila = 'score' | 'prazo' | 'antigos' | 'apoios' | 'distancia';

export type Atribuicao = 'meus' | 'equipe' | 'sem' | 'todos';

/**
 * Filtros da fila. `vencem_24h` e `sinalizados` não estão na query do contrato:
 * o app manda os dois (o backend pode ignorar) e também filtra no cliente.
 */
export type FiltrosFila = {
  status?: string;
  categoria_id?: number;
  equipe_id?: number;
  atribuicao?: Atribuicao;
  vencidos?: boolean;
  vencem_24h?: boolean;
  sinalizados?: boolean;
  bairro?: string;
  q?: string;
  ordenar: OrdemFila;
};

export type PaginaFila = {
  count: number;
  next: string | null;
  previous: string | null;
  results: ChamadoFila[];
};

export type TipoAnexo = 'cidadao' | 'antes' | 'depois';

/** GET `operacao/chamados/<id>/anexos/`. */
export type AnexoChamado = {
  id: number;
  tipo: TipoAnexo;
  url: string;
  latitude: number | null;
  longitude: number | null;
  autor_nome: string;
  criado_em: string;
};

export type RespostaPadrao = {
  id: number;
  titulo: string;
  texto: string;
  categoria_id?: number | null;
};

export type MembroEquipe = { id: string; nome: string; papel: Papel | string };

/** GET `operacao/equipes/`. */
export type EquipeOperacao = {
  id: number;
  nome: string;
  secretaria_nome: string;
  membros: MembroEquipe[];
};

/** Evento devolvido por `nota/` e `resposta/`. */
export type EventoOperacao = {
  id: number;
  tipo: string;
  texto: string;
  publico: boolean;
  criado_em: string;
};

/** POST `operacao/lote/`. */
export type ResultadoLote = {
  ok: IdChamado[];
  erros: { id: IdChamado; detail: string }[];
};

/** Corpo de POST `chamados/<id>/transicao/` (a foto vai à parte, em multipart). */
export type DadosTransicao = {
  para: string;
  texto?: string;
  resposta_publica?: string;
  motivo?: MotivoRejeicao;
  duplicado_de?: string;
  /** Itens do checklist marcados como feitos. */
  checklist?: string[];
};

export type DadosAtribuicao = { equipe_id?: number | null; atendente_id?: string | null };

export type Coordenada = { latitude: number; longitude: number };

/** Categoria vista pela equipe (GET `gestao/categorias/`). */
export type CategoriaOperacao = {
  categoria_id: number;
  nome: string;
  icone?: string;
  checklist?: string[];
};
