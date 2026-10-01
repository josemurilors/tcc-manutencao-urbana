/**
 * Modo offline da operação de campo.
 *
 * Periferia e zona rural têm sinal ruim; o operador não pode ficar parado
 * esperando rede para registrar o que já fez. Três peças:
 *
 * 1. **Cache da fila**: a última página carregada (com o resumo e os filtros
 *    usados) fica no AsyncStorage. Sem rede, a tela mostra o cache com a hora
 *    em que foi salvo, em vez de uma lista vazia que mentiria.
 * 2. **Fila de ações**: assumir, mudar status, nota, resposta, evidência e
 *    lote passam por `executarOuEnfileirar`. Se o erro for de rede, a ação é
 *    guardada com uma chave de idempotência (vai no `Idempotency-Key`) e
 *    reenviada depois, em ordem (FIFO). Fotos são copiadas para
 *    `documentDirectory`, que o sistema não limpa sozinho.
 * 3. **Roteiro do dia**: sobrevive a fechar o app; vale só no dia em que foi
 *    montado.
 *
 * Mesmas garantias da fila do cidadão (`offline-queue.ts`): cada item guarda
 * o dono, nada some em silêncio (recusa vira `falhou`, com a mensagem) e toda
 * leitura-escrita passa por uma trava.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { rotuloOperacao } from '@/constants/status';
import { apiOperacao, ehErroDeRede, type ResumoOperacao } from '@/services/api-operacao';
import { getStoredUser } from '@/services/storage';
import type { PickedImage } from '@/types';
import type {
  ChamadoFila,
  Coordenada,
  DadosAtribuicao,
  DadosTransicao,
  FiltrosFila,
  IdChamado,
  ResultadoLote,
} from '@/types/operacao';

const CHAVE_CACHE = 'ciu_operacao_cache';
const CHAVE_ACOES = 'ciu_operacao_acoes';
const CHAVE_ROTEIRO = 'ciu_operacao_roteiro';
const PASTA_FOTOS = 'operacao';

// ---------------------------------------------------------------------------
// Trava e ouvintes

let trava: Promise<unknown> = Promise.resolve();

function exclusivo<T>(fn: () => Promise<T>): Promise<T> {
  const proxima = trava.then(fn, fn);
  trava = proxima.catch(() => {});
  return proxima;
}

const ouvintes = new Set<() => void>();

/** Avisa quando a fila de ações muda (enfileirou, enviou, falhou). */
export function onAcoesChange(ouvinte: () => void) {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

function avisar() {
  // Fora da trava: o ouvinte costuma reler a fila.
  setTimeout(() => ouvintes.forEach((o) => o()), 0);
}

async function lerJson<T>(chave: string, padrao: T): Promise<T> {
  const raw = await AsyncStorage.getItem(chave);
  if (!raw) return padrao;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // JSON corrompido (app morto no meio da escrita): recomeça do padrão em
    // vez de travar a tela inteira.
    return padrao;
  }
}

// ---------------------------------------------------------------------------
// 1. Cache da fila

export type CacheFila = {
  usuario_id: string | null;
  salvo_em: string;
  filtros: FiltrosFila;
  resultados: ChamadoFila[];
  count: number;
  resumo: ResumoOperacao | null;
};

export async function salvarCacheFila(cache: Omit<CacheFila, 'salvo_em'>) {
  await AsyncStorage.setItem(
    CHAVE_CACHE,
    JSON.stringify({ ...cache, salvo_em: new Date().toISOString() }),
  );
}

/** Cache do usuário logado; o de outra pessoa no mesmo aparelho não aparece. */
export async function lerCacheFila(usuarioId: string | null): Promise<CacheFila | null> {
  const cache = await lerJson<CacheFila | null>(CHAVE_CACHE, null);
  if (!cache || !Array.isArray(cache.resultados)) return null;
  if (cache.usuario_id && usuarioId && cache.usuario_id !== usuarioId) return null;
  return cache;
}

// ---------------------------------------------------------------------------
// 2. Fila de ações

export type AcaoOperacao =
  | {
      tipo: 'transicao';
      defeito_id: IdChamado;
      dados: DadosTransicao;
      foto?: PickedImage | null;
      local?: Coordenada | null;
    }
  | { tipo: 'atribuir'; defeito_id: IdChamado; dados: DadosAtribuicao }
  | { tipo: 'liberar'; defeito_id: IdChamado }
  | { tipo: 'nota'; defeito_id: IdChamado; texto: string }
  | { tipo: 'resposta'; defeito_id: IdChamado; texto: string }
  | {
      tipo: 'evidencia';
      defeito_id: IdChamado;
      evidencia: 'antes' | 'depois';
      foto: PickedImage;
      local: Coordenada | null;
    }
  | {
      tipo: 'lote';
      ids: IdChamado[];
      acao: 'transicao' | 'atribuir';
      campos: Partial<DadosTransicao> & DadosAtribuicao;
    };

export type AcaoPendente = {
  /** Também é a chave de idempotência mandada ao backend. */
  id: string;
  usuario_id: string | null;
  /** Frase curta para a lista de pendências ("Concluir 2026-000123"). */
  rotulo: string;
  acao: AcaoOperacao;
  criado_em: string;
  status: 'pendente' | 'falhou';
  tentativas: number;
  proxima_tentativa_em: string | null;
  erro: string | null;
};

/** Chamados afetados por uma ação (para marcar "envio pendente" no card). */
export function idsDaAcao(acao: AcaoOperacao): string[] {
  return acao.tipo === 'lote' ? acao.ids.map(String) : [String(acao.defeito_id)];
}

async function lerAcoes(): Promise<AcaoPendente[]> {
  const lista = await lerJson<AcaoPendente[]>(CHAVE_ACOES, []);
  return Array.isArray(lista) ? lista : [];
}

async function gravarAcoes(lista: AcaoPendente[]) {
  if (lista.length === 0) await AsyncStorage.removeItem(CHAVE_ACOES);
  else await AsyncStorage.setItem(CHAVE_ACOES, JSON.stringify(lista));
  avisar();
}

export function listarAcoes(usuarioId: string | null): Promise<AcaoPendente[]> {
  return exclusivo(async () =>
    (await lerAcoes()).filter((a) => !a.usuario_id || !usuarioId || a.usuario_id === usuarioId),
  );
}

/**
 * Copia a foto para a pasta persistente. No web (URI blob:) ou se a cópia
 * falhar, segue com a original — melhor arriscar o cache do que perder a ação.
 */
async function guardarFoto(id: string, foto: PickedImage): Promise<PickedImage> {
  if (Platform.OS === 'web') return foto;
  try {
    const pasta = new Directory(Paths.document, PASTA_FOTOS);
    pasta.create({ intermediates: true, idempotent: true });
    const extensao = foto.name.split('.').pop() || 'jpg';
    const destino = new File(pasta, `${id}.${extensao}`);
    await new File(foto.uri).copy(destino);
    return { ...foto, uri: destino.uri };
  } catch (err) {
    if (__DEV__) console.warn('[operacao-offline] foto não copiada', err);
    return foto;
  }
}

function fotoDaAcao(acao: AcaoOperacao): PickedImage | null {
  if (acao.tipo === 'evidencia') return acao.foto;
  if (acao.tipo === 'transicao') return acao.foto ?? null;
  return null;
}

function apagarFoto(acao: AcaoOperacao) {
  const foto = fotoDaAcao(acao);
  if (!foto || Platform.OS === 'web' || !foto.uri.includes(`/${PASTA_FOTOS}/`)) return;
  try {
    const arquivo = new File(foto.uri);
    if (arquivo.exists) arquivo.delete();
  } catch (err) {
    // Sobra um arquivo órfão; não vale travar o fluxo por isso.
    if (__DEV__) console.warn('[operacao-offline] foto não apagada', err);
  }
}

function fotoExiste(acao: AcaoOperacao) {
  const foto = fotoDaAcao(acao);
  if (!foto || Platform.OS === 'web') return true;
  try {
    return new File(foto.uri).exists;
  } catch {
    return false;
  }
}

async function enfileirar(id: string, acao: AcaoOperacao, rotulo: string) {
  const foto = fotoDaAcao(acao);
  let guardada = acao;
  if (foto) {
    const copia = await guardarFoto(id, foto);
    guardada = { ...acao, foto: copia } as AcaoOperacao;
  }
  const usuario = await getStoredUser().catch(() => null);
  await exclusivo(async () => {
    const lista = await lerAcoes();
    lista.push({
      id,
      usuario_id: usuario?.id != null ? String(usuario.id) : null,
      rotulo,
      acao: guardada,
      criado_em: new Date().toISOString(),
      status: 'pendente',
      tentativas: 0,
      proxima_tentativa_em: null,
      erro: null,
    });
    await gravarAcoes(lista);
  });
}

/** Executa a ação no servidor; a chave vai como `Idempotency-Key`. */
export async function executarAcao(acao: AcaoOperacao, chave: string): Promise<unknown> {
  switch (acao.tipo) {
    case 'transicao':
      return apiOperacao.transicao(acao.defeito_id, acao.dados, {
        foto: acao.foto,
        local: acao.local,
        idempotencia: chave,
      });
    case 'atribuir':
      return apiOperacao.atribuir(acao.defeito_id, acao.dados, chave);
    case 'liberar':
      return apiOperacao.liberar(acao.defeito_id, chave);
    case 'nota':
      return apiOperacao.nota(acao.defeito_id, acao.texto, chave);
    case 'resposta':
      return apiOperacao.resposta(acao.defeito_id, acao.texto, chave);
    case 'evidencia':
      return apiOperacao.evidencia(acao.defeito_id, acao.evidencia, acao.foto, acao.local, chave);
    case 'lote':
      return apiOperacao.lote(acao.ids, acao.acao, acao.campos, chave);
  }
}

export type ResultadoExecucao<T> = { offline: false; resposta: T } | { offline: true };

/**
 * Tenta agora; sem rede, guarda para depois e devolve `{offline: true}` para a
 * tela aplicar o efeito de forma otimista. Erro do servidor (403, 400...) não
 * é enfileirado: sobe para a tela mostrar o motivo.
 *
 * Se ainda há ação pendente na fila, a nova entra atrás dela em vez de ir
 * direto: mandar agora passaria na frente ("Programar" chegando antes do
 * "Iniciar execução" feito offline) e o chamado terminaria no status errado.
 */
export async function executarOuEnfileirar<T = unknown>(
  acao: AcaoOperacao,
  rotulo: string,
): Promise<ResultadoExecucao<T>> {
  const chave = Crypto.randomUUID();
  const usuario = await getStoredUser().catch(() => null);
  const pendentes = await listarAcoes(usuario?.id != null ? String(usuario.id) : null);
  if (pendentes.some((a) => a.status === 'pendente')) {
    await enfileirar(chave, acao, rotulo);
    return { offline: true };
  }
  try {
    return { offline: false, resposta: (await executarAcao(acao, chave)) as T };
  } catch (err) {
    if (!ehErroDeRede(err)) throw err;
    await enfileirar(chave, acao, rotulo);
    return { offline: true };
  }
}

/** A transição carrega algo além do status (foto, checklist, resposta, nota...)? */
function temCarga(acao: Extract<AcaoOperacao, { tipo: 'transicao' }>) {
  const d = acao.dados;
  return (
    !!acao.foto ||
    !!d.texto?.trim() ||
    !!d.resposta_publica?.trim() ||
    (d.checklist?.length ?? 0) > 0 ||
    !!d.motivo ||
    !!d.duplicado_de
  );
}

/**
 * Uma recusa de transição pode vir de o chamado já estar no status pedido.
 * A repetição de algo que já chegou (resposta perdida na volta) o backend
 * reconhece pela chave de idempotência e devolve o 2xx guardado, então aqui
 * a recusa quase sempre é outra pessoa (ou a regra da comunidade) que mudou o
 * chamado antes. Só dá para considerar feita a transição que não leva mais
 * nada; com foto, checklist ou resposta, isso tudo foi descartado no servidor
 * e o item vira falha, com a explicação.
 */
async function conferirRecusa(
  acao: AcaoOperacao,
): Promise<{ aplicada: true } | { aplicada: false; aviso: string | null }> {
  if (acao.tipo !== 'transicao') return { aplicada: false, aviso: null };
  try {
    const atual = await apiOperacao.detalhe(acao.defeito_id);
    if (atual.status !== acao.dados.para) return { aplicada: false, aviso: null };
    if (!temCarga(acao)) return { aplicada: true };
    return {
      aplicada: false,
      aviso:
        `O chamado já está em "${rotuloOperacao(atual.status)}" (outra pessoa mudou antes), ` +
        'mas a foto, o checklist e a resposta desta ação não foram gravados. ' +
        'Registre-os pela tela do chamado e depois descarte este item.',
    };
  } catch {
    return { aplicada: false, aviso: null };
  }
}

/** Agrupa os motivos de recusa do lote: "Já assumido (3); Sem permissão (1)". */
function motivosDoLote(erros: ResultadoLote['erros']) {
  const contagem = new Map<string, number>();
  for (const e of erros) {
    const motivo = e.detail || 'Recusado';
    contagem.set(motivo, (contagem.get(motivo) ?? 0) + 1);
  }
  return [...contagem].map(([motivo, n]) => `${motivo} (${n})`).join('; ');
}

/**
 * Lote reenviado com recusas por chamado: o servidor responde 200 e lista os
 * recusados em `erros`. O item dá lugar a um novo, com chave nova (a antiga
 * devolveria o mesmo 200 guardado) e só os ids recusados, marcado como falha
 * com os motivos: "tentar de novo" reenvia só esses.
 */
function guardarRecusasDoLote(
  item: AcaoPendente,
  acao: Extract<AcaoOperacao, { tipo: 'lote' }>,
  resposta: ResultadoLote,
) {
  const recusados = new Set(resposta.erros.map((e) => String(e.id)));
  const ids = acao.ids.filter((id) => recusados.has(String(id)));
  const total = acao.ids.length;
  const n = resposta.erros.length;
  const verbo = n === 1 ? 'foi atualizado' : 'foram atualizados';
  return exclusivo(async () => {
    const lista = await lerAcoes();
    await gravarAcoes(
      lista.map((a) =>
        a.id === item.id
          ? {
              ...a,
              id: Crypto.randomUUID(),
              rotulo: `${item.rotulo} (${n} de ${total} recusado${n === 1 ? '' : 's'})`,
              acao: { ...acao, ids: ids.length > 0 ? ids : resposta.erros.map((e) => e.id) },
              status: 'falhou' as const,
              tentativas: item.tentativas + 1,
              proxima_tentativa_em: null,
              erro: `${n} de ${total} chamados não ${verbo}: ${motivosDoLote(resposta.erros)}.`,
            }
          : a,
      ),
    );
  });
}

/** Espera antes da próxima tentativa automática: 30 s, 2 min, 10 min, 30 min, 1 h. */
function espera(tentativas: number) {
  const passos = [30_000, 120_000, 600_000, 1_800_000];
  return passos[Math.max(0, tentativas - 1)] ?? 3_600_000;
}

/** Depois disso um erro ambíguo (5xx) vira falha visível em vez de tentar para sempre. */
const MAX_TENTATIVAS = 4;

export type ResumoDrenagem = { enviadas: number; falhas: number; semRede: boolean };

let drenando = false;

/**
 * Reenvia as ações do usuário em ordem (FIFO). Para no primeiro erro de rede
 * (sem conexão não adianta seguir), no primeiro item ainda em espera e no
 * primeiro erro ambíguo: a espera de um item vale para a fila toda, senão as
 * ações seguintes passariam na frente dele. Uma recusa clara do servidor marca
 * só aquele item como falha e a fila segue.
 */
export async function drenarAcoes(
  usuarioId: string | null,
  { forcar = false }: { forcar?: boolean } = {},
): Promise<ResumoDrenagem> {
  const resumo: ResumoDrenagem = { enviadas: 0, falhas: 0, semRede: false };
  if (drenando) return resumo;
  drenando = true;
  try {
    const agora = Date.now();
    const fila = (await listarAcoes(usuarioId)).filter((a) => a.status === 'pendente');
    for (const item of fila) {
      if (!forcar && item.proxima_tentativa_em && Date.parse(item.proxima_tentativa_em) > agora) break;
      if (!fotoExiste(item.acao)) {
        await atualizarAcao(item.id, {
          status: 'falhou',
          erro: 'A foto se perdeu no aparelho. Descarte e registre de novo.',
        });
        resumo.falhas++;
        continue;
      }
      try {
        const resposta = await executarAcao(item.acao, item.id);
        if (item.acao.tipo === 'lote') {
          const lote = resposta as ResultadoLote | null;
          if (lote?.erros && lote.erros.length > 0) {
            await guardarRecusasDoLote(item, item.acao, lote);
            if (lote.erros.length < item.acao.ids.length) resumo.enviadas++;
            resumo.falhas++;
            continue;
          }
        }
        await removerAcao(item.id);
        resumo.enviadas++;
      } catch (err) {
        const mensagem = err instanceof Error ? err.message : 'Erro ao enviar.';
        if (ehErroDeRede(err)) {
          await atualizarAcao(item.id, {
            tentativas: item.tentativas + 1,
            erro: 'Sem conexão',
            proxima_tentativa_em: new Date(Date.now() + espera(item.tentativas + 1)).toISOString(),
          });
          resumo.semRede = true;
          break;
        }
        if (mensagem.startsWith('Sessão expirada')) break;
        const conferida = await conferirRecusa(item.acao);
        if (conferida.aplicada) {
          await removerAcao(item.id);
          resumo.enviadas++;
          continue;
        }
        const tentativas = item.tentativas + 1;
        // 5xx tenta de novo algumas vezes; recusa clara (400/403/409) não muda
        // com o tempo. Sem o código HTTP no erro, a mensagem padrão do DRF
        // para 5xx não traz `detail`, então "Erro na requisição" conta como ambíguo.
        const ambiguo = mensagem === 'Erro na requisição' && tentativas < MAX_TENTATIVAS;
        await atualizarAcao(item.id, {
          tentativas,
          erro: conferida.aviso ? `${mensagem} ${conferida.aviso}` : mensagem,
          status: ambiguo ? 'pendente' : 'falhou',
          proxima_tentativa_em: ambiguo
            ? new Date(Date.now() + espera(tentativas)).toISOString()
            : null,
        });
        if (!ambiguo) resumo.falhas++;
        // Ambíguo fica pendente com espera: os seguintes esperam junto (FIFO).
        else break;
      }
    }
  } finally {
    drenando = false;
  }
  return resumo;
}

export function atualizarAcao(id: string, patch: Partial<AcaoPendente>) {
  return exclusivo(async () => {
    const lista = await lerAcoes();
    await gravarAcoes(lista.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  });
}

export function removerAcao(id: string) {
  return exclusivo(async () => {
    const lista = await lerAcoes();
    const item = lista.find((a) => a.id === id);
    if (item) apagarFoto(item.acao);
    await gravarAcoes(lista.filter((a) => a.id !== id));
  });
}

/** Volta um item que falhou para a fila (o usuário pediu "tentar de novo"). */
export function reativarAcao(id: string) {
  return atualizarAcao(id, {
    status: 'pendente',
    tentativas: 0,
    proxima_tentativa_em: null,
    erro: null,
  });
}

/**
 * Quando vale a próxima tentativa automática (ms a partir de agora), ou null.
 * Conta só a primeira pendente: a fila anda em ordem e ela segura as demais.
 */
export function proximaTentativaEm(acoes: AcaoPendente[]): number | null {
  const primeira = acoes.find((a) => a.status === 'pendente');
  if (!primeira) return null;
  const quando = primeira.proxima_tentativa_em
    ? Date.parse(primeira.proxima_tentativa_em)
    : Date.now() + 30_000;
  return Math.max(1000, quando - Date.now());
}

// ---------------------------------------------------------------------------
// 3. Roteiro do dia

export type MotivoPulo =
  | 'sem_acesso'
  | 'falta_material'
  | 'outra_equipe'
  | 'ja_resolvido'
  | 'nao_localizado';

export type RoteiroSalvo = {
  usuario_id: string | null;
  /** AAAA-MM-DD local: o roteiro vale só no dia em que foi montado. */
  data: string;
  paradas: ChamadoFila[];
  atual: number;
  /** Ids feitos (fechados) e pulados, com o motivo. */
  concluidas: string[];
  puladas: Record<string, MotivoPulo>;
  geometria: Coordenada[];
  distanciaM: number;
  duracaoS: number | null;
  fonte: 'ruas' | 'reta';
};

export function hojeLocal() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export async function salvarRoteiro(roteiro: RoteiroSalvo | null) {
  if (!roteiro) await AsyncStorage.removeItem(CHAVE_ROTEIRO);
  else await AsyncStorage.setItem(CHAVE_ROTEIRO, JSON.stringify(roteiro));
}

/** Roteiro de hoje do usuário; o de ontem (ou de outra pessoa) é descartado. */
export async function lerRoteiro(usuarioId: string | null): Promise<RoteiroSalvo | null> {
  const r = await lerJson<RoteiroSalvo | null>(CHAVE_ROTEIRO, null);
  if (!r || !Array.isArray(r.paradas)) return null;
  if (r.data !== hojeLocal() || (r.usuario_id && usuarioId && r.usuario_id !== usuarioId)) {
    await AsyncStorage.removeItem(CHAVE_ROTEIRO);
    return null;
  }
  return r;
}
