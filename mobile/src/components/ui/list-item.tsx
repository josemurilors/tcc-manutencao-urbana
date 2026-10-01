/**
 * Linha de lista: elemento à esquerda (ícone ou miniatura), título, subtítulo,
 * metadado e algo à direita. Base para listas de chamados, notificações e
 * menus — o `MenuRow` antigo cobre só o caso de ajustes.
 *
 * Tocável inteira (alvo mínimo de 56 px de altura), com o leitor de tela
 * lendo título, subtítulo e metadado numa frase só.
 */

import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';

import { AppText } from './text';

type IconName = keyof typeof Ionicons.glyphMap;

type Props = {
  title: string;
  subtitle?: string;
  /** Linha pequena extra (data, distância, protocolo). */
  meta?: string;
  /** Nome de ícone (vira um quadrado com o ícone) ou um nó pronto (miniatura). */
  leading?: IconName | React.ReactNode;
  /** Nó à direita. Sem ele, linhas tocáveis mostram um chevron. */
  trailing?: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Ação destrutiva ("Sair", "Excluir conta"): título e ícone em `danger`. */
  destructive?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
};

export function ListItem({
  title,
  subtitle,
  meta,
  leading,
  trailing,
  onPress,
  onLongPress,
  destructive,
  disabled,
  accessibilityLabel,
  accessibilityHint,
  style,
}: Props) {
  const colors = useColors();
  const corIcone = destructive ? colors.danger : colors.textSecondary;
  const tocavel = !!(onPress || onLongPress);

  const esquerda =
    typeof leading === 'string' ? (
      <View style={[styles.icone, { backgroundColor: destructive ? colors.dangerSubtle : colors.bgSubtle }]}>
        <Ionicons name={leading as IconName} size={20} color={corIcone} />
      </View>
    ) : (
      leading
    );

  const conteudo = (
    <>
      {esquerda}
      <View style={styles.textos}>
        <AppText variant="body" tone={destructive ? 'danger' : 'primary'} numberOfLines={2}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="bodySm" tone="secondary" numberOfLines={2}>
            {subtitle}
          </AppText>
        ) : null}
        {meta ? (
          <AppText variant="caption" tone="muted" numberOfLines={1}>
            {meta}
          </AppText>
        ) : null}
      </View>
      {trailing ??
        (tocavel ? <Ionicons name="chevron-forward" size={18} color={colors.textMuted} /> : null)}
    </>
  );

  const rotulo = accessibilityLabel ?? [title, subtitle, meta].filter(Boolean).join(', ');

  if (!tocavel) {
    return (
      <View accessible accessibilityLabel={rotulo} style={[styles.linha, style]}>
        {conteudo}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={rotulo}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.linha,
        pressed && { backgroundColor: colors.surfacePressed },
        disabled && { opacity: 0.5 },
        style,
      ]}>
      {conteudo}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    minHeight: 56,
    paddingVertical: Spacing[2],
    paddingHorizontal: Spacing[1],
    borderRadius: Radius.md,
  },
  icone: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textos: {
    flex: 1,
    gap: Spacing[0.5],
  },
});
