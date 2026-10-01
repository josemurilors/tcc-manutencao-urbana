/**
 * Tipos do mapa do cidadão (filtros, busca de endereço e transparência).
 *
 * Ficam fora de `types.ts` por regra do contrato v3 (§5): cada área cuida dos
 * seus. Os formatos de resposta espelham `docs/arquitetura/contrato-v3.md`
 * §7.2 (`/defeitos/area/`) e §7.5 (`/transparencia/<codigo>/`).
 */

/** Categoria como o GET /categorias/ devolve (o `id` alimenta `?categorias=`). */
export type CategoriaMapa = {
  id: number;
  nome: string;
  icone?: string;
};

/** Recorte de `?situacao=` em /defeitos/area/ (padrão do backend: abertos). */
export type SituacaoMapa = 'abertos' | 'resolvidos' | 'todos';

/** Escolhas da folha "Camadas", persistidas no aparelho. */
export type FiltrosMapa = {
  situacao: SituacaoMapa;
  /** Ids de categoria; vazio = todas. */
  categorias: number[];
  /** Camada de calor ligada. */
  calor: boolean;
};

export const FILTROS_PADRAO: FiltrosMapa = { situacao: 'abertos', categorias: [], calor: false };

/** Um resultado da busca de endereço, já pronto para "ir para". */
export type ResultadoEndereco = {
  id: string;
  /** Primeira linha: rua/lugar. */
  titulo: string;
  /** Segunda linha: bairro, cidade, UF. */
  detalhe: string;
  latitude: number;
  longitude: number;
  /** Enquadramento sugerido pelo geocoder (bairro/cidade vêm maiores que uma rua). */
  caixa?: { min_lat: number; max_lat: number; min_lng: number; max_lng: number };
};

/** GET /api/v1/transparencia/<codigo>/ — público e sem dado pessoal. */
export type Transparencia = {
  municipio: { codigo: string; nome: string; uf_sigla: string };
  /** A prefeitura contratou a plataforma (atende pelo app). */
  contratado: boolean;
  kpis_90d: {
    recebidos: number;
    resolvidos: number;
    /** 0–100; null sem resolvidos com prazo no período. */
    pct_no_prazo: number | null;
    tempo_mediano_dias: number | null;
    /** Média de 1 a 5; null sem avaliações. */
    csat_media: number | null;
  };
  por_categoria: {
    categoria: string;
    icone?: string;
    recebidos: number;
    resolvidos: number;
    tempo_mediano_dias: number | null;
    pct_no_prazo: number | null;
  }[];
  serie_mensal: { mes: string; recebidos: number; resolvidos: number }[];
  ultimos_resolvidos: {
    id: string;
    protocolo: string | null;
    titulo: string;
    categoria: string;
    bairro: string;
    resolvido_em: string;
    tem_foto_depois: boolean;
  }[];
};
