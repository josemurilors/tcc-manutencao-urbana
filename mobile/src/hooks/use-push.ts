/**
 * Notificações push (Expo Push) do andamento dos chamados.
 *
 * Regras de produto:
 * - Nunca pedir permissão no boot. Pedido "a frio" é recusado pela maioria e,
 *   no iOS, a recusa é definitiva. Os momentos certos são logo depois do
 *   primeiro reporte (`convidarParaPushAposReporte`, quando a pessoa acabou de
 *   criar algo que quer acompanhar) ou quando ela liga em Conta (`usePush`).
 * - Com a permissão já dada, o token é (re)registrado em silêncio a cada
 *   sessão (`sincronizarPush`) e removido no logout (`removerPushDoAparelho`),
 *   para o aparelho não receber avisos da conta de outra pessoa.
 * - Tocar na notificação abre o chamado (`useAbrirChamadoDaNotificacao`).
 *
 * Push remoto não existe no web, em simulador nem no Expo Go do Android
 * (removido no SDK 53): nesses casos tudo vira "indisponível" e a central de
 * notificações dentro do app continua funcionando.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Linking, Platform } from 'react-native';

import { notificacoesApi } from '@/services/api-notificacoes';
import type { DadosPush, PlataformaPush } from '@/types/notificacoes';

const TOKEN_KEY = 'ciu_push_token';
const CONVITE_KEY = 'ciu_push_convite_feito';
const CANAL_ANDROID = 'chamados';

export type EstadoPush =
  | 'carregando'
  /** Web, simulador ou Expo Go no Android. */
  | 'indisponivel'
  /** Sistema ainda não perguntou. */
  | 'nao-perguntado'
  /** Recusado: só dá para mudar nos ajustes do aparelho. */
  | 'negado'
  /** Permitido, mas a pessoa desligou os avisos neste aparelho. */
  | 'desligado'
  | 'ativo';

/** Rota do detalhe do chamado (contrato v3: `/chamado/<id>`). */
export function rotaDoChamado(id: string | number): Href {
  return `/chamado/${id}` as Href;
}

export function pushSuportado(): boolean {
  if (Platform.OS === 'web') return false;
  if (!Device.isDevice) return false;
  if (
    Platform.OS === 'android' &&
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient
  ) {
    return false;
  }
  return true;
}

// Com o app aberto, o aviso também aparece (banner) — senão a pessoa não
// percebe a mudança até abrir a central.
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: true,
    }),
  });
}

function plataforma(): PlataformaPush {
  return Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
}

async function prepararCanalAndroid() {
  if (Platform.OS !== 'android') return;
  // Android 8+: sem canal criado antes do pedido, o diálogo de permissão do
  // Android 13 nem aparece.
  await Notifications.setNotificationChannelAsync(CANAL_ANDROID, {
    name: 'Andamento dos chamados',
    description: 'Avisos quando a prefeitura atualiza um chamado seu ou que você apoiou.',
    importance: Notifications.AndroidImportance.HIGH,
  });
}

async function obterTokenExpo(): Promise<string> {
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
  const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : {});
  return data;
}

async function registrarToken() {
  await prepararCanalAndroid();
  const token = await obterTokenExpo();
  await notificacoesApi.registrarPushToken(token, plataforma());
  await AsyncStorage.setItem(TOKEN_KEY, token);
}

async function tokenGuardado() {
  return AsyncStorage.getItem(TOKEN_KEY);
}

async function lerEstado(): Promise<EstadoPush> {
  if (!pushSuportado()) return 'indisponivel';
  const { status } = await Notifications.getPermissionsAsync();
  if (status === 'denied') return 'negado';
  if (status !== 'granted') return 'nao-perguntado';
  return (await tokenGuardado()) ? 'ativo' : 'desligado';
}

/**
 * Pede a permissão (se preciso) e registra o token. Devolve o estado final;
 * erro de rede/servidor sobe para a tela mostrar.
 */
export async function ativarPush(): Promise<EstadoPush> {
  if (!pushSuportado()) return 'indisponivel';
  await prepararCanalAndroid();
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    ({ status } = await Notifications.requestPermissionsAsync());
  }
  if (status !== 'granted') return 'negado';
  await registrarToken();
  return 'ativo';
}

/** Para de mandar push para este aparelho (a permissão do sistema fica). */
export async function desativarPush(): Promise<void> {
  const token = await tokenGuardado();
  if (token) await notificacoesApi.removerPushToken(token);
  await AsyncStorage.removeItem(TOKEN_KEY);
}

/**
 * Sessão aberta: se a permissão já existe e a pessoa não desligou, garante o
 * token no servidor (ele pode ter mudado, ou a conta ser outra). Nunca pede
 * permissão.
 */
export async function sincronizarPush(): Promise<void> {
  if (!pushSuportado()) return;
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;
  // Quem desligou em Conta não tem token guardado; respeitamos.
  if (!(await tokenGuardado())) return;
  await registrarToken();
}

/**
 * Logout: desvincula o aparelho da conta antes de o token de sessão sumir.
 * A chave local continua, como "push ligado", para o próximo login registrar
 * o mesmo aparelho na conta nova (o backend troca o dono — `token` é UNIQUE).
 */
export async function removerPushDoAparelho(): Promise<void> {
  const token = await tokenGuardado();
  if (token) await notificacoesApi.removerPushToken(token);
}

/**
 * Convite contextual depois do primeiro chamado criado. Mostra uma vez por
 * aparelho e só se o sistema ainda não perguntou. Chamar na tela de reporte,
 * depois do sucesso (inclusive do envio offline).
 */
export async function convidarParaPushAposReporte(): Promise<EstadoPush> {
  if (!pushSuportado()) return 'indisponivel';
  if ((await AsyncStorage.getItem(CONVITE_KEY)) === '1') return lerEstado();
  const atual = await lerEstado();
  if (atual !== 'nao-perguntado') return atual;
  await AsyncStorage.setItem(CONVITE_KEY, '1');

  const quer = await new Promise<boolean>((resolve) => {
    Alert.alert(
      'Quer ser avisado quando a prefeitura agir?',
      'Mandamos uma notificação quando o seu chamado mudar de situação — por exemplo, quando for programado ou resolvido. Você pode desligar quando quiser em Conta.',
      [
        { text: 'Agora não', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Quero ser avisado', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
  if (!quer) return 'nao-perguntado';
  return ativarPush();
}

/** Estado e ações do push para a tela de Conta. */
export function usePush() {
  const [estado, setEstado] = useState<EstadoPush>('carregando');
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let vivo = true;
    const ler = () =>
      lerEstado()
        .then((e) => {
          if (vivo) setEstado(e);
        })
        .catch((err) => {
          console.warn('[push] não foi possível ler a permissão', err);
          if (vivo) setEstado('indisponivel');
        });
    ler();
    // A pessoa pode ter mudado a permissão nos ajustes do aparelho.
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') ler();
    });
    return () => {
      vivo = false;
      sub.remove();
    };
  }, []);

  const ativar = useCallback(async () => {
    setOcupado(true);
    try {
      const final = await ativarPush();
      setEstado(final);
      return final;
    } finally {
      setOcupado(false);
    }
  }, []);

  const desativar = useCallback(async () => {
    setOcupado(true);
    try {
      await desativarPush();
      setEstado(await lerEstado());
    } finally {
      setOcupado(false);
    }
  }, []);

  const abrirAjustesDoAparelho = useCallback(() => Linking.openSettings(), []);

  return { estado, ocupado, ativar, desativar, abrirAjustesDoAparelho };
}

function idDoChamado(resposta: Notifications.NotificationResponse): string | null {
  const dados = resposta.notification.request.content.data as DadosPush | undefined;
  const id = dados?.defeito_id;
  return id === undefined || id === null || id === '' ? null : String(id);
}

/**
 * Tocar no push abre o chamado. `pronto` segura a navegação até a pilha raiz
 * existir (no boot a sessão ainda está sendo lida e navegar quebraria o
 * router); o toque que abriu o app a frio é tratado assim que fica pronto.
 */
export function useAbrirChamadoDaNotificacao(pronto: boolean) {
  const pendente = useRef<string | null>(null);
  // A resposta que abriu o app pode chegar pelo listener e pela "última
  // resposta" ao mesmo tempo; sem isto o chamado abriria duas vezes.
  const tratadas = useRef(new Set<string>());

  const abrir = useCallback(
    (resposta: Notifications.NotificationResponse) => {
      const chave = resposta.notification.request.identifier;
      if (tratadas.current.has(chave)) return;
      tratadas.current.add(chave);
      const id = idDoChamado(resposta);
      if (!id) {
        // Aviso sem chamado (moderação, conta): a central explica o resto.
        if (pronto) router.push('/notificacoes' as Href);
        return;
      }
      if (!pronto) {
        pendente.current = id;
        return;
      }
      router.push(rotaDoChamado(id));
    },
    [pronto],
  );

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = Notifications.addNotificationResponseReceivedListener((resposta) => {
      abrir(resposta);
    });
    return () => sub.remove();
  }, [abrir, pronto]);

  // App aberto a frio pelo toque: a resposta já chegou antes do listener.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let cancelado = false;
    Notifications.getLastNotificationResponseAsync()
      .then((resposta) => {
        if (cancelado || !resposta) return;
        abrir(resposta);
        // Limpa para não reabrir o mesmo chamado a cada boot.
        return Notifications.clearLastNotificationResponseAsync();
      })
      .catch((err) => console.warn('[push] última resposta indisponível', err));
    return () => {
      cancelado = true;
    };
  }, [abrir]);

  useEffect(() => {
    if (pronto && pendente.current) {
      const id = pendente.current;
      pendente.current = null;
      router.push(rotaDoChamado(id));
    }
  }, [pronto]);
}
