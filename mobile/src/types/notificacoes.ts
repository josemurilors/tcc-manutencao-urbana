/** Tipos da central de notificações (contrato v3 §7.3). */

/** Tipos que o backend emite hoje; `string` cobre os que vierem depois. */
export type TipoNotificacao =
  | 'status'
  | 'resposta'
  | 'avaliar'
  | 'apoio_marco'
  | 'sla_alerta'
  | 'atribuido'
  | 'moderacao';

export type Notificacao = {
  id: number;
  tipo: TipoNotificacao | (string & {});
  titulo: string;
  corpo: string;
  /** Chamado relacionado; null em avisos de conta (moderação, por exemplo). */
  defeito_id: string | number | null;
  /** null = não lida. */
  lida_em: string | null;
  criado_em: string;
};

/** Página do DRF (`{count, next, previous, results}`). */
export type PaginaNotificacoes = {
  count: number;
  next: string | null;
  previous: string | null;
  results: Notificacao[];
};

/** Plataforma informada ao registrar o token do Expo Push. */
export type PlataformaPush = 'android' | 'ios' | 'web';

/** Dados que o backend manda junto com o push (`enviar_push(..., dados)`). */
export type DadosPush = {
  defeito_id?: string | number | null;
  tipo?: string;
  notificacao_id?: number;
};
