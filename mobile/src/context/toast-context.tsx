/**
 * Toasts v2 — nasceu do porte de `frontend/src/components/Toast.jsx`.
 *
 * API retrocompatível: `const addToast = useToast(); addToast('Salvo')` continua
 * valendo. Além disso o mesmo objeto expõe `show({...})` com ação opcional
 * ("Desfazer", "Ver fila") e atalhos `success/error/warning/info`.
 *
 * Regras:
 * - Duração por severidade (erro fica mais, para dar tempo de ler); com ação,
 *   no mínimo 6 s. Tocar e segurar pausa o tempo.
 * - Mensagem idêntica já visível não duplica: renova o tempo da existente.
 * - Fica no rodapé, acima do FAB, para não cobrir o avatar e o ranking do mapa;
 *   telas com outra coisa no rodapé ajustam com `useToastOffset`.
 * - Cada toast é anunciado ao leitor de tela (no Android, `accessibilityRole=
 *   'alert'` sozinho não é lido).
 */

import { Ionicons } from '@expo/vector-icons';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/ui/icon-button';
import { AppText } from '@/components/ui/text';
import { corDoTom, Duration, Elevation, Radius, Spacing, type Tom } from '@/constants/theme';
import { useColors } from '@/context/theme-context';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export type ToastAction = { label: string; onPress: () => void };

export type ToastOptions = {
  message: string;
  type?: ToastType;
  action?: ToastAction;
  /** Em ms. O padrão depende do tipo (ver `DURACAO_MS`). */
  duration?: number;
};

type Toast = Required<Pick<ToastOptions, 'message' | 'type'>> &
  Pick<ToastOptions, 'action'> & {
    id: number;
    duration: number;
    /** Muda quando uma mensagem repetida renova o tempo deste toast. */
    renovacao: number;
  };

/**
 * O que `useToast()` devolve: a função antiga `(message, type)` com os
 * métodos novos pendurados nela.
 */
export type ToastApi = ((message: string, type?: ToastType) => number) & {
  show: (options: ToastOptions) => number;
  success: (message: string, options?: Omit<ToastOptions, 'message' | 'type'>) => number;
  error: (message: string, options?: Omit<ToastOptions, 'message' | 'type'>) => number;
  warning: (message: string, options?: Omit<ToastOptions, 'message' | 'type'>) => number;
  info: (message: string, options?: Omit<ToastOptions, 'message' | 'type'>) => number;
  dismiss: (id: number) => void;
};

type ContextValue = { api: ToastApi; setOffset: (offset: number | null) => void };

const ToastContext = createContext<ContextValue | null>(null);

const DURACAO_MS: Record<ToastType, number> = {
  success: 3000,
  info: 3000,
  warning: 5000,
  error: 6000,
};
const DURACAO_COM_ACAO_MS = 6000;
const MAX_VISIVEIS = 3;
/** Distância do rodapé por padrão: livra o FAB "Reportar" e a barra de abas. */
const OFFSET_PADRAO = 88;

const TOM: Record<ToastType, Tom> = {
  success: 'success',
  error: 'danger',
  warning: 'warning',
  info: 'info',
};

const ICONE: Record<ToastType, keyof typeof Ionicons.glyphMap> = {
  success: 'checkmark-circle',
  error: 'alert-circle',
  warning: 'warning',
  info: 'information-circle',
};

/** Prefixo falado: o ícone e a cor não chegam a quem usa leitor de tela. */
const PREFIXO_FALADO: Record<ToastType, string> = {
  success: '',
  info: '',
  warning: 'Atenção: ',
  error: 'Erro: ',
};

function anunciar(toast: Pick<Toast, 'message' | 'type' | 'action'>) {
  const texto =
    PREFIXO_FALADO[toast.type] +
    toast.message +
    (toast.action ? `. Ação disponível: ${toast.action.label}.` : '');
  try {
    AccessibilityInfo.announceForAccessibility(texto);
  } catch {
    // Plataforma sem anúncio (web antigo): a live region do toast cobre.
  }
}

/**
 * Lista de toasts fora do React (assinada via `useSyncExternalStore`). Assim a
 * deduplicação lê o estado atual na hora do `show`, sem esperar render, e a API
 * devolvida por `useToast` é estável para sempre.
 */
function criarLoja() {
  let toasts: Toast[] = [];
  let proximoId = 0;
  const ouvintes = new Set<() => void>();

  const publicar = (next: Toast[]) => {
    toasts = next;
    ouvintes.forEach((o) => o());
  };

  const dismiss = (id: number) => publicar(toasts.filter((t) => t.id !== id));

  const show = ({ message, type = 'success', action, duration }: ToastOptions) => {
    const repetido = toasts.find((t) => t.message === message && t.type === type);
    if (repetido) {
      publicar(toasts.map((t) => (t.id === repetido.id ? { ...t, renovacao: t.renovacao + 1 } : t)));
      return repetido.id;
    }
    const id = proximoId++;
    const padrao = action ? Math.max(DURACAO_MS[type], DURACAO_COM_ACAO_MS) : DURACAO_MS[type];
    const toast: Toast = { id, message, type, action, duration: duration ?? padrao, renovacao: 0 };
    publicar([...toasts, toast].slice(-MAX_VISIVEIS));
    anunciar(toast);
    return id;
  };

  const atalho =
    (type: ToastType) =>
    (message: string, options?: Omit<ToastOptions, 'message' | 'type'>) =>
      show({ ...options, message, type });

  const api: ToastApi = Object.assign(
    (message: string, type?: ToastType) => show({ message, type }),
    {
      show,
      success: atalho('success'),
      error: atalho('error'),
      warning: atalho('warning'),
      info: atalho('info'),
      dismiss,
    },
  );

  return {
    api,
    subscribe: (ouvinte: () => void) => {
      ouvintes.add(ouvinte);
      return () => {
        ouvintes.delete(ouvinte);
      };
    },
    get: () => toasts,
  };
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [loja] = useState(criarLoja);
  const toasts = useSyncExternalStore(loja.subscribe, loja.get, loja.get);
  const [offset, setOffset] = useState<number | null>(null);

  const value = useMemo(() => ({ api: loja.api, setOffset }), [loja]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} offset={offset ?? OFFSET_PADRAO} onDismiss={loja.api.dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({
  toasts,
  offset,
  onDismiss,
}: {
  toasts: Toast[];
  offset: number;
  onDismiss: (id: number) => void;
}) {
  const insets = useSafeAreaInsets();
  if (toasts.length === 0) return null;

  return (
    <View pointerEvents="box-none" style={[styles.viewport, { bottom: insets.bottom + offset }]}>
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </View>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const colors = useColors();
  const tom = corDoTom(colors, TOM[toast.type]);
  // useState (e não useRef) porque o valor é lido durante o render, dentro do
  // style — refs não podem ser acessadas nessa fase.
  const [entrada] = useState(() => new Animated.Value(0));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restante = useRef(toast.duration);
  const inicio = useRef(0);
  const saindo = useRef(false);

  const sair = useCallback(() => {
    if (saindo.current) return;
    saindo.current = true;
    if (timer.current) clearTimeout(timer.current);
    Animated.timing(entrada, { toValue: 0, duration: Duration.normal, useNativeDriver: true }).start(
      () => onDismiss(toast.id),
    );
  }, [entrada, onDismiss, toast.id]);

  const iniciarTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    inicio.current = Date.now();
    timer.current = setTimeout(sair, restante.current);
  }, [sair]);

  const pausar = useCallback(() => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    restante.current = Math.max(1000, restante.current - (Date.now() - inicio.current));
  }, []);

  useEffect(() => {
    Animated.timing(entrada, { toValue: 1, duration: Duration.normal, useNativeDriver: true }).start();
  }, [entrada]);

  // Recomeça a contagem ao montar e a cada renovação (mensagem repetida).
  useEffect(() => {
    restante.current = toast.duration;
    iniciarTimer();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [toast.duration, toast.renovacao, iniciarTimer]);

  return (
    <Animated.View
      style={{
        opacity: entrada,
        transform: [
          { translateY: entrada.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
        ],
      }}>
      <Pressable
        onPressIn={pausar}
        onPressOut={iniciarTimer}
        // Não agrupa: a ação e o "Fechar" precisam ser focáveis por si. A
        // leitura da mensagem vem do anúncio e da live region.
        accessible={false}
        accessibilityRole="alert"
        accessibilityLiveRegion={toast.type === 'error' ? 'assertive' : 'polite'}
        style={[
          styles.toast,
          Elevation.md,
          {
            backgroundColor: colors.surfaceRaised,
            borderColor: colors.border,
            borderLeftColor: tom.fg,
          },
        ]}>
        <Ionicons name={ICONE[toast.type]} size={20} color={tom.fg} style={styles.icone} />
        <AppText variant="bodySm" weight="500" style={styles.mensagem}>
          {toast.message}
        </AppText>
        {toast.action ? (
          <Pressable
            onPress={() => {
              toast.action?.onPress();
              sair();
            }}
            accessibilityRole="button"
            accessibilityLabel={toast.action.label}
            style={styles.acao}>
            <AppText variant="label" tone="brand" inControl>
              {toast.action.label}
            </AppText>
          </Pressable>
        ) : null}
        <IconButton icon="close" size="sm" accessibilityLabel="Fechar aviso" onPress={sair} />
      </Pressable>
    </Animated.View>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast precisa estar dentro de <ToastProvider>');
  return ctx.api;
}

/**
 * Sobe ou desce os toasts enquanto a tela está montada (distância do rodapé,
 * já somada ao safe area). Ex.: uma tela sem FAB pode usar `useToastOffset(16)`.
 */
export function useToastOffset(offset: number) {
  const ctx = useContext(ToastContext);
  const setOffset = ctx?.setOffset;
  useEffect(() => {
    if (!setOffset) return;
    setOffset(offset);
    return () => setOffset(null);
  }, [offset, setOffset]);
}

const styles = StyleSheet.create({
  viewport: {
    position: 'absolute',
    left: Spacing[4],
    right: Spacing[4],
    gap: Spacing[2],
    zIndex: 9999,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    minHeight: 52,
    // Em tela larga (web/tablet) não estica de ponta a ponta.
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    paddingLeft: Spacing[3],
    paddingRight: Spacing[1],
    paddingVertical: Spacing[1],
    borderWidth: 1,
    borderLeftWidth: 4,
    borderRadius: Radius.md,
  },
  icone: {
    alignSelf: 'center',
  },
  mensagem: {
    flex: 1,
    paddingVertical: Spacing[2],
  },
  acao: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing[2],
  },
});
