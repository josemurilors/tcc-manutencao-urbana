import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, WarningCircle, XCircle, Info, X } from '@phosphor-icons/react';
import { ToastContext } from './toast-context';

const config = {
  success: {
    icon: CheckCircle,
    bg: 'var(--color-success)',
    text: '#0A0A0A',
    border: 'rgba(255,255,255,0.15)',
  },
  warning: {
    icon: WarningCircle,
    bg: 'var(--color-gold-500)',
    text: '#0A0A0A',
    border: 'rgba(0,0,0,0.1)',
  },
  error: {
    icon: XCircle,
    bg: 'var(--color-bg-elevated)',
    text: 'var(--color-error)',
    border: 'rgba(207,68,68,0.3)',
  },
  info: {
    icon: Info,
    bg: 'var(--color-bg-elevated)',
    text: 'var(--color-info)',
    border: 'rgba(74,144,217,0.3)',
  },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'success', duration = 3500) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, duration);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={addToast}>
      {children}
      <div
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 pointer-events-none"
        aria-live="polite"
        aria-atomic="true"
      >
        <AnimatePresence mode="popLayout">
          {toasts.map(t => {
            const c = config[t.type] || config.info;
            const Icon = c.icon;
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                className="pointer-events-auto flex items-center gap-2.5 px-4 py-2.5 rounded-lg border text-sm font-medium shadow-lg max-w-sm"
                style={{
                  background: c.bg,
                  color: c.text,
                  borderColor: c.border,
                }}
              >
                <Icon size={18} weight="bold" />
                <span className="flex-1">{t.message}</span>
                <button
                  onClick={() => removeToast(t.id)}
                  className="flex items-center justify-center w-5 h-5 rounded opacity-60 hover:opacity-100 transition-opacity"
                  aria-label="Fechar"
                >
                  <X size={12} />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
