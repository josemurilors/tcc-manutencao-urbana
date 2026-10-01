/**
 * Moldura da ficha de atendimento: o mesmo bottom sheet e as mesmas peças do
 * detalhe do cidadão (`DefectDetail`) — status, andamento, resposta pública,
 * local, descrição, histórico —, mas com **um único bloco de fotos**, o da
 * operação (`FotosChamado`: cidadão, antes e depois, com GPS e autor).
 *
 * O `DefectDetail` desenha a galeria do cidadão por conta própria; somada às
 * evidências da equipe, a ficha mostrava as mesmas fotos duas vezes.
 */

import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AndamentoChamado } from '@/components/chamado/andamento';
import { HistoricoChamado } from '@/components/chamado/historico';
import { RespostaPublica } from '@/components/chamado/resposta-publica';
import { StatusChamado } from '@/components/chamado/status-chamado';
import { IconButton } from '@/components/ui/icon-button';
import { AppText } from '@/components/ui/text';
import { Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import type { Defeito } from '@/types';
import { descreverSinalizacoes, formatarData, totalApoios } from '@/utils/format';

type Props = {
  defeito: Defeito;
  /** Selos, faixas e ações do dia a dia, logo abaixo do cabeçalho. */
  destaque?: React.ReactNode;
  /** O bloco de fotos, no lugar da galeria do cidadão. */
  fotos: React.ReactNode;
  onClose: () => void;
  /** Registro, gestão e as folhas de ação. */
  children?: React.ReactNode;
  /**
   * Desenha a ficha dentro da tela (painel direito da visão dividida, no
   * computador) em vez do bottom sheet sobre um `Modal`.
   */
  embutida?: boolean;
};

export function FichaDetalhe({ defeito, destaque, fotos, onClose, children, embutida }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
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

  const rolagem = (
    <ScrollView contentContainerStyle={styles.conteudo} showsVerticalScrollIndicator={false}>
      <View style={styles.corpo}>
        <View style={styles.cabecalho}>
          <View style={styles.cabecalhoTexto}>
            <AppText variant="title" numberOfLines={2} accessibilityRole="header">
              {defeito.titulo || categoria}
            </AppText>
            <View style={styles.linhaMeta}>
              <StatusChamado status={defeito.status} visao="operacao" />
              {defeito.autor_nome ? (
                <AppText variant="caption" tone="muted">
                  Aberto por {defeito.autor_nome}
                </AppText>
              ) : null}
            </View>
          </View>
          <IconButton icon="close" accessibilityLabel="Fechar ficha" onPress={onClose} />
        </View>

        {destaque}

        <AndamentoChamado defeito={defeito} />

        <RespostaPublica
          texto={defeito.resposta_publica}
          orgao={defeito.secretaria_nome || defeito.secretaria_responsavel}
        />

        {local || categoria ? (
          <View
            style={styles.linha}
            accessible
            accessibilityLabel={`Local: ${[categoria, local].filter(Boolean).join(', ')}`}>
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

        <AppText variant="label" tone="muted" style={styles.secao} accessibilityRole="header">
          Fotos
        </AppText>
        {fotos}

        {children}

        <AppText variant="label" tone="muted" style={styles.secao} accessibilityRole="header">
          Histórico
        </AppText>
        <HistoricoChamado defeito={defeito} visao="operacao" />

        <View style={styles.rodapeMeta}>
          <AppText variant="caption" tone="muted">
            Aberto em {formatarData(defeito.criado_em)}
          </AppText>
          {apoios > 0 ? (
            <View style={styles.linha}>
              <Ionicons name="people" size={14} color={colors.textMuted} />
              <AppText variant="caption" tone="muted">
                {apoios} {apoios === 1 ? 'apoio' : 'apoios'}
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
      </View>
    </ScrollView>
  );

  if (embutida) {
    return (
      <View
        style={[styles.embutida, { backgroundColor: colors.surface, paddingBottom: insets.bottom }]}
        accessibilityLabel="Ficha do chamado">
        {rolagem}
      </View>
    );
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={[styles.backdrop, { backgroundColor: colors.overlay }]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Fechar ficha"
      />
      <View
        style={[
          styles.sheet,
          { backgroundColor: colors.surface, borderColor: colors.borderGold, paddingBottom: insets.bottom + Spacing[4] },
        ]}>
        <View style={styles.puxador}>
          <View style={[styles.puxadorBarra, { backgroundColor: colors.borderHover }]} />
        </View>
        {rolagem}
      </View>
    </Modal>
  );
}

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
  embutida: {
    flex: 1,
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
