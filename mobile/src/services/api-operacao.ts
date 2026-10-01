/**
 * Cliente da operação de campo — `api/v1/operacao/` (contrato v3, seção 7.1).
 *
 * Substitui as chamadas antigas da equipe (`/defeitos/operacao/`, `atender/`,
 * `status/`, `batch_status/` e o PATCH genérico de defeitos): toda mudança de
 * chamado passa pelas ações dedicadas, que o backend valida com o fluxo.
 *
 * As ações mutáveis aceitam `idempotencia`: a chave vai no cabeçalho
 * `Idempotency-Key` para o backend reconhecer a repetição quando a fila
 * offline reenviar algo que já tinha chegado (ver `operacao-offline.ts`).
 */

import { API_URL, appendImage, paginated, request } from '@/services/api';
import { getTokenSync } from '@/services/storage';
import type { Defeito, DefeitoEvento, PickedImage } from '@/types';
import type {
  AnexoChamado,
  CategoriaOperacao,
  ChamadoFila,
  Coordenada,
  DadosAtribuicao,
  DadosTransicao,
  EquipeOperacao,
  EventoOperacao,
  FiltrosFila,
  IdChamado,
  PaginaFila,
  Prioridade,
  RespostaPadrao,
  ResultadoLote,
  ResumoFila,
  TipoAnexo,
} from '@/types/operacao';

const BASE = '/api/v1/operacao';

function cabecalhos(idempotencia?: string) {
  return idempotencia ? { 'Idempotency-Key': idempotencia } : undefined;
}

/** Erro de transporte (sem resposta do servidor), o único que vai para a fila offline. */
export function ehErroDeRede(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg === 'Network request failed' ||
    msg === 'Failed to fetch' ||
    msg.includes('NetworkError') ||
    msg.includes('Load failed')
  );
}

/** Monta a query da fila. `lat`/`lng` vão sempre que houver posição, para vir `distancia_m`. */
export function queryDaFila(filtros: FiltrosFila, pagina = 1, posicao?: Coordenada | null) {
  const q = new URLSearchParams();
  if (filtros.status) q.set('status', filtros.status);
  if (filtros.categoria_id != null) q.set('categoria_id', String(filtros.categoria_id));
  if (filtros.equipe_id != null) q.set('equipe_id', String(filtros.equipe_id));
  if (filtros.atribuicao && filtros.atribuicao !== 'todos') q.set('atribuicao', filtros.atribuicao);
  if (filtros.vencidos) q.set('vencidos', '1');
  if (filtros.vencem_24h) q.set('vencem_24h', '1');
  if (filtros.sinalizados) q.set('sinalizados', '1');
  if (filtros.bairro) q.set('bairro', filtros.bairro);
  if (filtros.q?.trim()) q.set('q', filtros.q.trim());
  q.set('ordenar', filtros.ordenar);
  if (posicao) {
    q.set('lat', posicao.latitude.toFixed(6));
    q.set('lng', posicao.longitude.toFixed(6));
  }
  if (pagina > 1) q.set('page', String(pagina));
  return q.toString();
}

async function formularioComFoto(
  campos: Record<string, unknown>,
  foto: PickedImage,
  local?: Coordenada | null,
) {
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(campos)) {
    if (valor == null || valor === '') continue;
    // Listas (checklist) vão como JSON: o multipart não tem tipo de lista.
    fd.append(chave, Array.isArray(valor) ? JSON.stringify(valor) : String(valor));
  }
  await appendImage(fd, 'foto', foto);
  if (local) {
    fd.append('latitude', String(local.latitude));
    fd.append('longitude', String(local.longitude));
  }
  return fd;
}

export const apiOperacao = {
  fila: (filtros: FiltrosFila, pagina = 1, posicao?: Coordenada | null) =>
    request<PaginaFila>(`${BASE}/fila/?${queryDaFila(filtros, pagina, posicao)}`),

  /** Página seguinte pelo `next` absoluto do DRF. */
  filaPorUrl: (next: string) => {
    const caminho = next.startsWith(API_URL) ? next.slice(API_URL.length) : next.replace(/^https?:\/\/[^/]+/, '');
    return request<PaginaFila>(caminho);
  },

  resumo: () => request<ResumoFila>(`${BASE}/resumo/`),

  /** Mudança de status. Com `foto`, vai multipart como evidência (`depois` ao concluir). */
  transicao: async (
    id: IdChamado,
    dados: DadosTransicao,
    opcoes: { foto?: PickedImage | null; local?: Coordenada | null; idempotencia?: string } = {},
  ) => {
    const corpo = opcoes.foto ? await formularioComFoto(dados, opcoes.foto, opcoes.local) : dados;
    return request<ChamadoFila>(`${BASE}/chamados/${id}/transicao/`, {
      method: 'POST',
      body: corpo,
      headers: cabecalhos(opcoes.idempotencia),
    });
  },

  atribuir: (id: IdChamado, dados: DadosAtribuicao, idempotencia?: string) =>
    request<ChamadoFila>(`${BASE}/chamados/${id}/atribuir/`, {
      method: 'POST',
      body: dados,
      headers: cabecalhos(idempotencia),
    }),

  liberar: (id: IdChamado, idempotencia?: string) =>
    request<ChamadoFila>(`${BASE}/chamados/${id}/liberar/`, {
      method: 'POST',
      headers: cabecalhos(idempotencia),
    }),

  nota: (id: IdChamado, texto: string, idempotencia?: string) =>
    request<EventoOperacao>(`${BASE}/chamados/${id}/nota/`, {
      method: 'POST',
      body: { texto },
      headers: cabecalhos(idempotencia),
    }),

  resposta: (id: IdChamado, texto: string, idempotencia?: string) =>
    request<EventoOperacao>(`${BASE}/chamados/${id}/resposta/`, {
      method: 'POST',
      body: { texto },
      headers: cabecalhos(idempotencia),
    }),

  evidencia: async (
    id: IdChamado,
    tipo: Exclude<TipoAnexo, 'cidadao'>,
    foto: PickedImage,
    local: Coordenada | null,
    idempotencia?: string,
  ) =>
    request<AnexoChamado>(`${BASE}/chamados/${id}/evidencia/`, {
      method: 'POST',
      body: await formularioComFoto({ tipo }, foto, local),
      headers: cabecalhos(idempotencia),
    }),

  anexos: (id: IdChamado) => request<AnexoChamado[]>(`${BASE}/chamados/${id}/anexos/`),

  /**
   * Fonte de imagem de um anexo para o `expo-image`: a rota exige o token da
   * equipe, que vai no cabeçalho em vez de na URL.
   */
  fonteDoAnexo: (anexo: AnexoChamado) => {
    const url = /^https?:/.test(anexo.url) ? anexo.url : `${API_URL}${anexo.url}`;
    const token = getTokenSync();
    return { uri: url, headers: token ? { Authorization: `Bearer ${token}` } : undefined };
  },

  sla: (id: IdChamado, prazoSlaDias: number, motivo: string, idempotencia?: string) =>
    request<ChamadoFila>(`${BASE}/chamados/${id}/sla/`, {
      method: 'POST',
      body: { prazo_sla_dias: prazoSlaDias, motivo },
      headers: cabecalhos(idempotencia),
    }),

  prioridade: (id: IdChamado, prioridade: Prioridade, idempotencia?: string) =>
    request<ChamadoFila>(`${BASE}/chamados/${id}/prioridade/`, {
      method: 'POST',
      body: { prioridade },
      headers: cabecalhos(idempotencia),
    }),

  lote: (
    ids: IdChamado[],
    acao: 'transicao' | 'atribuir',
    campos: Partial<DadosTransicao> & DadosAtribuicao,
    idempotencia?: string,
  ) =>
    request<ResultadoLote>(`${BASE}/lote/`, {
      method: 'POST',
      body: { ids, acao, ...campos },
      headers: cabecalhos(idempotencia),
    }),

  respostasPadrao: () => paginated<RespostaPadrao>(`${BASE}/respostas-padrao/`),

  equipes: () => request<EquipeOperacao[]>(`${BASE}/equipes/`),

  /** Detalhe completo (descrição, fotos) — o mesmo endpoint do cidadão. */
  detalhe: (id: IdChamado) => request<Defeito>(`/api/v1/defeitos/${id}/`),

  /** Histórico; para a equipe do município inclui as notas internas. */
  eventos: (id: IdChamado) => request<DefeitoEvento[]>(`/api/v1/defeitos/${id}/eventos/`),

  /** Busca exata por protocolo (`AAAA-NNNNNN`), aberto ou fechado. */
  porProtocolo: (protocolo: string) =>
    request<ChamadoFila>(`/api/v1/defeitos/protocolo/${encodeURIComponent(protocolo)}/`),

  /** Categorias do município com o id (o filtro da fila usa `categoria_id`). */
  categorias: () => paginated<CategoriaOperacao>('/api/v1/gestao/categorias/'),
};
