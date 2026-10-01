/**
 * Chamadas da gestão municipal — contrato v3, seção 7.6 (`api/v1/gestao/`).
 *
 * Tudo é do município do usuário logado (o backend resolve pelo token). O
 * super_admin poderia passar `?municipio=`; o app ainda não oferece a troca.
 */

import type { User } from '@/types';
import type {
  AlteracaoMembro,
  CategoriaAlteracao,
  CategoriaGestao,
  ConfigMunicipio,
  ConfigMunicipioAlteracao,
  ConviteMembro,
  Equipe,
  EquipeEntrada,
  FilaModeracao,
  FiltrosAuditoria,
  Membro,
  Pagina,
  RegistroAuditoria,
  Secretaria,
  SecretariaEntrada,
} from '@/types/gestao';

import { request } from './api';

const BASE = '/api/v1/gestao';

/**
 * Normaliza para `Pagina<T>`: o contrato pede paginação DRF nas listas
 * grandes, mas aceitar um array cru evita quebrar a tela se o backend optar
 * por devolver tudo de uma vez numa lista curta.
 */
async function pagina<T>(endpoint: string): Promise<Pagina<T>> {
  const data = await request<Pagina<T> | T[]>(endpoint);
  if (Array.isArray(data)) return { count: data.length, next: null, results: data };
  return {
    count: data?.count ?? data?.results?.length ?? 0,
    next: data?.next ?? null,
    previous: data?.previous ?? null,
    results: data?.results ?? [],
  };
}

/** Lista curta (secretarias, categorias): aceita paginado ou array. */
async function lista<T>(endpoint: string): Promise<T[]> {
  const data = await request<Pagina<T> | T[]>(endpoint);
  return Array.isArray(data) ? data : (data?.results ?? []);
}

function query(params: Record<string, string | number | null | undefined>) {
  const q = new URLSearchParams();
  for (const [chave, valor] of Object.entries(params)) {
    if (valor !== undefined && valor !== null && valor !== '') q.set(chave, String(valor));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const apiGestao = {
  // --- Perfil (revalida papel; ver components/gestao/papeis.ts) ---
  perfil: () => request<User & { secretaria_id?: number | null; equipe_id?: number | null }>(
    '/api/v1/auth/profile/',
  ),

  // --- Município ---
  municipio: () => request<ConfigMunicipio>(`${BASE}/municipio/`),
  salvarMunicipio: (dados: ConfigMunicipioAlteracao) =>
    request<ConfigMunicipio>(`${BASE}/municipio/`, { method: 'PATCH', body: dados }),

  // --- Equipe (membros) ---
  membros: (filtros: { q?: string; papel?: string; page?: number } = {}) =>
    pagina<Membro>(`${BASE}/membros/${query(filtros)}`),
  convidarMembro: (dados: ConviteMembro) =>
    request<Membro>(`${BASE}/membros/`, { method: 'POST', body: dados }),
  alterarMembro: (id: string, dados: AlteracaoMembro) =>
    request<Membro>(`${BASE}/membros/${id}/`, { method: 'PATCH', body: dados }),
  /** Revoga o acesso: a pessoa volta a ser cidadã (a conta continua existindo). */
  revogarMembro: (id: string) =>
    request<unknown>(`${BASE}/membros/${id}/`, { method: 'DELETE' }).catch(semCorpo),

  // --- Secretarias ---
  secretarias: () => lista<Secretaria>(`${BASE}/secretarias/`),
  criarSecretaria: (dados: SecretariaEntrada) =>
    request<Secretaria>(`${BASE}/secretarias/`, { method: 'POST', body: dados }),
  salvarSecretaria: (id: number, dados: Partial<SecretariaEntrada>) =>
    request<Secretaria>(`${BASE}/secretarias/${id}/`, { method: 'PATCH', body: dados }),
  excluirSecretaria: (id: number) =>
    request<unknown>(`${BASE}/secretarias/${id}/`, { method: 'DELETE' }).catch(semCorpo),

  // --- Equipes ---
  equipes: () => lista<Equipe>(`${BASE}/equipes/`),
  criarEquipe: (dados: EquipeEntrada) =>
    request<Equipe>(`${BASE}/equipes/`, { method: 'POST', body: dados }),
  salvarEquipe: (id: number, dados: Partial<EquipeEntrada>) =>
    request<Equipe>(`${BASE}/equipes/${id}/`, { method: 'PATCH', body: dados }),
  excluirEquipe: (id: number) =>
    request<unknown>(`${BASE}/equipes/${id}/`, { method: 'DELETE' }).catch(semCorpo),

  // --- Categorias e SLA ---
  categorias: () => lista<CategoriaGestao>(`${BASE}/categorias/`),
  salvarCategoria: (categoriaId: number, dados: CategoriaAlteracao) =>
    request<CategoriaGestao>(`${BASE}/categorias/${categoriaId}/`, { method: 'PATCH', body: dados }),

  // --- Moderação ---
  moderacao: async (): Promise<FilaModeracao> => {
    const data = await request<Partial<FilaModeracao>>(`${BASE}/moderacao/`);
    return {
      sinalizados: data?.sinalizados ?? [],
      removidos: data?.removidos ?? [],
      usuarios: data?.usuarios ?? [],
    };
  },
  removerChamado: (id: string, motivo: string) =>
    request<unknown>(`${BASE}/moderacao/defeitos/${id}/remover/`, {
      method: 'POST',
      body: { motivo },
    }),
  restaurarChamado: (id: string, motivo?: string) =>
    request<unknown>(`${BASE}/moderacao/defeitos/${id}/restaurar/`, {
      method: 'POST',
      body: motivo ? { motivo } : {},
    }),
  suspenderUsuario: (id: string, dias: number, motivo: string) =>
    request<unknown>(`${BASE}/moderacao/usuarios/${id}/suspender/`, {
      method: 'POST',
      body: { dias, motivo },
    }),
  reativarUsuario: (id: string) =>
    request<unknown>(`${BASE}/moderacao/usuarios/${id}/reativar/`, { method: 'POST', body: {} }),

  // --- Auditoria ---
  auditoria: (filtros: FiltrosAuditoria & { page?: number } = {}) =>
    pagina<RegistroAuditoria>(`${BASE}/auditoria/${query(filtros)}`),
};

/**
 * DELETE com 204 não tem corpo, e o `request` comum tenta ler JSON da
 * resposta: o `res.json()` falha com SyntaxError mesmo a operação tendo dado
 * certo. Só esse caso é engolido — qualquer erro HTTP vira `Error` antes.
 */
function semCorpo(err: unknown): null {
  if (err instanceof SyntaxError) return null;
  throw err;
}
