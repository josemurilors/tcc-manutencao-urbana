import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

function AnimatedCount({ value, duration = 1.5 }) {
  const [display, setDisplay] = useState(0);
  const prev = useRef(0);
  const frame = useRef(null);

  useEffect(() => {
    const start = prev.current;
    const diff = value - start;
    if (diff === 0) { setDisplay(value); return; }
    const startTime = performance.now();
    function tick(now) {
      const t = Math.min((now - startTime) / 1000 / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(start + diff * eased));
      if (t < 1) frame.current = requestAnimationFrame(tick);
      else { setDisplay(value); prev.current = value; }
    }
    frame.current = requestAnimationFrame(tick);
    return () => { if (frame.current) cancelAnimationFrame(frame.current); };
  }, [value, duration]);
  return <>{display.toLocaleString()}</>;
}

export function KpiCard({ title, value, icon: Icon, variation, format, className }) {
  const isUp = variation > 0;
  const isDown = variation < 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16,1,0.3,1] }}
      className={cn(
        'relative overflow-hidden rounded-xl border border-[var(--color-border-default)] p-5 flex flex-col gap-2',
        'bg-gradient-to-br from-[var(--color-bg-surface)] to-[var(--color-bg-primary)]',
        'transition-all duration-200 hover:border-[var(--color-border-hover)] hover:-translate-y-0.5 hover:shadow-[var(--card-shadow-gold)]',
        'before:absolute before:top-0 before:left-0 before:right-0 before:h-[2px] before:bg-[var(--color-gold-500)]',
        className
      )}
    >
      <div className="flex items-start justify-between">
        <span className="text-xs font-medium text-[var(--color-text-secondary)]">{title}</span>
        {Icon && (
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-[rgba(212,160,23,0.1)]">
            <Icon size={18} weight="bold" style={{ color: 'var(--color-gold-text)' }} />
          </div>
        )}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold tracking-tight text-[var(--color-gold-text)] leading-tight">
          {format === 'percent' ? <AnimatedCount value={value} /> : format === 'time' ? value : <AnimatedCount value={value} />}
          {format === 'percent' && <span className="text-lg ml-0.5">%</span>}
        </span>
      </div>
      {variation != null && (
        <div className="flex items-center gap-1.5">
          <span className={cn(
            'inline-flex items-center gap-0.5 text-xs font-semibold rounded-full px-1.5 py-0.5',
            isUp && 'text-[var(--color-success)] bg-[rgba(76,175,125,0.12)]',
            isDown && 'text-[var(--color-error)] bg-[rgba(207,68,68,0.12)]',
            !isUp && !isDown && 'text-[var(--color-text-muted)] bg-[var(--color-bg-elevated)]'
          )}>
            {isUp && '↑'} {isDown && '↓'} {Math.abs(variation).toFixed(1)}%
          </span>
          <span className="text-[10px] text-[var(--color-text-muted)]">vs mês anterior</span>
        </div>
      )}
    </motion.div>
  );
}
