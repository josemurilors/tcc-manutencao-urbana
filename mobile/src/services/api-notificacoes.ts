/**
 * Central de notificações e tokens de push — `api/v1/notificacoes/`
 * (contrato v3 §7.3).
 */

import type { Notificacao, PaginaNotificacoes, PlataformaPush } from '@/types/notificacoes';

import { request } from './api';

const BASE = '/api/v1/notificacoes';

/**
 * Ações sem resposta útil podem voltar 204 (corpo vazio), e o `request`
 * sempre tenta ler JSON. Corpo vazio vira `SyntaxError` no parse — aqui isso
 * é sucesso; qualquer outro erro continua subindo.
 */
async function semCorpo(promessa: Promise<unknown>): Promise<void> {
  try {
    await promessa;
  } catch (err) {
    if (err instanceof SyntaxError) return;
    throw err;
  }
}

export const notificacoesApi = {
  /** Página `page` (1, 2, ...), mais recentes primeiro; `naoLidas` filtra no servidor. */
  listar: (page = 1, opcoes: { naoLidas?: boolean } = {}) =>
    request<PaginaNotificacoes>(`${BASE}/?page=${page}${opcoes.naoLidas ? '&nao_lidas=1' : ''}`),

  naoLidas: () => request<{ total: number }>(`${BASE}/nao-lidas/`),

  marcarLida: (id: Notificacao['id']) => semCorpo(request(`${BASE}/${id}/lida/`, { method: 'POST' })),

  marcarTodasLidas: () => semCorpo(request(`${BASE}/todas-lidas/`, { method: 'POST' })),

  registrarPushToken: (token: string, plataforma: PlataformaPush) =>
    semCorpo(request(`${BASE}/push-tokens/`, { method: 'POST', body: { token, plataforma } })),

  removerPushToken: (token: string) =>
    semCorpo(request(`${BASE}/push-tokens/`, { method: 'DELETE', body: { token } })),
};
