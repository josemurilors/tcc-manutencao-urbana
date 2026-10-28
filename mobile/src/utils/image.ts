/**
 * Seleção de imagens (galeria ou câmera).
 *
 * O web usava `<input type="file">`; aqui usamos o expo-image-picker e
 * normalizamos o resultado para o formato que o FormData do React Native
 * espera (`{ uri, name, type }`).
 */

import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import type { PickedImage } from '@/types';

/** O backend aceita JPEG, PNG e WebP. */
const MIME_PADRAO = 'image/jpeg';
const TAMANHO_MAXIMO_BYTES = 5 * 1024 * 1024;

export class ImagemMuitoGrandeError extends Error {
  constructor() {
    super('Arquivo muito grande. Máximo 5MB.');
    this.name = 'ImagemMuitoGrandeError';
  }
}

function normalizar(asset: ImagePicker.ImagePickerAsset): PickedImage {
  const type = asset.mimeType ?? MIME_PADRAO;
  const extensao = type.split('/')[1] ?? 'jpg';
  return {
    uri: asset.uri,
    name: asset.fileName ?? `foto-${Date.now()}.${extensao}`,
    type,
  };
}

/** Lado máximo que o backend guarda (`LADO_MAXIMO` em image_processor.py). */
const LADO_MAXIMO = 1600;

/**
 * No navegador o `quality` do picker não recomprime: a foto do celular chega
 * inteira (10+ MB). Reduz aqui, já de pé (EXIF aplicado), antes do envio.
 */
async function reduzirNoNavegador(asset: ImagePicker.ImagePickerAsset): Promise<PickedImage> {
  const original = await fetch(asset.uri).then((r) => r.blob());
  const bmp = await createImageBitmap(original, { imageOrientation: 'from-image' });
  const escala = Math.min(1, LADO_MAXIMO / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * escala);
  canvas.height = Math.round(bmp.height * escala);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const jpeg = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, MIME_PADRAO, 0.85));
  if (!jpeg) throw new Error('Falha ao reduzir a foto.');
  return { uri: URL.createObjectURL(jpeg), name: `foto-${Date.now()}.jpg`, type: MIME_PADRAO };
}

async function preparar(asset: ImagePicker.ImagePickerAsset): Promise<PickedImage> {
  if (Platform.OS === 'web') return reduzirNoNavegador(asset);
  if (asset.fileSize && asset.fileSize > TAMANHO_MAXIMO_BYTES) throw new ImagemMuitoGrandeError();
  return normalizar(asset);
}

/** Abre a galeria. Devolve `null` se o usuário cancelar ou negar a permissão. */
export async function escolherDaGaleria(): Promise<PickedImage | null> {
  const permissao = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permissao.granted) return null;

  const resultado = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.7,
    allowsEditing: false,
  });
  if (resultado.canceled || !resultado.assets?.[0]) return null;

  return preparar(resultado.assets[0]);
}

/** Abre a câmera. Devolve `null` se o usuário cancelar ou negar a permissão. */
export async function tirarFoto(): Promise<PickedImage | null> {
  const permissao = await ImagePicker.requestCameraPermissionsAsync();
  if (!permissao.granted) return null;

  const resultado = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 0.7,
  });
  if (resultado.canceled || !resultado.assets?.[0]) return null;

  return preparar(resultado.assets[0]);
}
