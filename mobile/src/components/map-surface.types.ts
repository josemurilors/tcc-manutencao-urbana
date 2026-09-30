/**
 * Contrato compartilhado entre as duas implementações do mapa
 * (`map-surface.tsx` nativo e `map-surface.web.tsx`).
 *
 * Fica num arquivo só de tipos para que a tela possa importá-lo sem arrastar
 * junto a implementação da outra plataforma.
 */

import type { Posicao } from '@/hooks/use-localizacao';
import type { LatLng } from '@/utils/geo';

export type Regiao = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

export type CirculoMapa = {
  key: string;
  centro: LatLng;
  /** Raio em metros. */
  raio: number;
  corPreenchimento: string;
  corBorda?: string;
  larguraBorda?: number;
};

export type MarcadorMapa = {
  key: string;
  coordenada: LatLng;
  cor: string;
  /** Emoji da categoria, exibido dentro do pino. */
  icone?: string;
  /** Dentro do raio de confirmação — ganha o anel dourado (estilo Pokémon Go). */
  emAlcance?: boolean;
  /** Marcador selecionado no momento (maior). */
  selecionado?: boolean;
  /** Etiqueta curta sobre o balão (número da parada no roteiro). */
  rotulo?: string;
};

/** Linha desenhada no mapa (traçado do roteiro). */
export type LinhaMapa = {
  key: string;
  coordenadas: LatLng[];
  cor: string;
  largura?: number;
  /** Tracejada — usada para o traçado em linha reta (sem rota por ruas). */
  tracejada?: boolean;
};

export type MapSurfaceProps = {
  regiaoInicial: Regiao;
  circulos: CirculoMapa[];
  marcadores: MarcadorMapa[];
  linhas?: LinhaMapa[];
  /** Posição atual do GPS; desenhada como o "seu carro" do Waze. */
  usuario: Posicao | null;
  /** Para onde o aparelho aponta (bússola); gira o cone do marcador do usuário. */
  direcao: number | null;
  /** Toque longo no mapa (posicionar um chamado fora de onde se está). */
  onLongPressMapa: (coordenada: LatLng) => void;
  onPressMarcador: (key: string) => void;
  /** O usuário arrastou o mapa — a tela sai do modo "seguir". */
  onArrastar: () => void;
  /** A câmera parou (arrasto, zoom ou animação): região visível agora. */
  onRegiaoMudou?: (regiao: Regiao) => void;
  /**
   * O mapa nativo já aceita comandos de câmera. Chamadas a `seguir`/`animarPara`
   * antes disso são ignoradas pelo react-native-maps, então a tela usa este
   * sinal para (re)aplicar o "seguir" inicial.
   */
  onPronto?: () => void;
  escuro: boolean;
};

export type MapSurfaceHandle = {
  animarPara: (regiao: Regiao, duracaoMs?: number) => void;
  /** Centraliza no usuário com zoom de rua. */
  seguir: (posicao: Posicao) => void;
};
