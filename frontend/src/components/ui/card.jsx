import { cn } from '@/lib/utils';

/** Superfície padrão (equivale ao `Card` do app): fundo, borda e raio de 8 px. */
export function Card({ className, ...props }) {
  return <div className={cn('rounded-md border bg-card text-card-foreground', className)} {...props} />;
}
