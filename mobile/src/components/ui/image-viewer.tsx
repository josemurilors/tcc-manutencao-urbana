/**
 * Visualização de imagem em tela cheia (equivale ao lightbox do web).
 *
 * Quando a URL é da nossa API (anexos da operação, imagem de chamado
 * restrito), manda o token no cabeçalho, como as miniaturas: sem ele a
 * ampliação de uma foto protegida abria em branco. URL de fora (CDN, mapa) e
 * `data:`/`file:`/`blob:` vão sem cabeçalho — o token nunca sai para outro host.
 */

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Radius, Spacing } from '@/constants/theme';
import { API_URL } from '@/services/api';
import { getTokenSync } from '@/services/storage';

/** Fonte para o `expo-image`, com `Authorization` só para a nossa API. */
export function fonteDaImagem(uri: string) {
  const relativa = uri.startsWith('/') && !uri.startsWith('//');
  const absoluta = relativa ? `${API_URL}${uri}` : uri;
  const daApi = relativa || (!!API_URL && (absoluta === API_URL || absoluta.startsWith(`${API_URL}/`)));
  const token = daApi ? getTokenSync() : null;
  return token ? { uri: absoluta, headers: { Authorization: `Bearer ${token}` } } : { uri: absoluta };
}

type Props = {
  uri: string | null;
  onClose: () => void;
};

export function ImageViewer({ uri, onClose }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={!!uri} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Fechar imagem">
        {uri ? (
          <Image source={fonteDaImagem(uri)} style={styles.imagem} contentFit="contain" transition={150} />
        ) : null}
      </Pressable>
      <View style={[styles.fecharWrapper, { top: insets.top + Spacing[2] }]}>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Fechar"
          style={styles.fechar}>
          <Ionicons name="close" size={22} color="#fff" />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imagem: {
    width: '92%',
    height: '80%',
  },
  fecharWrapper: {
    position: 'absolute',
    right: Spacing[4],
  },
  fechar: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
