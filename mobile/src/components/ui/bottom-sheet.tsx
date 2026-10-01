/**
 * Folha inferior simples, sobre um `Modal`: escurece o fundo, sobe do rodapé e
 * fecha pelo toque fora, pelo botão "Fechar" e pelo voltar do Android.
 *
 * É a base para ações e detalhes curtos (fila offline, confirmar lote). As
 * folhas do mapa (`defect-sheet`, `operacao-sheet`) têm arrasto próprio e
 * ficam como estão por ora.
 */

import { useEffect, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Duration, Elevation, Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';

import { IconButton } from './icon-button';
import { AppText } from './text';

type Props = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** Linha abaixo do título. */
  description?: string;
  children: React.ReactNode;
  /** Rodapé fixo (botões), fora da área que rola. */
  footer?: React.ReactNode;
};

export function BottomSheet({ visible, onClose, title, description, children, footer }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [subida] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!visible) return;
    subida.setValue(0);
    Animated.timing(subida, { toValue: 1, duration: Duration.slow, useNativeDriver: true }).start();
  }, [visible, subida]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}>
      <View style={styles.raiz}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Fechar"
        />
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.folha,
            Elevation.lg,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              maxHeight: height * 0.85,
              paddingBottom: insets.bottom + Spacing[4],
              transform: [
                { translateY: subida.interpolate({ inputRange: [0, 1], outputRange: [48, 0] }) },
              ],
            },
          ]}>
          <View style={[styles.alca, { backgroundColor: colors.borderStrong }]} />
          {title ? (
            <View style={styles.cabecalho}>
              <View style={styles.titulos}>
                <AppText variant="title" accessibilityRole="header">
                  {title}
                </AppText>
                {description ? (
                  <AppText variant="bodySm" tone="secondary">
                    {description}
                  </AppText>
                ) : null}
              </View>
              <IconButton icon="close" accessibilityLabel="Fechar" onPress={onClose} />
            </View>
          ) : null}
          <ScrollView
            style={styles.rolagem}
            contentContainerStyle={styles.conteudo}
            keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {footer ? <View style={styles.rodape}>{footer}</View> : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  raiz: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  folha: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingTop: Spacing[2],
    // Em tablet/web não estica de ponta a ponta.
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
  alca: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: Radius.full,
    marginBottom: Spacing[2],
  },
  cabecalho: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing[2],
    paddingLeft: Spacing[4],
    paddingRight: Spacing[2],
  },
  titulos: {
    flex: 1,
    gap: Spacing[0.5],
    paddingTop: Spacing[2],
  },
  rolagem: {
    flexGrow: 0,
  },
  conteudo: {
    padding: Spacing[4],
    gap: Spacing[3],
  },
  rodape: {
    flexDirection: 'row',
    gap: Spacing[2],
    paddingHorizontal: Spacing[4],
  },
});
