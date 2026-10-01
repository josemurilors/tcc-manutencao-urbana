/**
 * Cores dos gráficos do painel.
 *
 * Separadas da paleta da interface porque têm outro trabalho: identificar
 * séries. Os três tons categóricos (azul, verde-água, laranja) foram
 * conferidos no validador de paleta para daltonismo contra as superfícies do
 * app (#FFFFFF no claro, #0A0A0A no escuro): separação ≥ 9 ΔE entre todos os
 * pares nos dois temas. O verde-água fica abaixo de 3:1 no claro, por isso todo
 * gráfico leva legenda com texto e a opção "Ver tabela".
 *
 * Cada tema tem seus próprios passos (não é inversão automática). A cor segue
 * a entidade, nunca a posição: "Recebidos" é sempre azul.
 */

import { useTheme } from '@/context/theme-context';

const CLARO = {
  recebidos: '#2a78d6',
  resolvidos: '#1baf7a',
  backlog: '#eb6834',
  /** Série única (ranking por dimensão, produtividade). */
  unica: '#2a78d6',
  /** Estado crítico (vencidos): sempre com rótulo/ícone ao lado. */
  critico: '#d03b3b',
  grade: '#E8E3D8',
  eixo: '#C9C0AC',
  /** Notas 1..5: divergente vermelho -> cinza -> azul. */
  notas: ['#b8312f', '#e66767', '#b4b2a9', '#6da7ec', '#256abf'],
};

const ESCURO: typeof CLARO = {
  recebidos: '#3987e5',
  resolvidos: '#199e70',
  backlog: '#d95926',
  unica: '#3987e5',
  critico: '#e05252',
  grade: '#222222',
  eixo: '#3A3A3A',
  notas: ['#d04a48', '#e66767', '#6a6a66', '#5598e7', '#3987e5'],
};

export type CoresGrafico = typeof CLARO;

export function useCoresGrafico(): CoresGrafico {
  const { theme } = useTheme();
  return theme === 'dark' ? ESCURO : CLARO;
}
