import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export function Timeline({ items = [], className }) {
  if (!items.length) return null;
  return (
    <div className={cn('relative pl-8 space-y-0', className)}>
      <div className="absolute left-[11px] top-2 bottom-2 w-px" style={{ background: 'var(--color-border-default)' }} />
      {items.map((item, i) => (
        <motion.div key={item.id || i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, delay: i * 0.05 }} className="relative pb-6 last:pb-0">
          <div className={cn('absolute -left-[25px] top-1 w-[22px] h-[22px] rounded-full border-2 flex items-center justify-center',
            item.active ? 'border-[var(--color-gold-500)] shadow-[0_0_8px_rgba(212,160,23,0.4)]' : 'border-[var(--color-border-default)]'
          )} style={{ background: item.active ? 'var(--color-gold-500)' : 'var(--color-bg-primary)' }}>
            {item.active && <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="w-2 h-2 rounded-full bg-white" />}
          </div>
          <div className="rounded-md border p-4 transition-colors" style={{
            background: item.active ? 'var(--color-bg-surface)' : 'var(--color-bg-primary)',
            borderColor: item.active ? 'var(--color-border-default)' : 'var(--color-border-subtle)',
            opacity: item.active ? 1 : 0.6,
          }}>
            {item.title && <h4 className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>{item.title}</h4>}
            {item.description && <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{item.description}</p>}
            {item.date && <span className="text-xs mt-1.5 block" style={{ color: 'var(--color-text-muted)' }}>{item.date}</span>}
            {item.meta && <span className="text-xs ml-2" style={{ color: 'var(--color-text-muted)' }}>{item.meta}</span>}
            {item.children}
          </div>
        </motion.div>
      ))}
    </div>
  );
}
