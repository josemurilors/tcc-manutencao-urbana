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

import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavigationThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppErrorBoundary, RouteErrorBoundary } from '@/components/error-boundary';
import { SyncIndicatorGlobal } from '@/components/sync-indicator';
import { AuthProvider, useAuth } from '@/context/auth-context';
import { OfflineSyncProvider } from '@/context/offline-sync-context';
import { ThemeProvider, useTheme } from '@/context/theme-context';
import { ToastProvider } from '@/context/toast-context';

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
    </NavigationThemeProvider>
  );
}
