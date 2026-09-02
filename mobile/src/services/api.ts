/**
 * Cliente HTTP da API — porte de `frontend/src/services/api.js`.
 *
 * Diferenças em relação ao web:
 * - token vem do SecureStore (cache síncrono) e não do localStorage;
 * - sem redirect por `window.location`: o 401 sem refresh dispara
 *   `onUnauthorized`, registrado pelo AuthContext;
 * - upload usa o formato de arquivo do React Native (`{ uri, name, type }`);
 * - a fila offline usa AsyncStorage em vez de IndexedDB + Background Sync.
 */

import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import type {
  AuthResponse,
  Categoria,
  VisaoMunicipio,
  Operacao,
  Defeito,
  Estatisticas,
  Municipio,
  PeriodoRanking,
  PickedImage,
  Progresso,
  Ranking,
  TipoSinalizacao,
  User,
} from '@/types';

import { enqueueDefeito } from './offline-queue';
import { getRefreshSync, getTokenSync, setRefresh, setToken } from './storage';

const API_URL_PRODUCAO = 'https://tcc.josemurilors.com.br';

/**
 * Resolve a base da API.
 *
 * 1. `EXPO_PUBLIC_API_URL`, se definida, sempre vence.
 * 2. Em desenvolvimento, deriva do host do Metro (`hostUri`) — assim o mesmo
 *    código aponta para o backend local tanto no navegador (`localhost`)
 *    quanto no celular via Expo Go (o IP da máquina na LAN), sem precisar
 *    editar `.env` toda vez que o IP do DHCP muda.
 * 3. Fora de desenvolvimento, cai na API de produção.
 */
function hostDeDesenvolvimento(): string | null {
  // No web o app é servido pelo próprio Metro, então a origem da página já é o
  // host certo — `Constants.expoConfig.hostUri` não é preenchido ali.
  if (Platform.OS === 'web') {
    return typeof window === 'undefined' ? null : window.location.hostname;
  }
  // No nativo, hostUri vem como "192.168.1.3:8081".
  return Constants.expoConfig?.hostUri?.split(':')[0] ?? null;
}

function resolverApiUrl() {
  const explicita = process.env.EXPO_PUBLIC_API_URL;
  if (explicita) return explicita.replace(/\/+$/, '');

  if (__DEV__) {
    const porta = process.env.EXPO_PUBLIC_API_PORT ?? '8000';
    const host = hostDeDesenvolvimento();
    if (host) return `http://${host}:${porta}`;
  }

  return API_URL_PRODUCAO;
}

export const API_URL = resolverApiUrl();

let onUnauthorized: (() => void) | null = null;

/** Registrado pelo AuthContext para derrubar a sessão quando o refresh falha. */
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

type RequestOptions = {
  /** Endpoint público: não manda o token (um token velho no aparelho daria 401 à toa). */
  publico?: boolean;
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
};

function extractError(err: any): string {
  if (!err) return 'Erro na requisição';
  if (typeof err === 'string') return err;
  if (err.detail) return err.detail;
  if (err.error) return err.error;
  const field = Object.values(err)[0];
  if (Array.isArray(field)) return String(field[0]);
  if (typeof field === 'string') return field;
  return 'Erro na requisição';
}

function baseHeaders(extra?: Record<string, string>, publico = false) {
  const token = publico ? null : getTokenSync();
  return {
    ...(token && { Authorization: `Bearer ${token}` }),
    ...extra,
  } as Record<string, string>;
}

async function request<T = any>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const headers = baseHeaders(options.headers, options.publico);
  const isFormData = options.body instanceof FormData;

  const fetchOptions: RequestInit = { method: options.method ?? 'GET', headers };
  if (options.body && !isFormData) {
    headers['Content-Type'] = 'application/json';
    fetchOptions.body = JSON.stringify(options.body);
  } else if (isFormData) {
    // O Content-Type é definido pelo runtime junto com o boundary.
    fetchOptions.body = options.body as FormData;
  }
  fetchOptions.headers = headers;

  const res = await fetch(`${API_URL}${endpoint}`, fetchOptions);

  if (!res.ok) {
    if (res.status === 401) {
      const refreshToken = getRefreshSync();
      const isAuthEndpoint =
        endpoint.includes('/auth/login/') || endpoint.includes('/auth/register/');

      if (refreshToken && !isAuthEndpoint) {
        const refreshRes = await fetch(`${API_URL}/api/v1/auth/refresh/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh: refreshToken }),
        });

        if (refreshRes.ok) {
          const { access, refresh } = (await refreshRes.json()) as {
            access: string;
            refresh?: string;
          };
          await setToken(access);
          // O backend rotaciona o refresh (ROTATE_REFRESH_TOKENS): guardar o
          // novo é o que faz a sessão "deslizar" em vez de cair 7 dias após o login.
          if (refresh) await setRefresh(refresh);
          headers.Authorization = `Bearer ${access}`;
          const retryRes = await fetch(`${API_URL}${endpoint}`, { ...fetchOptions, headers });
          if (retryRes.status === 401) {
            // Token novo e ainda 401: a conta não existe mais. Sai da sessão.
            onUnauthorized?.();
            throw new Error('Sessão expirada. Faça login novamente.');
          }
          if (!retryRes.ok) {
            const retryErr = await retryRes.json().catch(() => ({}));
            throw new Error(extractError(retryErr));
          }
          return retryRes.json() as Promise<T>;
        }

        onUnauthorized?.();
        throw new Error('Sessão expirada. Faça login novamente.');
      }
    }
    const err = await res.json().catch(() => ({}));
    if (res.status === 409 && err?.duplicado) {
      throw new DefeitoDuplicadoError(
        extractError(err),
        String(err.defeito_existente_id ?? ''),
        Number(err.distancia_m ?? 0),
      );
    }
    throw new Error(extractError(err));
  }

  return res.json() as Promise<T>;
}

/** Endpoints paginados do DRF devolvem `{ results: [...] }`. */
async function paginated<T>(endpoint: string, options?: RequestOptions): Promise<T[]> {
  const data = await request<any>(endpoint, options);
  return (data?.results ?? data) as T[];
}

/**
 * Anexa uma imagem do picker ao FormData.
 *
 * No nativo o RN aceita `{uri, name, type}` e faz o upload do arquivo. No
 * web isso vira "[object Object]" e o backend não recebe arquivo nenhum —
 * lá a URI (blob:/data:) precisa virar um Blob de verdade.
 */
export async function appendImage(fd: FormData, field: string, image: PickedImage) {
  if (Platform.OS === 'web') {
    const blob = await fetch(image.uri).then((r) => r.blob());
    fd.append(field, blob, image.name);
    return;
  }
  fd.append(field, {
    uri: image.uri,
    name: image.name,
    type: image.type,
  } as any);
}

/** Client IDs do Google por plataforma; vazios = login com Google desligado. */
export type GoogleConfig = { web: string; android: string; ios: string };

export type NovoDefeito = {
  titulo: string;
  descricao: string;
  categoria: string;
  rua: string;
  bairro: string;
  latitude: number;
  longitude: number;
  imagem?: PickedImage | null;
};

export async function buildDefeitoFormData(dados: NovoDefeito) {
  const fd = new FormData();
  fd.append('titulo', dados.titulo);
  fd.append('descricao', dados.descricao);
  fd.append('categoria', dados.categoria);
  fd.append('rua', dados.rua);
  fd.append('bairro', dados.bairro);
  fd.append('latitude', String(dados.latitude));
  fd.append('longitude', String(dados.longitude));
  if (dados.imagem) await appendImage(fd, 'imagem', dados.imagem);
  return fd;
}

/** 409 do backend: já existe um chamado igual (mesma categoria) a poucos metros. */
export class DefeitoDuplicadoError extends Error {
  constructor(
    message: string,
    public readonly defeitoExistenteId: string,
    public readonly distanciaM: number,
  ) {
    super(message);
    this.name = 'DefeitoDuplicadoError';
  }
}

function isNetworkError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message === 'Network request failed' ||
    message === 'Failed to fetch' ||
    message.includes('NetworkError')
  );
}

/**
 * Cria o chamado; se a rede falhar, guarda na fila offline e devolve
 * `{ offline: true }` para a tela avisar o usuário.
 */
async function createDefeito(
  dados: NovoDefeito,
): Promise<Defeito | { offline: true; message: string }> {
  try {
    return await request<Defeito>('/api/v1/defeitos/', {
      method: 'POST',
      body: await buildDefeitoFormData(dados),
    });
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueueDefeito(dados);
      return {
        offline: true,
        message: 'Chamado salvo offline. Será enviado quando houver conexão.',
      };
    }
    throw err;
  }
}

/** Envia um chamado da fila offline (sem re-enfileirar em caso de falha). */
export async function postDefeitoDireto(dados: NovoDefeito) {
  return request<Defeito>('/api/v1/defeitos/', {
    method: 'POST',
    body: await buildDefeitoFormData(dados),
  });
}

export const api = {
  /** Passo 1 do fluxo único de entrada: o e-mail já tem conta? */
  emailExiste: (email: string) =>
    request<{ existe: boolean }>('/api/v1/auth/existe/', {
      method: 'POST',
      body: { email },
      publico: true,
    }),

  login: (email: string, senha: string) =>
    request<AuthResponse>('/api/v1/auth/login/', {
      method: 'POST',
      body: { email, password: senha },
    }),

  googleConfig: () => request<GoogleConfig>('/api/v1/auth/google/', { publico: true }),

  loginGoogle: (idToken: string) =>
    request<AuthResponse>('/api/v1/auth/google/', {
      method: 'POST',
      body: { id_token: idToken },
      publico: true,
    }),

  register: (nome: string, email: string, senha: string, municipioId?: string, cpf?: string) =>
    request<AuthResponse>('/api/v1/auth/register/', {
      method: 'POST',
      body: {
        nome,
        email,
        password: senha,
        confirm_password: senha,
        ...(municipioId && { municipio_id: municipioId }),
        ...(cpf && { cpf }),
      },
    }),

  listDefeitos: (params: { ordenar?: string; status?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.ordenar)
      q.set('ordering', params.ordenar === 'recentes' ? '-criado_em' : '-curtidas');
    if (params.status) q.set('status', params.status);
    const qs = q.toString();
    return paginated<Defeito>(`/api/v1/defeitos/${qs ? '?' + qs : ''}`);
  },

  createDefeito,

  /** Cidade onde o ponto caiu, chamados abertos dela e rankings (visão expandida). */
  visaoMunicipio: (lat: number, lng: number) =>
    request<VisaoMunicipio>(`/api/v1/defeitos/municipio/?lat=${lat}&lng=${lng}`, {
      publico: true,
    }),

  /** Fila de operação: chamados do município do operador (403 sem vínculo). */
  operacao: () => request<Operacao>('/api/v1/defeitos/operacao/'),

  updateDefeito: (id: number, data: Record<string, unknown>) =>
    request<Defeito>(`/api/v1/defeitos/${id}/`, { method: 'PATCH', body: data }),

  /** Finaliza o chamado; a foto de resolução é opcional. */
  finalizarDefeito: async (id: number, fotoResolucao?: PickedImage) => {
    const fd = new FormData();
    fd.append('status', 'atendido');
    if (fotoResolucao) await appendImage(fd, 'foto_resolucao', fotoResolucao);
    return request<Defeito>(`/api/v1/defeitos/${id}/status/`, { method: 'PATCH', body: fd });
  },

  listMunicipios: () => request<Municipio[]>('/api/v1/municipios/lista/'),

  getMunicipio: (codigo: string) => request<any>(`/api/v1/municipios/${codigo}/`),

  listCategorias: () => paginated<Categoria>('/api/v1/categorias/'),

  meusDefeitos: () => paginated<Defeito>('/api/v1/defeitos/meus/'),

  updateProfile: (data: Record<string, unknown>) =>
    request<User>('/api/v1/auth/profile/', { method: 'PATCH', body: data }),

  updatePassword: (senhaAtual: string, novaSenha: string) =>
    request('/api/v1/auth/senha/', {
      method: 'PATCH',
      body: { senha_atual: senhaAtual, nova_senha: novaSenha },
    }),

  updateMunicipio: (municipioId: string) =>
    request<{ municipio: Municipio }>('/api/v1/auth/municipio/', {
      method: 'PATCH',
      body: { municipio_id: municipioId },
    }),

  verificarEmail: (codigo: string) =>
    request('/api/v1/auth/verificar-email/', { method: 'POST', body: { codigo } }),

  reenviarCodigo: () => request('/api/v1/auth/reenviar-codigo/', { method: 'POST' }),

  apoiarDefeito: (id: number) =>
    request<{ apoiado: boolean }>(`/api/v1/defeitos/${id}/apoiar/`, { method: 'POST' }),

  apoiei: () => request<{ ids: number[] }>('/api/v1/defeitos/apoiei/'),

  /**
   * Repetir o mesmo tipo remove; outro tipo troca. `tipo: null` na resposta =
   * sem sinalização. `resultado` diz o que a sinalização disparou: 'concluido'
   * (chamado fechado, vem em `defeito`) ou 'inexistente' (apagado; `defeito`
   * é null e o id não existe mais).
   */
  sinalizarDefeito: (id: number, tipo: TipoSinalizacao) =>
    request<{
      tipo: TipoSinalizacao | null;
      sinalizacoes: { resolvido: number; nao_existe: number };
      resultado: 'concluido' | 'inexistente' | null;
      defeito: Defeito | null;
    }>(`/api/v1/defeitos/${id}/sinalizar/`, { method: 'POST', body: { tipo } }),

  sinalizei: () =>
    request<{ sinalizacoes: Record<string, TipoSinalizacao> }>('/api/v1/defeitos/sinalizei/'),

  /** Nível, XP e barra de progresso do usuário logado. */
  progresso: () => request<Progresso>('/api/v1/defeitos/progresso/'),

  /**
   * Leaderboard de contribuição — por código IBGE, pelo ponto onde o usuário
   * está ou geral (Brasil); `periodo` recorta a semana/mês (padrão: tudo).
   */
  ranking: (params: {
    municipio?: string;
    lat?: number;
    lng?: number;
    geral?: boolean;
    periodo?: PeriodoRanking;
  }) => {
    const q = new URLSearchParams();
    if (params.geral) q.set('geral', '1');
    else if (params.municipio) q.set('municipio', params.municipio);
    else if (params.lat != null && params.lng != null) {
      q.set('lat', String(params.lat));
      q.set('lng', String(params.lng));
    }
    if (params.periodo) q.set('periodo', params.periodo);
    return request<Ranking>(`/api/v1/defeitos/ranking/?${q.toString()}`);
  },

  detalharDefeito: (id: number) => request<Defeito>(`/api/v1/defeitos/${id}/`),

  anexarImagem: async (id: number, image: PickedImage) => {
    const fd = new FormData();
    await appendImage(fd, 'file', image);
    return request(`/api/v1/defeitos/${id}/anexar/`, { method: 'POST', body: fd });
  },

  atenderDefeito: (id: number) =>
    request<Defeito>(`/api/v1/defeitos/${id}/atender/`, { method: 'PATCH' }),

  batchStatusDefeitos: (ids: number[], status: string) =>
    request<{ updated: number }>('/api/v1/defeitos/batch_status/', {
      method: 'PATCH',
      body: { ids, status },
    }),

  /**
   * Baixa a Ordem de Serviço em PDF para o cache e abre a folha de
   * compartilhamento do sistema (equivalente ao download do navegador).
   */
  gerarOS: async (id: number) => {
    const destino = new File(Paths.cache, `OS-${id}.pdf`);
    const arquivo = await File.downloadFileAsync(
      `${API_URL}/api/v1/defeitos/${id}/ordem_servico/`,
      destino,
      { headers: baseHeaders(), idempotent: true },
    );
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(arquivo.uri, {
        mimeType: 'application/pdf',
        dialogTitle: `Ordem de Serviço #${id}`,
        UTI: 'com.adobe.pdf',
      });
    }
    return arquivo.uri;
  },

  adminListUsers: () => request<User[]>('/api/v1/auth/admin/users/'),

  adminToggleAdmin: (id: number | string, admin: boolean) =>
    request(`/api/v1/auth/admin/users/${id}/admin/`, { method: 'PATCH', body: { admin } }),

  adminSetMunicipio: (id: number | string, municipioId: string | null) =>
    request(`/api/v1/auth/admin/users/${id}/municipio/`, {
      method: 'PATCH',
      body: { municipio_id: municipioId },
    }),

  adminEstatisticas: () => request<Estatisticas>('/api/v1/auth/admin/estatisticas/'),

  getMunicipiosComAdmin: () => request<Municipio[]>('/api/v1/municipios/com_admin/'),
};
