/**
 * Transforma uma linha de `audit_log` numa frase para gente: "Ana alterou o
 * prazo de Buraco de 7 para 5 dias" em vez de `categoria.alterar {...}`.
 *
 * As ações e o formato de `dados` são os que o backend grava hoje (contrato
 * v3, 7.6 + as rotas de operação, BI e conta que também auditam). As leituras
 * continuam tolerantes: ação desconhecida cai numa frase genérica, nunca no
 * JSON cru.
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

/**
 * Filtro por família de ação: o backend aceita o prefixo (`acao=membro` traz
 * `membro.vincular`, `membro.alterar`...). Ações exatas ficam para o detalhe.
 */
export const ACOES_AUDITORIA: { value: string; label: string }[] = [
  { value: '', label: 'Todas as ações' },
  { value: 'membro', label: 'Equipe (entradas, papéis, revogações)' },
  { value: 'secretaria', label: 'Secretarias' },
  { value: 'equipe', label: 'Equipes de campo' },
  { value: 'categoria', label: 'Categorias e prazos' },
  { value: 'municipio', label: 'Configuração do município' },
  { value: 'moderacao', label: 'Moderação de chamados' },
  { value: 'usuario', label: 'Suspensões de cidadãos' },
  { value: 'defeito', label: 'Prazo e prioridade de chamados' },
  { value: 'resposta_padrao', label: 'Respostas-padrão' },
  { value: 'bi', label: 'Exportações e relatórios' },
  { value: 'lgpd', label: 'Pedidos de dados (LGPD)' },
];

/** Rótulo legível de cada ação exata (detalhe do registro). */
const ROTULO_ACAO: Record<string, string> = {
  'municipio.config': 'Configuração do município alterada',
  'secretaria.criar': 'Secretaria criada',
  'secretaria.alterar': 'Secretaria alterada',
  'secretaria.desativar': 'Secretaria desativada',
  'secretaria.excluir': 'Secretaria excluída',
  'equipe.criar': 'Equipe criada',
  'equipe.alterar': 'Equipe alterada',
  'equipe.desativar': 'Equipe desativada',
  'equipe.excluir': 'Equipe excluída',
  'membro.vincular': 'Pessoa adicionada à equipe',
  'membro.alterar': 'Papel ou lotação alterados',
  'membro.revogar': 'Acesso revogado',
  'categoria.alterar': 'Regras da categoria alteradas',
  'moderacao.remover': 'Chamado removido pela moderação',
  'moderacao.restaurar': 'Chamado restaurado',
  'usuario.suspender': 'Cidadão suspenso',
  'usuario.reativar': 'Cidadão reativado',
  'usuario.papel': 'Papel alterado (tela antiga)',
  'usuario.municipio': 'Município do usuário alterado',
  'defeito.remover': 'Chamado removido',
  'defeito.sla': 'Prazo do chamado alterado',
  'defeito.prioridade': 'Prioridade do chamado alterada',
  'resposta_padrao.criar': 'Resposta-padrão criada',
  'resposta_padrao.editar': 'Resposta-padrão editada',
  'resposta_padrao.excluir': 'Resposta-padrão excluída',
  'bi.exportar': 'Exportação de dados do painel',
  'bi.relatorio': 'Relatório mensal gerado',
  'lgpd.exportacao': 'Exportação dos próprios dados (LGPD)',
};

/** Nome legível dos campos que aparecem em `antes`/`depois`. */
const ROTULO_CAMPO: Record<string, string> = {
  nome: 'Nome',
  sigla: 'Sigla',
  email: 'E-mail',
  ativo: 'Situação',
  papel: 'Papel',
  secretaria_id: 'Secretaria',
  equipe_id: 'Equipe',
  municipio_id: 'Município',
  prazo_sla_dias: 'Prazo (dias)',
  prioridade: 'Prioridade',
  checklist: 'Checklist',
  nome_exibicao: 'Nome de exibição',
  cor_primaria: 'Cor principal',
  email_contato: 'E-mail de contato',
  telefone: 'Telefone',
  site: 'Site',
  raio_duplicado_m: 'Raio de duplicado (m)',
  parametros: 'Regras de atendimento',
  contratado: 'Contratação',
};

export function rotuloDaAcao(acao: string) {
  return ROTULO_ACAO[acao] ?? acao.replace(/[._]/g, ' ');
}

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

function nomeDoAlvo(_r: RegistroAuditoria, d: Dados, padrao: string) {
  return achar(d, 'nome', 'alvo_nome', 'titulo', 'email', 'protocolo') || padrao;
}

function chamadoDe(d: Dados) {
  const protocolo = texto(d.protocolo);
  const titulo = texto(d.titulo);
  if (protocolo && titulo) return `${protocolo} (${titulo})`;
  return protocolo || titulo || 'um chamado';
}

function papelLegivel(valor: string) {
  return ehPapel(valor) ? ROTULO_PAPEL[valor].toLowerCase() : valor;
}

function dias(n: string) {
  return n === '1' ? '1 dia' : `${n} dias`;
}

function igual(a: unknown, b: unknown) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Campos que mudaram entre `dados.antes` e `dados.depois`. */
function camposAlterados(d: Dados): string[] {
  const antes = obj(d.antes);
  const depois = obj(d.depois);
  return Object.keys(depois).filter((k) => !igual(antes[k], depois[k]));
}

/** O que mudou numa categoria, em pedaços de frase. */
function mudancasDeCategoria(d: Dados): string[] {
  const antes = obj(d.antes);
  const depois = obj(d.depois);
  const partes: string[] = [];
  for (const k of camposAlterados(d)) {
    if (k === 'prazo_sla_dias') {
      const de = texto(antes.prazo_sla_dias);
      const para = texto(depois.prazo_sla_dias);
      partes.push(
        para
          ? de
            ? `o prazo de ${dias(de)} para ${dias(para)}`
            : `o prazo para ${dias(para)}`
          : 'o prazo para o padrão',
      );
    } else if (k === 'prioridade') {
      const p = texto(depois.prioridade);
      partes.push(p ? `a prioridade para ${ROTULO_PRIORIDADE[p] ?? p}` : 'a prioridade para o padrão');
    } else if (k === 'ativo') {
      partes.push(depois.ativo ? 'a categoria como atendida' : 'a categoria como não atendida');
    } else if (k === 'secretaria_id') {
      partes.push('a secretaria responsável');
    } else if (k === 'checklist') {
      const n = Array.isArray(depois.checklist) ? depois.checklist.length : 0;
      partes.push(`o checklist (${n} ${n === 1 ? 'item' : 'itens'})`);
    }
  }
  return partes;
}

function juntar(partes: string[]) {
  if (partes.length <= 1) return partes[0] ?? '';
  return `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`;
}

/** Frase de secretaria/equipe (mesmo formato de `dados` nas duas). */
function fraseDeEstrutura(r: RegistroAuditoria, d: Dados, ator: string, artigo: 'a') {
  const [familia, verbo] = r.acao.split('.');
  const tipo = familia === 'secretaria' ? 'secretaria' : 'equipe';
  const nome = nomeDoAlvo(r, d, tipo);
  switch (verbo) {
    case 'criar':
      return `${ator} criou ${artigo} ${tipo} ${nome}`;
    case 'desativar':
      return `${ator} desativou ${artigo} ${tipo} ${nome} (tinha histórico, por isso não foi apagada)`;
    case 'excluir':
      return `${ator} excluiu ${artigo} ${tipo} ${nome}`;
    default: {
      const antes = obj(d.antes);
      const depois = obj(d.depois);
      const mudou = camposAlterados(d);
      if (mudou.length === 1 && mudou[0] === 'ativo') {
        return `${ator} ${depois.ativo ? 'reativou' : 'desativou'} ${artigo} ${tipo} ${nome}`;
      }
      if (mudou.includes('nome') && texto(antes.nome)) {
        return `${ator} renomeou ${artigo} ${tipo} ${texto(antes.nome)} para ${nome}`;
      }
      return `${ator} alterou ${artigo} ${tipo} ${nome}`;
    }
  }
}

/** Frase principal do registro (sem data). */
export function fraseDaAuditoria(r: RegistroAuditoria): string {
  if (r.descricao) return r.descricao;

  const ator = r.usuario_nome || 'Sistema';
  const d = obj(r.dados);
  const antes = obj(d.antes);
  const depois = obj(d.depois);

  switch (r.acao) {
    case 'municipio.config': {
      const campos = camposAlterados(d)
        .map((k) => ROTULO_CAMPO[k]?.toLowerCase())
        .filter(Boolean) as string[];
      return campos.length
        ? `${ator} alterou na configuração do município: ${juntar(campos)}`
        : `${ator} atualizou a configuração do município`;
    }
    case 'secretaria.criar':
    case 'secretaria.alterar':
    case 'secretaria.desativar':
    case 'secretaria.excluir':
    case 'equipe.criar':
    case 'equipe.alterar':
    case 'equipe.desativar':
    case 'equipe.excluir':
      return fraseDeEstrutura(r, d, ator, 'a');
    case 'membro.vincular': {
      const papel = texto(depois.papel);
      const alvo = nomeDoAlvo(r, d, 'uma pessoa');
      return papel
        ? `${ator} adicionou ${alvo} à equipe como ${papelLegivel(papel)}`
        : `${ator} adicionou ${alvo} à equipe`;
    }
    case 'membro.alterar':
    case 'usuario.papel': {
      const alvo = nomeDoAlvo(r, d, 'uma pessoa');
      const de = texto(antes.papel);
      const para = texto(depois.papel);
      if (para === 'cidadao') return `${ator} revogou o acesso de ${alvo}`;
      if (para && para !== de) {
        return de
          ? `${ator} alterou o papel de ${alvo} de ${papelLegivel(de)} para ${papelLegivel(para)}`
          : `${ator} alterou o papel de ${alvo} para ${papelLegivel(para)}`;
      }
      return `${ator} alterou a lotação de ${alvo}`;
    }
    case 'membro.revogar':
      return `${ator} revogou o acesso de ${nomeDoAlvo(r, d, 'uma pessoa')}`;
    case 'usuario.municipio':
      return `${ator} alterou o município de ${nomeDoAlvo(r, d, 'um usuário')}`;
    case 'categoria.alterar': {
      const nome = nomeDoAlvo(r, d, 'uma categoria');
      const mudancas = mudancasDeCategoria(d);
      if (mudancas.length === 1 && mudancas[0].startsWith('o prazo')) {
        return `${ator} alterou ${mudancas[0].replace('o prazo', `o prazo de ${nome}`)}`;
      }
      return mudancas.length
        ? `${ator} alterou em ${nome} ${juntar(mudancas)}`
        : `${ator} salvou a categoria ${nome} sem mudanças`;
    }
    case 'moderacao.remover':
    case 'defeito.remover':
      return `${ator} removeu o chamado ${chamadoDe(d)}`;
    case 'moderacao.restaurar':
      return `${ator} restaurou o chamado ${chamadoDe(d)}`;
    case 'defeito.sla': {
      const para = texto(d.para) || achar(d, 'prazo_sla_dias');
      return para
        ? `${ator} alterou o prazo do chamado ${chamadoDe(d)} para ${dias(para)}`
        : `${ator} alterou o prazo do chamado ${chamadoDe(d)}`;
    }
    case 'defeito.prioridade': {
      const p = texto(d.para) || achar(d, 'prioridade');
      return `${ator} alterou a prioridade do chamado ${chamadoDe(d)}${
        p ? ` para ${ROTULO_PRIORIDADE[p] ?? p}` : ''
      }`;
    }
    case 'usuario.suspender': {
      const n = texto(d.dias);
      const alvo = nomeDoAlvo(r, d, 'um cidadão');
      return n ? `${ator} suspendeu ${alvo} por ${dias(n)}` : `${ator} suspendeu ${alvo}`;
    }
    case 'usuario.reativar':
      return `${ator} reativou ${nomeDoAlvo(r, d, 'um cidadão')}`;
    case 'resposta_padrao.criar':
      return `${ator} criou a resposta-padrão "${texto(d.titulo) || 'sem título'}"`;
    case 'resposta_padrao.editar':
      return `${ator} editou a resposta-padrão${texto(d.titulo) ? ` "${texto(d.titulo)}"` : ''}`;
    case 'resposta_padrao.excluir':
      return `${ator} excluiu a resposta-padrão "${texto(d.titulo) || 'sem título'}"`;
    case 'bi.exportar': {
      const formato = texto(d.formato).toUpperCase();
      return `${ator} exportou os chamados do painel${formato ? ` em ${formato}` : ''}`;
    }
    case 'bi.relatorio':
      return `${ator} gerou o relatório mensal${texto(d.mes) ? ` de ${texto(d.mes)}` : ''}`;
    case 'lgpd.exportacao':
      return `${ator} exportou os próprios dados (LGPD)`;
    default:
      return `${ator} registrou: ${rotuloDaAcao(r.acao)}`;
  }
}

/** Linha de apoio: motivo e consequências, quando houver. */
export function detalheDaAuditoria(r: RegistroAuditoria): string {
  const d = obj(r.dados);
  const partes: string[] = [];
  const motivo = texto(d.motivo);
  if (motivo && motivo !== 'moderacao') partes.push(`Motivo: ${motivo}`);
  const liberados = Number(d.chamados_liberados ?? 0);
  if (liberados > 0) {
    partes.push(
      liberados === 1 ? '1 chamado voltou para a fila' : `${liberados} chamados voltaram para a fila`,
    );
  }
  const recalculados = Number(d.chamados_recalculados ?? 0);
  if (recalculados > 0) {
    partes.push(
      recalculados === 1
        ? '1 chamado aberto ganhou o prazo novo'
        : `${recalculados} chamados abertos ganharam o prazo novo`,
    );
  }
  if (d.strike_retirado === true) partes.push('A advertência do autor foi retirada');
  if ((r.acao === 'bi.exportar' || r.acao === 'bi.relatorio') && texto(d.inicio) && texto(d.fim)) {
    partes.push(`Período: ${texto(d.inicio)} a ${texto(d.fim)}`);
  }
  return partes.join(' · ');
}

function valorLegivel(campo: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (campo === 'ativo' || campo === 'contratado') return v ? 'sim' : 'não';
  if (campo === 'papel' && typeof v === 'string') return papelLegivel(v);
  if (campo === 'prioridade' && typeof v === 'string') return ROTULO_PRIORIDADE[v] ?? v;
  if (Array.isArray(v)) return v.length ? v.map((x) => texto(x)).join('; ') : 'vazio';
  if (typeof v === 'object') {
    return Object.entries(v as Dados)
      .map(([k, x]) => `${k.replace(/_/g, ' ')}: ${texto(x) || '—'}`)
      .join(', ');
  }
  return texto(v);
}

/**
 * Antes → depois de cada campo alterado, para o detalhe do registro (a
 * prestação de contas pede o valor anterior, não só "alterou").
 */
export function mudancasDaAuditoria(r: RegistroAuditoria): { campo: string; antes: string; depois: string }[] {
  const d = obj(r.dados);
  const antes = obj(d.antes);
  const depois = obj(d.depois);
  // `secretaria_id` sai pelo nome quando o registro traz `secretaria_nome`.
  const valor = (fonte: Dados, k: string) => {
    const nome = k.endsWith('_id') ? texto(fonte[`${k.slice(0, -3)}_nome`]) : '';
    return nome || valorLegivel(k, fonte[k]);
  };
  return camposAlterados(d)
    .filter((k) => k !== 'id' && k !== 'criado_em' && !k.startsWith('total_') && !k.endsWith('_nome'))
    .map((k) => ({
      campo: ROTULO_CAMPO[k] ?? k.replace(/_/g, ' '),
      antes: valor(antes, k),
      depois: valor(depois, k),
    }));
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
    case 'moderacao':
      return 'shield-half' as const;
    case 'defeito':
      return 'document-text' as const;
    case 'bi':
      return 'download' as const;
    case 'resposta_padrao':
      return 'chatbox-ellipses' as const;
    case 'lgpd':
      return 'lock-closed' as const;
    default:
      return 'list' as const;
  }
}
