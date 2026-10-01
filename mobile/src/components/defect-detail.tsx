/**
 * Detalhe do chamado.
 *
 * `DefectDetailBody` é o conteúdo (cabeçalho com status, transparência —
 * protocolo, órgão, prazo —, resposta da prefeitura, fotos de antes/depois e
 * histórico real); `DefectDetail` o embrulha no bottom sheet usado pelo mapa,
 * pela lista e pela operação. A página `/chamado/[id]` usa o corpo direto,
 * em tela cheia.
 *
 * As ações ficam de fora de propósito — o cidadão (`defect-sheet.tsx`) e o
 * operador (`operacao-sheet.tsx`) veem o mesmo conteúdo com botões
 * completamente diferentes; cada um passa os seus como `children`.
 */

import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AndamentoChamado } from '@/components/chamado/andamento';
import { FotosDoChamado } from '@/components/chamado/fotos';
import { HistoricoChamado } from '@/components/chamado/historico';
import { RespostaPublica } from '@/components/chamado/resposta-publica';
import { StatusChamado } from '@/components/chamado/status-chamado';
import { IconButton } from '@/components/ui/icon-button';
import { AppText } from '@/components/ui/text';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import type { Defeito } from '@/types';
import type { ChamadoDetalhe } from '@/types/cidadao';
import { descreverSinalizacoes, formatarData, totalApoios } from '@/utils/format';
import type { VisaoTimeline } from '@/utils/timeline';

type BodyProps = {
  defeito: Defeito;
  /** Como chamar os apoios no rodapé ("confirmações" no mapa, "apoios" na lista). */
  rotuloApoios?: 'apoios' | 'confirmacoes';
  /** Faixa opcional logo abaixo do cabeçalho (ex.: alerta de SLA do operador). */
  destaque?: React.ReactNode;
  /** Bloco logo após o andamento (ex.: avaliação do autor na página do chamado). */
  aposAndamento?: React.ReactNode;
  /** Rótulos de status e histórico: do cidadão (padrão) ou da equipe. */
  visao?: VisaoTimeline;
  /** Botão de fechar no cabeçalho (só no sheet). */
  onClose?: () => void;
  /** Barra de ações, específica de cada papel. */
  children?: React.ReactNode;
};

export function DefectDetailBody({
  defeito,
  rotuloApoios,
  destaque,
  aposAndamento,
  visao = 'cidadao',
  onClose,
  children,
}: BodyProps) {
  const colors = useColors();
  const detalhe = defeito as ChamadoDetalhe;
  const apoios = totalApoios(defeito);
  const sinalizacoes = descreverSinalizacoes(defeito);
  const categoria = defeito.categoria || defeito.categoria_nome;
  const local = [
    defeito.rua,
    defeito.bairro,
    defeito.municipio ? `${defeito.municipio.nome}/${defeito.municipio.uf_sigla}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const rotuloContagem =
    rotuloApoios === 'confirmacoes'
      ? apoios === 1
        ? 'confirmação'
        : 'confirmações'
      : apoios === 1
        ? 'apoio'
        : 'apoios';

  return (
    <View style={styles.corpo}>
      <View style={styles.cabecalho}>
        <View style={styles.cabecalhoTexto}>
          <AppText variant="title" numberOfLines={2} accessibilityRole="header">
            {defeito.titulo || categoria}
          </AppText>
          <View style={styles.linhaMeta}>
            <StatusChamado status={defeito.status} visao={visao} />
            {defeito.autor_nome ? (
              <AppText variant="caption" tone="muted">
                Aberto por {defeito.autor_nome}
              </AppText>
            ) : null}
          </View>
        </View>
        {onClose ? <IconButton icon="close" accessibilityLabel="Fechar detalhes" onPress={onClose} /> : null}
      </View>

      {destaque}

      <AndamentoChamado defeito={defeito} />

      {aposAndamento}

      <RespostaPublica
        texto={defeito.resposta_publica}
        orgao={defeito.secretaria_nome || defeito.secretaria_responsavel}
      />

      {local || categoria ? (
        <View style={styles.linha} accessible accessibilityLabel={`Local: ${[categoria, local].filter(Boolean).join(', ')}`}>
          <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
          <AppText variant="bodySm" tone="secondary" style={styles.flex}>
            {[categoria, local].filter(Boolean).join(' · ')}
          </AppText>
        </View>
      ) : null}

      {defeito.descricao ? (
        <AppText variant="body" tone="secondary">
          {defeito.descricao}
        </AppText>
      ) : null}

      <FotosDoChamado defeito={detalhe} />

      <AppText variant="label" tone="muted" style={styles.secao} accessibilityRole="header">
        Histórico
      </AppText>
      <HistoricoChamado defeito={defeito} visao={visao} />

      <View style={styles.rodapeMeta}>
        <AppText variant="caption" tone="muted">
          Aberto em {formatarData(defeito.criado_em)}
        </AppText>
        {apoios > 0 ? (
          <View style={styles.linha}>
            <Ionicons
              name={rotuloApoios === 'confirmacoes' ? 'checkmark-circle' : 'people'}
              size={14}
              color={colors.textMuted}
            />
            <AppText variant="caption" tone="muted">
              {apoios} {rotuloContagem}
            </AppText>
          </View>
        ) : null}
      </View>

      {sinalizacoes ? (
        <View style={styles.linha}>
          <Ionicons name="flag" size={14} color={colors.warning} />
          <AppText variant="caption" tone="muted">
            {sinalizacoes}
          </AppText>
        </View>
      ) : null}

      {children ? <View style={detailStyles.acoes}>{children}</View> : null}
    </View>
  );
}

type Props = Omit<BodyProps, 'onClose' | 'aposAndamento'> & {
  onClose: () => void;
};

export function DefectDetail({ onClose, ...props }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={[styles.backdrop, { backgroundColor: colors.overlay }]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Fechar detalhes"
      />
      <View
        style={[
          styles.sheet,
          {
            backgroundColor: colors.surface,
            borderColor: colors.borderGold,
            paddingBottom: insets.bottom + Spacing[4],
          },
        ]}>
        <View style={styles.puxador}>
          <View style={[styles.puxadorBarra, { backgroundColor: colors.borderHover }]} />
        </View>

        <ScrollView contentContainerStyle={styles.conteudo} showsVerticalScrollIndicator={false}>
          <DefectDetailBody {...props} onClose={onClose} />
        </ScrollView>
      </View>
    </Modal>
  );
}

/** Estilos da barra de ações, compartilhados pelos dois sheets. */
export const detailStyles = StyleSheet.create({
  acoes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
  },
  aviso: {
    fontSize: FontSize.xs,
  },
});

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '88%',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
  },
  puxador: {
    alignItems: 'center',
    paddingTop: Spacing[2],
  },
  puxadorBarra: {
    width: 36,
    height: 4,
    borderRadius: Radius.full,
  },
  conteudo: {
    padding: Spacing[5],
    paddingTop: Spacing[3],
  },
  corpo: {
    gap: Spacing[3],
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
  cabecalho: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing[3],
  },
  cabecalhoTexto: {
    flex: 1,
    gap: Spacing[2],
  },
  linhaMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    flexWrap: 'wrap',
  },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[1.5],
  },
  flex: {
    flex: 1,
  },
  secao: {
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: Spacing[2],
  },
  rodapeMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing[3],
  },
});
