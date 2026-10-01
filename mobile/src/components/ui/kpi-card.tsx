/**
 * Cartão de KPI do painel executivo.
 *
 * Nasceu do porte do web, mas trocou a contagem animada (setInterval de 16 ms
 * em cada cartão, que gastava CPU e arredondava decimais) por valor estático
 * já formatado, e ganhou o que um indicador de gestão precisa:
 * - variação contra o período anterior com POLARIDADE: a cor diz se a mudança
 *   é boa ou ruim (backlog subindo é vermelho), e o texto repete isso em
 *   palavra ("melhor"/"pior"), para não depender só da cor;
 * - "o que é isto?": o ícone de informação abre a definição da métrica ali
 *   mesmo (tooltip em linha, que funciona igual no toque, no mouse e no leitor
 *   de tela);
 * - toque opcional para o drill-down.
 */

import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { Delta } from '@/components/bi/metricas';
import { Layout, Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';

import { IconButton } from './icon-button';
import { AppText } from './text';

type Props = {
  title: string;
  /** Valor já formatado ("1.234", "78%", "3,5 dias"). */
  value: string;
  /** Versão falada do valor, quando a escrita abrevia ("3,5 dias" já serve). */
  valueA11y?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  delta?: Delta | null;
  /** Complemento do delta: "vs 30 dias anteriores". */
  comparacao?: string;
  /** Definição da métrica, mostrada pelo botão de informação. */
  ajuda?: string;
  /** Cartão principal do topo: número maior. */
  destaque?: boolean;
  /** Pede atenção (ex.: há vencidos): faixa e ícone em `danger`. */
  alerta?: boolean;
  onPress?: () => void;
  /** Dica do toque para o leitor de tela ("Abre a lista de vencidos"). */
  onPressHint?: string;
};

export function KpiCard({
  title,
  value,
  valueA11y,
  icon,
  delta,
  comparacao,
  ajuda,
  destaque,
  alerta,
  onPress,
  onPressHint,
}: Props) {
  const colors = useColors();
  const [mostrarAjuda, setMostrarAjuda] = useState(false);

  const corDelta =
    delta?.avaliacao === 'bom' ? colors.success : delta?.avaliacao === 'ruim' ? colors.danger : colors.textMuted;
  const iconeDelta: keyof typeof Ionicons.glyphMap =
    delta?.direcao === 'subiu' ? 'arrow-up' : delta?.direcao === 'caiu' ? 'arrow-down' : 'remove';
  const palavra = delta?.avaliacao === 'bom' ? ' melhor' : delta?.avaliacao === 'ruim' ? ' pior' : '';
  const faixa = alerta ? colors.danger : destaque ? colors.primary : colors.border;

  const resumo = [
    `${title}: ${valueA11y ?? value}`,
    delta ? delta.extenso : null,
  ]
    .filter(Boolean)
    .join('. ');

  const conteudo = (
    <>
      <View style={[styles.faixa, { backgroundColor: faixa }]} />
      <View style={styles.topo}>
        {icon ? (
          <Ionicons
            name={icon}
            size={16}
            color={alerta ? colors.danger : colors.textSecondary}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
        ) : null}
        <AppText variant="caption" tone="secondary" weight="600" numberOfLines={2} style={styles.titulo}>
          {title}
        </AppText>
      </View>

      <AppText
        variant={destaque ? 'display' : 'headline'}
        tone={alerta ? 'danger' : 'primary'}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}>
        {value}
      </AppText>

      {delta ? (
        <View style={styles.delta}>
          <Ionicons name={iconeDelta} size={14} color={corDelta} />
          <AppText variant="caption" weight="600" style={{ color: corDelta }} numberOfLines={2}>
            {delta.texto}
            {palavra}
            {comparacao ? (
              <AppText variant="caption" tone="muted">
                {' '}
                {comparacao}
              </AppText>
            ) : null}
          </AppText>
        </View>
      ) : comparacao ? (
        <AppText variant="caption" tone="muted">
          sem base para comparar
        </AppText>
      ) : null}

      {mostrarAjuda && ajuda ? (
        <View
          style={[styles.ajuda, { backgroundColor: colors.bgSubtle, borderColor: colors.border }]}
          accessibilityLiveRegion="polite">
          <AppText variant="caption" tone="secondary">
            {ajuda}
          </AppText>
        </View>
      ) : null}
    </>
  );

  return (
    <View
      style={[
        styles.card,
        destaque && styles.cardDestaque,
        { backgroundColor: colors.surface, borderColor: alerta ? colors.danger : colors.border },
      ]}>
      {onPress ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={resumo}
          accessibilityHint={onPressHint}
          style={({ pressed }) => [styles.corpo, pressed && { opacity: 0.75 }]}>
          {conteudo}
          <Ionicons
            name="chevron-forward"
            size={16}
            color={colors.textMuted}
            style={styles.chevron}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
        </Pressable>
      ) : (
        <View style={styles.corpo} accessible accessibilityLabel={resumo}>
          {conteudo}
        </View>
      )}
      {ajuda ? (
        <IconButton
          icon={mostrarAjuda ? 'close-circle-outline' : 'information-circle-outline'}
          size="sm"
          accessibilityLabel={mostrarAjuda ? `Fechar explicação de ${title}` : `O que é ${title}?`}
          onPress={() => setMostrarAjuda((v) => !v)}
          selected={false}
          style={styles.info}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexGrow: 1,
    flexBasis: 150,
    minWidth: 150,
    borderWidth: 1,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  cardDestaque: {
    flexBasis: 220,
  },
  corpo: {
    padding: Spacing[3],
    paddingRight: Layout.minTouch - Spacing[1],
    gap: Spacing[1],
    minHeight: Layout.minTouch,
  },
  faixa: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
  },
  topo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[1.5],
  },
  titulo: {
    flexShrink: 1,
  },
  delta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[1],
  },
  ajuda: {
    marginTop: Spacing[1],
    padding: Spacing[2],
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
  info: {
    position: 'absolute',
    top: Spacing[1],
    right: Spacing[1],
  },
  chevron: {
    position: 'absolute',
    right: Spacing[3],
    bottom: Spacing[3],
  },
});
