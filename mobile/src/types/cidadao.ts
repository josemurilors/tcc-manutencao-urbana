/**
 * Tipos da jornada do cidadão (contrato v3 §7.2 — `docs/arquitetura/contrato-v3.md`).
 *
 * Ficam fora de `types.ts` de propósito (contrato §5): cada área cuida dos seus.
 */

import type { Defeito, DefeitoEvento } from '@/types';

/** Linha de GET /defeitos/proximos/ — abertos no raio + fechados há até 30 dias. */
export type ChamadoProximo = {
  id: string;
  protocolo: string | null;
  titulo: string;
  categoria: string;
  status: string;
  distancia_m: number;
  criado_em: string;
  resolvido_em: string | null;
  total_apoios: number;
};

/** Foto do chamado (GET /operacao/chamados/<id>/anexos/). */
export type AnexoChamado = {
  id: number;
  tipo: 'cidadao' | 'antes' | 'depois';
  /** Pode vir relativa (`/api/v1/operacao/anexos/<id>/imagem/`); o serviço completa. */
  url: string;
  latitude: number | null;
  longitude: number | null;
  autor_nome: string;
  criado_em: string;
};

/**
 * Detalhe do chamado como o cidadão recebe. Além do que `Defeito` já descreve,
 * o serializer de detalhe manda a foto de resolução e a previsão.
 */
export type ChamadoDetalhe = Defeito & {
  /** Foto de evidência da conclusão (data URI), quando a equipe anexou. */
  foto_resolucao_url?: string | null;
  previsao_conclusao?: string | null;
};

export type EventoChamado = DefeitoEvento;

/** Filtro de "Meus chamados". */
export type FiltroMeusChamados = 'abertos' | 'resolvidos' | 'todos';

/** Par de fotos para o "antes e depois" do detalhe. */
export type FotosChamado = {
  antes: string[];
  depois: string[];
  /** De onde veio: anexos da API (completo) ou só os campos do detalhe (resumo). */
  origem: 'anexos' | 'detalhe';
};
