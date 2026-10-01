/**
 * Chamadas do painel executivo (contrato v3, seção 7.4 — `api/v1/bi/`).
 *
 * Todas as rotas recebem os mesmos filtros; `queryDosFiltros` é o único lugar
 * que traduz o estado da barra de filtros para a query string, para nenhuma
 * seção do painel divergir das outras sobre "qual período é este".
 */

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import type {
  BiAgingFaixa,
  BiDistribuicaoLinha,
  BiFiltros,
  BiHotspots,
  BiKpisResposta,
  BiProdutividadeLinha,
  BiSatisfacao,
  BiSeriePonto,
  ChamadoFilaBi,
  DimensaoBi,
  FormatoExportacao,
  Granularidade,
  OpcaoFiltro,
  PaginaBi,
} from '@/types/bi';

import { API_URL, paginated, request } from './api';
import { getTokenSync } from './storage';

const BASE = '/api/v1/bi';

/** Filtros -> query (sem `?`). Campos vazios ficam de fora. */
export function queryDosFiltros(filtros: BiFiltros, extra: Record<string, string> = {}) {
  const q = new URLSearchParams();
  q.set('inicio', filtros.inicio);
  q.set('fim', filtros.fim);
  if (filtros.categoria_id) q.set('categoria_id', filtros.categoria_id);
  if (filtros.secretaria_id) q.set('secretaria_id', filtros.secretaria_id);
  if (filtros.equipe_id) q.set('equipe_id', filtros.equipe_id);
  if (filtros.bairro) q.set('bairro', filtros.bairro);
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  return q.toString();
}

/** Recorte do drill-down: os mesmos filtros do painel mais a fatia tocada. */
export type RecorteDrill = {
  dimensao: DimensaoBi | 'vencidos';
  chave?: string | null;
};

export const apiBi = {
  kpis: (f: BiFiltros) => request<BiKpisResposta>(`${BASE}/kpis/?${queryDosFiltros(f, { comparar: '1' })}`),

  series: (f: BiFiltros, granularidade: Granularidade) =>
    request<BiSeriePonto[]>(`${BASE}/series/?${queryDosFiltros(f, { granularidade })}`),

  distribuicao: (f: BiFiltros, dimensao: DimensaoBi) =>
    request<BiDistribuicaoLinha[]>(`${BASE}/distribuicao/?${queryDosFiltros(f, { dimensao })}`),

  aging: (f: BiFiltros) => request<BiAgingFaixa[]>(`${BASE}/aging/?${queryDosFiltros(f)}`),

  produtividade: (f: BiFiltros) =>
    request<BiProdutividadeLinha[]>(`${BASE}/produtividade/?${queryDosFiltros(f)}`),

  hotspots: (f: BiFiltros) => request<BiHotspots>(`${BASE}/hotspots/?${queryDosFiltros(f)}`),

  satisfacao: (f: BiFiltros) => request<BiSatisfacao>(`${BASE}/satisfacao/?${queryDosFiltros(f)}`),

  /**
   * Opções dos filtros. Categoria e secretaria vêm da gestão (7.6, GET liberado
   * para gestor+); se a rota ainda não existir, caem na distribuição do
   * período, que traz chave e rótulo das mesmas dimensões.
   */
  opcoesCategoria: async (f: BiFiltros): Promise<OpcaoFiltro[]> => {
    try {
      const lista = await paginated<{ categoria_id: number; nome: string; ativo?: boolean }>(
        '/api/v1/gestao/categorias/',
      );
      return lista
        .filter((c) => c.ativo !== false)
        .map((c) => ({ value: String(c.categoria_id), label: c.nome }));
    } catch {
      // Gestão ainda sem a rota: a distribuição do período serve de catálogo.
      return opcoesDaDistribuicao(f, 'categoria');
    }
  },

  opcoesSecretaria: async (f: BiFiltros): Promise<OpcaoFiltro[]> => {
    try {
      const lista = await paginated<{ id: number; nome: string; sigla?: string; ativo?: boolean }>(
        '/api/v1/gestao/secretarias/',
      );
      return lista
        .filter((s) => s.ativo !== false)
        .map((s) => ({ value: String(s.id), label: s.sigla ? `${s.sigla} — ${s.nome}` : s.nome }));
    } catch {
      return opcoesDaDistribuicao(f, 'secretaria');
    }
  },

  /** Bairro não tem cadastro: os que tiveram chamado no período bastam. */
  opcoesBairro: (f: BiFiltros) => opcoesDaDistribuicao(f, 'bairro'),

  /**
   * Lista do drill-down: a fila de operação (7.1) filtrada pela fatia. A fila
   * não recorta por data de abertura — o que interessa ao gestor ali é o que
   * está aberto agora naquela categoria/bairro/secretaria.
   */
  chamados: (f: BiFiltros, recorte: RecorteDrill, page = 1) => {
    const q = new URLSearchParams({ atribuicao: 'todos', ordenar: 'prazo', page: String(page) });
    if (f.categoria_id) q.set('categoria_id', f.categoria_id);
    if (f.secretaria_id) q.set('secretaria_id', f.secretaria_id);
    if (f.equipe_id) q.set('equipe_id', f.equipe_id);
    if (f.bairro) q.set('bairro', f.bairro);
    const chave = recorte.chave ?? '';
    switch (recorte.dimensao) {
      case 'categoria':
        if (chave) q.set('categoria_id', chave);
        break;
      case 'secretaria':
        if (chave) q.set('secretaria_id', chave);
        break;
      case 'equipe':
        if (chave) q.set('equipe_id', chave);
        break;
      case 'bairro':
        if (chave) q.set('bairro', chave);
        break;
      case 'status':
        if (chave) q.set('status', chave);
        break;
      case 'vencidos':
        q.set('vencidos', '1');
        break;
    }
    return request<PaginaBi<ChamadoFilaBi>>(`/api/v1/operacao/fila/?${q.toString()}`);
  },

  exportar: (f: BiFiltros, formato: FormatoExportacao) =>
    baixarECompartilhar(`${BASE}/exportar/?${queryDosFiltros(f, { formato })}`, {
      nome: `chamados-${f.inicio}-a-${f.fim}.${formato}`,
      mimeType:
        formato === 'csv'
          ? 'text/csv'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      uti: formato === 'csv' ? 'public.comma-separated-values-text' : 'org.openxmlformats.spreadsheetml.sheet',
      titulo: 'Exportar chamados',
    }),

  /** Relatório executivo do mês (`YYYY-MM`) em PDF. */
  relatorio: (f: BiFiltros, mes: string) => {
    // O relatório é mensal: o período da barra não vale, mas os recortes sim.
    const q = new URLSearchParams({ mes });
    if (f.categoria_id) q.set('categoria_id', f.categoria_id);
    if (f.secretaria_id) q.set('secretaria_id', f.secretaria_id);
    if (f.equipe_id) q.set('equipe_id', f.equipe_id);
    if (f.bairro) q.set('bairro', f.bairro);
    return baixarECompartilhar(`${BASE}/relatorio/?${q.toString()}`, {
      nome: `relatorio-${mes}.pdf`,
      mimeType: 'application/pdf',
      uti: 'com.adobe.pdf',
      titulo: `Relatório de ${mes}`,
    });
  },
};

async function opcoesDaDistribuicao(f: BiFiltros, dimensao: DimensaoBi): Promise<OpcaoFiltro[]> {
  // Sem o próprio filtro da dimensão: senão a lista só teria o item escolhido.
  const semEla: BiFiltros = { ...f };
  if (dimensao === 'categoria') semEla.categoria_id = null;
  if (dimensao === 'secretaria') semEla.secretaria_id = null;
  if (dimensao === 'equipe') semEla.equipe_id = null;
  if (dimensao === 'bairro') semEla.bairro = null;
  const linhas = await apiBi.distribuicao(semEla, dimensao);
  return linhas
    .filter((l) => String(l.chave ?? '').trim() !== '')
    .map((l) => ({ value: String(l.chave), label: l.rotulo || String(l.chave) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
}

type Download = { nome: string; mimeType: string; uti: string; titulo: string };

async function buscarArquivo(endpoint: string) {
  const token = getTokenSync();
  return fetch(`${API_URL}${endpoint}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

/** Lê o `{detail}` do erro quando o corpo é JSON; senão, uma frase pelo status. */
async function mensagemDeErro(res: Response) {
  const corpo = await res.json().catch(() => null);
  if (corpo?.detail) return String(corpo.detail);
  if (res.status === 404) return 'Exportação ainda não disponível no servidor.';
  if (res.status === 403) return 'Seu perfil não tem acesso a exportações.';
  return `Falha ao gerar o arquivo (erro ${res.status}).`;
}

/**
 * Baixa um arquivo autenticado e entrega ao usuário: no nativo, grava no cache
 * e abre a folha de compartilhar (como a OS em `api.ts`); no web, dispara o
 * download do navegador. Usa `fetch` nos dois para ler o status e o `{detail}`
 * do erro — o `downloadFileAsync` gravaria a página de erro como se fosse o
 * arquivo.
 */
async function baixarECompartilhar(endpoint: string, arq: Download) {
  let res = await buscarArquivo(endpoint);
  if (res.status === 401) {
    // Token vencido: `request` sabe renovar pelo refresh; depois tenta de novo.
    await request(`${BASE}/aging/?inicio=2000-01-01&fim=2000-01-01`).catch(() => undefined);
    res = await buscarArquivo(endpoint);
  }
  if (!res.ok) throw new Error(await mensagemDeErro(res));

  if (Platform.OS === 'web') {
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = arq.nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Dá tempo do navegador começar o download antes de liberar o blob.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return arq.nome;
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  const destino = new File(Paths.cache, arq.nome);
  destino.create({ overwrite: true });
  destino.write(bytes);
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Este aparelho não permite compartilhar arquivos.');
  }
  await Sharing.shareAsync(destino.uri, {
    mimeType: arq.mimeType,
    dialogTitle: arq.titulo,
    UTI: arq.uti,
  });
  return destino.uri;
}
