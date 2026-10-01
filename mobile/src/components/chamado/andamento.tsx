/**
 * Bloco de transparência do chamado: protocolo, órgão responsável e prazo,
 * com barra de tempo consumido e atraso destacado (texto + ícone, nunca só
 * cor). É a pergunta que o cidadão faz ao abrir o chamado: "quem cuida disso
 * e quando fica pronto?".
 */

import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/text';
import { corDoTom, Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import type { Defeito } from '@/types';

import { lerPrazo } from './prazo';

type IconName = keyof typeof Ionicons.glyphMap;

function Linha({ icone, rotulo, valor }: { icone: IconName; rotulo: string; valor: string }) {
  const colors = useColors();
  return (
    <View style={styles.linha} accessible accessibilityLabel={`${rotulo}: ${valor}`}>
      <Ionicons name={icone} size={18} color={colors.textSecondary} />
      <View style={styles.textos}>
        <AppText variant="caption" tone="muted">
          {rotulo}
        </AppText>
        <AppText variant="bodySm" weight="600" selectable>
          {valor}
        </AppText>
      </View>
    </View>
  );
}

export function AndamentoChamado({ defeito }: { defeito: Defeito }) {
  const colors = useColors();
  const prazo = lerPrazo(defeito);
  const orgao = defeito.secretaria_nome || defeito.secretaria_responsavel;
  const tom = prazo ? corDoTom(colors, prazo.tom) : null;

  return (
    <View style={[styles.caixa, { backgroundColor: colors.bgSubtle, borderColor: colors.border }]}>
      {defeito.protocolo ? (
        <Linha icone="document-text-outline" rotulo="Protocolo" valor={defeito.protocolo} />
      ) : null}
      <Linha
        icone="business-outline"
        rotulo="Órgão responsável"
        valor={orgao || 'Aguardando encaminhamento'}
      />

      {prazo && tom ? (
        <View
          style={styles.prazo}
          accessible
          accessibilityLabel={`Prazo: ${prazo.titulo}${prazo.detalhe ? `. ${prazo.detalhe}` : ''}`}>
          <View style={styles.linha}>
            <Ionicons
              name={prazo.atrasado ? 'alert-circle' : prazo.tom === 'success' ? 'checkmark-circle' : 'time-outline'}
              size={18}
              color={tom.fg}
            />
            <View style={styles.textos}>
              <AppText variant="caption" tone="muted">
                Prazo
              </AppText>
              <AppText variant="bodySm" weight="700" style={{ color: tom.fg }}>
                {prazo.titulo}
              </AppText>
              {prazo.detalhe ? (
                <AppText variant="caption" tone="secondary">
                  {prazo.detalhe}
                </AppText>
              ) : null}
            </View>
          </View>
          {prazo.fracao !== null ? (
            <View
              style={[styles.trilho, { backgroundColor: colors.border }]}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants">
              <View
                style={[
                  styles.barra,
                  { width: `${Math.round(prazo.fracao * 100)}%`, backgroundColor: tom.fg },
                ]}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {defeito.reaberturas ? (
        <AppText variant="caption" tone="muted">
          Reaberto {defeito.reaberturas === 1 ? '1 vez' : `${defeito.reaberturas} vezes`}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  caixa: {
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing[3],
    gap: Spacing[3],
  },
  linha: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing[2],
  },
  textos: {
    flex: 1,
    gap: 2,
  },
  prazo: {
    gap: Spacing[2],
  },
  trilho: {
    height: 6,
    borderRadius: Radius.full,
    overflow: 'hidden',
    marginLeft: 26,
  },
  barra: {
    height: '100%',
    borderRadius: Radius.full,
  },
});
