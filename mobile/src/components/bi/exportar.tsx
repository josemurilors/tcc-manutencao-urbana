/**
 * Folha "Exportar": planilha dos chamados do recorte (CSV/XLSX) e relatório
 * executivo mensal em PDF. É o que a prefeitura anexa em ofício à Câmara,
 * prestação de contas e resposta de LAI — por isso fica no topo do painel.
 *
 * O arquivo é baixado e entregue à folha de compartilhar do sistema (no web,
 * ao download do navegador), como a Ordem de Serviço.
 */

import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { FilterChips } from '@/components/ui/chips';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { ListItem } from '@/components/ui/list-item';
import { AppText } from '@/components/ui/text';
import { Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import { useToast } from '@/context/toast-context';
import { apiBi } from '@/services/api-bi';
import type { BiFiltros } from '@/types/bi';

import { descreverPeriodo, fmtMes, mesAnterior, ultimosMeses } from './formato';

type Acao = 'csv' | 'xlsx' | 'pdf';

type Props = {
  visivel: boolean;
  onFechar: () => void;
  filtros: BiFiltros;
  /** Resumo dos recortes ativos ("Buraco · Centro"), para o rótulo. */
  recortes?: string;
};

export function FolhaExportar({ visivel, onFechar, filtros, recortes }: Props) {
  const colors = useColors();
  const toast = useToast();
  const [ocupado, setOcupado] = useState<Acao | null>(null);
  // Relatório do mês fechado mais recente por padrão: o mês corrente está pela metade.
  const [mes, setMes] = useState(mesAnterior);
  const meses = ultimosMeses(7);

  async function executar(acao: Acao) {
    if (ocupado) return;
    setOcupado(acao);
    try {
      if (acao === 'pdf') await apiBi.relatorio(filtros, mes);
      else await apiBi.exportar(filtros, acao);
      toast.success(acao === 'pdf' ? 'Relatório gerado.' : 'Planilha gerada.');
      onFechar();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível gerar o arquivo.', {
        action: { label: 'Tentar de novo', onPress: () => executar(acao) },
      });
    } finally {
      setOcupado(null);
    }
  }

  const periodo = descreverPeriodo(filtros.periodo, filtros.inicio, filtros.fim);

  return (
    <BottomSheet
      visible={visivel}
      onClose={onFechar}
      title="Exportar"
      description="Sem dados pessoais dos cidadãos (LGPD).">
      <View style={styles.bloco}>
        <AppText variant="label">Planilha de chamados</AppText>
        <AppText variant="caption" tone="muted">
          {periodo}
          {recortes ? ` · ${recortes}` : ''}
        </AppText>
      </View>
      <ListItem
        title="Excel (.xlsx)"
        subtitle="Uma linha por chamado, pronta para filtrar"
        leading="grid-outline"
        onPress={() => executar('xlsx')}
        trailing={ocupado === 'xlsx' ? <Carregando /> : undefined}
        disabled={!!ocupado}
        accessibilityHint="Baixa e abre as opções de compartilhar"
      />
      <ListItem
        title="CSV"
        subtitle="Para sistemas e portais de dados abertos"
        leading="document-text-outline"
        onPress={() => executar('csv')}
        trailing={ocupado === 'csv' ? <Carregando /> : undefined}
        disabled={!!ocupado}
        accessibilityHint="Baixa e abre as opções de compartilhar"
      />

      <View style={[styles.bloco, styles.separado, { borderTopColor: colors.border }]}>
        <AppText variant="label">Relatório executivo (PDF)</AppText>
        <AppText variant="caption" tone="muted">
          Indicadores do mês, comparação, gráficos e pontos de atenção.
        </AppText>
      </View>
      <View style={styles.meses}>
        <FilterChips
          options={meses.map((m, i) => ({ value: m, label: i === 0 ? `${fmtMes(m)} (parcial)` : fmtMes(m) }))}
          value={mes}
          onChange={setMes}
          accessibilityLabel="Mês do relatório"
        />
      </View>
      <ListItem
        title={`Relatório de ${fmtMes(mes)}`}
        subtitle={recortes ? `Recorte: ${recortes}` : 'Município inteiro'}
        leading="document-attach-outline"
        onPress={() => executar('pdf')}
        trailing={ocupado === 'pdf' ? <Carregando /> : undefined}
        disabled={!!ocupado}
        accessibilityHint="Gera o PDF e abre as opções de compartilhar"
      />
    </BottomSheet>
  );
}

function Carregando() {
  const colors = useColors();
  return (
    <View accessibilityLabel="Gerando arquivo" accessibilityRole="progressbar">
      <Ionicons name="hourglass-outline" size={20} color={colors.textSecondary} />
    </View>
  );
}

const styles = StyleSheet.create({
  bloco: {
    gap: Spacing[0.5],
  },
  separado: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing[3],
  },
  meses: {
    // Os chips têm o próprio respiro lateral; aqui encostam na borda da folha.
    marginHorizontal: -Spacing[4],
  },
});
