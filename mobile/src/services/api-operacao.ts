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

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

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

/**
 * Regras da prefeitura (`municipio_config.parametros`) que o app aplica antes
 * de enviar, já com o padrão da plataforma no que a cidade não definiu.
 */
export type ParametrosOperacao = {
  /** Concluir exige a foto do depois (padrão: sim). */
  exigir_foto_conclusao: boolean;
  /** Distância máxima, em metros, da foto até o chamado. */
  raio_evidencia_m: number;
};

/** GET `operacao/resumo/`. `parametros` falta em backends anteriores a ele. */
export type ResumoOperacao = ResumoFila & { parametros?: ParametrosOperacao };

/** Foto obrigatória ao concluir? Sem a informação, vale o padrão (exige). */
export function exigeFotoAoConcluir(resumo: ResumoOperacao | null | undefined) {
  return resumo?.parametros?.exigir_foto_conclusao ?? true;
}

/**
 * Cabeçalho de idempotência. No navegador ele iria num preflight de CORS que o
 * backend não libera (a requisição cairia como "Failed to fetch" e a ação iria
 * para a fila offline para sempre); lá a chave vai na query (`comChave`).
 */
function cabecalhos(idempotencia?: string) {
  return idempotencia && Platform.OS !== 'web' ? { 'Idempotency-Key': idempotencia } : undefined;
}

/** Caminho da ação com a chave na query, no web (ver `cabecalhos`). */
function comChave(caminho: string, idempotencia?: string) {
  if (!idempotencia || Platform.OS !== 'web') return caminho;
  return `${caminho}${caminho.includes('?') ? '&' : '?'}idempotency_key=${encodeURIComponent(idempotencia)}`;
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

  resumo: () => request<ResumoOperacao>(`${BASE}/resumo/`),

  /** Mudança de status. Com `foto`, vai multipart como evidência (`depois` ao concluir). */
  transicao: async (
    id: IdChamado,
    dados: DadosTransicao,
    opcoes: { foto?: PickedImage | null; local?: Coordenada | null; idempotencia?: string } = {},
  ) => {
    const corpo = opcoes.foto ? await formularioComFoto(dados, opcoes.foto, opcoes.local) : dados;
    return request<ChamadoFila>(comChave(`${BASE}/chamados/${id}/transicao/`, opcoes.idempotencia), {
      method: 'POST',
      body: corpo,
      headers: cabecalhos(opcoes.idempotencia),
    });
  },

  atribuir: (id: IdChamado, dados: DadosAtribuicao, idempotencia?: string) =>
    request<ChamadoFila>(comChave(`${BASE}/chamados/${id}/atribuir/`, idempotencia), {
      method: 'POST',
      body: dados,
      headers: cabecalhos(idempotencia),
    }),

  liberar: (id: IdChamado, idempotencia?: string) =>
    request<ChamadoFila>(comChave(`${BASE}/chamados/${id}/liberar/`, idempotencia), {
      method: 'POST',
      headers: cabecalhos(idempotencia),
    }),

  nota: (id: IdChamado, texto: string, idempotencia?: string) =>
    request<EventoOperacao>(comChave(`${BASE}/chamados/${id}/nota/`, idempotencia), {
      method: 'POST',
      body: { texto },
      headers: cabecalhos(idempotencia),
    }),

  resposta: (id: IdChamado, texto: string, idempotencia?: string) =>
    request<EventoOperacao>(comChave(`${BASE}/chamados/${id}/resposta/`, idempotencia), {
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
    request<AnexoChamado>(comChave(`${BASE}/chamados/${id}/evidencia/`, idempotencia), {
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
    request<ChamadoFila>(comChave(`${BASE}/chamados/${id}/sla/`, idempotencia), {
      method: 'POST',
      body: { prazo_sla_dias: prazoSlaDias, motivo },
      headers: cabecalhos(idempotencia),
    }),

  prioridade: (id: IdChamado, prioridade: Prioridade, idempotencia?: string) =>
    request<ChamadoFila>(comChave(`${BASE}/chamados/${id}/prioridade/`, idempotencia), {
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
    request<ResultadoLote>(comChave(`${BASE}/lote/`, idempotencia), {
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

  /**
   * Ordem de Serviço em PDF (`chamados/<id>/ordem-servico/`): no nativo grava no
   * cache e abre o compartilhar (imprimir, WhatsApp, e-mail); no web baixa.
   * Usa `fetch` para ler o `{detail}` do erro em vez de salvar a página de erro.
   */
  ordemServico: async (id: IdChamado, protocolo?: string | null) => {
    const nome = `OS-${protocolo || String(id).slice(0, 8)}.pdf`;
    const buscar = () => {
      const token = getTokenSync();
      return fetch(`${API_URL}${BASE}/chamados/${id}/ordem-servico/`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    };
    let res = await buscar();
    if (res.status === 401) {
      // Token vencido: `request` renova pelo refresh; depois tenta de novo.
      await request(`${BASE}/resumo/`).catch(() => undefined);
      res = await buscar();
    }
    if (!res.ok) {
      const corpo = await res.json().catch(() => null);
      throw new Error(corpo?.detail ? String(corpo.detail) : `Falha ao gerar a Ordem de Serviço (erro ${res.status}).`);
    }
    if (Platform.OS === 'web') {
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = nome;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return nome;
    }
    const destino = new File(Paths.cache, nome);
    destino.create({ overwrite: true });
    destino.write(new Uint8Array(await res.arrayBuffer()));
    if (!(await Sharing.isAvailableAsync())) {
      throw new Error('Este aparelho não permite compartilhar arquivos.');
    }
    await Sharing.shareAsync(destino.uri, {
      mimeType: 'application/pdf',
      dialogTitle: `Ordem de Serviço ${protocolo ?? ''}`.trim(),
      UTI: 'com.adobe.pdf',
    });
    return destino.uri;
  },

  /** Categorias do município com o id (o filtro da fila usa `categoria_id`). */
  categorias: () => paginated<CategoriaOperacao>('/api/v1/gestao/categorias/'),
};
