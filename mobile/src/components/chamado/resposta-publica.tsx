/**
 * Resposta pública da prefeitura em destaque, logo abaixo do andamento. No
 * histórico ela também aparece, mas perdida entre eventos; aqui é a primeira
 * coisa que o cidadão lê depois do status.
 */

import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/text';
import { Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';

export function RespostaPublica({ texto, orgao }: { texto?: string | null; orgao?: string | null }) {
  const colors = useColors();
  if (!texto?.trim()) return null;
  return (
    <View
      style={[styles.caixa, { backgroundColor: colors.primarySubtle, borderColor: colors.primary }]}
      accessible
      accessibilityLabel={`Resposta da prefeitura: ${texto}`}>
      <View style={styles.cabecalho}>
        <Ionicons name="chatbubble-ellipses" size={18} color={colors.primaryText} />
        <AppText variant="label" tone="brand">
          Resposta da prefeitura
        </AppText>
      </View>
      <AppText variant="body">{texto}</AppText>
      {orgao ? (
        <AppText variant="caption" tone="secondary">
          {orgao}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  caixa: {
    borderWidth: 1,
    borderLeftWidth: 4,
    borderRadius: Radius.md,
    padding: Spacing[3],
    gap: Spacing[2],
  },
  cabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
});
