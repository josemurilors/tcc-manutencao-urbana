import { MapPin, List, ChartBar, Users, User, GearSix } from '@phosphor-icons/react';

const ehAdminMunicipal = user => ['admin_municipal', 'super_admin'].includes(user?.papel);

/**
 * Única lista de páginas da web: a navegação do cabeçalho (`nav`), o Ctrl+K e
 * o menu do avatar leem daqui. `ver(user)` repete a regra de acesso da página
 * (`user.admin` espelha qualquer papel de equipe).
 */
export const PAGINAS = [
  { path: '/mapa', icon: MapPin, label: 'Mapa', keywords: 'mapa home', nav: true },
  { path: '/lista', icon: List, label: 'Chamados', keywords: 'chamados lista defeitos', nav: true },
  { path: '/admin/dashboard', icon: ChartBar, label: 'Métricas', keywords: 'metricas dashboard graficos', nav: true, ver: user => !!user?.admin },
  { path: '/admin/usuarios', icon: Users, label: 'Usuários', keywords: 'usuarios admin gerenciar', nav: true, ver: ehAdminMunicipal },
  { path: '/conta', icon: User, label: 'Minha conta', keywords: 'conta perfil configuracoes senha' },
  { path: '/configuracoes', icon: GearSix, label: 'Configurações gerais', keywords: 'configuracoes gerais' },
];

export function paginasDo(user) {
  return PAGINAS.filter(p => !p.ver || p.ver(user));
}
