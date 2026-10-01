/**
 * Armazenamento local.
 *
 * Tokens ficam no SecureStore (keystore/keychain); dados não sensíveis
 * (perfil, preferências, fila offline) no AsyncStorage. Como o `api` precisa
 * ler o token de forma síncrona a cada requisição, mantemos um cache em
 * memória hidratado uma vez no boot por `hydrateSession()`.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { User } from '@/types';

const TOKEN_KEY = 'ciu_token';
const REFRESH_KEY = 'ciu_refresh';
const USER_KEY = 'ciu_user_data';
const THEME_KEY = 'ciu_theme';
const ONBOARDING_KEY = 'ciu_onboarding_visto';

/** SecureStore não existe no web; lá caímos para o AsyncStorage. */
const secure = {
  async get(key: string) {
    if (Platform.OS === 'web') return AsyncStorage.getItem(key);
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string) {
    if (Platform.OS === 'web') return AsyncStorage.setItem(key, value);
    return SecureStore.setItemAsync(key, value);
  },
  async remove(key: string) {
    if (Platform.OS === 'web') return AsyncStorage.removeItem(key);
    return SecureStore.deleteItemAsync(key);
  },
};

type SessionCache = {
  token: string | null;
  refresh: string | null;
};

const cache: SessionCache = { token: null, refresh: null };

/** Lê o token sem await — usado no interceptor do `api`. */
export function getTokenSync() {
  return cache.token;
}

export function getRefreshSync() {
  return cache.refresh;
}

export async function hydrateSession() {
  const [token, refresh] = await Promise.all([secure.get(TOKEN_KEY), secure.get(REFRESH_KEY)]);
  cache.token = token;
  cache.refresh = refresh;
  return { token, refresh };
}

export async function setToken(token: string | null) {
  cache.token = token;
  if (token) await secure.set(TOKEN_KEY, token);
  else await secure.remove(TOKEN_KEY);
}

export async function setRefresh(refresh: string | null) {
  cache.refresh = refresh;
  if (refresh) await secure.set(REFRESH_KEY, refresh);
  else await secure.remove(REFRESH_KEY);
}

export async function getStoredUser(): Promise<Partial<User> | null> {
  const raw = await AsyncStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Partial<User>;
  } catch {
    return null;
  }
}

export async function setStoredUser(user: Partial<User> | null) {
  if (!user) return AsyncStorage.removeItem(USER_KEY);
  return AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
}

export async function mergeStoredUser(updates: Partial<User>) {
  const current = (await getStoredUser()) ?? {};
  const next = { ...current, ...updates };
  await setStoredUser(next);
  return next;
}

export async function clearSession() {
  cache.token = null;
  cache.refresh = null;
  await Promise.all([
    secure.remove(TOKEN_KEY),
    secure.remove(REFRESH_KEY),
    AsyncStorage.removeItem(USER_KEY),
  ]);
}

/** Preferência de tema; `system` (ou nada salvo) segue o aparelho. */
export type StoredTheme = 'light' | 'dark' | 'system';

export async function getStoredTheme(): Promise<StoredTheme | null> {
  const value = await AsyncStorage.getItem(THEME_KEY);
  return value === 'light' || value === 'dark' || value === 'system' ? value : null;
}

export async function setStoredTheme(theme: StoredTheme) {
  await AsyncStorage.setItem(THEME_KEY, theme);
}

/** Guia de boas-vindas: mostrado só na primeira entrada. */
export async function getOnboardingVisto(): Promise<boolean> {
  return (await AsyncStorage.getItem(ONBOARDING_KEY)) === '1';
}

export async function setOnboardingVisto() {
  await AsyncStorage.setItem(ONBOARDING_KEY, '1');
}
