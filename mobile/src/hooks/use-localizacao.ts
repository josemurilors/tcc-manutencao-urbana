/**
 * Posição do usuário em tempo real.
 *
 * O mapa funciona como um app de navegação: tudo (reportar, pendências
 * próximas, confirmação no local) parte da posição atual do GPS, então em vez
 * de uma leitura pontual (`getCurrentPositionAsync`) o hook mantém um
 * `watchPositionAsync` ativo enquanto a tela estiver montada.
 *
 * Funciona nas três plataformas: no web o expo-location usa
 * `navigator.geolocation` por baixo.
 */

import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { gpsSimulado, type EstadoSimulado } from '@/dev/gps-simulado';
import { salvarUltimaPosicao } from '@/services/ultima-posicao';

export type Posicao = {
  latitude: number;
  longitude: number;
  /** Precisão em metros, quando o dispositivo informa. */
  precisao: number | null;
  /** Direção do movimento em graus (0 = norte); null quando parado. */
  heading: number | null;
  timestamp: number;
};

export type EstadoLocalizacao = {
  posicao: Posicao | null;
  /**
   * Para onde o aparelho está virado (bússola, 0 = norte), em graus. É o que
   * gira a seta no mapa — o `heading` do GPS só existe em movimento.
   * `null` sem magnetômetro (desktop) ou sem permissão.
   */
  bussola: number | null;
  /** `null` enquanto a permissão ainda não foi decidida. */
  permitido: boolean | null;
  erro: string | null;
  /** Pede a permissão de novo (ex.: depois de negar e mudar de ideia). */
  tentarNovamente: () => void;
};

const OPCOES_WATCH: Location.LocationOptions = {
  accuracy: Location.Accuracy.High,
  // Em metros / ms — atualiza a cada poucos passos, sem drenar bateria.
  distanceInterval: 5,
  timeInterval: 2000,
};

const GRAUS_MINIMOS = 3;

/** Diferença entre dois ângulos em (-180, 180]. */
function diferencaAngular(a: number, b: number) {
  return ((a - b + 540) % 360) - 180;
}

function paraPosicao(obj: Location.LocationObject): Posicao {
  return {
    latitude: obj.coords.latitude,
    longitude: obj.coords.longitude,
    precisao: obj.coords.accuracy ?? null,
    heading:
      typeof obj.coords.heading === 'number' && obj.coords.heading >= 0
        ? obj.coords.heading
        : null,
    timestamp: obj.timestamp,
  };
}

export function useLocalizacao(ativo = true): EstadoLocalizacao {
  const [posicao, setPosicao] = useState<Posicao | null>(null);
  const [bussola, setBussola] = useState<number | null>(null);
  const [permitido, setPermitido] = useState<boolean | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [simulado, setSimulado] = useState<EstadoSimulado>(gpsSimulado.get());
  const assinaturaRef = useRef<Location.LocationSubscription | null>(null);

  // GPS simulado (painel de desenvolvimento). Fora do dev o store fica inerte.
  useEffect(() => gpsSimulado.subscribe(setSimulado), []);

  useEffect(() => {
    if (!ativo) return;
    let cancelado = false;

    (async () => {
      const permissao = await Location.requestForegroundPermissionsAsync();
      if (cancelado) return;
      setPermitido(permissao.granted);
      if (!permissao.granted) {
        setErro('Permissão de localização negada.');
        return;
      }
      setErro(null);

      // Última posição conhecida chega na hora; o watch refina em seguida.
      const ultima = await Location.getLastKnownPositionAsync().catch(() => null);
      if (!cancelado && ultima) setPosicao(paraPosicao(ultima));

      try {
        assinaturaRef.current = await Location.watchPositionAsync(OPCOES_WATCH, (obj) => {
          if (!cancelado) setPosicao(paraPosicao(obj));
        });
      } catch {
        if (!cancelado) setErro('Não foi possível obter sua localização.');
      }
    })().catch(() => {
      if (!cancelado) setErro('Não foi possível obter sua localização.');
    });

    return () => {
      cancelado = true;
      assinaturaRef.current?.remove();
      assinaturaRef.current = null;
    };
  }, [ativo, tentativa]);

  // Bússola. Só atualiza a cada poucos graus para não re-renderizar o mapa
  // a cada leitura do magnetômetro.
  useEffect(() => {
    if (!ativo || permitido !== true) return;
    let ultimo: number | null = null;
    const publicar = (graus: number) => {
      const normalizado = ((graus % 360) + 360) % 360;
      if (ultimo !== null && Math.abs(diferencaAngular(normalizado, ultimo)) < GRAUS_MINIMOS) return;
      ultimo = normalizado;
      setBussola(normalizado);
    };

    if (Platform.OS === 'web') {
      if (typeof window === 'undefined') return;
      const handler = (e: DeviceOrientationEvent) => {
        // Safari/iOS expõe a direção já compensada; nos demais, `alpha` é o
        // giro em torno do eixo vertical (sentido anti-horário).
        const webkit = (e as any).webkitCompassHeading as number | undefined;
        if (typeof webkit === 'number') return publicar(webkit);
        if (e.alpha != null) publicar(360 - e.alpha);
      };
      const evento = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
      window.addEventListener(evento, handler as EventListener);
      return () => window.removeEventListener(evento, handler as EventListener);
    }

    let assinatura: Location.LocationSubscription | null = null;
    let cancelado = false;
    Location.watchHeadingAsync((h) => {
      // trueHeading vem -1 quando o aparelho não consegue calcular o norte verdadeiro.
      publicar(h.trueHeading >= 0 ? h.trueHeading : h.magHeading);
    })
      .then((sub) => {
        if (cancelado) sub.remove();
        else assinatura = sub;
      })
      .catch(() => {});
    return () => {
      cancelado = true;
      assinatura?.remove();
    };
  }, [ativo, permitido]);

  const tentarNovamente = useCallback(() => setTentativa((t) => t + 1), []);

  // Guarda a posição que as telas estão vendo, para o mapa abrir nela da
  // próxima vez em vez de esperar o GPS.
  const posicaoAtual = simulado.ativo ? simulado.posicao : posicao;
  useEffect(() => {
    if (posicaoAtual) salvarUltimaPosicao(posicaoAtual);
  }, [posicaoAtual]);

  if (simulado.ativo) {
    return {
      posicao: simulado.posicao,
      bussola: simulado.bussola,
      permitido: true,
      erro: null,
      tentarNovamente,
    };
  }

  return { posicao, bussola, permitido, erro, tentarNovamente };
}
