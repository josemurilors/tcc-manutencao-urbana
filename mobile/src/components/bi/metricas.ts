/**
 * Catálogo dos indicadores do painel: rótulo, explicação e polaridade.
 *
 * A polaridade é o que faltava ao painel antigo, que pintava qualquer alta de
 * verde — backlog subindo aparecia como boa notícia. Aqui cada KPI diz se
 * "maior" é melhor, pior ou só informativo (volume de entrada não é bom nem
 * ruim: depende de divulgação, chuva, época do ano).
 */

import type { Ionicons } from '@expo/vector-icons';

import type { BiChaveKpi, BiKpis } from '@/types/bi';

import { fmtDecimal, fmtHoras, fmtHorasExtenso, fmtNumero, fmtPct } from './formato';

export type Polaridade = 'maior' | 'menor' | 'neutra';
export type FormatoKpi = 'numero' | 'pct' | 'horas' | 'nota';

export type DefinicaoKpi = {
  titulo: string;
  ajuda: string;
  polaridade: Polaridade;
  formato: FormatoKpi;
  icone: keyof typeof Ionicons.glyphMap;
};

export const KPIS: Record<BiChaveKpi, DefinicaoKpi> = {
  backlog: {
    titulo: 'Chamados em aberto',
    ajuda:
      'Chamados ainda não concluídos nem rejeitados no fim do período, de qualquer data de abertura. É a fila que a prefeitura precisa zerar: subir é ruim.',
    polaridade: 'menor',
    formato: 'numero',
    icone: 'file-tray-full',
  },
  backlog_vencido: {
    titulo: 'Abertos com prazo vencido',
    ajuda:
      'Dos chamados em aberto, quantos já passaram do prazo (SLA) da categoria. É o risco imediato de reclamação na ouvidoria e na imprensa.',
    polaridade: 'menor',
    formato: 'numero',
    icone: 'alarm',
  },
  pct_no_prazo: {
    titulo: 'Resolvidos no prazo',
    ajuda:
      'Percentual dos chamados resolvidos no período que foram concluídos dentro do prazo (SLA) da categoria.',
    polaridade: 'maior',
    formato: 'pct',
    icone: 'checkmark-done',
  },
  lead_time_p50_h: {
    titulo: 'Tempo típico de solução',
    ajuda:
      'Mediana do tempo entre a abertura e a conclusão dos chamados resolvidos no período: metade foi resolvida em menos tempo que isso. A mediana não se distorce por poucos casos extremos.',
    polaridade: 'menor',
    formato: 'horas',
    icone: 'timer',
  },
  lead_time_p90_h: {
    titulo: 'Tempo dos casos mais lentos',
    ajuda:
      'Percentil 90 do tempo de solução: 9 em cada 10 chamados foram resolvidos em até esse tempo. Mostra a cauda que gera reclamação.',
    polaridade: 'menor',
    formato: 'horas',
    icone: 'hourglass',
  },
  primeira_resposta_p50_h: {
    titulo: 'Primeira resposta',
    ajuda:
      'Mediana do tempo até a primeira resposta da prefeitura ao cidadão: a triagem ou a primeira mensagem pública da equipe, o que vier antes. É quando o cidadão percebe que foi ouvido.',
    polaridade: 'menor',
    formato: 'horas',
    icone: 'chatbubble-ellipses',
  },
  recebidos: {
    titulo: 'Recebidos',
    ajuda:
      'Chamados abertos pelos cidadãos no período. Mede a demanda: alta não é boa nem ruim por si — compare com os resolvidos.',
    polaridade: 'neutra',
    formato: 'numero',
    icone: 'download',
  },
  resolvidos: {
    titulo: 'Resolvidos',
    ajuda: 'Chamados concluídos no período, pela equipe ou confirmados pela comunidade.',
    polaridade: 'maior',
    formato: 'numero',
    icone: 'checkmark-circle',
  },
  rejeitados: {
    titulo: 'Rejeitados',
    ajuda:
      'Chamados encerrados como "não procede" no período (duplicado, fora da competência, não localizado...).',
    polaridade: 'neutra',
    formato: 'numero',
    icone: 'close-circle',
  },
  taxa_resolucao: {
    titulo: 'Taxa de resolução',
    ajuda:
      'Dos chamados recebidos no período, quantos já estavam resolvidos ao fim dele. Mostra se a demanda nova está sendo atendida a tempo.',
    polaridade: 'maior',
    formato: 'pct',
    icone: 'trending-up',
  },
  reabertura_pct: {
    titulo: 'Reabertos',
    ajuda:
      'Percentual dos chamados resolvidos que voltaram a ser abertos (pelo cidadão ou pela gestão). Indica serviço mal feito ou baixa prematura.',
    polaridade: 'menor',
    formato: 'pct',
    icone: 'refresh-circle',
  },
  csat_media: {
    titulo: 'Satisfação',
    ajuda: 'Nota média (1 a 5) que os cidadãos deram aos chamados resolvidos no período.',
    polaridade: 'maior',
    formato: 'nota',
    icone: 'star',
  },
  csat_respostas: {
    titulo: 'Avaliações recebidas',
    ajuda: 'Quantos cidadãos avaliaram o atendimento no período. Poucas respostas deixam a média instável.',
    polaridade: 'maior',
    formato: 'numero',
    icone: 'chatbox',
  },
  cidadaos_ativos: {
    titulo: 'Cidadãos participando',
    ajuda: 'Pessoas diferentes que abriram ou apoiaram chamados no período: o engajamento da cidade.',
    polaridade: 'maior',
    formato: 'numero',
    icone: 'people',
  },
};

export function fmtKpi(formato: FormatoKpi, valor: number | null | undefined) {
  switch (formato) {
    case 'pct':
      return fmtPct(valor);
    case 'horas':
      return fmtHoras(valor);
    case 'nota':
      return valor == null ? '—' : `${fmtDecimal(valor)} / 5`;
    default:
      return fmtNumero(valor);
  }
}

export function fmtKpiExtenso(formato: FormatoKpi, valor: number | null | undefined) {
  if (valor == null) return 'sem dado';
  if (formato === 'horas') return fmtHorasExtenso(valor);
  if (formato === 'pct') return `${fmtDecimal(valor)} por cento`;
  if (formato === 'nota') return `${fmtDecimal(valor)} de 5`;
  return fmtNumero(valor);
}

export type Avaliacao = 'bom' | 'ruim' | 'neutro';

export type Delta = {
  /** "+12%", "−3,5 p.p.", "+0,4" */
  texto: string;
  /** Frase para o leitor de tela. */
  extenso: string;
  direcao: 'subiu' | 'caiu' | 'igual';
  avaliacao: Avaliacao;
};

/**
 * Variação contra o período anterior. Percentuais variam em pontos
 * percentuais (78% -> 81% é +3 p.p., não +3,8%); notas, na diferença
 * absoluta; o resto, em variação relativa.
 */
export function calcularDelta(
  chave: BiChaveKpi,
  atual: number | null | undefined,
  anterior: number | null | undefined,
): Delta | null {
  if (atual == null || anterior == null || !Number.isFinite(atual) || !Number.isFinite(anterior)) {
    return null;
  }
  const def = KPIS[chave];
  let diferenca: number;
  let texto: string;
  let extenso: string;

  if (def.formato === 'pct') {
    diferenca = atual - anterior;
    texto = `${fmtDecimal(Math.abs(diferenca))} p.p.`;
    extenso = `${fmtDecimal(Math.abs(diferenca))} pontos percentuais`;
  } else if (def.formato === 'nota') {
    diferenca = atual - anterior;
    texto = fmtDecimal(Math.abs(diferenca));
    extenso = `${fmtDecimal(Math.abs(diferenca))} ponto`;
  } else {
    if (anterior === 0) {
      if (atual === 0) return { texto: 'igual', extenso: 'sem variação', direcao: 'igual', avaliacao: 'neutro' };
      // Sem base de comparação, percentual seria infinito: mostra a diferença.
      diferenca = atual;
      texto = def.formato === 'horas' ? fmtHoras(atual) : fmtNumero(atual);
      extenso = `${texto} a mais, sem registro no período anterior`;
    } else {
      diferenca = ((atual - anterior) / Math.abs(anterior)) * 100;
      texto = `${fmtDecimal(Math.abs(diferenca))}%`;
      extenso = `${fmtDecimal(Math.abs(diferenca))} por cento`;
    }
  }

  // Abaixo de 0,05 o arredondamento já mostra "0": trata como estável.
  const direcao = Math.abs(diferenca) < 0.05 ? 'igual' : diferenca > 0 ? 'subiu' : 'caiu';
  let avaliacao: Avaliacao = 'neutro';
  if (direcao !== 'igual' && def.polaridade !== 'neutra') {
    const melhorou = (direcao === 'subiu') === (def.polaridade === 'maior');
    avaliacao = melhorou ? 'bom' : 'ruim';
  }
  const sinal = direcao === 'subiu' ? '+' : direcao === 'caiu' ? '−' : '';
  return {
    texto: direcao === 'igual' ? 'estável' : `${sinal}${texto}`,
    extenso:
      direcao === 'igual'
        ? 'estável em relação ao período anterior'
        : `${direcao === 'subiu' ? 'subiu' : 'caiu'} ${extenso} em relação ao período anterior${
            avaliacao === 'bom' ? ', melhora' : avaliacao === 'ruim' ? ', piora' : ''
          }`,
    direcao,
    avaliacao,
  };
}

/** Valor de um KPI no objeto, tolerando campo ausente de backend antigo. */
export function valorKpi(kpis: Partial<BiKpis> | null | undefined, chave: BiChaveKpi) {
  const v = kpis?.[chave];
  return typeof v === 'number' ? v : null;
}
