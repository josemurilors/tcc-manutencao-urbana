/**
 * Casca do detalhe de chamado em bottom sheet: modal, puxador, cabeçalho com
 * status, descrição, fotos, histórico e metadados.
 *
 * As ações ficam de fora de propósito — o sheet do cidadão
 * (`defect-sheet.tsx`) e o do operador (`operacao-sheet.tsx`) mostram o mesmo
 * conteúdo, mas com botões completamente diferentes; cada um passa os seus
 * como `children`.
 */

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ImageViewer } from '@/components/ui/image-viewer';
import { StatusBadge } from '@/components/ui/status-badge';
import { Timeline } from '@/components/ui/timeline';
import { FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import type { Defeito } from '@/types';
import {
  concluidoEm,
  descreverSinalizacoes,
  formatarData,
  maskName,
  parseImagensExtra,
  totalApoios,
} from '@/utils/format';
import { getTimelineItems } from '@/utils/timeline';

type Props = {
  defeito: Defeito;
  onClose: () => void;
  /** Como chamar os apoios no rodapé ("confirmações" no mapa, "apoios" na lista). */
  rotuloApoios?: 'apoios' | 'confirmacoes';
  /** Faixa opcional logo abaixo do cabeçalho (ex.: alerta de SLA do operador). */
  destaque?: React.ReactNode;
  /** Barra de ações, específica de cada papel. */
  children?: React.ReactNode;
};

export function DefectDetail({ defeito, onClose, rotuloApoios, destaque, children }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [imagemAberta, setImagemAberta] = useState<string | null>(null);

  const imagensExtra = parseImagensExtra(defeito.imagens_extra);
  const apoios = totalApoios(defeito);
  const sinalizacoes = descreverSinalizacoes(defeito);

  return (
    <>
      <Modal visible transparent animationType="slide" onRequestClose={onClose}>
        <Pressable
          style={[styles.backdrop, { backgroundColor: colors.overlay }]}
          onPress={onClose}
          accessibilityLabel="Fechar detalhes"
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.bgSurface,
              borderColor: colors.borderGold,
              paddingBottom: insets.bottom + Spacing[4],
            },
          ]}>
          <View style={styles.puxador}>
            <View style={[styles.puxadorBarra, { backgroundColor: colors.borderHover }]} />
          </View>

          <ScrollView contentContainerStyle={styles.conteudo} showsVerticalScrollIndicator={false}>
            <View style={styles.cabecalho}>
              <View style={styles.cabecalhoTexto}>
                <Text style={[styles.titulo, { color: colors.textPrimary }]} numberOfLines={2}>
                  {defeito.titulo}
                </Text>
                <View style={styles.linhaMeta}>
                  <StatusBadge status={defeito.status} concluidoEm={concluidoEm(defeito)} />
                  <Text style={[styles.meta, { color: colors.textMuted }]}>
                    {defeito.autor_nome || maskName(defeito.usuario?.nome)}
                  </Text>
                </View>
              </View>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Fechar"
                hitSlop={8}>
                <Ionicons name="close" size={20} color={colors.textMuted} />
              </Pressable>
            </View>

            {destaque}

            {defeito.descricao ? (
              <Text style={[styles.descricao, { color: colors.textSecondary }]}>
                {defeito.descricao}
              </Text>
            ) : null}

            {defeito.categoria || defeito.bairro ? (
              <Text style={[styles.meta, { color: colors.textMuted }]}>
                {[
                  defeito.categoria,
                  defeito.rua,
                  defeito.bairro,
                  defeito.municipio
                    ? `${defeito.municipio.nome}/${defeito.municipio.uf_sigla}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            ) : null}

            {defeito.imagem_thumbnail ? (
              <Pressable onPress={() => setImagemAberta(defeito.imagem_thumbnail!)}>
                <Image
                  source={{ uri: defeito.imagem_thumbnail }}
                  style={styles.imagem}
                  contentFit="cover"
                  transition={150}
                />
              </Pressable>
            ) : null}

            {imagensExtra.map((url) => (
              <Pressable key={url} onPress={() => setImagemAberta(url)}>
                <Image
                  source={{ uri: url }}
                  style={styles.imagem}
                  contentFit="cover"
                  transition={150}
                />
              </Pressable>
            ))}

            <Text style={[styles.secao, { color: colors.textMuted }]}>Histórico</Text>
            <Timeline items={getTimelineItems(defeito)} />

            <View style={styles.rodapeMeta}>
              <Text style={[styles.meta, { color: colors.textMuted }]}>
                {formatarData(defeito.criado_em)}
              </Text>
              {apoios > 0 ? (
                <View style={styles.apoios}>
                  <Ionicons
                    name={rotuloApoios === 'confirmacoes' ? 'checkmark-circle' : 'thumbs-up'}
                    size={12}
                    color={colors.textMuted}
                  />
                  <Text style={[styles.meta, { color: colors.textMuted }]}>
                    {apoios}
                    {rotuloApoios === 'confirmacoes'
                      ? apoios === 1
                        ? ' confirmação'
                        : ' confirmações'
                      : rotuloApoios === 'apoios'
                        ? apoios === 1
                          ? ' apoio'
                          : ' apoios'
                        : ''}
                  </Text>
                </View>
              ) : null}
            </View>

            {sinalizacoes ? (
              <View style={styles.apoios}>
                <Ionicons name="flag" size={12} color={colors.warning} />
                <Text style={[styles.meta, { color: colors.textMuted }]}>{sinalizacoes}</Text>
              </View>
            ) : null}

            {children ? <View style={detailStyles.acoes}>{children}</View> : null}
          </ScrollView>
        </View>
      </Modal>

      <ImageViewer uri={imagemAberta} onClose={() => setImagemAberta(null)} />
    </>
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
    maxHeight: '85%',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
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
    gap: Spacing[3],
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
  titulo: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
  },
  linhaMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    flexWrap: 'wrap',
  },
  meta: {
    fontSize: FontSize.xs,
  },
  descricao: {
    fontSize: FontSize.sm,
    lineHeight: 20,
  },
  imagem: {
    width: '100%',
    height: 160,
    borderRadius: Radius.md,
  },
  secao: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: Spacing[2],
  },
  rodapeMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
  },
  apoios: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[1],
  },
});
