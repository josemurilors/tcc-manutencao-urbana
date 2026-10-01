/**
 * Selo (pílula) de estado. Sempre leva texto e ícone: a cor reforça, mas nunca
 * é a única pista (WCAG 1.4.1) — daltônico ou tela ao sol ainda distinguem
 * "Resolvido" de "Rejeitado" pelo ícone e pelo rótulo.
 */

import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { corDoTom, Radius, Spacing, type CorDeTom, type Tom } from '@/constants/theme';
import { useColors } from '@/context/theme-context';

import { AppText } from './text';

type IconName = keyof typeof Ionicons.glyphMap;

const ICONE_DO_TOM: Record<Tom, IconName> = {
  neutral: 'ellipse',
  primary: 'star',
  success: 'checkmark-circle',
  warning: 'warning',
  danger: 'alert-circle',
  info: 'information-circle',
};

type Props = {
  label: string;
  tone?: Tom;
  /** Cor pronta (ex.: `corDoStatus(colors, status)`); vence o `tone`. */
  color?: CorDeTom;
  /** Ícone; o padrão é o do tom. `null` remove (só quando o texto basta). */
  icon?: IconName | null;
  /** `subtle` (fundo claro, padrão), `solid` (cheio) ou `outline`. */
  variant?: 'subtle' | 'solid' | 'outline';
  size?: 'sm' | 'md';
  /** Só o ícone, com o rótulo indo para o leitor de tela. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Badge({
  label,
  tone = 'neutral',
  color,
  icon,
  variant = 'subtle',
  size = 'sm',
  compact,
  style,
}: Props) {
  const colors = useColors();
  const cor = color ?? corDoTom(colors, tone);
  const nomeIcone = icon === undefined ? ICONE_DO_TOM[tone] : icon;
  const tamanhoIcone = size === 'sm' ? 14 : 16;

  // `solid` inverte: fundo na cor cheia e texto no "on" do fundo da tela.
  const fg = variant === 'solid' ? colors.bg : cor.fg;
  const bg = variant === 'solid' ? cor.fg : variant === 'outline' ? 'transparent' : cor.bg;

  if (compact) {
    return (
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={label}
        style={[styles.compacto, { backgroundColor: cor.bg, borderColor: cor.border }, style]}>
        <Ionicons name={nomeIcone ?? ICONE_DO_TOM[tone]} size={14} color={cor.fg} />
      </View>
    );
  }

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[
        styles.badge,
        size === 'md' && styles.md,
        { backgroundColor: bg, borderColor: variant === 'subtle' ? cor.border : cor.fg },
        style,
      ]}>
      {nomeIcone ? <Ionicons name={nomeIcone} size={tamanhoIcone} color={fg} /> : null}
      <AppText
        variant={size === 'sm' ? 'caption' : 'bodySm'}
        weight="600"
        inControl
        numberOfLines={1}
        style={{ color: fg }}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing[1],
    minHeight: 24,
    paddingHorizontal: Spacing[2],
    paddingVertical: Spacing[0.5],
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  md: {
    minHeight: 32,
    paddingHorizontal: Spacing[3],
    gap: Spacing[1.5],
  },
  compacto: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Radius.full,
  },
});
