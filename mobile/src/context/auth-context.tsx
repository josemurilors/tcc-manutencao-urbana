/**
 * Autenticação.
 *
 * Diferenças em relação ao web:
 * - a sessão é hidratada de forma assíncrona do SecureStore no boot;
 * - push é nativo (Expo Push, `hooks/use-push.ts`): com sessão aberta o token
 *   do aparelho é sincronizado em silêncio, e o logout o desvincula. O pedido
 *   de permissão nunca sai daqui — só em momentos de contexto.
 *
 * O usuário segue o contrato v3 (`Usuario`: papel, secretaria, equipe,
 * aceite dos termos, suspensão) e é reconferido com o servidor a cada boot,
 * porque papel e suspensão mudam do lado da prefeitura.
 */

import { useRootNavigationState } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import {
  removerPushDoAparelho,
  sincronizarPush,
  useAbrirChamadoDaNotificacao,
} from '@/hooks/use-push';
import { api, setUnauthorizedHandler } from '@/services/api';
import { contaApi } from '@/services/api-conta';
import {
  clearSession,
  getStoredUser,
  hydrateSession,
  mergeStoredUser,
  setRefresh,
  setStoredUser,
  setToken,
} from '@/services/storage';
import type { AuthResponse, Municipio } from '@/types';
import type { PapelUsuario, Usuario } from '@/types/conta';
import { decodeJwt } from '@/utils/jwt';

type AuthContextValue = {
  user: Usuario | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (response: AuthResponse) => Promise<void>;
  /**
   * Encerra a sessão. `contaExcluida`: a conta já foi apagada no servidor
   * (os tokens de push foram junto), então não há o que desvincular.
   */
  logout: (opcoes?: { contaExcluida?: boolean }) => Promise<void>;
  updateUser: (updates: Partial<Usuario>) => Promise<void>;
};

const PAPEIS_EQUIPE: readonly string[] = ['operador', 'gestor', 'admin_municipal', 'super_admin'];

/** Papel efetivo, inclusive para usuários salvos antes do contrato v3 (só `admin`). */
export function papelDe(user: Usuario | null | undefined): PapelUsuario | string {
  if (!user) return 'cidadao';
  if (user.papel) return user.papel;
  if (user.super_admin) return 'super_admin';
  return user.admin ? 'admin_municipal' : 'cidadao';
}

/** Servidor da prefeitura (operador ou acima). */
export function ehEquipe(user: Usuario | null | undefined) {
  return PAPEIS_EQUIPE.includes(papelDe(user));
}

/**
 * Falta aceitar os termos: só quando o backend manda o campo e ele vem nulo
 * (backend antigo, sem o campo, não bloqueia ninguém).
 */
export function precisaAceitarTermos(user: Usuario | null | undefined) {
  return !!user && user.aceite_termos_em === null;
}

/** Normaliza o que vem do servidor/armazenamento para o formato do app. */
function normalizarUsuario(dados: Partial<Usuario>): Partial<Usuario> {
  return {
    ...dados,
    email_verificado: dados.email_verificado ?? dados.email_verified ?? false,
  };
}

function avisarFalhaPush(acao: string) {
  return (err: unknown) => console.warn(`[push] falha ao ${acao}`, err);
}

const AuthContext = createContext<AuthContextValue | null>(null);

const decodeToken = decodeJwt;

/** O município precisa do polígono e do bounding box para desenhar o mapa. */
function precisaCarregarMunicipio(user: Usuario) {
  if (!user.municipio_id) return false;
  const m = user.municipio;
  return (
    !m ||
    !m.poligono_json ||
    typeof m.min_lat !== 'number' ||
    typeof m.max_lat !== 'number' ||
    typeof m.min_lng !== 'number' ||
    typeof m.max_lng !== 'number'
  );
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Usuario | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Toque numa notificação abre o chamado — só depois da sessão lida e da
  // pilha raiz montada (navegar antes disso quebra o router).
  const navegacao = useRootNavigationState();
  useAbrirChamadoDaNotificacao(!loading && !!navegacao?.key);

  // Um logout por vez: o DELETE do push com a sessão já morta dá 401, o
  // refresh falha e o `onUnauthorized` chamaria o logout de novo, em cascata.
  const saindo = useRef(false);

  const logout = useCallback(async (opcoes?: { contaExcluida?: boolean }) => {
    if (saindo.current) return;
    saindo.current = true;
    try {
      // Desvincula o aparelho enquanto o token de sessão ainda vale; se falhar
      // (sessão já expirada, sem rede), sair continua valendo.
      if (!opcoes?.contaExcluida) {
        await removerPushDoAparelho().catch(avisarFalhaPush('desvincular o aparelho'));
      }
      setTokenState(null);
      setUser(null);
      await clearSession();
    } finally {
      saindo.current = false;
    }
  }, []);

  // Derruba a sessão quando o refresh token também expira.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      logout();
    });
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  const carregarMunicipio = useCallback(async (municipioId: string) => {
    try {
      const mun = await api.getMunicipio(municipioId);
      // O endpoint devolve GeoJSON Feature; achatamos como o web faz.
      const flat = { ...mun.properties, id: mun.id } as Municipio;
      setUser((prev) => (prev ? { ...prev, municipio: flat } : prev));
      await mergeStoredUser({ municipio: flat });
    } catch {
      // Sem o polígono o mapa apenas não desenha o perímetro.
    }
  }, []);

  /** Monta o usuário a partir do token + dados salvos e busca o município se faltar. */
  const aplicarSessao = useCallback(
    async (accessToken: string) => {
      const payload = decodeToken(accessToken);
      if (!payload) {
        await logout();
        return;
      }
      const stored = ((await getStoredUser()) ?? {}) as Partial<Usuario>;
      const base: Usuario = {
        id: stored.id ?? payload.user_id ?? '',
        email: stored.email ?? payload.email ?? '',
        nome: stored.nome ?? '',
        cpf: stored.cpf ?? null,
        admin: stored.admin ?? false,
        super_admin: stored.super_admin ?? false,
        municipio_id: stored.municipio_id ?? null,
        municipio: stored.municipio ?? null,
        email_verificado: stored.email_verificado ?? stored.email_verified ?? false,
        papel: stored.papel,
        secretaria_id: stored.secretaria_id ?? null,
        equipe_id: stored.equipe_id ?? null,
        aceite_termos_em: stored.aceite_termos_em,
        suspenso_ate: stored.suspenso_ate ?? null,
      };
      setUser(base);
      if (precisaCarregarMunicipio(base)) await carregarMunicipio(base.municipio_id!);
    },
    [carregarMunicipio, logout],
  );

  /**
   * Reconfere o perfil no servidor sem travar o boot: papel, suspensão e
   * aceite dos termos mudam do lado da prefeitura. Offline, fica o salvo.
   */
  const reconferirPerfil = useCallback(async () => {
    try {
      const atual = normalizarUsuario(await contaApi.perfil());
      const salvo = await getStoredUser();
      // O perfil não traz o polígono do município: preserva o já carregado,
      // a menos que a cidade tenha mudado.
      // Compara como texto: o código IBGE já veio salvo como número em versões antigas.
      const trocouMunicipio = String(atual.municipio_id ?? '') !== String(salvo?.municipio_id ?? '');
      setUser((prev) =>
        prev ? { ...prev, ...atual, municipio: trocouMunicipio ? null : prev.municipio } : prev,
      );
      await mergeStoredUser(trocouMunicipio ? { ...atual, municipio: null } : atual);
      if (trocouMunicipio && atual.municipio_id) await carregarMunicipio(atual.municipio_id);
    } catch (err) {
      console.warn('[auth] não foi possível reconferir o perfil', err);
    }
  }, [carregarMunicipio]);

  // Boot: lê SecureStore e reconstrói a sessão.
  useEffect(() => {
    let cancelado = false;
    (async () => {
      const session = await hydrateSession();
      if (cancelado) return;
      if (session.token) {
        setTokenState(session.token);
        await aplicarSessao(session.token);
        // Em segundo plano: não seguram a splash.
        reconferirPerfil();
        sincronizarPush().catch(avisarFalhaPush('registrar o aparelho'));
      }
      if (!cancelado) setLoading(false);
    })();
    return () => {
      cancelado = true;
    };
  }, [aplicarSessao, reconferirPerfil]);

  const login = useCallback(
    async (response: AuthResponse) => {
      const { access, refresh, user: userData } = response;
      await setToken(access);
      if (refresh) await setRefresh(refresh);
      if (userData) await setStoredUser(userData);
      setTokenState(access);
      if (userData) {
        const normalizado = normalizarUsuario(userData) as Usuario;
        setUser(normalizado);
        if (precisaCarregarMunicipio(normalizado)) {
          await carregarMunicipio(normalizado.municipio_id!);
        }
      } else {
        await aplicarSessao(access);
      }
      // Quem já tinha ligado o push neste aparelho volta a recebê-lo na conta
      // que acabou de entrar.
      sincronizarPush().catch(avisarFalhaPush('registrar o aparelho'));
    },
    [aplicarSessao, carregarMunicipio],
  );

  const updateUser = useCallback(async (updates: Partial<Usuario>) => {
    setUser((prev) => (prev ? { ...prev, ...updates } : prev));
    await mergeStoredUser(updates);
  }, []);

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: !!token,
      loading,
      login,
      logout,
      updateUser,
    }),
    [user, token, loading, login, logout, updateUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>');
  return ctx;
}
