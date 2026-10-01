/**
 * Quem vê o painel: gestor para cima (contrato v3, §3 — "BI, exportações").
 * Espelha `core/permissoes.nivel` do backend; o servidor confere de novo em
 * cada rota, isto aqui só evita mostrar uma tela que daria 403.
 */

import type { User } from '@/types';

const NIVEL: Record<string, number> = {
  cidadao: 0,
  operador: 1,
  gestor: 2,
  admin_municipal: 3,
  super_admin: 4,
};

export function nivelDoUsuario(user: User | null | undefined) {
  if (!user) return 0;
  if (user.papel && user.papel in NIVEL) return NIVEL[user.papel];
  // Sessão salva antes do contrato v3 (sem `papel`): o `admin` antigo era o
  // administrador municipal, e o backfill do servidor o tornou isso.
  if (user.super_admin) return NIVEL.super_admin;
  return user.admin ? NIVEL.admin_municipal : 0;
}

export function podeVerPainel(user: User | null | undefined) {
  return nivelDoUsuario(user) >= NIVEL.gestor;
}
