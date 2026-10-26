import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, List, User, ChartBar, Users, SignOut } from '@phosphor-icons/react';
import { useAuth } from '../../context/AuthContext';

export default function UserDropdown() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const ref = useRef(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function handleNav(path) {
    setOpen(false);
    navigate(path);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center justify-center w-8 h-8 rounded-full border text-xs font-semibold transition-colors select-none"
        style={{
          borderColor: open ? 'var(--color-gold-500)' : 'var(--color-border-default)',
          color: 'var(--color-text-secondary)',
          background: open ? 'var(--color-bg-surface)' : 'var(--color-bg-surface)',
        }}
        aria-label="Menu do usuário"
        aria-expanded={open}
      >
        {user?.nome?.charAt(0)?.toUpperCase() || '?'}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.96 }}
            transition={{ duration: 0.15, ease: [0.16,1,0.3,1] }}
            className="absolute right-0 top-full mt-2 min-w-[200px] rounded-lg border p-1.5 shadow-lg z-[3000]"
            style={{ background: 'var(--color-bg-elevated)', borderColor: 'var(--color-border-default)' }}
          >
            <div className="px-3 py-2">
              <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>
                {user?.nome || 'Usuário'}
              </p>
              <p className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>
                {user?.email || ''}
              </p>
              {user?.municipio?.nome && (
                <p className="text-xs truncate mt-0.5" style={{ color: 'var(--color-gold-text)' }}>
                  {user.municipio.nome} - {user.municipio.uf_sigla}
                </p>
              )}
            </div>

            <div className="h-px mx-2" style={{ background: 'var(--color-border-default)' }} />

            <button onClick={() => handleNav('/mapa')} className="flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-sm transition-colors" style={{ color: 'var(--color-text-secondary)' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}>
              <MapPin size={16} /> Mapa
            </button>
            <button onClick={() => handleNav('/lista')} className="flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-sm transition-colors" style={{ color: 'var(--color-text-secondary)' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}>
              <List size={16} /> Lista de Chamados
            </button>
            <button onClick={() => handleNav('/conta')} className="flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-sm transition-colors" style={{ color: 'var(--color-text-secondary)' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}>
              <User size={16} /> Configurações
            </button>

            {user?.admin && (
              <>
                <div className="h-px mx-2" style={{ background: 'var(--color-border-default)' }} />
                <p className="px-3 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
                  Administração
                </p>
                <button onClick={() => handleNav('/admin/dashboard')} className="flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-sm transition-colors" style={{ color: 'var(--color-text-secondary)' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}>
                  <ChartBar size={16} /> Métricas
                </button>
                {['admin_municipal', 'super_admin'].includes(user?.papel) && (
                  <button onClick={() => handleNav('/admin/usuarios')} className="flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-sm transition-colors" style={{ color: 'var(--color-text-secondary)' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}>
                    <Users size={16} /> Usuários
                  </button>
                )}
              </>
            )}

            <div className="h-px mx-2" style={{ background: 'var(--color-border-default)' }} />
            <button onClick={() => { setOpen(false); logout(); }} className="flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-sm transition-colors"
              style={{ color: 'var(--color-error)' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(207,68,68,0.12)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
              <SignOut size={16} /> Sair
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
