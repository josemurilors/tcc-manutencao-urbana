/**
 * Conta e LGPD — rotas novas de `api/v1/auth/` (contrato v3 §7.7):
 * recuperação de senha, aceite dos termos e exportação dos próprios dados.
 */

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import type { MeusDados, Usuario } from '@/types/conta';

import { request } from './api';

const BASE = '/api/v1/auth';

/** Versão dos termos mostrada no app; sobe junto com o texto de `app/termos.tsx`. */
export const VERSAO_TERMOS = '2026-10';

export const contaApi = {
  /** Perfil atualizado (papel, aceite, suspensão podem mudar no servidor). */
  perfil: () => request<Usuario>(`${BASE}/profile/`),

  /**
   * Pede o código de redefinição. O backend responde 200 exista ou não a
   * conta (não dá para descobrir e-mails cadastrados por aqui).
   */
  esqueciSenha: (email: string) =>
    request<{ detail?: string }>(`${BASE}/senha/esqueci/`, {
      method: 'POST',
      body: { email },
      publico: true,
    }),

  redefinirSenha: (email: string, codigo: string, novaSenha: string) =>
    request<{ detail?: string }>(`${BASE}/senha/redefinir/`, {
      method: 'POST',
      body: { email, codigo, nova_senha: novaSenha },
      publico: true,
    }),

  /**
   * Registra o aceite dos termos e da política. `accessToken` permite aceitar
   * antes de abrir a sessão no app (o fluxo de entrada só "entra" depois do
   * aceite); sem ele, vale o token da sessão atual.
   */
  aceitarTermos: async (
    accessToken?: string,
  ): Promise<Partial<Usuario> & { aceite_termos_em: string }> => {
    // O backend responde `{user}`; o contrato também admite `{aceite_termos_em}`.
    // Normaliza para o usuário atualizado com a data sempre preenchida.
    const r = await request<{ user?: Usuario; aceite_termos_em?: string | null }>(
      `${BASE}/aceite-termos/`,
      {
        method: 'POST',
        body: { versao: VERSAO_TERMOS },
        ...(accessToken && { headers: { Authorization: `Bearer ${accessToken}` } }),
      },
    );
    const usuario: Partial<Usuario> = r.user ?? {};
    return {
      ...usuario,
      aceite_termos_em:
        usuario.aceite_termos_em ?? r.aceite_termos_em ?? new Date().toISOString(),
    };
  },

  meusDados: () => request<MeusDados>(`${BASE}/meus-dados/`),
};

/**
 * Baixa a exportação dos dados (direito de acesso e portabilidade, LGPD
 * art. 18) e entrega como arquivo `.json`: no celular, pela folha de
 * compartilhamento do sistema (salvar em Arquivos, mandar por e-mail...);
 * no navegador, como download.
 */
export async function baixarMeusDados(): Promise<void> {
  const dados = await contaApi.meusDados();
  const conteudo = JSON.stringify(dados, null, 2);
  const data = new Date().toISOString().slice(0, 10);
  const nome = `meus-dados-ciu-${data}.json`;

  if (Platform.OS === 'web') {
    const blob = new Blob([conteudo], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nome;
    link.click();
    URL.revokeObjectURL(url);
    return;
  }

  const arquivo = new File(Paths.cache, nome);
  arquivo.create({ overwrite: true });
  arquivo.write(conteudo);
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Este aparelho não permite compartilhar arquivos.');
  }
  await Sharing.shareAsync(arquivo.uri, {
    mimeType: 'application/json',
    dialogTitle: 'Meus dados — CIU',
    UTI: 'public.json',
  });
}
