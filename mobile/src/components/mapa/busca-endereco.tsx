/**
 * Barra "Buscar endereço ou protocolo" no topo do mapa.
 *
 * Digitar dispara a busca depois de uma pausa (`ESPERA_MS`) e cancela a
 * anterior ainda em voo — o Nominatim público aceita ~1 req/s. Escolher um
 * resultado entrega a coordenada para a tela, que leva o mapa até lá e
 * oferece "Reportar aqui".
 */

import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/ui/text';
import { Elevation, Layout, MaxFontScale, Radius, Spacing, Typography } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import { normalizarProtocolo } from '@/services/api-cidadao';
import { buscarEndereco } from '@/services/api-mapa';
import type { ResultadoEndereco } from '@/types/mapa';

const ESPERA_MS = 600;
const MINIMO_LETRAS = 3;

/**
 * "2026-000123", "2026 123", "#2026/123": o que a pessoa digita quando quer
 * achar um chamado pelo protocolo (recebido por mensagem ou no 156). Nesse
 * caso a barra oferece abrir o chamado em vez de buscar endereço.
 */
// Ano começando em 20: um CEP só com números ("01310100") não vira protocolo.
const PARECE_PROTOCOLO = /^#?\s*20\d{2}\s*[-/.\s]?\s*\d{1,6}$/;

export function protocoloDigitado(texto: string): string | null {
  const t = texto.trim();
  return PARECE_PROTOCOLO.test(t) ? normalizarProtocolo(t) : null;
}

type Estado = 'ocioso' | 'buscando' | 'pronto' | 'erro';

type Resposta = {
  termo: string;
  tentativa: number;
  lista: ResultadoEndereco[];
  erro: string | null;
};

type Props = {
  /** Posição para priorizar resultados perto da pessoa. */
  perto: { latitude: number; longitude: number } | null;
  onEscolher: (resultado: ResultadoEndereco) => void;
};

export function BuscaEndereco({ perto, onEscolher }: Props) {
  const colors = useColors();
  const [texto, setTexto] = useState('');
  // Texto do resultado escolhido: ele volta para a barra, mas não é uma busca nova.
  const [escolhido, setEscolhido] = useState<string | null>(null);
  // Última resposta, amarrada ao termo/tentativa que a pediu: o estado da
  // lista é derivado dela no render, sem setState síncrono no efeito.
  const [resposta, setResposta] = useState<Resposta | null>(null);
  const [focado, setFocado] = useState(false);
  // Tentativas manuais ("Tentar de novo") reexecutam o efeito com o mesmo texto.
  const [tentativa, setTentativa] = useState(0);
  const pertoRef = useRef(perto);
  useEffect(() => {
    pertoRef.current = perto;
  }, [perto]);

  const termo = texto.trim();
  const protocolo = protocoloDigitado(termo);
  const ativo = termo.length >= MINIMO_LETRAS && termo !== escolhido && !protocolo;

  useEffect(() => {
    if (!ativo) return;
    const controller = new AbortController();
    const id = setTimeout(() => {
      buscarEndereco(termo, pertoRef.current, controller.signal)
        .then((lista) => {
          if (!controller.signal.aborted) setResposta({ termo, tentativa, lista, erro: null });
        })
        .catch((err: unknown) => {
          // Abortada porque a pessoa continuou digitando: não é erro.
          if (controller.signal.aborted) return;
          const erro = err instanceof Error ? err.message : 'Busca indisponível.';
          setResposta({ termo, tentativa, lista: [], erro });
        });
    }, ESPERA_MS);
    return () => {
      clearTimeout(id);
      controller.abort();
    };
  }, [ativo, termo, tentativa]);

  const atual = resposta && resposta.termo === termo && resposta.tentativa === tentativa ? resposta : null;
  const estado: Estado = !ativo ? 'ocioso' : !atual ? 'buscando' : atual.erro ? 'erro' : 'pronto';
  const resultados = atual?.lista ?? [];
  const erro = atual?.erro ?? null;

  function escolher(r: ResultadoEndereco) {
    Keyboard.dismiss();
    setFocado(false);
    setEscolhido(r.titulo.trim());
    setTexto(r.titulo);
    onEscolher(r);
  }

  function abrirProtocolo(p: string) {
    Keyboard.dismiss();
    setFocado(false);
    router.push({ pathname: '/protocolo/[protocolo]', params: { protocolo: p } });
  }

  function limpar() {
    setEscolhido(null);
    setTexto('');
  }

  const mostrarLista = focado && (estado !== 'ocioso' || !!protocolo);

  return (
    <View style={styles.raiz}>
      <View
        style={[
          styles.barra,
          Elevation.md,
          {
            backgroundColor: colors.surfaceRaised,
            borderColor: focado ? colors.focus : colors.border,
          },
        ]}>
        <Ionicons name="search" size={18} color={colors.textSecondary} />
        <TextInput
          value={texto}
          onChangeText={setTexto}
          onFocus={() => setFocado(true)}
          onBlur={() => {
            // Espera o toque no resultado chegar antes de fechar a lista.
            setTimeout(() => setFocado(false), 200);
          }}
          placeholder="Buscar endereço ou protocolo"
          placeholderTextColor={colors.textMuted}
          accessibilityLabel="Buscar endereço, bairro ou número de protocolo"
          onSubmitEditing={() => {
            if (protocolo) abrirProtocolo(protocolo);
          }}
          returnKeyType="search"
          autoCorrect={false}
          maxFontSizeMultiplier={MaxFontScale.control}
          style={[styles.input, Typography.bodySm, { color: colors.textPrimary }]}
        />
        {estado === 'buscando' ? (
          <ActivityIndicator size="small" color={colors.primaryText} accessibilityLabel="Buscando" />
        ) : texto ? (
          <Pressable
            onPress={limpar}
            accessibilityRole="button"
            accessibilityLabel="Limpar busca"
            hitSlop={10}
            style={styles.limpar}>
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {mostrarLista ? (
        <View
          style={[
            styles.lista,
            Elevation.lg,
            { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
          ]}
          accessibilityLiveRegion="polite">
          {protocolo ? (
            <Pressable
              onPress={() => abrirProtocolo(protocolo)}
              accessibilityRole="button"
              accessibilityLabel={`Abrir o chamado de protocolo ${protocolo}`}
              style={({ pressed }) => [
                styles.resultado,
                { borderColor: colors.borderSubtle },
                pressed && { backgroundColor: colors.surfacePressed },
              ]}>
              <Ionicons name="document-text-outline" size={18} color={colors.primaryText} />
              <View style={styles.flex}>
                <AppText variant="bodySm" weight="600" numberOfLines={1}>
                  Abrir protocolo {protocolo}
                </AppText>
                <AppText variant="caption" tone="muted" numberOfLines={1}>
                  Acompanhar o andamento deste chamado
                </AppText>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>
          ) : estado === 'buscando' && resultados.length === 0 ? (
            <AppText variant="bodySm" tone="muted" style={styles.aviso}>
              Buscando...
            </AppText>
          ) : estado === 'erro' ? (
            <View style={styles.erro}>
              <AppText variant="bodySm" tone="danger" style={styles.flex} accessibilityRole="alert">
                {erro ?? 'Não foi possível buscar agora.'}
              </AppText>
              <Pressable
                onPress={() => setTentativa((n) => n + 1)}
                accessibilityRole="button"
                hitSlop={8}
                style={styles.tentar}>
                <AppText variant="label" tone="brand">
                  Tentar de novo
                </AppText>
              </Pressable>
            </View>
          ) : resultados.length === 0 ? (
            <AppText variant="bodySm" tone="muted" style={styles.aviso}>
              Nenhum endereço encontrado. Tente incluir o bairro ou a cidade.
            </AppText>
          ) : (
            resultados.map((r) => (
              <Pressable
                key={r.id}
                onPress={() => escolher(r)}
                accessibilityRole="button"
                accessibilityLabel={`Ir para ${r.titulo}, ${r.detalhe}`}
                style={({ pressed }) => [
                  styles.resultado,
                  { borderColor: colors.borderSubtle },
                  pressed && { backgroundColor: colors.surfacePressed },
                ]}>
                <Ionicons name="location-outline" size={18} color={colors.textSecondary} />
                <View style={styles.flex}>
                  <AppText variant="bodySm" weight="600" numberOfLines={1}>
                    {r.titulo}
                  </AppText>
                  <AppText variant="caption" tone="muted" numberOfLines={1}>
                    {r.detalhe}
                  </AppText>
                </View>
              </Pressable>
            ))
          )}
          {protocolo ? null : (
            <AppText variant="caption" tone="muted" style={styles.creditos}>
              Endereços: © OpenStreetMap
            </AppText>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  raiz: {
    width: '100%',
  },
  barra: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    minHeight: Layout.minTouch,
    paddingHorizontal: Spacing[3],
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  input: {
    flex: 1,
    paddingVertical: Spacing[2],
    // Sem o contorno azul do navegador; a borda da barra já mostra o foco.
    outlineStyle: 'none',
  } as object,
  limpar: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lista: {
    marginTop: Spacing[1],
    borderWidth: 1,
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  resultado: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    minHeight: Layout.minTouch + 8,
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
    borderBottomWidth: 1,
  },
  aviso: {
    padding: Spacing[3],
  },
  erro: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    padding: Spacing[3],
  },
  tentar: {
    minHeight: Layout.minTouch,
    justifyContent: 'center',
  },
  creditos: {
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[1],
    textAlign: 'right',
  },
  flex: {
    flex: 1,
  },
});
