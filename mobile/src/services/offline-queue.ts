/**
 * Fila offline de chamados.
 *
 * O web usa IndexedDB + Background Sync do service worker. No nativo não há
 * service worker, então a fila mora no AsyncStorage e é drenada pelo
 * `OfflineSyncProvider` (montado no layout raiz) quando há conexão.
 *
 * Garantias:
 * - A foto é copiada do cache do picker para `documentDirectory/offline/`, que
 *   o sistema não limpa sozinho. Antes ela era só referenciada e podia sumir.
 * - Cada item guarda quem o criou (`usuario_id`): se outra pessoa entrar no
 *   mesmo aparelho, o chamado não sai com o token dela.
 * - Nenhum item some em silêncio: o que o backend recusa vira `falhou`, com a
 *   mensagem, e só sai da fila quando enviado ou descartado pelo usuário.
 * - Leituras e escritas passam por uma trava, para o sync e um enfileiramento
 *   simultâneo não se sobrescreverem.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import type { NovoDefeito } from './api';
import { getStoredUser } from './storage';

const QUEUE_KEY = 'ciu_offline_defeitos';
const PASTA_FOTOS = 'offline';

export type StatusFila = 'pendente' | 'falhou';

export type PendingDefeito = NovoDefeito & {
  id: string;
  criado_em: string;
  // Campos abaixo são opcionais porque itens gravados por versões antigas do
  // app não os têm; a leitura trata ausência como pendente, sem tentativas.
  usuario_id?: string | null;
  status?: StatusFila;
  tentativas?: number;
  /** ISO; antes disso o sync automático não tenta este item de novo. */
  proxima_tentativa_em?: string | null;
  erro?: string | null;
};

let trava: Promise<unknown> = Promise.resolve();

type Ouvinte = () => void;
const ouvintes = new Set<Ouvinte>();

/**
 * Avisa quando a fila muda. O `api.createDefeito` enfileira sem passar pelo
 * provider de sync; é assim que o indicador fica sabendo na hora.
 */
export function onQueueChange(ouvinte: Ouvinte) {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

/** Serializa operações na fila (ler-modificar-gravar). */
function exclusivo<T>(fn: () => Promise<T>): Promise<T> {
  const proxima = trava.then(fn, fn);
  trava = proxima.catch(() => {});
  return proxima;
}

async function lerFila(): Promise<PendingDefeito[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveQueue(items: PendingDefeito[]) {
  if (items.length === 0) await AsyncStorage.removeItem(QUEUE_KEY);
  else await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  // Fora da trava: o ouvinte costuma reler a fila, o que entraria na fila da
  // própria trava que ainda está ocupada por esta escrita.
  setTimeout(() => ouvintes.forEach((o) => o()), 0);
}

export function getQueue(): Promise<PendingDefeito[]> {
  return exclusivo(lerFila);
}

/**
 * Copia a foto para a pasta persistente da fila. Se a cópia falhar (ou no web,
 * onde a URI é blob:), segue com a URI original — melhor arriscar o cache do
 * que perder o chamado inteiro.
 */
async function guardarFoto(id: string, dados: NovoDefeito): Promise<NovoDefeito> {
  if (!dados.imagem || Platform.OS === 'web') return dados;
  try {
    const pasta = new Directory(Paths.document, PASTA_FOTOS);
    pasta.create({ intermediates: true, idempotent: true });
    const extensao = dados.imagem.name.split('.').pop() || 'jpg';
    const destino = new File(pasta, `${id}.${extensao}`);
    await new File(dados.imagem.uri).copy(destino);
    return { ...dados, imagem: { ...dados.imagem, uri: destino.uri } };
  } catch {
    return dados;
  }
}

/** Apaga a cópia da foto, se ela estiver na pasta da fila. */
function apagarFoto(item: PendingDefeito) {
  if (!item.imagem || Platform.OS === 'web') return;
  if (!item.imagem.uri.includes(`/${PASTA_FOTOS}/`)) return;
  try {
    const arquivo = new File(item.imagem.uri);
    if (arquivo.exists) arquivo.delete();
  } catch {
    // Sobra um arquivo órfão na pasta da fila; não vale travar o fluxo por isso.
  }
}

export async function enqueueDefeito(dados: NovoDefeito) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [comFoto, usuario] = await Promise.all([
    guardarFoto(id, dados),
    getStoredUser().catch(() => null),
  ]);
  await exclusivo(async () => {
    const queue = await lerFila();
    queue.push({
      ...comFoto,
      id,
      criado_em: new Date().toISOString(),
      usuario_id: usuario?.id != null ? String(usuario.id) : null,
      status: 'pendente',
      tentativas: 0,
      proxima_tentativa_em: null,
      erro: null,
    });
    await saveQueue(queue);
  });
}

/** Aplica um patch a um item (ex.: marcar falha, agendar nova tentativa). */
export function updateQueueItem(id: string, patch: Partial<PendingDefeito>) {
  return exclusivo(async () => {
    const queue = await lerFila();
    await saveQueue(queue.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  });
}

/** Tira o item da fila (enviado ou descartado) e apaga a cópia da foto. */
export function removeFromQueue(id: string) {
  return exclusivo(async () => {
    const queue = await lerFila();
    const item = queue.find((i) => i.id === id);
    if (item) apagarFoto(item);
    await saveQueue(queue.filter((i) => i.id !== id));
  });
}

export function clearQueue() {
  return exclusivo(async () => {
    (await lerFila()).forEach(apagarFoto);
    await saveQueue([]);
  });
}

/** A foto do item ainda está no aparelho? No web a URI blob: não é verificável. */
export function fotoExiste(item: PendingDefeito): boolean {
  if (!item.imagem) return false;
  if (Platform.OS === 'web') return true;
  try {
    return new File(item.imagem.uri).exists;
  } catch {
    return false;
  }
}

/** Descarta a foto quando o arquivo já não existe (compatibilidade). */
export function withExistingImage(item: PendingDefeito): PendingDefeito {
  if (!item.imagem) return item;
  return fotoExiste(item) ? item : { ...item, imagem: null };
}

/**
 * Espera antes da próxima tentativa automática: 30 s, 2 min, 10 min, 30 min e
 * depois de hora em hora. Tocar no indicador força o envio na hora.
 */
export function esperaAposTentativas(tentativas: number): number {
  const passos = [30_000, 120_000, 600_000, 1_800_000];
  return passos[Math.max(0, tentativas - 1)] ?? 3_600_000;
}
