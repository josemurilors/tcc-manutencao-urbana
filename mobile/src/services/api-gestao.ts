/**
 * Chamadas da gestão municipal — contrato v3, seção 7.6 (`api/v1/gestao/`).
 *
 * Tudo é do município do usuário logado (o backend resolve pelo token). O
 * super_admin escolhe o município no topo das telas de gestão
 * (`components/gestao/municipio-gestao.ts`) e `req` acrescenta o
 * `?municipio=` em toda chamada de `gestao/`.
 */

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { municipioGestao } from '@/components/gestao/municipio-gestao';
import type { User } from '@/types';
import type {
  AlteracaoMembro,
  CategoriaAlteracao,
  CategoriaGestao,
  ConfigMunicipio,
  ConfigMunicipioAlteracao,
  Convite,
  ConviteMembro,
  ConviteResposta,
  Equipe,
  EquipeEntrada,
  FilaModeracao,
  FiltrosAuditoria,
  Membro,
  Pagina,
  RegistroAuditoria,
  RespostaPadraoEntrada,
  RespostaPadraoGestao,
  RevogacaoMembro,
  Secretaria,
  SecretariaEntrada,
  UsuarioModerado,
} from '@/types/gestao';

import { API_URL, request } from './api';
import { getTokenSync } from './storage';

const BASE = '/api/v1/gestao';
const RESPOSTAS = '/api/v1/operacao/respostas-padrao';

type Opcoes = Parameters<typeof request>[1];

/** Endpoint com o `?municipio=` do super_admin, quando ele escolheu um. */
function comMunicipio(endpoint: string) {
  const codigo = municipioGestao()?.codigo;
  if (!codigo) return endpoint;
  return `${endpoint}${endpoint.includes('?') ? '&' : '?'}municipio=${encodeURIComponent(codigo)}`;
}

/** `request` das rotas de `gestao/` (com o município escolhido). */
function req<T>(endpoint: string, opcoes?: Opcoes) {
  return request<T>(comMunicipio(endpoint), opcoes);
}

/**
 * Normaliza para `Pagina<T>`: o contrato pede paginação DRF nas listas
 * grandes, mas aceitar um array cru evita quebrar a tela se o backend optar
 * por devolver tudo de uma vez numa lista curta.
 */
async function pagina<T>(endpoint: string): Promise<Pagina<T>> {
  const data = await req<Pagina<T> | T[]>(endpoint);
  if (Array.isArray(data)) return { count: data.length, next: null, results: data };
  return {
    count: data?.count ?? data?.results?.length ?? 0,
    next: data?.next ?? null,
    previous: data?.previous ?? null,
    results: data?.results ?? [],
  };
}

/** Lista curta (secretarias, categorias): aceita paginado ou array. */
async function lista<T>(endpoint: string, doMunicipioEscolhido = true): Promise<T[]> {
  const data = doMunicipioEscolhido
    ? await req<Pagina<T> | T[]>(endpoint)
    : await request<Pagina<T> | T[]>(endpoint);
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
  municipio: () => req<ConfigMunicipio>(`${BASE}/municipio/`),
  salvarMunicipio: (dados: ConfigMunicipioAlteracao) =>
    req<ConfigMunicipio>(`${BASE}/municipio/`, { method: 'PATCH', body: dados }),

  // --- Equipe (membros) ---
  /** Paginado no servidor (30 por página, papel mais alto primeiro). */
  membros: (filtros: { q?: string; papel?: string; page?: number } = {}) =>
    pagina<Membro>(`${BASE}/membros/${query(filtros)}`),
  /**
   * Conta existente: vira membro na hora (devolve o `Membro`). E-mail sem
   * conta: o backend cria (ou renova) um convite e manda por e-mail
   * (devolve `{convite, email_enviado}`); o papel entra quando a pessoa
   * entrar com esse e-mail verificado.
   */
  convidarMembro: (dados: ConviteMembro) =>
    req<Membro | ConviteResposta>(`${BASE}/membros/`, { method: 'POST', body: dados }),
  alterarMembro: (id: string, dados: AlteracaoMembro) =>
    req<Membro>(`${BASE}/membros/${id}/`, { method: 'PATCH', body: dados }),
  /**
   * Revoga o acesso: a pessoa volta a ser cidadã (a conta continua existindo)
   * e os chamados abertos dela voltam para a fila (`chamados_liberados`).
   */
  revogarMembro: (id: string) =>
    req<RevogacaoMembro>(`${BASE}/membros/${id}/`, { method: 'DELETE' }),

  // --- Convites pendentes (e-mail ainda sem conta) ---
  convites: () => lista<Convite>(`${BASE}/convites/`),
  /** Manda o e-mail de novo e renova o prazo (reabre um vencido). */
  reenviarConvite: (id: number) =>
    req<ConviteResposta>(`${BASE}/convites/${id}/reenviar/`, { method: 'POST', body: {} }),
  cancelarConvite: (id: number) =>
    req<unknown>(`${BASE}/convites/${id}/`, { method: 'DELETE' }).catch(semCorpo),

  // --- Respostas-padrão (rota da operação: sempre do município do usuário) ---
  respostasPadrao: () => lista<RespostaPadraoGestao>(`${RESPOSTAS}/`, false),
  criarRespostaPadrao: (dados: RespostaPadraoEntrada) =>
    request<RespostaPadraoGestao>(`${RESPOSTAS}/`, { method: 'POST', body: dados }),
  salvarRespostaPadrao: (id: number, dados: Partial<RespostaPadraoEntrada>) =>
    request<RespostaPadraoGestao>(`${RESPOSTAS}/${id}/`, { method: 'PATCH', body: dados }),
  excluirRespostaPadrao: (id: number) =>
    request<unknown>(`${RESPOSTAS}/${id}/`, { method: 'DELETE' }).catch(semCorpo),

  // --- Secretarias ---
  secretarias: () => lista<Secretaria>(`${BASE}/secretarias/`),
  criarSecretaria: (dados: SecretariaEntrada) =>
    req<Secretaria>(`${BASE}/secretarias/`, { method: 'POST', body: dados }),
  salvarSecretaria: (id: number, dados: Partial<SecretariaEntrada>) =>
    req<Secretaria>(`${BASE}/secretarias/${id}/`, { method: 'PATCH', body: dados }),
  excluirSecretaria: (id: number) =>
    req<unknown>(`${BASE}/secretarias/${id}/`, { method: 'DELETE' }).catch(semCorpo),

  // --- Equipes ---
  equipes: () => lista<Equipe>(`${BASE}/equipes/`),
  criarEquipe: (dados: EquipeEntrada) =>
    req<Equipe>(`${BASE}/equipes/`, { method: 'POST', body: dados }),
  salvarEquipe: (id: number, dados: Partial<EquipeEntrada>) =>
    req<Equipe>(`${BASE}/equipes/${id}/`, { method: 'PATCH', body: dados }),
  excluirEquipe: (id: number) =>
    req<unknown>(`${BASE}/equipes/${id}/`, { method: 'DELETE' }).catch(semCorpo),

  // --- Categorias e SLA ---
  categorias: () => lista<CategoriaGestao>(`${BASE}/categorias/`),
  salvarCategoria: (categoriaId: number, dados: CategoriaAlteracao) =>
    req<CategoriaGestao>(`${BASE}/categorias/${categoriaId}/`, { method: 'PATCH', body: dados }),

  // --- Moderação ---
  moderacao: async (): Promise<FilaModeracao> => {
    const data = await req<Partial<FilaModeracao>>(`${BASE}/moderacao/`);
    const sinalizados = data?.sinalizados ?? [];
    const removidos = data?.removidos ?? [];
    const usuarios = data?.usuarios ?? [];
    return {
      sinalizados,
      removidos,
      usuarios,
      contagens: {
        sinalizados: data?.contagens?.sinalizados ?? sinalizados.length,
        removidos: data?.contagens?.removidos ?? removidos.length,
        suspensos: data?.contagens?.suspensos ?? usuarios.filter((u) => u.suspenso).length,
        em_quarentena:
          data?.contagens?.em_quarentena ?? usuarios.filter((u) => u.em_quarentena).length,
      },
    };
  },
  removerChamado: (id: string, motivo: string) =>
    req<{ id: string; removido_em: string; removido_motivo: string; removido_texto?: string }>(
      `${BASE}/moderacao/defeitos/${id}/remover/`,
      { method: 'POST', body: { motivo } },
    ),
  restaurarChamado: (id: string, motivo?: string) =>
    req<{ id: string; strike_retirado?: boolean }>(
      `${BASE}/moderacao/defeitos/${id}/restaurar/`,
      { method: 'POST', body: motivo ? { motivo } : {} },
    ),
  suspenderUsuario: (id: string, dias: number, motivo: string) =>
    req<UsuarioModerado>(`${BASE}/moderacao/usuarios/${id}/suspender/`, {
      method: 'POST',
      body: { dias, motivo },
    }),
  reativarUsuario: (id: string) =>
    req<UsuarioModerado>(`${BASE}/moderacao/usuarios/${id}/reativar/`, {
      method: 'POST',
      body: {},
    }),

  // --- Auditoria ---
  auditoria: (filtros: FiltrosAuditoria & { page?: number } = {}) =>
    pagina<RegistroAuditoria>(`${BASE}/auditoria/${query(filtros)}`),
  /**
   * Baixa a auditoria com os mesmos filtros em CSV (`?formato=csv`): no web
   * dispara o download; no celular grava no cache e abre o compartilhar.
   */
  exportarAuditoria: (filtros: FiltrosAuditoria = {}) =>
    baixarCsv(
      comMunicipio(`${BASE}/auditoria/${query({ ...filtros, formato: 'csv' })}`),
      `auditoria-${new Date().toISOString().slice(0, 10)}.csv`,
    ),
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

async function buscarArquivo(endpoint: string) {
  const token = getTokenSync();
  return fetch(`${API_URL}${endpoint}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

/**
 * Download autenticado lendo o status e o `{detail}` do erro (mesmo padrão
 * de `api-bi.ts`): o `downloadFileAsync` gravaria a página de erro como se
 * fosse o arquivo.
 */
async function baixarCsv(endpoint: string, nome: string) {
  let res = await buscarArquivo(endpoint);
  if (res.status === 401) {
    // Token vencido: `request` sabe renovar pelo refresh; depois tenta de novo.
    await req(`${BASE}/municipio/`).catch(() => undefined);
    res = await buscarArquivo(endpoint);
  }
  if (!res.ok) {
    const corpo = await res.json().catch(() => null);
    if (corpo?.detail) throw new Error(String(corpo.detail));
    throw new Error(`Falha ao gerar o arquivo (erro ${res.status}).`);
  }

  if (Platform.OS === 'web') {
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Dá tempo do navegador começar o download antes de liberar o blob.
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
    mimeType: 'text/csv',
    dialogTitle: 'Exportar auditoria',
    UTI: 'public.comma-separated-values-text',
  });
  return destino.uri;
}
