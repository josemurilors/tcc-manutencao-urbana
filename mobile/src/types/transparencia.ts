/**
 * Tipos do portal público de transparência (`/transparencia/<codigo>`).
 *
 * O formato base da resposta já mora em `types/mapa.ts` (o painel da cidade
 * no mapa usa o mesmo endpoint); aqui entra o que só o portal lê — o selo de
 * "dados atualizados em" — e os atalhos de item que as seções recebem.
 * Espelha `docs/arquitetura/contrato-v3.md` §7.5.
 */

import type { Transparencia } from './mapa';

/** GET /api/v1/transparencia/<codigo>/ completo, como o portal consome. */
export type PortalTransparencia = Transparencia & {
  /** Quando o backend montou os números (cache de até 10 min). */
  atualizado_em?: string;
};

export type KpisTransparencia = PortalTransparencia['kpis_90d'];
export type CategoriaTransparencia = PortalTransparencia['por_categoria'][number];
export type MesTransparencia = PortalTransparencia['serie_mensal'][number];
export type ResolvidoTransparencia = PortalTransparencia['ultimos_resolvidos'][number];

/** Formatos de download dos dados abertos (`/dados-abertos/<codigo>/chamados.<fmt>`). */
export type FormatoDadosAbertos = 'csv' | 'geojson';
