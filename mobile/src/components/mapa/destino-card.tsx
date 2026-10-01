/**
 * Cartão do endereço buscado, acima do botão de recentralizar: diz onde o
 * mapa está e oferece "Reportar aqui" — sem ele, quem buscou "Rua X" para
 * registrar algo que viu mais cedo teria de achar o toque longo sozinho.
 */

import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { AppText } from '@/components/ui/text';
import { Elevation, Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import type { ResultadoEndereco } from '@/types/mapa';

type Props = {
  destino: ResultadoEndereco;
  logado: boolean;
  onReportar: () => void;
  onFechar: () => void;
};

export function DestinoCard({ destino, logado, onReportar, onFechar }: Props) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.cartao,
        Elevation.lg,
        { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
      ]}>
      <View style={styles.linha}>
        <Ionicons name="location" size={20} color={colors.primaryText} />
        <View style={styles.textos}>
          <AppText variant="label" numberOfLines={1}>
            {destino.titulo}
          </AppText>
          <AppText variant="caption" tone="muted" numberOfLines={1}>
            {destino.detalhe}
          </AppText>
        </View>
        <IconButton icon="close" accessibilityLabel="Fechar endereço buscado" onPress={onFechar} />
      </View>
      <Button
        size="sm"
        onPress={onReportar}
        block
        icon={<Ionicons name="megaphone" size={16} color={colors.onPrimary} />}
        accessibilityHint="Abre um chamado neste endereço">
        {logado ? 'Reportar aqui' : 'Entrar para reportar aqui'}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  cartao: {
    gap: Spacing[2],
    padding: Spacing[3],
    paddingTop: Spacing[1],
    borderWidth: 1,
    borderRadius: Radius.lg,
  },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
  textos: {
    flex: 1,
  },
});
