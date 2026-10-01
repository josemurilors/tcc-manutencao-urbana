/**
 * Rota antiga "Gerenciar usuários". Virou a tela de Equipe (`/admin/equipe`),
 * restrita ao município; fica o redirecionamento para links e telas que
 * ainda apontam para cá (ex.: atalho do Painel).
 */

import { Redirect, type Href } from 'expo-router';

export default function UsuariosRedirect() {
  return <Redirect href={'/admin/equipe' as Href} />;
}
