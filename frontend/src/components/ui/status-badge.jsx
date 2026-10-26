import { cn } from '@/lib/utils';
import { getStatusLabel, statusVars } from './status-utils';

export function StatusBadge({ status, concluido_em, className, pulse }) {
  const { fg, bg, border } = statusVars(status, concluido_em);
  const label = getStatusLabel(status, concluido_em);

  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-xs font-semibold',
      pulse && 'animate-pulse', className
    )} style={{ color: fg, background: bg, borderColor: border }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: fg }} />
      {label}
    </span>
  );
}
