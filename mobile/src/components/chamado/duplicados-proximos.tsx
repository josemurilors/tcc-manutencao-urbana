/**
 * "Já reportado aqui?" — chamados perto do ponto, antes de enviar
 * (`GET /defeitos/proximos/`). Apoiar o existente concentra a demanda num
 * chamado só (que ganha prioridade na fila) em vez de espalhar o mesmo buraco
 * em cinco pinos; é a principal fonte de duplicados em apps de zeladoria.
 */

import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { AppText } from '@/components/ui/text';
import { statusAberto } from '@/constants/status';
import { Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import type { ChamadoProximo } from '@/types/cidadao';
import { formatarDistancia } from '@/utils/geo';

import { dataCurta } from './prazo';
import { StatusChamado } from './status-chamado';

export type EstadoProximos =
  | { tipo: 'carregando' }
  | { tipo: 'ok'; itens: ChamadoProximo[] }
  | { tipo: 'erro'; mensagem: string };

type Props = {
  estado: EstadoProximos;
  categoria: string | null;
  iconeDe: (categoria: string) => string;
  apoiando: string | null;
  onApoiar: (c: ChamadoProximo) => void;
  onVer: (c: ChamadoProximo) => void;
  onTentarDeNovo: () => void;
};

function mesmaCategoria(a: string | null, b: string) {
  return !!a && a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function DuplicadosProximos({
  estado,
  categoria,
  iconeDe,
  apoiando,
  onApoiar,
  onVer,
  onTentarDeNovo,
}: Props) {
  const colors = useColors();

  if (estado.tipo === 'carregando') {
    return (
      <View style={styles.linha} accessibilityLiveRegion="polite">
        <Ionicons name="search" size={16} color={colors.textSecondary} />
        <AppText variant="caption" tone="secondary">
          Procurando chamados já abertos por perto...
        </AppText>
      </View>
    );
  }

  if (estado.tipo === 'erro') {
    return (
      <View style={styles.linha}>
        <Ionicons name="cloud-offline-outline" size={16} color={colors.warning} />
        <AppText variant="caption" tone="secondary" style={styles.flex}>
          Não deu para conferir se já reportaram isto aqui. Você pode enviar mesmo assim.
        </AppText>
        <Button size="xs" variant="ghost" onPress={onTentarDeNovo}>
          Tentar de novo
        </Button>
      </View>
    );
  }

  if (estado.itens.length === 0) {
    return (
      <View style={styles.linha}>
        <Ionicons name="checkmark-circle-outline" size={16} color={colors.success} />
        <AppText variant="caption" tone="secondary">
          Ninguém reportou nada aqui ainda.
        </AppText>
      </View>
    );
  }

  // Mesma categoria primeiro (o provável duplicado), depois por distância.
  const itens = [...estado.itens].sort((a, b) => {
    const ma = mesmaCategoria(categoria, a.categoria) ? 0 : 1;
    const mb = mesmaCategoria(categoria, b.categoria) ? 0 : 1;
    return ma - mb || a.distancia_m - b.distancia_m;
  });

  return (
    <View style={[styles.caixa, { backgroundColor: colors.warningSubtle, borderColor: colors.warning }]}>
      <View style={styles.linha}>
        <Ionicons name="alert-circle" size={18} color={colors.warning} />
        <AppText variant="label" style={styles.flex} accessibilityRole="header">
          Já reportado por perto?
        </AppText>
      </View>
      <AppText variant="bodySm" tone="secondary">
        Se for o mesmo problema, apoie o chamado existente: ele ganha prioridade e você acompanha do mesmo jeito.
      </AppText>

      {itens.slice(0, 5).map((c) => {
        const aberto = statusAberto(c.status);
        const destaque = mesmaCategoria(categoria, c.categoria) && aberto;
        const meta = [
          `a ${formatarDistancia(c.distancia_m)}`,
          c.total_apoios > 0 ? `${c.total_apoios} ${c.total_apoios === 1 ? 'apoio' : 'apoios'}` : '',
          !aberto && c.resolvido_em ? `resolvido em ${dataCurta(c.resolvido_em)}` : '',
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <View
            key={String(c.id)}
            style={[
              styles.item,
              {
                backgroundColor: colors.surface,
                borderColor: destaque ? colors.primary : colors.border,
                borderWidth: destaque ? 2 : 1,
              },
            ]}>
            <View style={styles.linha}>
              <AppText style={styles.emoji} accessibilityElementsHidden importantForAccessibility="no">
                {iconeDe(c.categoria)}
              </AppText>
              <View style={styles.flex}>
                <AppText variant="label" numberOfLines={1}>
                  {c.categoria || c.titulo}
                </AppText>
                <AppText variant="caption" tone="muted">
                  {meta}
                </AppText>
              </View>
              <StatusChamado status={c.status} />
            </View>
            <View style={styles.acoes}>
              {aberto ? (
                <Button
                  size="sm"
                  variant={destaque ? 'primary' : 'secondary'}
                  onPress={() => onApoiar(c)}
                  loading={apoiando === String(c.id)}
                  disabled={apoiando !== null && apoiando !== String(c.id)}
                  accessibilityLabel={`É este. Apoiar ${c.categoria} a ${formatarDistancia(c.distancia_m)}`}
                  icon={
                    <Ionicons
                      name="thumbs-up-outline"
                      size={16}
                      color={destaque ? colors.onPrimary : colors.textPrimary}
                    />
                  }>
                  É este? Apoiar
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                onPress={() => onVer(c)}
                accessibilityLabel={`Ver chamado ${c.categoria}${c.protocolo ? `, protocolo ${c.protocolo}` : ''}`}>
                Ver chamado
              </Button>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  caixa: {
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing[3],
    gap: Spacing[2],
  },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
  flex: {
    flex: 1,
  },
  item: {
    borderRadius: Radius.md,
    padding: Spacing[3],
    gap: Spacing[2],
  },
  emoji: {
    fontSize: 24,
    lineHeight: 30,
  },
  acoes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
  },
});
