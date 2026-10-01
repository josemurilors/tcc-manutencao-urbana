/**
 * Carrega um recurso único (config, lista curta) com os estados do design
 * system. Par do `useListaPaginada` para o que não pagina.
 *
 * Recarregar = trocar a `versao`; o efeito busca e só grava estado depois do
 * `await` (sem setState síncrono no efeito, regra do React Compiler). A
 * função de busca entra por `useEffectEvent`: muda a cada render da tela sem
 * disparar recarga.
 */

import { useEffect, useEffectEvent, useState } from 'react';

import { ehErroDeRede, mensagemDeErro } from './confirmar';
import type { EstadoLista } from './use-lista-paginada';

type Resultado<T> = { dados: T | null; estado: EstadoLista; erro: string };

export function useDados<T>(buscar: () => Promise<T>, ativo = true) {
  const [res, setRes] = useState<Resultado<T>>({ dados: null, estado: 'carregando', erro: '' });
  const [atualizando, setAtualizando] = useState(false);
  const [versao, setVersao] = useState(0);

  const buscarAgora = useEffectEvent(() => buscar());

  useEffect(() => {
    if (!ativo) return;
    let cancelado = false;
    buscarAgora().then(
      (dados) => {
        if (cancelado) return;
        setRes({ dados, estado: 'pronto', erro: '' });
        setAtualizando(false);
      },
      (err: unknown) => {
        if (cancelado) return;
        setRes((r) => ({
          ...r,
          estado: ehErroDeRede(err) ? 'offline' : 'erro',
          erro: mensagemDeErro(err),
        }));
        setAtualizando(false);
      },
    );
    return () => {
      cancelado = true;
    };
  }, [ativo, versao]);

  return {
    dados: res.dados,
    estado: res.estado,
    erro: res.erro,
    atualizando,
    /** Troca os dados localmente (depois de salvar) sem ir ao servidor. */
    setDados: (atualizar: (prev: T | null) => T | null) =>
      setRes((r) => ({ ...r, dados: atualizar(r.dados) })),
    /** Volta ao esqueleto e busca de novo (botão "Tentar de novo"). */
    recarregar: () => {
      setRes((r) => ({ ...r, estado: 'carregando' }));
      setVersao((v) => v + 1);
    },
    /** Busca de novo mantendo a tela (puxar para atualizar, depois de salvar). */
    atualizar: () => {
      setAtualizando(true);
      setVersao((v) => v + 1);
    },
  };
}
