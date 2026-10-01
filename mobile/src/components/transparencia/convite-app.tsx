/**
 * Convite para quem chegou por um link público (portal ou chamado) sem estar
 * no app: reportar/acompanhar pelo CIU. No web oferece baixar o app; no app
 * nativo, que já está instalado, só entrar na conta.
 */

import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Linking, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Button } from '@/components/ui/button';
import { AppText } from '@/components/ui/text';
import { Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useColors } from '@/context/theme-context';
import { useToast } from '@/context/toast-context';
import { LINK_BAIXAR_APP } from '@/services/api-transparencia';

type Props = {
  titulo: string;
  texto: string;
  /** `faixa`: barra compacta fixa no rodapé; `cartao`: bloco no fim da página. */
  modo?: 'faixa' | 'cartao';
  style?: StyleProp<ViewStyle>;
};

export function ConviteApp({ titulo, texto, modo = 'cartao', style }: Props) {
  const colors = useColors();
  const toast = useToast();
  const { isAuthenticated } = useAuth();
  const web = Platform.OS === 'web';

  async function baixar() {
    try {
      await Linking.openURL(LINK_BAIXAR_APP);
    } catch {
      toast.error('Não foi possível abrir a loja de aplicativos.');
    }
  }

  const botoes = (
    <View style={styles.botoes}>
      {web ? (
        <Button
          size="sm"
          onPress={baixar}
          icon={<Ionicons name="download-outline" size={16} color={colors.onPrimary} />}>
          Baixar o app
        </Button>
      ) : null}
      {isAuthenticated ? (
        <Button
          size="sm"
          variant={web ? 'secondary' : 'primary'}
          onPress={() => router.navigate('/(tabs)/mapa')}
          icon={<Ionicons name="map-outline" size={16} color={web ? colors.textPrimary : colors.onPrimary} />}>
          Reportar no mapa
        </Button>
      ) : (
        <Button
          size="sm"
          variant={web ? 'secondary' : 'primary'}
          onPress={() => router.push('/login')}
          icon={<Ionicons name="log-in-outline" size={16} color={web ? colors.textPrimary : colors.onPrimary} />}>
          Entrar
        </Button>
      )}
    </View>
  );

  return (
    <View
      style={[
        modo === 'faixa' ? styles.faixa : styles.cartao,
        {
          backgroundColor: colors.primarySubtle,
          borderColor: colors.primary,
        },
        style,
      ]}>
      <View style={styles.textos}>
        <AppText variant={modo === 'faixa' ? 'label' : 'title'} accessibilityRole="header">
          {titulo}
        </AppText>
        <AppText variant="caption" tone="secondary">
          {texto}
        </AppText>
      </View>
      {botoes}
    </View>
  );
}

const styles = StyleSheet.create({
  cartao: {
    gap: Spacing[3],
    padding: Spacing[4],
    borderWidth: 1,
    borderRadius: Radius.lg,
  },
  faixa: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing[3],
    padding: Spacing[3],
    borderWidth: 1,
    borderRadius: Radius.lg,
  },
  textos: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 220,
    gap: 2,
  },
  botoes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
  },
});
