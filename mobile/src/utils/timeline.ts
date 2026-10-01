/**
 * Histórico do chamado.
 *
 * A fonte da verdade é `GET /defeitos/<id>/eventos/` (contrato v3 §7.2): cada
 * mudança vira um evento com data própria. Antes disso o app montava a linha do
 * tempo só com os timestamps do chamado, o que dava datas repetidas e jargão
 * interno; esse caminho continua aqui só como reserva para quando os eventos
 * não carregam (rede, backend antigo), e o detalhe avisa que é um resumo.
 */

import type { Ionicons } from '@expo/vector-icons';

import { normalizarStatus, rotuloCidadao, rotuloOperacao } from '@/constants/status';
import type { Tom } from '@/constants/theme';
import type { Defeito, DefeitoEvento } from '@/types';

type IconName = keyof typeof Ionicons.glyphMap;

export type TimelineItem = {
  id: string;
  title: string;
  description?: string;
  date?: string;
  meta?: string;
  /** Ícone do marcador; com o título, distingue o evento sem depender da cor. */
  icon?: IconName;
  tone?: Tom;
  /** Destaque visual (ex.: resposta da prefeitura). */
  emphasis?: boolean;
};

export type VisaoTimeline = 'cidadao' | 'operacao';

/**
 * Ícone de cada status. Os rótulos e as cores moram em `constants/status.ts`;
 * o ícone fica aqui até aquele arquivo ganhar o seu (pendência registrada).
 */
export const ICONE_STATUS: Record<string, IconName> = {
  pendente: 'mail-unread-outline',
  em_analise: 'search',
  agendado: 'calendar-outline',
  em_andamento: 'construct-outline',
  concluido: 'checkmark-circle',
  rejeitado: 'close-circle-outline',
};

export function iconeDoStatus(status: string): IconName {
  return ICONE_STATUS[normalizarStatus(status)] ?? 'ellipse-outline';
}

/** Motivos de rejeição (`fluxo.MOTIVOS_REJEICAO`) em linguagem de cidadão. */
export const MOTIVOS_REJEICAO_CIDADAO: Record<string, string> = {
  duplicado: 'Já existe outro chamado para este mesmo problema.',
  fora_da_competencia: 'O problema não é de responsabilidade da prefeitura.',
  nao_localizado: 'A equipe não encontrou o problema no local informado.',
  ja_resolvido: 'O problema já estava resolvido quando a equipe chegou.',
  improcedente: 'A prefeitura avaliou que o pedido não procede.',
  outro: 'Encerrado pela prefeitura.',
};

/** "01/10/2026 14:05" — sem segundos, que só poluem o histórico. */
export function dataHoraCurta(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const TOM_STATUS: Record<string, Tom> = {
  pendente: 'info',
  em_analise: 'info',
  agendado: 'info',
  em_andamento: 'warning',
  concluido: 'success',
  rejeitado: 'neutral',
};

/** Título de uma mudança de status, em voz de cidadão. */
function tituloStatusCidadao(para: string, de: string | null, papel: string) {
  const s = normalizarStatus(para);
  if (s === 'pendente' && de) return 'Chamado reaberto';
  if (s === 'concluido' && papel === 'comunidade') return 'Resolvido, segundo moradores';
  switch (s) {
    case 'em_analise':
      return 'Em análise pela prefeitura';
    case 'agendado':
      return 'Serviço programado';
    case 'em_andamento':
      return 'Equipe em execução';
    case 'concluido':
      return 'Resolvido pela prefeitura';
    case 'rejeitado':
      return 'Encerrado: não procede';
    default:
      return rotuloCidadao(s);
  }
}

function estrelas(nota: number) {
  const n = Math.max(0, Math.min(5, Math.round(nota)));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

function textoDe(dados: Record<string, unknown> | undefined, chave: string) {
  const v = dados?.[chave];
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

/** Converte um evento num item do histórico; `null` = não aparece nesta visão. */
function itemDoEvento(e: DefeitoEvento, visao: VisaoTimeline): TimelineItem | null {
  const operacao = visao === 'operacao';
  const base = {
    id: `ev-${e.id}`,
    date: dataHoraCurta(e.criado_em),
    // Para o cidadão o backend já manda "Prefeitura"/"Comunidade"/nome mascarado.
    meta: e.autor_nome ? `Por ${e.autor_nome}` : undefined,
  };

  switch (e.tipo) {
    case 'criado':
      return {
        ...base,
        title: 'Chamado registrado',
        description: e.texto || undefined,
        icon: 'flag',
        tone: 'primary',
      };
    case 'status': {
      if (!e.para_status) return null;
      const s = normalizarStatus(e.para_status);
      const motivo = textoDe(e.dados, 'motivo');
      const protocoloOriginal = textoDe(e.dados, 'duplicado_de_protocolo');
      let descricaoRejeicao =
        s === 'rejeitado' ? MOTIVOS_REJEICAO_CIDADAO[motivo] ?? MOTIVOS_REJEICAO_CIDADAO.outro : '';
      if (s === 'rejeitado' && protocoloOriginal) {
        descricaoRejeicao += ` Acompanhe o protocolo ${protocoloOriginal}.`;
      }
      // A conclusão pode trazer a resposta pública junto (fluxo.transicionar).
      const resposta = textoDe(e.dados, 'resposta_publica');
      const textoVisivel = operacao || e.papel !== 'cidadao' ? e.texto : '';
      return {
        ...base,
        title: operacao
          ? `${rotuloOperacao(s)}${e.de_status ? ` (antes: ${rotuloOperacao(e.de_status)})` : ''}`
          : tituloStatusCidadao(s, e.de_status, e.papel),
        description:
          [descricaoRejeicao, resposta || textoVisivel].filter(Boolean).join(' ') || undefined,
        icon: s === 'pendente' && e.de_status ? 'refresh' : iconeDoStatus(s),
        tone: TOM_STATUS[s] ?? 'neutral',
        emphasis: !!resposta,
      };
    }
    case 'resposta_publica':
      return {
        ...base,
        title: 'Resposta da prefeitura',
        description: e.texto || undefined,
        icon: 'chatbubble-ellipses',
        tone: 'primary',
        emphasis: true,
      };
    case 'atribuido':
      return {
        ...base,
        title: operacao ? 'Atribuído' : 'Encaminhado à equipe responsável',
        description: operacao ? e.texto || undefined : undefined,
        icon: 'people-outline',
        tone: 'info',
      };
    case 'anexo': {
      const depois = textoDe(e.dados, 'tipo') === 'depois';
      return {
        ...base,
        title: depois ? 'Foto do serviço concluído' : 'Nova foto adicionada',
        icon: 'image-outline',
        tone: depois ? 'success' : 'neutral',
      };
    }
    case 'avaliacao': {
      const nota = Number(e.dados?.nota ?? 0);
      return {
        ...base,
        title: nota ? `Avaliação do atendimento: ${estrelas(nota)}` : 'Atendimento avaliado',
        description: e.texto || undefined,
        icon: 'star',
        tone: 'primary',
      };
    }
    case 'reaberto':
      return {
        ...base,
        title: 'Chamado reaberto',
        description: e.texto ? `Motivo: ${e.texto}` : undefined,
        icon: 'refresh',
        tone: 'warning',
      };
    case 'sla':
      return {
        ...base,
        title: 'Prazo de atendimento ajustado',
        description: e.texto || undefined,
        icon: 'time-outline',
        tone: 'info',
      };
    case 'prioridade':
      return operacao
        ? { ...base, title: 'Prioridade alterada', description: e.texto || undefined, icon: 'flame-outline' }
        : null;
    case 'nota_interna':
      return operacao
        ? {
            ...base,
            title: 'Nota interna',
            description: e.texto || undefined,
            icon: 'lock-closed-outline',
            tone: 'neutral',
          }
        : null;
    case 'removido':
      return {
        ...base,
        title: 'Chamado removido',
        description: e.texto || undefined,
        icon: 'trash-outline',
        tone: 'danger',
      };
    case 'sinalizacao':
    case 'moderacao':
      return operacao
        ? { ...base, title: e.tipo === 'sinalizacao' ? 'Sinalização de cidadão' : 'Moderação', description: e.texto || undefined, icon: 'flag-outline' }
        : null;
    default:
      return null;
  }
}

/**
 * Histórico a partir dos eventos. Apoios viram uma linha só ("12 pessoas
 * confirmaram"), senão um chamado popular soterraria as ações da prefeitura.
 */
export function timelineDosEventos(
  eventos: DefeitoEvento[],
  visao: VisaoTimeline = 'cidadao',
): TimelineItem[] {
  const ordenados = [...eventos].sort(
    (a, b) => new Date(a.criado_em).getTime() - new Date(b.criado_em).getTime(),
  );
  const itens: TimelineItem[] = [];
  let apoios = 0;
  let ultimoApoio: string | undefined;
  let posicaoApoios = -1;

  for (const e of ordenados) {
    if (e.tipo === 'apoio') {
      apoios += 1;
      ultimoApoio = e.criado_em;
      if (posicaoApoios < 0) posicaoApoios = itens.length;
      continue;
    }
    const item = itemDoEvento(e, visao);
    if (item) itens.push(item);
  }

  if (apoios > 0) {
    itens.splice(posicaoApoios, 0, {
      id: 'apoios',
      title: apoios === 1 ? '1 pessoa confirmou o problema' : `${apoios} pessoas confirmaram o problema`,
      date: ultimoApoio ? `Último em ${dataHoraCurta(ultimoApoio)}` : undefined,
      icon: 'people',
      tone: 'neutral',
    });
  }
  return itens;
}

/**
 * Reserva: histórico resumido só com os campos do chamado (sem eventos).
 * Mantém a assinatura antiga, usada também pela tela de operação.
 */
export function getTimelineItems(d: Defeito): TimelineItem[] {
  const status = normalizarStatus(d.status);
  const items: TimelineItem[] = [
    {
      id: 'criado',
      title: 'Chamado registrado',
      date: dataHoraCurta(d.criado_em),
      meta: d.autor_nome ? `Por ${d.autor_nome}` : undefined,
      icon: 'flag',
      tone: 'primary',
    },
  ];

  if (d.triado_em) {
    items.push({
      id: 'triado',
      title: 'Em análise pela prefeitura',
      date: dataHoraCurta(d.triado_em),
      icon: iconeDoStatus('em_analise'),
      tone: 'info',
    });
  }

  if (d.iniciado_em) {
    items.push({
      id: 'execucao',
      title: 'Equipe em execução',
      date: dataHoraCurta(d.iniciado_em),
      icon: iconeDoStatus('em_andamento'),
      tone: 'warning',
    });
  }

  if (d.resposta_publica) {
    items.push({
      id: 'resposta',
      title: 'Resposta da prefeitura',
      description: d.resposta_publica,
      icon: 'chatbubble-ellipses',
      tone: 'primary',
      emphasis: true,
    });
  }

  if (status === 'concluido') {
    items.push({
      id: 'concluido',
      title: 'Resolvido',
      date: dataHoraCurta(d.resolvido_em ?? d.atendido_em),
      icon: iconeDoStatus('concluido'),
      tone: 'success',
    });
  }

  if (status === 'rejeitado') {
    items.push({
      id: 'rejeitado',
      title: 'Encerrado: não procede',
      description: d.motivo_rejeicao ? MOTIVOS_REJEICAO_CIDADAO[d.motivo_rejeicao] : undefined,
      date: dataHoraCurta(d.fechado_em),
      icon: iconeDoStatus('rejeitado'),
      tone: 'neutral',
    });
  }

  return items;
}
