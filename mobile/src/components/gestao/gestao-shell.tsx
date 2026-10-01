/**
 * Casca das telas de administração: cabeçalho com voltar, título e ação à
 * direita, mais a guarda de papel.
 *
 * Diferente do `SubScreen`, não embrulha tudo num ScrollView — as telas de
 * gestão são listas longas (FlatList) e lista dentro de ScrollView perde a
 * virtualização. Formulários passam `scroll`.
 *
 * Para o super_admin, mostra o seletor de município logo abaixo do título
 * (a escolha vale para toda a gestão; ver `municipio-gestao.ts`).
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
import { useAuth } from '@/context/auth-context';
import { useColors } from '@/context/theme-context';
import type { Papel } from '@/types/gestao';

import { useMunicipioGestao } from './municipio-gestao';
import { NIVEL, ROTULO_PAPEL, usePapel } from './papeis';
import { SeletorMunicipio } from './seletor-municipio';

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
  /**
   * A tela usa uma rota que só conhece o município do próprio usuário (ex.:
   * respostas-padrão, da operação): o super_admin não vê o seletor.
   */
  semSeletorMunicipio?: boolean;
  children: React.ReactNode;
};

export function GestaoShell({
  title,
  subtitle,
  minimo,
  acao,
  scroll,
  semSeletorMunicipio,
  children,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { papel, nivel } = usePapel();
  const { user } = useAuth();
  const escolhido = useMunicipioGestao();

  function voltar() {
    if (router.canGoBack()) router.back();
    else router.replace('/admin' as Href);
  }

  const permitido = nivel >= NIVEL[minimo];
  const comSeletor = permitido && papel === 'super_admin' && !semSeletorMunicipio;
  // Super admin sem município próprio e sem escolha: o backend não sabe de
  // qual prefeitura falar (400), então pede a escolha antes.
  const semMunicipio = comSeletor && !escolhido && !user?.municipio_id;

  const conteudo = !permitido ? (
    <StateView
      kind="empty"
      icon="lock-closed-outline"
      title="Área restrita"
      description={`Esta área é para quem tem o papel ${ROTULO_PAPEL[minimo]} ou superior na prefeitura. Se você precisa de acesso, fale com o administrador do município.`}
      action={{ label: 'Voltar', onPress: voltar }}
    />
  ) : semMunicipio ? (
    <StateView
      kind="empty"
      icon="business-outline"
      title="Escolha um município"
      description="Como equipe da plataforma, você gerencia qualquer prefeitura. Escolha acima qual quer ver."
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
      {comSeletor ? <SeletorMunicipio padrao={user?.municipio_id ?? null} /> : null}
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
