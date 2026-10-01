/**
 * Catálogos auxiliares da operação: categorias (com id e checklist), equipes
 * com membros e respostas-padrão. Carregados uma vez por montagem da aba.
 *
 * São acessórios: se um falhar, a fila continua e só some o recurso que
 * dependia dele (filtro por categoria, atribuir, respostas prontas). O erro
 * fica registrado em `falhas` para a tela poder avisar.
 */

import { useCallback, useEffect, useState } from 'react';

import { api } from '@/services/api';
import { apiOperacao } from '@/services/api-operacao';
import type { CategoriaOperacao, EquipeOperacao, RespostaPadrao } from '@/types/operacao';

export type Catalogos = {
  categorias: CategoriaOperacao[];
  equipes: EquipeOperacao[];
  respostas: RespostaPadrao[];
  /** Emoji por nome de categoria (pinos e cartões). */
  icones: Map<string, string>;
  falhas: string[];
  recarregar: () => void;
};

export function useCatalogos(): Catalogos {
  const [categorias, setCategorias] = useState<CategoriaOperacao[]>([]);
  const [equipes, setEquipes] = useState<EquipeOperacao[]>([]);
  const [respostas, setRespostas] = useState<RespostaPadrao[]>([]);
  const [icones, setIcones] = useState<Map<string, string>>(new Map());
  const [falhas, setFalhas] = useState<string[]>([]);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    let vivo = true;
    const erros: string[] = [];
    const anotar = (oque: string) => (err: unknown) => {
      if (__DEV__) console.warn(`[catalogos] ${oque}`, err);
      erros.push(oque);
      return null;
    };
    Promise.all([
      apiOperacao.categorias().catch(anotar('categorias')),
      apiOperacao.equipes().catch(anotar('equipes')),
      apiOperacao.respostasPadrao().catch(anotar('respostas-padrão')),
      // Os emojis vêm do catálogo público, que existe desde a v1.
      api.listCategorias().catch(anotar('ícones')),
    ]).then(([cats, eqs, resps, publicas]) => {
      if (!vivo) return;
      setCategorias(Array.isArray(cats) ? cats : []);
      setEquipes(Array.isArray(eqs) ? eqs : []);
      setRespostas(Array.isArray(resps) ? resps.filter((r) => r && r.texto) : []);
      const mapa = new Map<string, string>();
      for (const c of publicas ?? []) if (c.icone) mapa.set(c.nome, c.icone);
      for (const c of Array.isArray(cats) ? cats : []) if (c.icone) mapa.set(c.nome, c.icone);
      setIcones(mapa);
      setFalhas(erros);
    });
    return () => {
      vivo = false;
    };
  }, [versao]);

  const recarregar = useCallback(() => setVersao((v) => v + 1), []);

  return { categorias, equipes, respostas, icones, falhas, recarregar };
}
