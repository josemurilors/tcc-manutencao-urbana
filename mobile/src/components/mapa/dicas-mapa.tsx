/**
 * Dicas de primeira vez do mapa: quatro cartões curtos sobre o que não se
 * descobre sozinho — o toque longo para reportar em outro ponto, o anel
 * dourado de confirmação e as bolhas com número. Aparecem uma vez (flag no
 * aparelho, ver `useDicasVistas`) e podem ser puladas a qualquer momento.
 */

import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { AppText } from '@/components/ui/text';
import { RAIO_CONFIRMACAO_M } from '@/constants/proximidade';
import { Elevation, Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';

type Dica = { icone: keyof typeof Ionicons.glyphMap; titulo: string; texto: string };

function dicas(logado: boolean): Dica[] {
  const toqueLongo =
    Platform.OS === 'web'
      ? 'Clique com o botão direito (ou toque e segure) no mapa para marcar um problema em outro lugar.'
      : 'Toque e segure no mapa para marcar um problema em outro lugar, sem precisar ir até ele.';
  return [
    {
      icone: 'megaphone',
      titulo: 'Reporte onde você está',
      texto: logado
        ? 'O botão Reportar abre um chamado no ponto exato em que você está, com foto.'
        : 'Entre na sua conta para reportar problemas e acompanhar o que a prefeitura faz.',
    },
    { icone: 'hand-left', titulo: 'Ou em outro ponto', texto: toqueLongo },
    {
      icone: 'radio-button-on',
      titulo: 'Confirme de perto',
      texto: `A até ${RAIO_CONFIRMACAO_M} m de um problema, o pino ganha um anel dourado: toque nele e confirme que continua lá. Isso dá prioridade ao chamado.`,
    },
    {
      icone: 'layers',
      titulo: 'Entenda o mapa',
      texto:
        'Círculos com número juntam vários chamados: toque para aproximar. Em Camadas você filtra por tipo, vê os já resolvidos e liga o mapa de calor.',
    },
  ];
}

type Props = {
  logado: boolean;
  onConcluir: () => void;
};

export function DicasMapa({ logado, onConcluir }: Props) {
  const colors = useColors();
  const lista = dicas(logado);
  const [passo, setPasso] = useState(0);
  const dica = lista[passo];
  const ultimo = passo === lista.length - 1;

  return (
    <View
      style={[
        styles.cartao,
        Elevation.lg,
        { backgroundColor: colors.surfaceRaised, borderColor: colors.primary },
      ]}
      accessibilityViewIsModal
      accessibilityLiveRegion="polite">
      <View style={styles.topo}>
        <View style={[styles.icone, { backgroundColor: colors.primarySubtle }]}>
          <Ionicons name={dica.icone} size={22} color={colors.primaryText} />
        </View>
        <View style={styles.textos}>
          <AppText variant="caption" tone="muted">
            Dica {passo + 1} de {lista.length}
          </AppText>
          <AppText variant="title" accessibilityRole="header">
            {dica.titulo}
          </AppText>
        </View>
      </View>
      <AppText variant="bodySm" tone="secondary">
        {dica.texto}
      </AppText>
      <View style={styles.pontos} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {lista.map((d, i) => (
          <View
            key={d.titulo}
            style={[
              styles.ponto,
              { backgroundColor: i === passo ? colors.primary : colors.borderStrong },
            ]}
          />
        ))}
      </View>
      <View style={styles.acoes}>
        {ultimo ? null : (
          <Button variant="ghost" size="sm" onPress={onConcluir} style={styles.acao}>
            Pular
          </Button>
        )}
        <Button
          size="sm"
          onPress={() => (ultimo ? onConcluir() : setPasso((p) => p + 1))}
          style={styles.acao}>
          {ultimo ? 'Entendi' : 'Próxima'}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cartao: {
    gap: Spacing[3],
    padding: Spacing[4],
    borderWidth: 1,
    borderRadius: Radius.lg,
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },
  topo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
  },
  icone: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textos: {
    flex: 1,
  },
  pontos: {
    flexDirection: 'row',
    gap: Spacing[1],
    alignSelf: 'center',
  },
  ponto: {
    width: 8,
    height: 8,
    borderRadius: Radius.full,
  },
  acoes: {
    flexDirection: 'row',
    gap: Spacing[2],
  },
  acao: {
    flex: 1,
  },
});
