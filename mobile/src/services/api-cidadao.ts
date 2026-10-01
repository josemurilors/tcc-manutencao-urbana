/**
 * Chamadas da jornada do cidadão (contrato v3 §7.2): duplicados por perto,
 * histórico, avaliação, reabertura, busca por protocolo e fotos.
 *
 * Usa `request`/`paginated` de `api.ts` (refresh de token, erros `{detail}`)
 * em vez de inflar o objeto `api` de lá (contrato §5).
 */

import { API_URL, request } from '@/services/api';
import { getTokenSync } from '@/services/storage';
import type { Defeito } from '@/types';
import type { AnexoChamado, ChamadoDetalhe, ChamadoProximo, EventoChamado } from '@/types/cidadao';

type Id = number | string;

/** Teto de páginas de "Meus chamados" (20 por página): 500 chamados. */
const MAX_PAGINAS_MEUS = 25;

/**
 * Domínio público dos links compartilhados. Fixo de propósito: um link
 * enviado pelo WhatsApp a partir de um build de desenvolvimento não pode
 * apontar para o IP da máquina de quem desenvolve.
 */
export const SITE_PUBLICO = 'https://tcc.josemurilors.com.br';

export function linkPublicoDoChamado(id: Id) {
  return `${SITE_PUBLICO}/chamado/${id}`;
}

/**
 * Protocolo como o cidadão digita ("2026 123", "2026-123", "#2026-000123")
 * no formato canônico `AAAA-NNNNNN`. Devolve `null` se não der para entender.
 */
export function normalizarProtocolo(entrada: string): string | null {
  const digitos = entrada.replace(/\D/g, '');
  if (digitos.length < 5) return null;
  const ano = digitos.slice(0, 4);
  const seq = digitos.slice(4);
  if (seq.length > 6 || Number(seq) === 0) return null;
  return `${ano}-${seq.padStart(6, '0')}`;
}

/** Erro HTTP com o status: a tela separa "não existe" (404) de "falhou". */
export class ErroHttp extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ErroHttp';
  }
}

/**
 * GET de leitura pública com o status preservado (o `request` de `api.ts` só
 * devolve a mensagem). Vai com o token quando há sessão — o backend usa isso
 * para `eh_autor` —, e se o token estiver vencido (401) repete sem ele, já
 * que a rota é pública: quem abriu um link compartilhado não deve cair num
 * erro por causa de sessão velha.
 */
async function getPublico<T>(endpoint: string): Promise<T> {
  const token = getTokenSync();
  let res = await fetch(`${API_URL}${endpoint}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (res.status === 401 && token) res = await fetch(`${API_URL}${endpoint}`);
  if (!res.ok) {
    const corpo = await res.json().catch(() => ({}));
    const msg =
      (corpo && (corpo.detail || corpo.error)) ||
      (res.status === 404 ? 'Não encontrado.' : `Erro ${res.status} ao carregar.`);
    throw new ErroHttp(String(msg), res.status);
  }
  return res.json() as Promise<T>;
}

/** URL de imagem que pode vir relativa à API. */
function urlAbsoluta(url: string) {
  if (/^(https?:|data:|blob:)/.test(url)) return url;
  return `${API_URL}${url.startsWith('/') ? '' : '/'}${url}`;
}

export const apiCidadao = {
  /**
   * Todos os chamados do usuário. `/defeitos/meus/` é paginado (20 por
   * página): pegar só a primeira escondia chamados de quem reporta muito —
   * e as contagens de abertos/resolvidos saíam erradas.
   */
  meusChamados: async () => {
    const todos: Defeito[] = [];
    for (let pagina = 1; pagina <= MAX_PAGINAS_MEUS; pagina++) {
      const dados = await request<{ results?: Defeito[]; next?: string | null } | Defeito[]>(
        `/api/v1/defeitos/meus/?page=${pagina}`,
      );
      if (Array.isArray(dados)) return dados;
      todos.push(...(dados.results ?? []));
      if (!dados.next) break;
    }
    return todos;
  },

  /**
   * Chamados perto do ponto, para o "já reportado aqui?" antes de enviar.
   * Público: um token velho no aparelho não pode derrubar a checagem.
   */
  proximos: (lat: number, lng: number, opcoes: { categoria?: string; raio?: number } = {}) => {
    const qs = new URLSearchParams({ lat: String(lat), lng: String(lng) });
    if (opcoes.categoria) qs.set('categoria', opcoes.categoria);
    if (opcoes.raio) qs.set('raio', String(opcoes.raio));
    return request<ChamadoProximo[]>(`/api/v1/defeitos/proximos/?${qs}`, { publico: true });
  },

  /** Histórico; para o cidadão, só os eventos públicos. */
  eventos: (id: Id) => request<EventoChamado[]>(`/api/v1/defeitos/${id}/eventos/`),

  detalhe: (id: Id) => getPublico<ChamadoDetalhe>(`/api/v1/defeitos/${id}/`),

  /** Detalhe público pelo protocolo (com `eh_autor` quando há sessão). */
  porProtocolo: (protocolo: string) =>
    getPublico<ChamadoDetalhe>(`/api/v1/defeitos/protocolo/${encodeURIComponent(protocolo)}/`),

  avaliar: (id: Id, nota: number, comentario: string) =>
    request<ChamadoDetalhe>(`/api/v1/defeitos/${id}/avaliar/`, {
      method: 'POST',
      body: { nota, comentario },
    }),

  reabrir: (id: Id, motivo: string) =>
    request<ChamadoDetalhe>(`/api/v1/defeitos/${id}/reabrir/`, {
      method: 'POST',
      body: { motivo },
    }),

  /**
   * Fotos de antes/depois. A rota é da operação: o backend só libera ao
   * cidadão quando o chamado é público — fora isso responde 403/404, e quem
   * chama cai nas fotos que já vêm no detalhe (ver `useFotosDoChamado`).
   */
  anexos: async (id: Id) => {
    const lista = await request<AnexoChamado[]>(`/api/v1/operacao/chamados/${id}/anexos/`);
    return lista.map((a) => ({ ...a, url: urlAbsoluta(a.url) }));
  },
};
