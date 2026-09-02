/**
 * Painel de simulação de GPS — só em desenvolvimento, no web (desktop).
 *
 * - Joystick: arraste o botão; a direção vira a bússola e a deflexão a
 *   velocidade (até ~6 m/s, uma corrida). Soltar para.
 * - Lat/Lng/Rumo: teleporta para a coordenada digitada apontando para o rumo.
 *   Os campos já vêm com `POSICAO_DEV_PADRAO`; "Ligar" parte dela.
 * - "GPS real": desliga a simulação e volta a ouvir o aparelho.
 *
 * Alimenta o store `gpsSimulado`; o `useLocalizacao` lê de lá enquanto ativo.
 */

import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type GestureResponderEvent } from 'react-native';

import { FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import type { Posicao } from '@/hooks/use-localizacao';
import { gpsSimulado, type EstadoSimulado } from './gps-simulado';

const RAIO_JOYSTICK = 44;
const RAIO_BOTAO = 18;
/** Velocidade com o joystick no limite, em m/s. */
const VELOCIDADE_MAX = 6;
const INTERVALO_MS = 100;

/** Ponto de partida da simulação (lat, lng e rumo em graus). */
const POSICAO_DEV_PADRAO = { latitude: -23.00039, longitude: -49.31988, bussola: 214 };

type Props = {
  /** Posição real (só informativa; a simulação parte de `POSICAO_DEV_PADRAO`). */
  posicaoReal: Posicao | null;
};

export function GpsJoystick({ posicaoReal: _posicaoReal }: Props) {
  const colors = useColors();
  const [estado, setEstado] = useState<EstadoSimulado>(gpsSimulado.get());
  const [aberto, setAberto] = useState(true);
  const [lat, setLat] = useState(String(POSICAO_DEV_PADRAO.latitude));
  const [lng, setLng] = useState(String(POSICAO_DEV_PADRAO.longitude));
  const [rumo, setRumo] = useState(String(POSICAO_DEV_PADRAO.bussola));
  const [deslocamento, setDeslocamento] = useState({ x: 0, y: 0 });

  const inicio = useRef({ x: 0, y: 0 });
  const vetor = useRef({ x: 0, y: 0 });

  useEffect(() => gpsSimulado.subscribe(setEstado), []);

  // Loop de movimento: enquanto o joystick estiver deslocado, anda.
  useEffect(() => {
    if (!estado.ativo) return;
    const id = setInterval(() => {
      const { x, y } = vetor.current;
      const intensidade = Math.min(Math.hypot(x, y) / RAIO_JOYSTICK, 1);
      if (intensidade < 0.05) return;
      // Tela: y cresce para baixo; bússola: 0 = norte (para cima), horário.
      const bearing = (Math.atan2(x, -y) * 180) / Math.PI;
      gpsSimulado.andar((VELOCIDADE_MAX * intensidade * INTERVALO_MS) / 1000, bearing);
    }, INTERVALO_MS);
    return () => clearInterval(id);
  }, [estado.ativo]);

  function lerCampos() {
    const la = Number(lat.replace(',', '.'));
    const lo = Number(lng.replace(',', '.'));
    const ru = Number(rumo.replace(',', '.'));
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
    return { latitude: la, longitude: lo, bussola: Number.isFinite(ru) ? ru : undefined };
  }

  function ligar() {
    gpsSimulado.ativar(lerCampos() ?? POSICAO_DEV_PADRAO);
  }

  function teleportar() {
    const alvo = lerCampos();
    if (!alvo) return;
    if (!estado.ativo) {
      gpsSimulado.ativar(alvo);
      return;
    }
    gpsSimulado.irPara(alvo.latitude, alvo.longitude);
    if (alvo.bussola !== undefined) gpsSimulado.virar(alvo.bussola);
  }

  function aoComecar(e: GestureResponderEvent) {
    inicio.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
  }

  function aoMover(e: GestureResponderEvent) {
    let x = e.nativeEvent.pageX - inicio.current.x;
    let y = e.nativeEvent.pageY - inicio.current.y;
    const d = Math.hypot(x, y);
    if (d > RAIO_JOYSTICK) {
      x = (x / d) * RAIO_JOYSTICK;
      y = (y / d) * RAIO_JOYSTICK;
    }
    vetor.current = { x, y };
    setDeslocamento({ x, y });
    // Girar o aparelho já ao encostar, mesmo antes de andar.
    if (d > 4) gpsSimulado.virar((Math.atan2(x, -y) * 180) / Math.PI);
  }

  function aoSoltar() {
    vetor.current = { x: 0, y: 0 };
    setDeslocamento({ x: 0, y: 0 });
  }

  const posicao = estado.posicao;

  return (
    <View
      style={[
        styles.painel,
        { backgroundColor: colors.bgElevated, borderColor: colors.borderGold },
      ]}
      pointerEvents="box-none">
      <View style={styles.cabecalho}>
        <Ionicons name="game-controller" size={14} color={colors.gold500} />
        <Text style={[styles.titulo, { color: colors.gold500 }]}>GPS simulado (dev)</Text>
        <Pressable onPress={() => setAberto((a) => !a)} hitSlop={8} accessibilityRole="button">
          <Ionicons
            name={aberto ? 'chevron-down' : 'chevron-up'}
            size={16}
            color={colors.textSecondary}
          />
        </Pressable>
      </View>

      {aberto ? (
        <>
          <View style={styles.linha}>
            <Pressable
              onPress={estado.ativo ? gpsSimulado.desativar : ligar}
              accessibilityRole="button"
              style={[
                styles.toggle,
                {
                  backgroundColor: estado.ativo ? colors.gold500 : 'transparent',
                  borderColor: estado.ativo ? colors.gold500 : colors.borderDefault,
                },
              ]}>
              <Text
                style={[
                  styles.toggleTexto,
                  { color: estado.ativo ? colors.textInverse : colors.textSecondary },
                ]}>
                {estado.ativo ? 'Simulando' : 'GPS real'}
              </Text>
            </Pressable>
            {posicao && estado.ativo ? (
              <Text style={[styles.leitura, { color: colors.textMuted }]} numberOfLines={2}>
                {posicao.latitude.toFixed(5)}, {posicao.longitude.toFixed(5)}
                {'\n'}
                {estado.bussola != null ? `${Math.round(estado.bussola)}°` : '—'}
              </Text>
            ) : null}
          </View>

          <View style={styles.corpo}>
            <View
              style={[
                styles.base,
                { borderColor: colors.borderDefault, opacity: estado.ativo ? 1 : 0.4 },
              ]}
              onStartShouldSetResponder={() => estado.ativo}
              onMoveShouldSetResponder={() => estado.ativo}
              onResponderGrant={aoComecar}
              onResponderMove={aoMover}
              onResponderRelease={aoSoltar}
              onResponderTerminate={aoSoltar}>
              <View style={[styles.cruz, { backgroundColor: colors.borderDefault }]} />
              <View
                style={[styles.cruz, styles.cruzVertical, { backgroundColor: colors.borderDefault }]}
              />
              <View
                style={[
                  styles.botao,
                  {
                    backgroundColor: colors.gold500,
                    transform: [{ translateX: deslocamento.x }, { translateY: deslocamento.y }],
                  },
                ]}
              />
            </View>

            <View style={styles.campos}>
              <TextInput
                value={lat}
                onChangeText={setLat}
                placeholder="lat"
                placeholderTextColor={colors.textMuted}
                keyboardType="numbers-and-punctuation"
                style={[
                  styles.campo,
                  {
                    color: colors.textPrimary,
                    borderColor: colors.borderDefault,
                    backgroundColor: colors.bgInput,
                  },
                ]}
              />
              <TextInput
                value={lng}
                onChangeText={setLng}
                placeholder="lng"
                placeholderTextColor={colors.textMuted}
                keyboardType="numbers-and-punctuation"
                style={[
                  styles.campo,
                  {
                    color: colors.textPrimary,
                    borderColor: colors.borderDefault,
                    backgroundColor: colors.bgInput,
                  },
                ]}
              />
              <TextInput
                value={rumo}
                onChangeText={setRumo}
                placeholder="rumo °"
                placeholderTextColor={colors.textMuted}
                keyboardType="numbers-and-punctuation"
                onSubmitEditing={teleportar}
                style={[
                  styles.campo,
                  {
                    color: colors.textPrimary,
                    borderColor: colors.borderDefault,
                    backgroundColor: colors.bgInput,
                  },
                ]}
              />
              <Pressable
                onPress={teleportar}
                accessibilityRole="button"
                style={[styles.ir, { borderColor: colors.gold500 }]}>
                <Ionicons name="locate" size={12} color={colors.gold500} />
                <Text style={[styles.irTexto, { color: colors.gold500 }]}>Ir</Text>
              </Pressable>
            </View>
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  painel: {
    position: 'absolute',
    // Abaixo do botão da conta + pill de nível, longe da bandeja do rodapé.
    left: Spacing[4],
    top: 104,
    zIndex: 1100,
    width: 250,
    padding: Spacing[3],
    gap: Spacing[2],
    borderWidth: 1,
    borderRadius: Radius.md,
    opacity: 0.95,
  },
  cabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
  titulo: {
    flex: 1,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
  toggle: {
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[1] + 2,
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  toggleTexto: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },
  leitura: {
    flex: 1,
    fontSize: FontSize.xs - 2,
    fontVariant: ['tabular-nums'],
  },
  corpo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
  },
  base: {
    width: RAIO_JOYSTICK * 2 + RAIO_BOTAO,
    height: RAIO_JOYSTICK * 2 + RAIO_BOTAO,
    borderRadius: Radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cruz: {
    position: 'absolute',
    width: '70%',
    height: 1,
  },
  cruzVertical: {
    width: 1,
    height: '70%',
  },
  botao: {
    width: RAIO_BOTAO * 2,
    height: RAIO_BOTAO * 2,
    borderRadius: Radius.full,
  },
  campos: {
    flex: 1,
    gap: Spacing[1] + 2,
  },
  campo: {
    height: 28,
    paddingHorizontal: Spacing[2],
    borderWidth: 1,
    borderRadius: Radius.sm,
    fontSize: FontSize.xs,
  },
  ir: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[1],
    height: 28,
    borderWidth: 1,
    borderRadius: Radius.sm,
  },
  irTexto: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },
});
