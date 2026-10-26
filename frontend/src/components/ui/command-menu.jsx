import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { paginasDo } from '../paginas';


export function CommandMenu({ open, onClose, user }) {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);

  const filtered = paginasDo(user).filter(p => {
    if (!query) return true;
    const q = query.toLowerCase();
    return p.label.toLowerCase().includes(q) || p.keywords.toLowerCase().includes(q) || p.path.toLowerCase().includes(q);
  });

  useEffect(() => { setSelectedIdx(0); }, [query]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50); else setQuery(''); }, [open]);

  const handleSelect = useCallback((item) => { navigate(item.path); onClose?.(); }, [navigate, onClose]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, filtered.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); }
      else if (e.key === 'Enter' && filtered[selectedIdx]) { e.preventDefault(); handleSelect(filtered[selectedIdx]); }
      else if (e.key === 'Escape') { onClose?.(); }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, filtered, selectedIdx, handleSelect, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[5000] bg-black/70 backdrop-blur-sm" onClick={onClose} />
          <motion.div initial={{ opacity: 0, scale: 0.96, y: -20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: -20 }}
            transition={{ duration: 0.2, ease: [0.16,1,0.3,1] }} className="fixed top-[15%] left-1/2 -translate-x-1/2 z-[5001] w-full max-w-lg">
            <div className="rounded-lg border overflow-hidden shadow-2xl" style={{ background: 'var(--color-bg-surface)', borderColor: 'var(--color-border-default)' }}>
              <div className="flex items-center gap-3 px-4 h-12 border-b" style={{ borderColor: 'var(--color-border-default)' }}>
                <MagnifyingGlass size={18} style={{ color: 'var(--color-text-muted)' }} />
                <input ref={inputRef} type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar páginas..."
                  className="flex-1 bg-transparent border-none outline-none text-sm" style={{ color: 'var(--color-text-primary)' }} />
                <kbd className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono"
                  style={{ background: 'var(--color-bg-elevated)', color: 'var(--color-text-muted)' }}>ESC</kbd>
              </div>
              <div className="max-h-72 overflow-y-auto p-2">
                {filtered.length === 0 && <p className="py-6 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>Nenhum resultado para "{query}"</p>}
                {filtered.map((item, i) => (
                  <button key={item.path} onClick={() => handleSelect(item)}
                    className="flex items-center gap-3 w-full px-3 py-2.5 rounded-md text-sm transition-colors"
                    style={{ background: i === selectedIdx ? 'var(--color-bg-elevated)' : 'transparent', color: i === selectedIdx ? 'var(--color-text-primary)' : 'var(--color-text-secondary)' }}>
                    <item.icon size={18} weight={i === selectedIdx ? 'bold' : 'regular'} style={{ color: i === selectedIdx ? 'var(--color-gold-500)' : 'var(--color-text-muted)' }} />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
