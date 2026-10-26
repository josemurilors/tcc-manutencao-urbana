/**
 * Tema claro/escuro.
 *
 * A preferência tem três valores: `sistema` (padrão), `claro` e `escuro`. Na
 * primeira versão o primeiro toque no toggle fixava o tema para sempre, sem
 * caminho de volta para "seguir o aparelho"; agora isso é uma opção explícita
 * em Preferências. A escolha fica no AsyncStorage.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';

import { Colors, type Palette, type ThemeName } from '@/constants/theme';
import { getStoredTheme, setStoredTheme, type StoredTheme } from '@/services/storage';

export type PreferenciaTema = 'sistema' | 'claro' | 'escuro';

type ThemeContextValue = {
  /** Tema efetivo, já resolvido contra o sistema. */
  theme: ThemeName;
  colors: Palette;
  preferencia: PreferenciaTema;
  setPreferencia: (preferencia: PreferenciaTema) => void;
  /** Alterna claro/escuro (fixa a escolha). Mantido por compatibilidade. */
  toggle: () => void;
  /** Fixa um tema. Mantido por compatibilidade; prefira `setPreferencia`. */
  setTheme: (theme: ThemeName) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const PARA_STORAGE: Record<PreferenciaTema, StoredTheme> = {
  sistema: 'system',
  claro: 'light',
  escuro: 'dark',
};

function daStorage(valor: StoredTheme | null): PreferenciaTema {
  if (valor === 'light') return 'claro';
  if (valor === 'dark') return 'escuro';
  return 'sistema';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [preferencia, setPreferenciaState] = useState<PreferenciaTema>('sistema');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    getStoredTheme()
      .then((stored) => setPreferenciaState(daStorage(stored)))
      // Storage ilegível: fica no padrão (sistema), que é o comportamento esperado.
      .catch(() => {})
      .finally(() => setHydrated(true));
  }, []);

  const theme: ThemeName =
    preferencia === 'claro'
      ? 'light'
      : preferencia === 'escuro'
        ? 'dark'
        : systemScheme === 'light'
          ? 'light'
          : 'dark';

  const setPreferencia = useCallback((next: PreferenciaTema) => {
    setPreferenciaState(next);
    // Falha ao gravar só faz a escolha não sobreviver ao próximo boot.
    setStoredTheme(PARA_STORAGE[next]).catch(() => {});
  }, []);

  const setTheme = useCallback(
    (next: ThemeName) => setPreferencia(next === 'light' ? 'claro' : 'escuro'),
    [setPreferencia],
  );

  const toggle = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  const value = useMemo(
    () => ({ theme, colors: Colors[theme], preferencia, setPreferencia, toggle, setTheme }),
    [theme, preferencia, setPreferencia, toggle, setTheme],
  );

  // Evita o flash de tema errado enquanto a preferência salva é lida.
  if (!hydrated) return null;

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme precisa estar dentro de <ThemeProvider>');
  return ctx;
}

/** Atalho para quem só precisa das cores. */
export function useColors() {
  return useTheme().colors;
}
