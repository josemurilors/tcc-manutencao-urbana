/**
 * Painel do roteiro do dia (aba Operação): próxima parada em destaque, com
 * navegação externa (Google Maps / Waze), e as paradas restantes.
 *
 * - O avanço é automático quando a parada atual é fechada (concluída ou
 *   rejeitada) — a tela observa a fila.
 * - "Pular" pede o motivo (sem acesso, falta material, outra equipe, já
 *   resolvido, não localizado). Os dois últimos viram nota interna no chamado,
 *   para a gestão saber o que a equipe viu no local.
 * - Montar o roteiro **não** assume os chamados: assumir é decisão por parada,
 *   na ficha — assim ninguém "segura" 25 chamados o dia inteiro.
 */

import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { OpcoesRadio } from '@/components/operacao/campos';
import { MOTIVOS_PULO, nomeCategoria, slaDe } from '@/components/operacao/regras';
import { Badge } from '@/components/ui/badge';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { AppText } from '@/components/ui/text';
import { Elevation, Layout, Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import type { MotivoPulo, RoteiroSalvo } from '@/services/operacao-offline';
import type { ChamadoFila } from '@/types/operacao';
import { formatarDistancia } from '@/utils/geo';
import { navegarGoogleMaps, navegarWaze } from '@/utils/navegacao';

export type Roteiro = RoteiroSalvo;

type Props = {
  roteiro: Roteiro;
  icones: Map<string, string>;
  /** Posição do operador, origem da navegação externa. */
  origem: { latitude: number; longitude: number } | null;
  /** Ids com ação esperando rede. */
  pendentes: Set<string>;
  onAbrir: (chamado: ChamadoFila) => void;
  onPular: (motivo: MotivoPulo) => void;
  onFechar: () => void;
};

function formatarDuracao(segundos: number | null) {
  if (segundos == null) return null;
  const min = Math.round(segundos / 60);
  if (min < 60) return `~${min} min`;
  const h = Math.floor(min / 60);
  return `~${h}h${String(min % 60).padStart(2, '0')}`;
}

export function RoteiroPanel({ roteiro, icones, origem, pendentes, onAbrir, onPular, onFechar }: Props) {
  const colors = useColors();
  const [pulando, setPulando] = useState(false);
  const [motivo, setMotivo] = useState<MotivoPulo | null>(null);

  const { paradas, atual } = roteiro;
  const feitas = new Set(roteiro.concluidas);
  const proxima = paradas[atual];
  const restantes = paradas.filter((p, i) => i > atual && !feitas.has(String(p.id)));
  const duracao = formatarDuracao(roteiro.duracaoS);
  const nPuladas = Object.keys(roteiro.puladas).length;
  const slaProxima = proxima ? slaDe(proxima) : null;

  return (
    <View
      style={[styles.painel, Elevation.md, { backgroundColor: colors.surface, borderColor: colors.primary }]}
      accessibilityLabel="Roteiro do dia">
      <View style={styles.cabecalho}>
        <Ionicons name="navigate" size={18} color={colors.primaryText} />
        <View style={styles.flex}>
          <AppText variant="label">
            Roteiro do dia · {feitas.size}/{paradas.length}
          </AppText>
          <AppText variant="caption" tone="muted">
            {formatarDistancia(roteiro.distanciaM)}
            {duracao ? ` · ${duracao}` : ''}
            {roteiro.fonte === 'ruas' ? ' · por ruas' : ' · em linha reta'}
            {nPuladas > 0 ? ` · ${nPuladas} pulada${nPuladas === 1 ? '' : 's'}` : ''}
          </AppText>
        </View>
        <IconButton icon="close" accessibilityLabel="Encerrar roteiro" onPress={onFechar} />
      </View>

      {proxima ? (
        <View style={[styles.atual, { backgroundColor: colors.surfaceRaised }]}>
          <Pressable
            style={styles.atualLinha}
            onPress={() => onAbrir(proxima)}
            accessibilityRole="button"
            accessibilityLabel={`Parada ${atual + 1}: ${nomeCategoria(proxima)}, ${proxima.rua ?? 'sem endereço'}. Abrir ficha`}>
            <View style={[styles.numero, { backgroundColor: colors.primary }]}>
              <AppText variant="caption" weight="700" style={{ color: colors.onPrimary }}>
                {atual + 1}
              </AppText>
            </View>
            <AppText style={styles.emoji}>{icones.get(nomeCategoria(proxima)) ?? '📋'}</AppText>
            <View style={styles.flex}>
              <AppText variant="label" numberOfLines={1}>
                {nomeCategoria(proxima)}
              </AppText>
              <AppText variant="caption" tone="muted" numberOfLines={1}>
                {[proxima.rua, proxima.bairro].filter(Boolean).join(' · ') || 'Sem endereço'}
              </AppText>
            </View>
          </Pressable>
          <View style={styles.selos}>
            {slaProxima ? <Badge label={slaProxima.texto} tone={slaProxima.tom} icon={slaProxima.icone} /> : null}
            {pendentes.has(String(proxima.id)) ? <Badge label="Envio pendente" tone="info" icon="cloud-upload" /> : null}
          </View>
          <View style={styles.acoes}>
            <Button
              size="sm"
              onPress={() => navegarGoogleMaps(proxima, origem)}
              icon={<Ionicons name="navigate" size={16} color={colors.onPrimary} />}>
              Navegar
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onPress={() => navegarWaze(proxima)}
              icon={<Ionicons name="car" size={16} color={colors.textPrimary} />}>
              Waze
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onPress={() => onAbrir(proxima)}
              icon={<Ionicons name="document-text" size={16} color={colors.textPrimary} />}>
              Ficha
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onPress={() => {
                setMotivo(null);
                setPulando(true);
              }}>
              Pular
            </Button>
          </View>
        </View>
      ) : (
        <View style={[styles.atual, { backgroundColor: colors.surfaceRaised }]}>
          <View style={styles.atualLinha}>
            <Ionicons name="checkmark-done-circle" size={22} color={colors.success} />
            <AppText variant="label">Roteiro concluído</AppText>
          </View>
          <AppText variant="caption" tone="secondary">
            Todas as paradas foram atendidas ou puladas. Encerre para voltar à fila.
          </AppText>
        </View>
      )}

      {restantes.length > 0 ? (
        <ScrollView style={styles.lista} contentContainerStyle={styles.listaConteudo}>
          {restantes.map((d) => {
            const numero = paradas.indexOf(d) + 1;
            const s = slaDe(d);
            return (
              <Pressable
                key={String(d.id)}
                onPress={() => onAbrir(d)}
                accessibilityRole="button"
                accessibilityLabel={`Parada ${numero}: ${nomeCategoria(d)}${d.rua ? `, ${d.rua}` : ''}${s ? `, ${s.texto}` : ''}`}
                style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.surfacePressed }]}>
                <AppText variant="caption" tone="muted" weight="600" style={styles.itemNumero}>
                  {numero}
                </AppText>
                <AppText style={styles.itemEmoji}>{icones.get(nomeCategoria(d)) ?? '📋'}</AppText>
                <AppText variant="caption" tone="secondary" numberOfLines={1} style={styles.flex}>
                  {nomeCategoria(d)}
                  {d.rua ? ` · ${d.rua}` : ''}
                </AppText>
                {s && s.tom !== 'success' ? <Ionicons name={s.icone} size={14} color={s.tom === 'danger' ? colors.danger : colors.warning} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <BottomSheet
        visible={pulando}
        onClose={() => setPulando(false)}
        title="Por que pular esta parada?"
        description="O motivo fica no roteiro; 'já resolvido' e 'não localizado' viram nota interna no chamado."
        footer={
          <Button
            block
            style={styles.flex}
            disabled={!motivo}
            onPress={() => {
              if (!motivo) return;
              setPulando(false);
              onPular(motivo);
            }}>
            Pular parada
          </Button>
        }>
        <OpcoesRadio rotulo="Motivo" opcoes={MOTIVOS_PULO} valor={motivo} onChange={setMotivo} />
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  painel: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingVertical: Spacing[2],
    gap: Spacing[2],
  },
  cabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    paddingLeft: Spacing[3],
    paddingRight: Spacing[1],
  },
  atual: {
    marginHorizontal: Spacing[2],
    padding: Spacing[3],
    borderRadius: Radius.md,
    gap: Spacing[2],
  },
  atualLinha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    minHeight: Layout.minTouch,
  },
  numero: {
    width: 28,
    height: 28,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 22,
    lineHeight: 28,
  },
  selos: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[1.5],
  },
  acoes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
  },
  lista: {
    maxHeight: 132,
  },
  listaConteudo: {
    paddingHorizontal: Spacing[2],
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    minHeight: Layout.minTouch,
    paddingHorizontal: Spacing[2],
    borderRadius: Radius.md,
  },
  itemNumero: {
    width: 18,
    textAlign: 'right',
  },
  itemEmoji: {
    fontSize: 16,
    lineHeight: 22,
  },
});
