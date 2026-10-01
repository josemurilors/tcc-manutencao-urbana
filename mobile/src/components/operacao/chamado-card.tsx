/**
 * Cartão da fila de operação.
 *
 * O que o operador precisa para decidir em um olhar: categoria e endereço,
 * protocolo, situação, SLA restante (texto + ícone + cor), score de
 * prioridade, apoios, sinalizações de cidadãos, quem está com o chamado e a
 * distância. Toque abre a ficha; toque longo entra na seleção em lote.
 */

import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { AppText } from '@/components/ui/text';
import { rotuloOperacao } from '@/constants/status';
import { corDoStatus, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import type { ChamadoFila } from '@/types/operacao';
import { formatarDistancia } from '@/utils/geo';

import { identificador, nomeCategoria, slaDe, tomDoScore } from './regras';

type Props = {
  chamado: ChamadoFila;
  icone?: string;
  meuId: string | null;
  /** Há ação deste chamado esperando rede. */
  pendente: boolean;
  modoSelecao: boolean;
  selecionado: boolean;
  onPress: (c: ChamadoFila) => void;
  onLongPress: (c: ChamadoFila) => void;
};

function quemAtende(c: ChamadoFila, meuId: string | null) {
  if (c.atendente_id != null && String(c.atendente_id) === meuId) return 'Com você';
  if (c.atendente_nome) return c.atendente_nome;
  if (c.atendente_id != null || c.tem_atendente) return 'Outro servidor';
  if (c.equipe_nome) return `Equipe ${c.equipe_nome}`;
  return 'Sem responsável';
}

function ChamadoCardBase({
  chamado: c,
  icone,
  meuId,
  pendente,
  modoSelecao,
  selecionado,
  onPress,
  onLongPress,
}: Props) {
  const colors = useColors();
  const sla = slaDe(c);
  const apoios = c.total_apoios ?? c.apoios_total ?? 0;
  const sinal =
    (c.total_resolvido ?? c.sinalizacoes?.resolvido ?? 0) + (c.total_nao_existe ?? c.sinalizacoes?.nao_existe ?? 0);
  const responsavel = quemAtende(c, meuId);
  const endereco = [c.rua, c.bairro].filter(Boolean).join(' · ');
  const comigo = responsavel === 'Com você';

  const resumoFalado = [
    nomeCategoria(c),
    endereco,
    identificador(c),
    rotuloOperacao(c.status),
    sla?.texto,
    c.score != null ? `prioridade ${Math.round(c.score)}` : null,
    apoios ? `${apoios} apoios` : null,
    sinal ? `${sinal} sinalizações de cidadãos` : null,
    responsavel,
    c.distancia_m != null ? formatarDistancia(c.distancia_m) : null,
    pendente ? 'envio pendente' : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Card
      onPress={() => onPress(c)}
      onLongPress={() => onLongPress(c)}
      selected={modoSelecao ? selecionado : undefined}
      accessibilityLabel={resumoFalado}
      accessibilityHint={modoSelecao ? 'Marca ou desmarca para ação em lote' : 'Abre a ficha de atendimento'}
      padding={Spacing[3]}>
      <View style={styles.topo}>
        {modoSelecao ? (
          <Ionicons
            name={selecionado ? 'checkbox' : 'square-outline'}
            size={22}
            color={selecionado ? colors.primaryText : colors.textMuted}
          />
        ) : null}
        <AppText style={styles.emoji} accessibilityElementsHidden importantForAccessibility="no">
          {icone ?? '📋'}
        </AppText>
        <View style={styles.titulos}>
          <AppText variant="label" numberOfLines={1}>
            {nomeCategoria(c)}
          </AppText>
          <AppText variant="caption" tone="secondary" numberOfLines={1}>
            {endereco || 'Sem endereço'}
          </AppText>
        </View>
        {c.score != null ? (
          <Badge label={`Prioridade ${Math.round(c.score)}`} tone={tomDoScore(c.score)} icon="flame" />
        ) : null}
      </View>

      <View style={styles.selos}>
        <Badge label={rotuloOperacao(c.status)} color={corDoStatus(colors, c.status)} icon="ellipse" />
        {sla ? <Badge label={sla.texto} tone={sla.tom} icon={sla.icone} /> : null}
        {pendente ? <Badge label="Envio pendente" tone="info" icon="cloud-upload" /> : null}
      </View>

      <View style={styles.meta}>
        <Meta icone="pricetag" texto={identificador(c)} />
        <Meta icone={comigo ? 'person' : 'person-outline'} texto={responsavel} destaque={comigo} />
        {apoios > 0 ? <Meta icone="thumbs-up" texto={String(apoios)} /> : null}
        {sinal > 0 ? <Meta icone="flag" texto={`${sinal} sinalizaç${sinal === 1 ? 'ão' : 'ões'}`} aviso /> : null}
        {c.distancia_m != null ? <Meta icone="navigate" texto={formatarDistancia(c.distancia_m)} /> : null}
      </View>
    </Card>
  );
}

function Meta({
  icone,
  texto,
  destaque,
  aviso,
}: {
  icone: keyof typeof Ionicons.glyphMap;
  texto: string;
  destaque?: boolean;
  aviso?: boolean;
}) {
  const colors = useColors();
  const cor = aviso ? colors.warning : destaque ? colors.primaryText : colors.textMuted;
  return (
    <View style={styles.metaItem}>
      <Ionicons name={icone} size={14} color={cor} />
      <AppText variant="caption" style={{ color: cor }} numberOfLines={1}>
        {texto}
      </AppText>
    </View>
  );
}

export const ChamadoCard = memo(ChamadoCardBase);

const styles = StyleSheet.create({
  topo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
  emoji: {
    fontSize: 22,
    lineHeight: 28,
  },
  titulos: {
    flex: 1,
    gap: Spacing[0.5],
  },
  selos: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[1.5],
  },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: Spacing[3],
    rowGap: Spacing[1],
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[1],
    maxWidth: '100%',
  },
});
