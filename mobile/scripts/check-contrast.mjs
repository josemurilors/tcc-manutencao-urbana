/**
 * Confere o contraste WCAG AA da paleta (`npm run check:contrast`).
 *
 * Lê `src/constants/palette.ts` direto (o Node 22.18+ remove os tipos sozinho)
 * e reprova com código 1 se algum par listado em `ParesDeContraste`, ou alguma
 * cor de status sobre o fundo/selo, ficar abaixo do mínimo.
 */

import { Colors, ParesDeContraste } from '../src/constants/palette.ts';

function luminancia(hex) {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const canal = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

function contraste(a, b) {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (escuro + 0.05);
}

let falhas = 0;

function conferir(tema, rotulo, fg, bg, min) {
  const valor = contraste(fg, bg);
  if (valor < min) {
    falhas++;
    console.log(`✗ ${tema}: ${rotulo} = ${valor.toFixed(2)}:1 (mínimo ${min}:1)`);
  }
}

for (const [tema, p] of Object.entries(Colors)) {
  for (const { fg, bg, min } of ParesDeContraste) {
    conferir(tema, `${fg} sobre ${bg}`, p[fg], p[bg], min);
  }
  for (const [status, cor] of Object.entries(p.status)) {
    conferir(tema, `status.${status} sobre o selo`, cor.fg, cor.bg, 4.5);
    conferir(tema, `status.${status} sobre bg`, cor.fg, p.bg, 4.5);
    conferir(tema, `status.${status} sobre surface`, cor.fg, p.surface, 4.5);
  }
}

if (falhas > 0) {
  console.log(`\n${falhas} par(es) abaixo do WCAG AA.`);
  process.exit(1);
}
console.log('Paleta OK: todos os pares passam no WCAG AA nos dois temas.');
