/**
 * Texto de erro para mostrar à pessoa. O `request` cai em "Erro na
 * requisição" quando o servidor não manda `detail` (404 de rota ainda não
 * publicada, 500), e o fetch fala inglês quando a rede cai — nenhum dos dois
 * ajuda quem está usando o app.
 */

const GENERICOS = ['Erro na requisição', 'Not found.', 'Não encontrado.'];
const REDE = ['Failed to fetch', 'Network request failed', 'NetworkError'];

export function mensagemDeErro(err: unknown, padrao: string): string {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (!msg || GENERICOS.includes(msg)) return padrao;
  if (REDE.some((r) => msg.includes(r))) return 'Sem conexão com a internet. Confira e tente de novo.';
  return msg;
}
