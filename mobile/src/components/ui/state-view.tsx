/**
 * Estados padrão de uma área de conteúdo: carregando, vazio, erro e sem rede.
 *
 * Existe para acabar com o `catch(() => {})` seguido de "Nenhum chamado" (que
 * mente quando o problema é a rede): toda tela que busca dados deve cair num
 * destes quatro, e erro sempre oferece "Tentar de novo" (contrato v3 §5).
 *
 * - `loading`: esqueletos (`skeleton`, padrão 3) ou spinner (`skeleton={0}`).
 * - `empty`: ícone + título + descrição + ação que leva ao próximo passo.
 * - `error`: mensagem + "Tentar de novo"; anunciado ao leitor de tela.
 * - `offline`: igual ao erro, com ícone e texto de conexão.
 */

import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';

import { Button } from './button';
import { SkeletonList } from './skeleton';
import { AppText } from './text';

type IconName = keyof typeof Ionicons.glyphMap;

export type StateKind = 'loading' | 'empty' | 'error' | 'offline';

type Props = {
  kind: StateKind;
  title?: string;
  description?: string;
  icon?: IconName;
  /** Próximo passo no vazio (ex.: "Reportar agora"). */
  action?: { label: string; onPress: () => void };
  /** Erro/offline: mostra "Tentar de novo". */
  onRetry?: () => void;
  retryLabel?: string;
  /** Quantos cards esqueleto no `loading`; `0` usa spinner. */
  skeleton?: number;
  style?: StyleProp<ViewStyle>;
};

const PADROES: Record<Exclude<StateKind, 'loading'>, { icon: IconName; title: string; description?: string }> = {
  empty: { icon: 'file-tray-outline', title: 'Nada por aqui ainda' },
  error: {
    icon: 'alert-circle-outline',
    title: 'Não foi possível carregar',
    description: 'Algo deu errado do nosso lado. Tente de novo em instantes.',
  },
  offline: {
    icon: 'cloud-offline-outline',
    title: 'Sem conexão',
    description: 'Confira sua internet e tente de novo. O que você já viu continua salvo.',
  },
};

export function StateView({
  kind,
  title,
  description,
  icon,
  action,
  onRetry,
  retryLabel = 'Tentar de novo',
  skeleton = 3,
  style,
}: Props) {
  const colors = useColors();

  if (kind === 'loading') {
    if (skeleton > 0) {
      return (
        <View style={style}>
          <SkeletonList count={skeleton} label={title ?? 'Carregando'} />
        </View>
      );
    }
    return (
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={title ?? 'Carregando'}
        accessibilityState={{ busy: true }}
        style={[styles.centro, style]}>
        <ActivityIndicator color={colors.primaryText} />
        <AppText variant="bodySm" tone="muted">
          {title ?? 'Carregando...'}
        </AppText>
      </View>
    );
  }

  const padrao = PADROES[kind];
  const ehFalha = kind === 'error' || kind === 'offline';
  const corIcone = kind === 'error' ? colors.danger : kind === 'offline' ? colors.warning : colors.primaryText;
  const fundoIcone =
    kind === 'error' ? colors.dangerSubtle : kind === 'offline' ? colors.warningSubtle : colors.primarySubtle;
  const textoDescricao = description ?? padrao.description;

  return (
    <View
      style={[styles.centro, style]}
      // Erro aparece depois de uma ação (abrir a tela, puxar para atualizar):
      // anunciar evita que quem usa leitor de tela fique esperando em silêncio.
      accessibilityLiveRegion={ehFalha ? 'polite' : 'none'}>
      <View
        style={[styles.ilustracao, { backgroundColor: fundoIcone }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        <Ionicons name={icon ?? padrao.icon} size={36} color={corIcone} />
      </View>
      <View style={styles.textos} accessible accessibilityRole={ehFalha ? 'alert' : 'text'}>
        <AppText variant="title" align="center">
          {title ?? padrao.title}
        </AppText>
        {textoDescricao ? (
          <AppText variant="bodySm" tone="secondary" align="center">
            {textoDescricao}
          </AppText>
        ) : null}
      </View>
      {ehFalha && onRetry ? (
        <Button
          variant="secondary"
          onPress={onRetry}
          icon={<Ionicons name="refresh" size={16} color={colors.textPrimary} />}>
          {retryLabel}
        </Button>
      ) : null}
      {action ? <Button onPress={action.onPress}>{action.label}</Button> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  centro: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[3],
    paddingVertical: Spacing[10],
    paddingHorizontal: Spacing[6],
  },
  ilustracao: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing[1],
  },
  textos: {
    gap: Spacing[1],
    alignItems: 'center',
    maxWidth: 360,
  },
});
