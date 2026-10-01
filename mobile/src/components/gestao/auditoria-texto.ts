/**
 * Transforma uma linha de `audit_log` numa frase para gente: "Ana alterou o
 * SLA de Buraco para 5 dias" em vez de `categoria.alterar {"prazo_sla_dias":5}`.
 *
 * O `dados` de cada ação não tem formato fixo no contrato (cada view grava o
 * que tem à mão), então as leituras aqui são tolerantes: procuram o nome do
 * alvo e o valor novo em `dados`, `dados.depois` e chaves usuais. Ação
 * desconhecida cai numa frase genérica, nunca no JSON cru.
 */

import type { RegistroAuditoria } from '@/types/gestao';

import { ehPapel, ROTULO_PAPEL } from './papeis';

type Dados = Record<string, unknown>;

const ROTULO_PRIORIDADE: Record<string, string> = {
  baixa: 'baixa',
  media: 'média',
  alta: 'alta',
  urgente: 'urgente',
};

/** Ações que o filtro oferece, com o rótulo do grupo. */
export const ACOES_AUDITORIA: { value: string; label: string }[] = [
  { value: '', label: 'Todas as ações' },
  { value: 'membro.adicionar', label: 'Equipe: pessoa adicionada' },
  { value: 'membro.alterar', label: 'Equipe: papel alterado' },
  { value: 'membro.revogar', label: 'Equipe: acesso revogado' },
  { value: 'usuario.papel', label: 'Usuário: papel alterado' },
  { value: 'secretaria.criar', label: 'Secretaria criada' },
  { value: 'secretaria.alterar', label: 'Secretaria alterada' },
  { value: 'secretaria.excluir', label: 'Secretaria excluída' },
  { value: 'equipe.criar', label: 'Equipe criada' },
  { value: 'equipe.alterar', label: 'Equipe alterada' },
  { value: 'equipe.excluir', label: 'Equipe excluída' },
  { value: 'categoria.alterar', label: 'Categoria e SLA' },
  { value: 'municipio.alterar', label: 'Configuração do município' },
  { value: 'defeito.remover', label: 'Chamado removido' },
  { value: 'defeito.restaurar', label: 'Chamado restaurado' },
  { value: 'usuario.suspender', label: 'Cidadão suspenso' },
  { value: 'usuario.reativar', label: 'Cidadão reativado' },
];

function obj(v: unknown): Dados {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Dados) : {};
}

function texto(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

/** Primeiro valor não vazio entre as chaves, olhando em `dados` e em `dados.depois`. */
function achar(d: Dados, ...chaves: string[]): string {
  const depois = obj(d.depois);
  for (const fonte of [d, depois]) {
    for (const c of chaves) {
      const v = texto(fonte[c]);
      if (v) return v;
    }
  }
  return '';
}

function nomeDoAlvo(r: RegistroAuditoria, d: Dados, padrao: string) {
  return (
    achar(d, 'alvo_nome', 'nome', 'categoria_nome', 'usuario_nome', 'email', 'protocolo', 'titulo') ||
    (r.alvo_id ? `${padrao} #${r.alvo_id}` : padrao)
  );
}

function papelLegivel(valor: string) {
  return ehPapel(valor) ? ROTULO_PAPEL[valor].toLowerCase() : valor;
}

function dias(n: string) {
  return n === '1' ? '1 dia' : `${n} dias`;
}

/** O que mudou numa categoria, em pedaços de frase ("o SLA para 5 dias"). */
function mudancasDeCategoria(d: Dados): string[] {
  const depois = Object.keys(obj(d.depois)).length ? obj(d.depois) : d;
  const partes: string[] = [];
  const prazo = texto(depois.prazo_sla_dias);
  if (prazo) partes.push(`o SLA para ${dias(prazo)}`);
  const prioridade = texto(depois.prioridade);
  if (prioridade) partes.push(`a prioridade para ${ROTULO_PRIORIDADE[prioridade] ?? prioridade}`);
  if (depois.ativo === false) partes.push('a categoria como desativada');
  if (depois.ativo === true) partes.push('a categoria como ativa');
  const secretaria = texto(depois.secretaria_nome);
  if (secretaria) partes.push(`a secretaria para ${secretaria}`);
  if (Array.isArray(depois.checklist)) partes.push(`o checklist (${depois.checklist.length} itens)`);
  return partes;
}

function juntar(partes: string[]) {
  if (partes.length <= 1) return partes[0] ?? '';
  return `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`;
}

/** Frase principal do registro (sem data). */
export function fraseDaAuditoria(r: RegistroAuditoria): string {
  if (r.descricao) return r.descricao;

  const ator = r.usuario_nome || 'Sistema';
  const d = obj(r.dados);

  switch (r.acao) {
    case 'usuario.papel':
    case 'membro.alterar':
    case 'membro.adicionar': {
      const alvo = nomeDoAlvo(r, d, 'usuário');
      const papel = achar(d, 'papel');
      if (r.acao === 'membro.adicionar') {
        return papel
          ? `${ator} adicionou ${alvo} à equipe como ${papelLegivel(papel)}`
          : `${ator} adicionou ${alvo} à equipe`;
      }
      if (papel === 'cidadao') return `${ator} revogou o acesso de ${alvo}`;
      return papel
        ? `${ator} alterou o papel de ${alvo} para ${papelLegivel(papel)}`
        : `${ator} alterou os dados de ${alvo} na equipe`;
    }
    case 'membro.revogar':
      return `${ator} revogou o acesso de ${nomeDoAlvo(r, d, 'usuário')}`;
    case 'usuario.municipio':
      return `${ator} alterou o município de ${nomeDoAlvo(r, d, 'usuário')}`;
    case 'secretaria.criar':
      return `${ator} criou a secretaria ${nomeDoAlvo(r, d, 'secretaria')}`;
    case 'secretaria.alterar':
      return `${ator} alterou a secretaria ${nomeDoAlvo(r, d, 'secretaria')}`;
    case 'secretaria.excluir':
      return `${ator} excluiu a secretaria ${nomeDoAlvo(r, d, 'secretaria')}`;
    case 'equipe.criar':
      return `${ator} criou a equipe ${nomeDoAlvo(r, d, 'equipe')}`;
    case 'equipe.alterar':
      return `${ator} alterou a equipe ${nomeDoAlvo(r, d, 'equipe')}`;
    case 'equipe.excluir':
      return `${ator} excluiu a equipe ${nomeDoAlvo(r, d, 'equipe')}`;
    case 'categoria.alterar': {
      const nome = nomeDoAlvo(r, d, 'categoria');
      const mudancas = mudancasDeCategoria(d);
      // "alterou o SLA de Buraco para 5 dias" — o caso mais comum lê melhor
      // com o nome no meio.
      if (mudancas.length === 1 && mudancas[0].startsWith('o SLA para')) {
        return `${ator} alterou o SLA de ${nome} para ${mudancas[0].slice('o SLA para '.length)}`;
      }
      return mudancas.length
        ? `${ator} alterou em ${nome} ${juntar(mudancas)}`
        : `${ator} alterou a categoria ${nome}`;
    }
    case 'municipio.alterar':
      return `${ator} atualizou a configuração do município`;
    case 'defeito.remover':
      return `${ator} removeu o chamado ${nomeDoAlvo(r, d, 'chamado')}`;
    case 'defeito.restaurar':
      return `${ator} restaurou o chamado ${nomeDoAlvo(r, d, 'chamado')}`;
    case 'defeito.sla': {
      const prazo = achar(d, 'prazo_sla_dias');
      const alvo = nomeDoAlvo(r, d, 'chamado');
      return prazo
        ? `${ator} alterou o prazo do chamado ${alvo} para ${dias(prazo)}`
        : `${ator} alterou o prazo do chamado ${alvo}`;
    }
    case 'defeito.prioridade': {
      const p = achar(d, 'prioridade');
      return `${ator} alterou a prioridade do chamado ${nomeDoAlvo(r, d, 'chamado')}${
        p ? ` para ${ROTULO_PRIORIDADE[p] ?? p}` : ''
      }`;
    }
    case 'usuario.suspender': {
      const n = achar(d, 'dias');
      const alvo = nomeDoAlvo(r, d, 'usuário');
      return n ? `${ator} suspendeu ${alvo} por ${dias(n)}` : `${ator} suspendeu ${alvo}`;
    }
    case 'usuario.reativar':
      return `${ator} reativou ${nomeDoAlvo(r, d, 'usuário')}`;
    default: {
      const rotulo = ACOES_AUDITORIA.find((a) => a.value === r.acao)?.label;
      const alvo = r.alvo_tipo ? ` (${r.alvo_tipo}${r.alvo_id ? ` #${r.alvo_id}` : ''})` : '';
      return `${ator} registrou: ${rotulo ?? r.acao.replace(/[._]/g, ' ')}${alvo}`;
    }
  }
}

/** Linha de apoio: motivo, quando houver. */
export function detalheDaAuditoria(r: RegistroAuditoria): string {
  const d = obj(r.dados);
  const motivo = achar(d, 'motivo');
  return motivo ? `Motivo: ${motivo}` : '';
}

/** Ícone por família de ação. */
export function iconeDaAuditoria(acao: string) {
  const familia = acao.split('.')[0];
  switch (familia) {
    case 'membro':
    case 'usuario':
      return 'people' as const;
    case 'secretaria':
    case 'equipe':
      return 'business' as const;
    case 'categoria':
      return 'pricetags' as const;
    case 'municipio':
      return 'settings' as const;
    case 'defeito':
      return 'document-text' as const;
    default:
      return 'list' as const;
  }
}
