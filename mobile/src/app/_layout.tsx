/**
 * Layout raiz: providers + pilha de navegação.
 *
 * Equivale ao `App.jsx` do web (ErrorBoundary + ThemeProvider + AuthProvider +
 * ToastProvider + BrowserRouter), com o roteador substituído pelo Expo Router.
 *
 * Erros de render têm dois níveis: `AppErrorBoundary` em volta dos providers
 * (último recurso) e o `ErrorBoundary` exportado abaixo, que o Expo Router
 * aplica por rota. A fila offline sincroniza daqui, para o app todo.
 */

import {
  DarkTheme,
  DefaultTheme,
  Stack,
  ThemeProvider as NavigationThemeProvider,
  usePathname,
} from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AceiteTermos } from '@/components/auth-flow';
import { AppErrorBoundary, RouteErrorBoundary } from '@/components/error-boundary';
import { SyncIndicatorGlobal } from '@/components/sync-indicator';
import { Button } from '@/components/ui/button';
import { AppText } from '@/components/ui/text';
import { Layout, Radius, Spacing } from '@/constants/theme';
import { AuthProvider, precisaAceitarTermos, useAuth } from '@/context/auth-context';
import { OfflineSyncProvider } from '@/context/offline-sync-context';
import { ThemeProvider, useTheme } from '@/context/theme-context';
import { ToastProvider, useToast } from '@/context/toast-context';
import { contaApi } from '@/services/api-conta';
import { mensagemDeErro } from '@/utils/erro';

export { RouteErrorBoundary as ErrorBoundary };

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppErrorBoundary>
          <ThemeProvider>
            <AuthProvider>
              <ToastProvider>
                <OfflineSyncProvider>
                  <RootNavigator />
                </OfflineSyncProvider>
              </ToastProvider>
            </AuthProvider>
          </ThemeProvider>
        </AppErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator() {
  const { theme, colors } = useTheme();
  const { loading } = useAuth();

  // Só solta a splash quando a sessão já foi lida do SecureStore, para não
  // piscar a tela de login antes de restaurar o usuário.
  useEffect(() => {
    if (!loading) SplashScreen.hideAsync();
  }, [loading]);

  if (loading) return null;

  const navTheme = theme === 'dark' ? DarkTheme : DefaultTheme;

  return (
    <NavigationThemeProvider
      value={{
        ...navTheme,
        colors: {
          ...navTheme.colors,
          background: colors.bgPrimary,
          card: colors.bgElevated,
          text: colors.textPrimary,
          border: colors.borderDefault,
          primary: colors.primaryText,
        },
      }}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bgPrimary },
        }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="boas-vindas" />
        <Stack.Screen name="login" />
        <Stack.Screen name="registro" />
        <Stack.Screen name="escolher-nome" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="novo"
          options={{ presentation: 'modal', headerShown: true, title: 'Novo Chamado' }}
        />
        <Stack.Screen
          name="admin/usuarios"
          options={{ headerShown: true, title: 'Gerenciar Usuários' }}
        />
        {/* Catálogo do design system: a tela se recusa a abrir fora do __DEV__. */}
        <Stack.Screen name="dev/catalogo" options={{ headerShown: false }} />
      </Stack>
      <SyncIndicatorGlobal />
      <PortaoTermos />
    </NavigationThemeProvider>
  );
}

/**
 * Rotas em que o portão não cobre a tela: os próprios textos (para ler antes
 * de aceitar) e o passo do Google, que já pede o aceite junto com o nome.
 */
const ROTAS_LIVRES_DO_PORTAO = ['/termos', '/privacidade', '/escolher-nome'];

/**
 * Aceite dos Termos e da Política para quem já está com a sessão aberta e
 * ainda não aceitou (LGPD): sessões de antes desta versão (o perfil é
 * reconferido a cada boot) e o login com Google de conta existente, que não
 * passa pelo fluxo de e-mail. Cobre o app até aceitar ou sair.
 */
function PortaoTermos() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const pathname = usePathname();
  const { user, isAuthenticated, updateUser, logout } = useAuth();
  const [aceito, setAceito] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');

  if (!isAuthenticated || !precisaAceitarTermos(user)) return null;
  if (ROTAS_LIVRES_DO_PORTAO.includes(pathname)) return null;

  async function aceitar() {
    setErro('');
    if (!aceito) {
      setErro('Marque a caixa para continuar.');
      return;
    }
    setEnviando(true);
    try {
      await updateUser(await contaApi.aceitarTermos());
      toast.success('Obrigado! Tudo certo para continuar.');
    } catch (err) {
      setErro(mensagemDeErro(err, 'Não foi possível registrar o aceite. Tente de novo.'));
    } finally {
      setEnviando(false);
    }
  }

  async function sair() {
    await logout();
    toast.info('Sessão encerrada. Sem o aceite dos termos não dá para usar a conta.');
  }

  return (
    <View
      style={[StyleSheet.absoluteFill, styles.portao, { backgroundColor: colors.bgPrimary }]}
      accessibilityViewIsModal>
      <ScrollView
        contentContainerStyle={[
          styles.portaoConteudo,
          { paddingTop: insets.top + Spacing[8], paddingBottom: insets.bottom + Spacing[8] },
        ]}>
        <View
          style={[
            styles.portaoCartao,
            { backgroundColor: colors.bgSurface, borderColor: colors.borderDefault },
          ]}>
          <AppText variant="title" accessibilityRole="header">
            Antes de continuar
          </AppText>
          <AppText variant="bodySm" tone="secondary">
            Atualizamos os Termos de Uso e a Política de Privacidade. Eles explicam, em linguagem
            simples, o que fica público, o que a prefeitura vê e como baixar ou apagar seus dados.
          </AppText>
          <AceiteTermos aceito={aceito} onChange={setAceito} invalido={!!erro && !aceito} />
          {erro ? (
            <AppText variant="caption" tone="danger" accessibilityRole="alert">
              {erro}
            </AppText>
          ) : null}
          <Button block onPress={aceitar} loading={enviando}>
            Aceitar e continuar
          </Button>
          <Button block variant="ghost" onPress={sair} disabled={enviando}>
            Sair da conta
          </Button>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  portao: {
    zIndex: 1000,
    elevation: 1000,
  },
  portaoConteudo: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Layout.gutter,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  portaoCartao: {
    gap: Spacing[3],
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing[6],
  },
});
