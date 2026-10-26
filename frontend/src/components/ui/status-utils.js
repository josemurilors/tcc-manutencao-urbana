// Única fonte de status da web. Mesmos status de `defeitos/fluxo.py` e as
// mesmas cores do app (`mobile/src/constants/palette.ts`), em `tokens.css`.
export const STATUS_ABERTOS = ['pendente', 'em_analise', 'agendado', 'em_andamento'];
export const STATUS_FECHADOS = ['concluido', 'rejeitado'];

// Rótulos de operação (`fluxo.ROTULOS_OPERACAO`).
const labels = {
  pendente: 'Novo',
  em_analise: 'Em triagem',
  agendado: 'Programado',
  em_andamento: 'Em execução',
  concluido: 'Concluído',
  rejeitado: 'Rejeitado',
};

const UMA_SEMANA_MS = 7 * 24 * 60 * 60 * 1000;

function concluidoHaMaisDeUmaSemana(status, concluido_em) {
  return status === 'concluido' && concluido_em && Date.now() - new Date(concluido_em).getTime() >= UMA_SEMANA_MS;
}

function chave(status) {
  return labels[status] ? status : 'pendente';
}

/** Para CSS (estilo inline, classes): acompanha a troca de tema sozinho. */
export function statusVars(status, concluido_em) {
  const k = concluidoHaMaisDeUmaSemana(status, concluido_em) ? 'rejeitado' : chave(status);
  return { fg: `var(--status-${k})`, bg: `var(--status-${k}-bg)`, border: `var(--status-${k}-border)` };
}

/**
 * Cor resolvida (hex) para quem não aceita `var()`: atributos SVG do Recharts
 * e do Leaflet. shortcut: lida na hora do render, então um marcador já
 * desenhado só troca de cor no próximo render após mudar o tema.
 */
export function getStatusColor(status, concluido_em) {
  const k = concluidoHaMaisDeUmaSemana(status, concluido_em) ? 'rejeitado' : chave(status);
  return getComputedStyle(document.documentElement).getPropertyValue(`--status-${k}`).trim() || '#8A8A8A';
}

export function getStatusLabel(status, concluido_em) {
  if (concluidoHaMaisDeUmaSemana(status, concluido_em)) return 'Concluído há +1 semana';
  return labels[status] || status;
}
