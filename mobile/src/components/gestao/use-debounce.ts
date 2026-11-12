import { useEffect, useState } from 'react';

/** Valor atrasado em `ms`: a busca só dispara quando a pessoa para de digitar. */
export function useDebounce<T>(valor: T, ms: number) {
  const [atrasado, setAtrasado] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setAtrasado(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return atrasado;
}
