/**
 * Campos reutilizados pelas folhas de ação da operação: opção única em lista,
 * checklist, respostas-padrão e foto de evidência com GPS.
 */

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { AppText } from '@/components/ui/text';
import { Layout, Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import { useToast } from '@/context/toast-context';
import type { RespostaPadrao } from '@/types/operacao';
import { ImagemMuitoGrandeError } from '@/utils/image';

import { capturarEvidencia, type Evidencia } from './evidencia';

type IconName = keyof typeof Ionicons.glyphMap;

/** Lista de opções de escolha única (motivo, prioridade...), com ajuda opcional. */
export function OpcoesRadio<T extends string>({
  opcoes,
  valor,
  onChange,
  rotulo,
}: {
  opcoes: { value: T; label: string; ajuda?: string; icone?: string }[];
  valor: T | null;
  onChange: (v: T) => void;
  rotulo: string;
}) {
  const colors = useColors();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={rotulo} style={styles.lista}>
      {opcoes.map((o) => {
        const ativo = o.value === valor;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: ativo, checked: ativo }}
            accessibilityLabel={o.ajuda ? `${o.label}. ${o.ajuda}` : o.label}
            style={({ pressed }) => [
              styles.opcao,
              {
                borderColor: ativo ? colors.primary : colors.border,
                backgroundColor: ativo ? colors.primarySubtle : pressed ? colors.surfacePressed : 'transparent',
              },
            ]}>
            <Ionicons
              name={(o.icone as IconName) ?? (ativo ? 'radio-button-on' : 'radio-button-off')}
              size={20}
              color={ativo ? colors.primaryText : colors.textSecondary}
            />
            <View style={styles.flex}>
              <AppText variant="label">{o.label}</AppText>
              {o.ajuda ? (
                <AppText variant="caption" tone="secondary">
                  {o.ajuda}
                </AppText>
              ) : null}
            </View>
            {ativo ? <Ionicons name="checkmark" size={18} color={colors.primaryText} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Checklist da categoria: cada item é uma caixa de seleção de 44 px. */
export function ChecklistCampo({
  itens,
  marcados,
  onChange,
}: {
  itens: string[];
  marcados: Set<string>;
  onChange: (m: Set<string>) => void;
}) {
  const colors = useColors();
  return (
    <View style={styles.lista}>
      {itens.map((item) => {
        const ok = marcados.has(item);
        return (
          <Pressable
            key={item}
            onPress={() => {
              const next = new Set(marcados);
              if (ok) next.delete(item);
              else next.add(item);
              onChange(next);
            }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: ok }}
            accessibilityLabel={item}
            style={({ pressed }) => [styles.check, pressed && { backgroundColor: colors.surfacePressed }]}>
            <Ionicons
              name={ok ? 'checkbox' : 'square-outline'}
              size={22}
              color={ok ? colors.success : colors.textSecondary}
            />
            <AppText variant="bodySm" style={styles.flex}>
              {item}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Atalhos de resposta pronta: tocar copia o texto para o campo (editável). */
export function RespostasPadraoChips({
  respostas,
  categoriaId,
  onEscolher,
}: {
  respostas: RespostaPadrao[];
  categoriaId?: number | null;
  onEscolher: (texto: string) => void;
}) {
  const colors = useColors();
  // As da categoria do chamado primeiro; as gerais (sem categoria) depois.
  const lista = respostas
    .filter((r) => r.categoria_id == null || r.categoria_id === categoriaId)
    .sort((a, b) => Number(b.categoria_id === categoriaId) - Number(a.categoria_id === categoriaId));
  if (lista.length === 0) return null;
  return (
    <View style={styles.respostas}>
      <AppText variant="caption" tone="secondary">
        Respostas prontas
      </AppText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {lista.map((r) => (
          <Pressable
            key={r.id}
            onPress={() => onEscolher(r.texto)}
            accessibilityRole="button"
            accessibilityLabel={`Usar resposta pronta: ${r.titulo}`}
            style={({ pressed }) => [
              styles.chip,
              { borderColor: colors.borderStrong, backgroundColor: pressed ? colors.surfacePressed : 'transparent' },
            ]}>
            <Ionicons name="chatbubble-ellipses" size={14} color={colors.textSecondary} />
            <AppText variant="caption" weight="600" inControl numberOfLines={1}>
              {r.titulo}
            </AppText>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

/** Botão de câmera + prévia da foto e do estado do GPS. */
export function FotoCampo({
  rotulo,
  evidencia,
  onChange,
  obrigatoria,
}: {
  rotulo: string;
  evidencia: Evidencia | null;
  onChange: (e: Evidencia | null) => void;
  obrigatoria?: boolean;
}) {
  const colors = useColors();
  const toast = useToast();
  const [abrindo, setAbrindo] = useState(false);

  async function capturar() {
    setAbrindo(true);
    try {
      const e = await capturarEvidencia();
      if (e) onChange(e);
    } catch (err) {
      toast.error(
        err instanceof ImagemMuitoGrandeError
          ? err.message
          : `Não foi possível usar a câmera: ${err instanceof Error ? err.message : 'erro desconhecido'}`,
      );
    } finally {
      setAbrindo(false);
    }
  }

  return (
    <View style={styles.foto}>
      <AppText variant="label">
        {rotulo}
        {obrigatoria ? ' (obrigatória)' : ' (opcional)'}
      </AppText>
      {evidencia ? (
        <View style={styles.previa}>
          <Image source={{ uri: evidencia.foto.uri }} style={styles.miniatura} contentFit="cover" />
          <View style={styles.flex}>
            <View style={styles.gps}>
              <Ionicons
                name={evidencia.local ? 'location' : 'location-outline'}
                size={16}
                color={evidencia.local ? colors.success : colors.warning}
              />
              <AppText variant="caption" tone={evidencia.local ? 'success' : 'warning'}>
                {evidencia.local ? 'Local registrado pelo GPS' : 'Sem GPS: a foto vai sem localização'}
              </AppText>
            </View>
            <Button size="sm" variant="ghost" onPress={capturar} loading={abrindo}>
              Tirar outra
            </Button>
          </View>
        </View>
      ) : (
        <Button
          variant="secondary"
          onPress={capturar}
          loading={abrindo}
          icon={<Ionicons name="camera" size={18} color={colors.textPrimary} />}>
          Abrir câmera
        </Button>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  lista: {
    gap: Spacing[1.5],
  },
  opcao: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    minHeight: Layout.minTouch + 4,
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
    borderWidth: 1,
    borderRadius: Radius.md,
  },
  check: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    minHeight: Layout.minTouch,
    paddingHorizontal: Spacing[1],
    borderRadius: Radius.md,
  },
  respostas: {
    gap: Spacing[1],
  },
  chips: {
    gap: Spacing[1.5],
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[1],
    minHeight: 40,
    maxWidth: 240,
    paddingHorizontal: Spacing[3],
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  foto: {
    gap: Spacing[2],
  },
  previa: {
    flexDirection: 'row',
    gap: Spacing[3],
    alignItems: 'center',
  },
  miniatura: {
    width: 88,
    height: 88,
    borderRadius: Radius.md,
  },
  gps: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[1],
  },
});
