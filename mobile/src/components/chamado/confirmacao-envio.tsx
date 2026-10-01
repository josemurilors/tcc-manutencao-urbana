/**
 * Confirmação depois de reportar: protocolo, órgão responsável e prazo
 * previsto, com "Acompanhar". Antes era só um toast "+10 XP" e voltar ao
 * mapa — a pessoa perdia o vínculo com o que tinha acabado de abrir.
 */

import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { AppText } from '@/components/ui/text';
import { Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import type { Defeito } from '@/types';

import { dataCurta } from './prazo';

type Props =
  | {
      tipo: 'enviado';
      defeito: Defeito;
      onAcompanhar: () => void;
      onCompartilhar: () => void;
      onVoltar: () => void;
    }
  | { tipo: 'offline'; mensagem: string; onVoltar: () => void };

function Info({ icone, rotulo, valor }: { icone: keyof typeof Ionicons.glyphMap; rotulo: string; valor: string }) {
  const colors = useColors();
  return (
    <View style={styles.info} accessible accessibilityLabel={`${rotulo}: ${valor}`}>
      <Ionicons name={icone} size={20} color={colors.textSecondary} />
      <View style={styles.flex}>
        <AppText variant="caption" tone="muted">
          {rotulo}
        </AppText>
        <AppText variant="body" weight="600">
          {valor}
        </AppText>
      </View>
    </View>
  );
}

export function ConfirmacaoEnvio(props: Props) {
  const colors = useColors();

  if (props.tipo === 'offline') {
    return (
      <View style={styles.container}>
        <View style={[styles.selo, { backgroundColor: colors.warningSubtle }]}>
          <Ionicons name="cloud-upload-outline" size={44} color={colors.warning} />
        </View>
        <AppText variant="headline" align="center" accessibilityRole="header">
          Chamado guardado no aparelho
        </AppText>
        <AppText variant="body" tone="secondary" align="center">
          {props.mensagem} O protocolo aparece em Meus chamados assim que ele for enviado.
        </AppText>
        <Button block onPress={props.onVoltar}>
          Voltar ao mapa
        </Button>
      </View>
    );
  }

  const d = props.defeito;
  const orgao = d.secretaria_nome || d.secretaria_responsavel;
  const prazo = d.prazo_em
    ? `Até ${dataCurta(d.prazo_em)}${d.prazo_sla_dias ? ` (${d.prazo_sla_dias} ${d.prazo_sla_dias === 1 ? 'dia' : 'dias'})` : ''}`
    : d.prazo_sla_dias
      ? `${d.prazo_sla_dias} dias`
      : 'Definido na triagem da prefeitura';

  return (
    <View style={styles.container}>
      <View style={[styles.selo, { backgroundColor: colors.successSubtle }]}>
        <Ionicons name="checkmark-circle" size={48} color={colors.success} />
      </View>
      <AppText variant="headline" align="center" accessibilityRole="header">
        Chamado enviado!
      </AppText>
      <AppText variant="body" tone="secondary" align="center">
        A prefeitura recebeu seu pedido. Você acompanha cada etapa por aqui.
      </AppText>

      {d.protocolo ? (
        <View
          style={[styles.protocolo, { borderColor: colors.primary, backgroundColor: colors.primarySubtle }]}
          accessible
          accessibilityLabel={`Protocolo ${d.protocolo}`}>
          <AppText variant="caption" tone="secondary" align="center">
            PROTOCOLO
          </AppText>
          <AppText variant="display" align="center" selectable style={styles.mono}>
            {d.protocolo}
          </AppText>
          <AppText variant="caption" tone="muted" align="center">
            Guarde este número para consultar quando quiser.
          </AppText>
        </View>
      ) : null}

      <View style={[styles.cartao, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <Info icone="pricetag-outline" rotulo="Problema" valor={d.categoria || d.categoria_nome || d.titulo} />
        <Info icone="business-outline" rotulo="Órgão responsável" valor={orgao || 'Em encaminhamento'} />
        <Info icone="time-outline" rotulo="Prazo previsto" valor={prazo} />
      </View>

      <View style={styles.acoes}>
        <Button block onPress={props.onAcompanhar} icon={<Ionicons name="eye-outline" size={18} color={colors.onPrimary} />}>
          Acompanhar chamado
        </Button>
        <Button
          block
          variant="secondary"
          onPress={props.onCompartilhar}
          icon={<Ionicons name="share-social-outline" size={18} color={colors.textPrimary} />}>
          Compartilhar com vizinhos
        </Button>
        <Button block variant="ghost" onPress={props.onVoltar}>
          Voltar ao mapa
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing[4],
    alignItems: 'stretch',
    paddingVertical: Spacing[4],
  },
  selo: {
    alignSelf: 'center',
    width: 88,
    height: 88,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  protocolo: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing[4],
    gap: Spacing[1],
  },
  mono: {
    letterSpacing: 1,
    fontVariant: ['tabular-nums'],
  },
  cartao: {
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing[4],
    gap: Spacing[3],
  },
  info: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing[3],
  },
  flex: {
    flex: 1,
  },
  acoes: {
    gap: Spacing[2],
  },
});
