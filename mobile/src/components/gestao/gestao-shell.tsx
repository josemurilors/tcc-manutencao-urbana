/**
 * Casca das telas de administração: cabeçalho com voltar, título e ação à
 * direita, mais a guarda de papel.
 *
 * Diferente do `SubScreen`, não embrulha tudo num ScrollView — as telas de
 * gestão são listas longas (FlatList) e lista dentro de ScrollView perde a
 * virtualização. Formulários passam `scroll`.
 */

import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/ui/icon-button';
import { StateView } from '@/components/ui/state-view';
import { AppText } from '@/components/ui/text';
import { Layout, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import type { Papel } from '@/types/gestao';

import { NIVEL, ROTULO_PAPEL, usePapel } from './papeis';

type Props = {
  title: string;
  subtitle?: string;
  /** Papel mínimo para ver a tela; abaixo dele, aviso de área restrita. */
  minimo: Papel;
  /** Botão à direita do título (ex.: "Convidar"). */
  acao?: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    onPress: () => void;
  };
  /** Conteúdo rola junto (formulários). Listas usam a própria FlatList. */
  scroll?: boolean;
  children: React.ReactNode;
};

export function GestaoShell({ title, subtitle, minimo, acao, scroll, children }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { nivel } = usePapel();

  function voltar() {
    if (router.canGoBack()) router.back();
    else router.replace('/admin' as Href);
  }

  const permitido = nivel >= NIVEL[minimo];

  const conteudo = !permitido ? (
    <StateView
      kind="empty"
      icon="lock-closed-outline"
      title="Área restrita"
      description={`Esta área é para quem tem o papel ${ROTULO_PAPEL[minimo]} ou superior na prefeitura. Se você precisa de acesso, fale com o administrador do município.`}
      action={{ label: 'Voltar', onPress: voltar }}
    />
  ) : scroll ? (
    <ScrollView
      contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + Spacing[16] }]}
      keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    children
  );

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.cabecalho, { paddingTop: insets.top + Spacing[2] }]}>
        <IconButton icon="arrow-back" accessibilityLabel="Voltar" onPress={voltar} />
        <View style={styles.titulos}>
          <AppText variant="title" accessibilityRole="header" numberOfLines={1}>
            {title}
          </AppText>
          {subtitle ? (
            <AppText variant="caption" tone="muted" numberOfLines={1}>
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {acao && permitido ? (
          <IconButton
            icon={acao.icon}
            accessibilityLabel={acao.label}
            onPress={acao.onPress}
            variant="primary"
          />
        ) : null}
      </View>
      {conteudo}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  cabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    paddingHorizontal: Spacing[2],
    paddingBottom: Spacing[2],
    minHeight: Layout.minTouch,
  },
  titulos: {
    flex: 1,
    gap: Spacing[0.5],
  },
  scroll: {
    paddingHorizontal: Layout.gutter,
    gap: Spacing[4],
  },
});
