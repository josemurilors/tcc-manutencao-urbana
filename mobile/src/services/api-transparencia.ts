/**
 * Portal público de transparência (contrato v3 §7.5): indicadores do
 * município, dados abertos (CSV/GeoJSON) e Open311 GeoReport v2.
 *
 * Tudo anônimo — vai sem token de propósito: a página é aberta por quem
 * recebeu o link da prefeitura, sem conta, e o cache do backend é o mesmo
 * para todo mundo.
 */

import { Platform, Share } from 'react-native';

import type { FormatoDadosAbertos, PortalTransparencia } from '@/types/transparencia';

import { API_URL } from './api';
import { ErroHttp, SITE_PUBLICO } from './api-cidadao';

export type ResultadoCompartilhar = 'compartilhado' | 'copiado' | 'cancelado';

/**
 * Onde baixar o app. Configurável por `EXPO_PUBLIC_LINK_APP` (página da loja
 * ou do APK); sem ela, a ficha da Play Store do pacote `com.ciu.mobile`.
 */
export const LINK_BAIXAR_APP =
  process.env.EXPO_PUBLIC_LINK_APP || 'https://play.google.com/store/apps/details?id=com.ciu.mobile';

/** Link público e fixo do portal (o mesmo domínio dos links de chamado). */
export function linkDoPortal(codigo: string) {
  return `${SITE_PUBLICO}/transparencia/${encodeURIComponent(codigo)}`;
}

/** Download direto dos dados abertos do município. */
export function urlDadosAbertos(codigo: string, formato: FormatoDadosAbertos) {
  return `${API_URL}/api/v1/dados-abertos/${encodeURIComponent(codigo)}/chamados.${formato}`;
}

/** Endpoints Open311 GeoReport v2 já com a jurisdição (código IBGE). */
export function urlsOpen311(codigo: string) {
  const base = `${API_URL}/api/v1/open311/v2`;
  const jur = `jurisdiction_id=${encodeURIComponent(codigo)}`;
  return {
    servicos: `${base}/services.json?${jur}`,
    solicitacoes: `${base}/requests.json?${jur}`,
    solicitacao: `${base}/requests/<protocolo>.json?${jur}`,
  };
}

/** Indicadores públicos do município; 404 vira `ErroHttp` com status. */
export async function buscarPortal(codigo: string): Promise<PortalTransparencia> {
  const res = await fetch(`${API_URL}/api/v1/transparencia/${encodeURIComponent(codigo)}/`);
  if (!res.ok) {
    const corpo = await res.json().catch(() => ({}));
    const msg =
      (corpo && (corpo.detail || corpo.error)) ||
      (res.status === 404 ? 'Município não encontrado.' : `Erro ${res.status} ao carregar.`);
    throw new ErroHttp(String(msg), res.status);
  }
  return res.json() as Promise<PortalTransparencia>;
}

/**
 * Compartilha o portal. No web, `navigator.share` quando existe (celular);
 * senão o link vai para a área de transferência — mesma regra do chamado.
 */
export async function compartilharPortal(codigo: string, nome: string): Promise<ResultadoCompartilhar> {
  const link = linkDoPortal(codigo);
  const titulo = `Transparência · ${nome}`;
  const mensagem = `Veja como a prefeitura de ${nome} responde aos problemas da cidade: ${link}`;

  if (Platform.OS === 'web') {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    if (nav?.share) {
      try {
        await nav.share({ title: titulo, text: mensagem, url: link });
        return 'compartilhado';
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return 'cancelado';
        throw err;
      }
    }
    if (nav?.clipboard) {
      await nav.clipboard.writeText(link);
      return 'copiado';
    }
    throw new Error('Este navegador não permite compartilhar. Copie o endereço da página.');
  }

  const res = await Share.share(
    Platform.OS === 'ios' ? { message: mensagem, url: link } : { message: mensagem, title: titulo },
    { dialogTitle: 'Compartilhar portal' },
  );
  return res.action === Share.dismissedAction ? 'cancelado' : 'compartilhado';
}
