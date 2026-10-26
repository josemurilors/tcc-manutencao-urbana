import { NavLink, useNavigate } from 'react-router-dom';
import { Sun, Moon, MagnifyingGlass } from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/utils';
import { paginasDo } from './paginas';
import UserDropdown from './ui/user-dropdown';
import SyncIndicator from './ui/sync-indicator';

/** Navegação principal: só ícone no celular, ícone e nome a partir do `md`. */
function AppNav() {
  const { user } = useAuth();
  return (
    <nav aria-label="Principal" className="flex items-center gap-0.5">
      {paginasDo(user).filter(p => p.nav).map(({ path, icon: Icon, label }) => (
        <NavLink key={path} to={path} aria-label={label} title={label}
          className={({ isActive }) => cn(
            'flex items-center gap-1.5 h-8 px-2 md:px-3 rounded-md text-xs font-medium transition-colors',
            isActive
              ? 'bg-[var(--color-gold-muted)] text-[var(--color-gold-text)]'
              : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]'
          )}>
          <Icon size={16} />
          <span className="hidden md:inline">{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export function AppHeader({ onToggleTheme, onOpenCmd, theme }) {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="flex items-center justify-between gap-2 h-14 px-4 sm:px-5 shrink-0 border-b bg-[var(--color-bg-elevated)] z-[1000]">
      <div className="flex items-center gap-3 min-w-0">
        <button type="button" onClick={() => navigate('/mapa')} aria-label="Ir para o mapa" className="flex items-center gap-2 shrink-0">
          <span className="flex items-center justify-center size-7 rounded-sm overflow-hidden border border-[var(--color-icon)]">
            <img src="/icon.svg" alt="" className="size-full object-cover" />
          </span>
          <span className="hidden lg:block text-left">
            <span className="block text-sm font-medium text-foreground">Central de Inteligência Urbana</span>
            <span className="block text-xs text-[var(--color-text-muted)]">Chamados para Serviços Públicos</span>
          </span>
        </button>
        {isAuthenticated && <AppNav />}
      </div>

      <div className="flex items-center gap-1 sm:gap-2 shrink-0">
        <SyncIndicator />
        {isAuthenticated && (
          <button onClick={onOpenCmd} aria-label="Buscar (Ctrl+K)"
            className="flex items-center gap-1.5 h-8 px-2 sm:px-3 text-xs transition-colors text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]">
            <MagnifyingGlass size={14} />
            <span className="hidden sm:inline opacity-60">Ctrl+K</span>
          </button>
        )}
        <button onClick={onToggleTheme} aria-label={theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
          className="flex items-center justify-center size-8 transition-colors text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]">
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        {isAuthenticated ? <UserDropdown /> : (
          <button onClick={() => navigate('/login')}
            className="text-xs font-medium h-8 px-3 transition-colors text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]">
            Entrar
          </button>
        )}
      </div>
    </header>
  );
}
