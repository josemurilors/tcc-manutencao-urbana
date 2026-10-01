/**
 * Rede de segurança para exceções de render: em vez de tela branca, uma tela
 * amigável com "Tentar de novo" e "Recarregar o app".
 *
 * Dois níveis:
 * - `AppErrorBoundary` envolve os providers no layout raiz. Pode rodar fora
 *   do ThemeProvider (o erro pode ter vindo dele), então lê o tema do sistema
 *   e as cores direto da paleta, sem `useColors`.
 * - `RouteErrorBoundary` é o `ErrorBoundary` que o Expo Router usa por rota
 *   (exportado em `app/_layout.tsx`): um erro numa tela não derruba o resto.
 *
 * Telemetria (Sentry) ainda não existe; por ora o erro vai para o console.
 */

import { Ionicons } from '@expo/vector-icons';
import { reloadAppAsync } from 'expo';
import type { ErrorBoundaryProps } from 'expo-router';
import { Component, type ErrorInfo } from 'react';
import { Platform, Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';

import { Colors, Layout, Radius, Spacing, Typography } from '@/constants/theme';

async function recarregarApp() {
  try {
    if (Platform.OS === 'web') {
      window.location.reload();
      return;
    }
    await reloadAppAsync('Recarregado após erro');
  } catch {
    // Sem reload disponível (ex.: Expo Go antigo): o "Tentar de novo" ainda resolve a maioria.
  }
}

export function ErrorFallback({ error, onRetry }: { error?: Error; onRetry: () => void }) {
  const esquema = useColorScheme();
  const colors = Colors[esquema === 'light' ? 'light' : 'dark'];

  return (
    <View style={[styles.tela, { backgroundColor: colors.bg }]} accessibilityLiveRegion="assertive">
      <View style={[styles.icone, { backgroundColor: colors.dangerSubtle }]}>
        <Ionicons name="bug-outline" size={36} color={colors.danger} />
      </View>
      <Text accessibilityRole="header" style={[Typography.headline, styles.centro, { color: colors.textPrimary }]}>
        Algo deu errado
      </Text>
      <Text style={[Typography.body, styles.centro, { color: colors.textSecondary }]}>
        Esta tela encontrou um problema inesperado. Tente de novo; se continuar, recarregue o app.
        Chamados salvos no aparelho não se perdem.
      </Text>
      {__DEV__ && error ? (
        <Text selectable style={[Typography.caption, styles.detalhe, { color: colors.textMuted, borderColor: colors.border }]}>
          {error.message}
        </Text>
      ) : null}
      <View style={styles.acoes}>
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.botao,
            { backgroundColor: pressed ? colors.primaryPressed : colors.primary },
          ]}>
          <Text style={[Typography.label, { color: colors.onPrimary }]}>Tentar de novo</Text>
        </Pressable>
        <Pressable
          onPress={recarregarApp}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.botao,
            { borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: pressed ? colors.surfacePressed : 'transparent' },
          ]}>
          <Text style={[Typography.label, { color: colors.textPrimary }]}>Recarregar o app</Text>
        </Pressable>
      </View>
    </View>
  );
}

type State = { error: Error | null };

export class AppErrorBoundary extends Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) return <ErrorFallback error={this.state.error} onRetry={this.reset} />;
    return this.props.children;
  }
}

/** Formato que o Expo Router espera do `export { ErrorBoundary }` de uma rota. */
export function RouteErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return <ErrorFallback error={error} onRetry={() => void retry()} />;
}

const styles = StyleSheet.create({
  tela: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[3],
    padding: Spacing[6],
  },
  icone: {
    width: 72,
    height: 72,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing[2],
  },
  centro: {
    textAlign: 'center',
    maxWidth: 420,
  },
  detalhe: {
    maxWidth: 420,
    padding: Spacing[3],
    borderWidth: 1,
    borderRadius: Radius.md,
  },
  acoes: {
    width: '100%',
    maxWidth: 320,
    gap: Spacing[2],
    marginTop: Spacing[3],
  },
  botao: {
    minHeight: Layout.minTouch + 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    paddingHorizontal: Spacing[4],
  },
});
