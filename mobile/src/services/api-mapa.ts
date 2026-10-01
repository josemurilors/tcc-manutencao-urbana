/**
 * Chamadas do mapa do cidadão: área visível com filtros, categorias com id,
 * transparência do município e busca de endereço.
 *
 * As rotas da API seguem o contrato v3 (§7.2 e §7.5). A busca de endereço não
 * passa pelo backend: vai direto ao Nominatim (OpenStreetMap), com debounce
 * na tela e no máximo uma requisição em voo — a política de uso do serviço
 * público pede ≤ 1 req/s e um User-Agent que identifique o app.
 */

import * as Location from 'expo-location';
import { Platform } from 'react-native';

import { paginated, request } from '@/services/api';
import type { AreaDoMapa } from '@/types';
import type {
  CategoriaMapa,
  FiltrosMapa,
  ResultadoEndereco,
  Transparencia,
} from '@/types/mapa';
import type { Caixa } from '@/utils/rarear';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
/** Identificação exigida pela política do Nominatim (o navegador não deixa trocar o UA). */
const USER_AGENT = 'CIU-CentralDeInteligenciaUrbana/1.0 (app de zeladoria urbana)';
const TIMEOUT_BUSCA_MS = 8000;

type Posicao = { latitude: number; longitude: number } | null | undefined;

/**
 * GET /defeitos/area/ com os filtros da folha "Camadas". `situacao` e
 * `categorias` são do contrato v3; um backend que ainda não os conhece só
 * os ignora (e a tela filtra de novo no cliente).
 */
export function areaDoMapa(caixa: Caixa, posicao: Posicao, filtros: FiltrosMapa) {
  const q = new URLSearchParams({
    min_lat: String(caixa.min_lat),
    max_lat: String(caixa.max_lat),
    min_lng: String(caixa.min_lng),
    max_lng: String(caixa.max_lng),
    situacao: filtros.situacao,
  });
  if (filtros.categorias.length > 0) q.set('categorias', filtros.categorias.join(','));
  if (posicao) {
    q.set('lat', String(posicao.latitude));
    q.set('lng', String(posicao.longitude));
  }
  return request<AreaDoMapa>(`/api/v1/defeitos/area/?${q}`);
}

/** Categorias com `id` (o tipo `Categoria` antigo só tem nome e ícone). */
export function categoriasDoMapa() {
  return paginated<CategoriaMapa>('/api/v1/categorias/', { publico: true });
}

/** Indicadores públicos da cidade (contrato v3 §7.5). */
export function transparencia(codigo: string) {
  return request<Transparencia>(`/api/v1/transparencia/${encodeURIComponent(codigo)}/`, {
    publico: true,
  });
}

type ItemNominatim = {
  place_id: number;
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  boundingbox?: [string, string, string, string];
  address?: Record<string, string>;
};

function paraResultado(item: ItemNominatim): ResultadoEndereco {
  const a = item.address ?? {};
  const rua = [a.road ?? a.pedestrian ?? a.footway, a.house_number].filter(Boolean).join(', ');
  const titulo = item.name || rua || item.display_name.split(',')[0];
  const cidade = a.city ?? a.town ?? a.village ?? a.municipality;
  const detalhe =
    [a.suburb ?? a.neighbourhood ?? a.city_district, cidade, a.state_code ?? a.state]
      .filter(Boolean)
      .join(' · ') || item.display_name;
  const bb = item.boundingbox?.map(Number);
  return {
    id: String(item.place_id),
    titulo,
    detalhe,
    latitude: Number(item.lat),
    longitude: Number(item.lon),
    caixa:
      bb && bb.every((n) => Number.isFinite(n))
        ? { min_lat: bb[0], max_lat: bb[1], min_lng: bb[2], max_lng: bb[3] }
        : undefined,
  };
}

/**
 * Busca de endereço no Brasil, priorizando o entorno de `perto` (viewbox de
 * ~30 km sem restringir: "Rua X" acha a da cidade da pessoa primeiro, mas
 * ainda acha outra cidade se ela digitar o nome).
 *
 * No nativo, se o Nominatim falhar (rede, limite), cai no geocoder do sistema
 * (`expo-location`), que só devolve coordenadas — vira um resultado único.
 */
export async function buscarEndereco(
  texto: string,
  perto: Posicao,
  signal?: AbortSignal,
): Promise<ResultadoEndereco[]> {
  const q = new URLSearchParams({
    q: texto,
    format: 'jsonv2',
    addressdetails: '1',
    countrycodes: 'br',
    limit: '6',
    'accept-language': 'pt-BR',
  });
  if (perto) {
    const d = 0.3;
    q.set(
      'viewbox',
      [perto.longitude - d, perto.latitude + d, perto.longitude + d, perto.latitude - d].join(','),
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_BUSCA_MS);
  const abortarExterno = () => controller.abort();
  signal?.addEventListener('abort', abortarExterno);
  try {
    const resp = await fetch(`${NOMINATIM_URL}?${q}`, {
      signal: controller.signal,
      // `User-Agent` é cabeçalho proibido no navegador; lá o Nominatim
      // identifica pelo Referer, que o próprio navegador manda.
      headers: Platform.OS === 'web' ? {} : { 'User-Agent': USER_AGENT },
    });
    if (!resp.ok) throw new Error(`Busca de endereço indisponível (${resp.status}).`);
    const itens = (await resp.json()) as ItemNominatim[];
    return itens.map(paraResultado);
  } catch (err) {
    // Cancelada pela própria tela (o usuário continuou digitando): repassa.
    if (signal?.aborted) throw err;
    if (Platform.OS === 'web') throw err;
    const pontos = await Location.geocodeAsync(texto);
    return pontos.slice(0, 3).map((p, i) => ({
      id: `sistema-${i}`,
      titulo: texto,
      detalhe: 'Localização aproximada',
      latitude: p.latitude,
      longitude: p.longitude,
    }));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortarExterno);
  }
}
