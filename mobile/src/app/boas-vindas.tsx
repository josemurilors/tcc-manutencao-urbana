/**
 * Recepção da primeira entrada: três passos contando para que o app serve e
 * como ele funciona, sem jargão — só para a pessoa não cair no mapa perdida.
 * Mostrada uma única vez (flag local); "Pular" está sempre à mão.
 *
 * Os passos deslizam com o dedo (lista paginada) e também pelos botões; os
 * pontos são tocáveis e dizem "Passo X de 3" ao leitor de tela. O último
 * passo leva à Política de Privacidade, antes de qualquer pedido de dado.
 */

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, type Href } from 'expo-router';
import { useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { AppText } from '@/components/ui/text';
import { FontSize, FontWeight, hitSlopPara, Layout, Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import { setOnboardingVisto } from '@/services/storage';

const LOGO = require('@/assets/images/icon.png');

const PASSOS: {
  icone: keyof typeof Ionicons.glyphMap;
  titulo: string;
  texto: string;
}[] = [
  {
    icone: 'map',
    titulo: 'A sua cidade, num mapa',
    texto:
      'Buraco na rua, poste apagado, entulho na calçada? Aqui você vê o que já foi reportado perto de você — e o que a prefeitura está fazendo a respeito.',
  },
  {
    icone: 'camera',
    titulo: 'Viu um problema? Reporte',
    texto:
      'Toque em Reportar, tire uma foto na hora e pronto: o chamado vai direto para a equipe responsável, no ponto exato onde você está.',
  },
  {
    icone: 'checkmark-done-circle',
    titulo: 'Acompanhe até resolver',
    texto:
      'Vizinhos podem apoiar e confirmar o problema, e você acompanha tudo em "Meus chamados" — do aberto ao resolvido.',
  },
];

export default function BoasVindasScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [passo, setPasso] = useState(0);
  const [largura, setLargura] = useState(0);
  const lista = useRef<FlatList<(typeof PASSOS)[number]>>(null);

  const ultimo = passo === PASSOS.length - 1;

  async function concluir() {
    await setOnboardingVisto();
    router.replace('/(tabs)/mapa');
  }

  function irPara(indice: number) {
    setPasso(indice);
    lista.current?.scrollToIndex({ index: indice, animated: true });
  }

  function aoParar(e: NativeSyntheticEvent<NativeScrollEvent>) {
    if (!largura) return;
    const indice = Math.round(e.nativeEvent.contentOffset.x / largura);
    if (indice !== passo) setPasso(Math.min(Math.max(indice, 0), PASSOS.length - 1));
  }

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.bgPrimary,
          paddingTop: insets.top + Spacing[4],
          paddingBottom: insets.bottom + Spacing[6],
        },
      ]}>
      <View style={styles.topo}>
        <View style={styles.marca}>
          <View style={[styles.logoCaixa, { borderColor: colors.gold500 }]}>
            <Image source={LOGO} style={styles.logo} contentFit="cover" />
          </View>
          <Text style={[styles.marcaNome, { color: colors.textMuted }]}>
            Central de Inteligência Urbana
          </Text>
        </View>
        <Pressable
          onPress={concluir}
          accessibilityRole="button"
          accessibilityLabel="Pular apresentação"
          style={styles.pular}>
          <AppText variant="bodySm" tone="secondary" weight="600">
            Pular
          </AppText>
        </Pressable>
      </View>

      <View style={styles.conteudo} onLayout={(e) => setLargura(e.nativeEvent.layout.width)}>
        {largura > 0 ? (
          <FlatList
            ref={lista}
            data={PASSOS}
            keyExtractor={(p) => p.titulo}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={aoParar}
            getItemLayout={(_, index) => ({ length: largura, offset: largura * index, index })}
            renderItem={({ item, index }) => (
              <View
                style={[styles.pagina, { width: largura }]}
                accessible
                accessibilityLabel={`Passo ${index + 1} de ${PASSOS.length}. ${item.titulo}. ${item.texto}`}>
                <View style={[styles.iconeCaixa, { backgroundColor: colors.goldMuted }]}>
                  <Ionicons name={item.icone} size={44} color={colors.gold500} />
                </View>
                <Text style={[styles.titulo, { color: colors.textPrimary }]}>{item.titulo}</Text>
                <Text style={[styles.texto, { color: colors.textSecondary }]}>{item.texto}</Text>
              </View>
            )}
          />
        ) : null}
      </View>

      <View style={styles.rodape}>
        <View style={styles.pontos}>
          {PASSOS.map((_, i) => (
            <Pressable
              key={i}
              onPress={() => irPara(i)}
              accessibilityRole="button"
              accessibilityLabel={`Passo ${i + 1} de ${PASSOS.length}`}
              accessibilityState={{ selected: i === passo }}
              hitSlop={hitSlopPara(20, 6)}
              style={styles.pontoAlvo}>
              <View
                style={[
                  styles.ponto,
                  {
                    backgroundColor: i === passo ? colors.gold500 : colors.borderDefault,
                    width: i === passo ? 20 : 6,
                  },
                ]}
              />
            </Pressable>
          ))}
        </View>
        <Button block onPress={ultimo ? concluir : () => irPara(passo + 1)}>
          {ultimo ? 'Começar' : 'Avançar'}
        </Button>
        {ultimo ? (
          <Pressable
            onPress={() => router.push('/privacidade' as Href)}
            accessibilityRole="link"
            style={styles.privacidade}>
            <AppText variant="bodySm" tone="muted" style={styles.sublinhado}>
              Como cuidamos dos seus dados
            </AppText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: Spacing[6],
    maxWidth: 440,
    width: '100%',
    alignSelf: 'center',
  },
  topo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  marca: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
  logoCaixa: {
    width: 24,
    height: 24,
    borderWidth: 1,
  },
  logo: {
    width: '100%',
    height: '100%',
  },
  marcaNome: {
    fontSize: FontSize.xs,
  },
  pular: {
    minHeight: Layout.minTouch,
    paddingHorizontal: Spacing[3],
    justifyContent: 'center',
  },
  conteudo: {
    flex: 1,
  },
  pagina: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[4],
    paddingHorizontal: Spacing[1],
  },
  iconeCaixa: {
    width: 96,
    height: 96,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing[2],
  },
  titulo: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.semibold,
    textAlign: 'center',
  },
  texto: {
    fontSize: FontSize.sm,
    lineHeight: 22,
    textAlign: 'center',
  },
  rodape: {
    gap: Spacing[5],
    alignItems: 'center',
  },
  pontos: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
  pontoAlvo: {
    height: 24,
    justifyContent: 'center',
  },
  ponto: {
    height: 6,
    borderRadius: Radius.full,
  },
  privacidade: {
    minHeight: Layout.minTouch,
    justifyContent: 'center',
    marginTop: -Spacing[2],
  },
  sublinhado: {
    textDecorationLine: 'underline',
  },
});
