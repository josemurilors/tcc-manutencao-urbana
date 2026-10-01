/**
 * Captura de evidência de campo: foto **pela câmera** (nunca da galeria, para
 * a prova não ser uma foto antiga) com a posição do GPS no momento.
 *
 * Sem GPS a foto segue (o local pode estar sob marquise ou sem sinal), mas a
 * ficha avisa — o backend recebe `latitude/longitude` vazios e decide.
 */

import * as Location from 'expo-location';

import type { PickedImage } from '@/types';
import type { Coordenada } from '@/types/operacao';
import { tirarFoto } from '@/utils/image';

const TIMEOUT_GPS_MS = 8000;

async function posicaoAgora(): Promise<Coordenada | null> {
  const permissao = await Location.getForegroundPermissionsAsync();
  if (!permissao.granted) {
    const pedido = await Location.requestForegroundPermissionsAsync();
    if (!pedido.granted) return null;
  }
  const leitura = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  const limite = new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_GPS_MS));
  const pos = (await Promise.race([leitura, limite])) ?? (await Location.getLastKnownPositionAsync());
  return pos ? { latitude: pos.coords.latitude, longitude: pos.coords.longitude } : null;
}

export type Evidencia = { foto: PickedImage; local: Coordenada | null };

/**
 * Abre a câmera e lê o GPS em paralelo. `null` se a pessoa cancelar ou negar a
 * câmera. Erros de tamanho de imagem sobem para a tela mostrar.
 */
export async function capturarEvidencia(): Promise<Evidencia | null> {
  const gps = posicaoAgora().catch((err) => {
    if (__DEV__) console.warn('[evidencia] GPS indisponível', err);
    return null;
  });
  const foto = await tirarFoto();
  if (!foto) return null;
  return { foto, local: await gps };
}
