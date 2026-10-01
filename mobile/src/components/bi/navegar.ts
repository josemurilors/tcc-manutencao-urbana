/**
 * Ida e volta entre o painel e o drill-down (`app/painel/[dimensao].tsx`).
 *
 * Os filtros vão na URL, e não só no armazenamento local: o drill-down abre
 * exatamente o recorte que o gestor tocou, mesmo que ele mude a barra depois,
 * e o link continua válido se for aberto direto (web).
 */

import { router, type Href } from 'expo-router';

import type { BiFiltros, DimensaoBi, PeriodoRapido, RecorteLista } from '@/types/bi';

import { filtrosPadrao } from './use-filtros-bi';

/** `vencidos` e `todos` não têm tabela: abrem direto a lista (do cartão de KPI). */
export type DimensaoDrill = DimensaoBi | 'vencidos' | 'todos';

export const DIMENSOES_DRILL: DimensaoDrill[] = [
  'categoria',
  'bairro',
  'secretaria',
  'equipe',
  'status',
  'vencidos',
  'todos',
];

export const RECORTES_LISTA: RecorteLista[] = ['abertos', 'vencidos', 'recebidos', 'resolvidos', 'rejeitados'];

export const ROTULO_DIMENSAO: Record<DimensaoDrill, { singular: string; plural: string }> = {
  categoria: { singular: 'Categoria', plural: 'Categorias' },
  bairro: { singular: 'Bairro', plural: 'Bairros' },
  secretaria: { singular: 'Secretaria', plural: 'Secretarias' },
  equipe: { singular: 'Equipe', plural: 'Equipes' },
  status: { singular: 'Situação', plural: 'Situações' },
  vencidos: { singular: 'Prazo vencido', plural: 'Prazo vencido' },
  todos: { singular: 'Município', plural: 'Município' },
};

type ParamsDrill = Record<string, string | undefined>;

export function paramsDosFiltros(f: BiFiltros): Record<string, string> {
  const p: Record<string, string> = { periodo: f.periodo, inicio: f.inicio, fim: f.fim };
  if (f.categoria_id) p.categoria_id = f.categoria_id;
  if (f.secretaria_id) p.secretaria_id = f.secretaria_id;
  if (f.equipe_id) p.equipe_id = f.equipe_id;
  if (f.bairro) p.bairro = f.bairro;
  return p;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const PERIODOS: PeriodoRapido[] = ['7d', '30d', '90d', '12m', 'personalizado'];

export function filtrosDosParams(p: ParamsDrill): BiFiltros {
  const padrao = filtrosPadrao();
  const valido = p.inicio && p.fim && ISO.test(p.inicio) && ISO.test(p.fim);
  return {
    periodo: valido && PERIODOS.includes(p.periodo as PeriodoRapido) ? (p.periodo as PeriodoRapido) : padrao.periodo,
    inicio: valido ? (p.inicio as string) : padrao.inicio,
    fim: valido ? (p.fim as string) : padrao.fim,
    categoria_id: p.categoria_id || null,
    secretaria_id: p.secretaria_id || null,
    equipe_id: p.equipe_id || null,
    bairro: p.bairro || null,
  };
}

export function abrirDrill(
  f: BiFiltros,
  dimensao: DimensaoDrill,
  fatia?: { chave: string; rotulo: string } | null,
  recorte?: RecorteLista,
) {
  router.push({
    pathname: '/painel/[dimensao]',
    params: {
      dimensao,
      ...paramsDosFiltros(f),
      ...(fatia ? { chave: fatia.chave, rotulo: fatia.rotulo } : null),
      ...(recorte ? { recorte } : null),
    },
  } as unknown as Href);
}

/** Abre o chamado no mapa, onde mora o detalhe completo (folha do chamado). */
export function abrirChamado(id: string | number) {
  router.push({ pathname: '/(tabs)/mapa', params: { abrir: String(id) } });
}

/** Enquadra um ponto (ex.: área crítica do painel) no mapa do app. */
export function abrirCoordenada(lat: number, lng: number) {
  router.push({ pathname: '/(tabs)/mapa', params: { lat: String(lat), lng: String(lng) } });
}
