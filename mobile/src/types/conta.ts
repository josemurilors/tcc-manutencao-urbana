/** Tipos da conta e da LGPD (contrato v3 §2 `users` e §7.7). */

import type { User } from '@/types';

export type PapelUsuario = 'cidadao' | 'operador' | 'gestor' | 'admin_municipal' | 'super_admin';

/** Campos que o objeto `user` passou a trazer no contrato v3. */
export type CamposContaV3 = {
  papel?: PapelUsuario | (string & {});
  secretaria_id?: number | null;
  equipe_id?: number | null;
  /**
   * Quando aceitou os termos. `null` = o backend conhece o campo e a pessoa
   * ainda não aceitou; ausente = backend antigo, que não pergunta.
   */
  aceite_termos_em?: string | null;
  /** Conta suspensa pela moderação até esta data (ISO). */
  suspenso_ate?: string | null;
};

/** Usuário da sessão: o `User` antigo com os campos do contrato v3. */
export type Usuario = User & CamposContaV3;

/** Exportação de GET /auth/meus-dados/: JSON livre, só repassado ao arquivo. */
export type MeusDados = Record<string, unknown>;
