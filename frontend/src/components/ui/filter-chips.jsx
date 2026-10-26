import { cn } from '@/lib/utils';

/**
 * Filtros em pílula, como os `FilterChips` do app. `radiogroup` (e não abas):
 * os chips filtram a mesma lista. `options`: [{ value, label }].
 */
export function FilterChips({ options, value, onChange, label, disabled, className }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('flex items-center gap-1.5 flex-wrap', className)}>
      {options.map(o => {
        const ativo = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={ativo} disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              'h-8 px-3 rounded-full border text-xs font-medium whitespace-nowrap transition-colors disabled:opacity-50',
              ativo
                ? 'bg-primary border-primary text-primary-foreground'
                : 'bg-transparent text-foreground hover:bg-[var(--color-bg-hover)]'
            )}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
