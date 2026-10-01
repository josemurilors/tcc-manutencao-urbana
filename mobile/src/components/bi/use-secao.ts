/**
 * Carga independente de cada seção do painel.
 *
 * Cada bloco busca a própria rota e tem o próprio estado de erro: se
 * `bi/satisfacao/` falhar (ou ainda não existir no servidor), o resto do
 * painel continua de pé e só aquele cartão mostra "Tentar de novo". Respostas
 * que chegam depois de o filtro mudar são descartadas pelo contador de
 * geração, para um período antigo não sobrescrever o novo.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Erro técnico -> frase para o gestor. O `request` repassa a mensagem crua do
 * fetch ("Failed to fetch") ou o `detail` do DRF em inglês ("Not found.").
 */
export function mensagemAmigavel(e: unknown, padrao = 'Falha ao carregar.') {
  const msg = e instanceof Error ? e.message : '';
  if (/failed to fetch|network request failed|networkerror/i.test(msg)) {
    return 'Sem conexão com o servidor. Confira a internet e tente de novo.';
  }
  if (/^not found\.?$/i.test(msg.trim())) return 'Este indicador ainda não está disponível no servidor.';
  return msg || padrao;
}

export type Secao<T> = {
  dados: T | null;
  erro: string | null;
  carregando: boolean;
  recarregar: () => Promise<void>;
};

/**
 * `manterAnterior`: durante a recarga, continua mostrando o dado do filtro
 * anterior (bom para KPIs — sem piscar). Desligue quando o dado velho induz a
 * erro, como um ranking por bairro exibido sob o título "por categoria".
 */
export function useSecao<T>(
  buscar: (() => Promise<T>) | null,
  chave: string,
  manterAnterior = true,
): Secao<T> {
  const [resultado, setResultado] = useState<{ chave: string; dados: T } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(!!buscar);
  const geracao = useRef(0);
  const buscarRef = useRef(buscar);
  const chaveRef = useRef(chave);
  useEffect(() => {
    buscarRef.current = buscar;
    chaveRef.current = chave;
  });

  const recarregar = useCallback(async () => {
    const fn = buscarRef.current;
    if (!fn) return;
    const minha = ++geracao.current;
    setCarregando(true);
    setErro(null);
    try {
      const r = await fn();
      if (minha === geracao.current) setResultado({ chave: chaveRef.current, dados: r });
    } catch (e) {
      if (minha === geracao.current) setErro(mensagemAmigavel(e));
    } finally {
      if (minha === geracao.current) setCarregando(false);
    }
  }, []);

  const ativo = !!buscar;
  useEffect(() => {
    if (ativo) recarregar();
  }, [chave, ativo, recarregar]);

  const dados = resultado && (manterAnterior || resultado.chave === chave) ? resultado.dados : null;
  return { dados, erro, carregando, recarregar };
}
