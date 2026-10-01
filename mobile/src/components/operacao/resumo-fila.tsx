/**
 * Resumo no topo da fila: contadores que também são atalhos de filtro.
 *
 * Cada contador é um botão de alternância — tocar aplica o recorte, tocar de
 * novo volta à fila inteira. Ícone + rótulo + número, nunca só cor.
 */

import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/text';
import { corDoTom, Layout, Radius, Spacing, type Tom } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import type { FiltrosFila, ResumoFila } from '@/types/operacao';

export type AtalhoResumo = 'meus' | 'vencidos' | 'vencem_24h' | 'sem_atribuicao' | 'sinalizados';

const ATALHOS: {
  chave: AtalhoResumo;
  rotulo: string;
  icone: keyof typeof Ionicons.glyphMap;
  tom: Tom;
}[] = [
  { chave: 'meus', rotulo: 'Meus', icone: 'person', tom: 'primary' },
  { chave: 'vencidos', rotulo: 'Vencidos', icone: 'alarm', tom: 'danger' },
  { chave: 'vencem_24h', rotulo: 'Vencem em 24 h', icone: 'time', tom: 'warning' },
  { chave: 'sem_atribuicao', rotulo: 'Sem responsável', icone: 'person-add', tom: 'info' },
  { chave: 'sinalizados', rotulo: 'Sinalizados', icone: 'flag', tom: 'warning' },
];

/** Qual atalho corresponde aos filtros atuais (só um por vez). */
export function atalhoAtivo(f: FiltrosFila): AtalhoResumo | null {
  if (f.vencidos) return 'vencidos';
  if (f.vencem_24h) return 'vencem_24h';
  if (f.sinalizados) return 'sinalizados';
  if (f.atribuicao === 'meus') return 'meus';
  if (f.atribuicao === 'sem') return 'sem_atribuicao';
  return null;
}

/** Filtros que um atalho aplica, limpando os recortes dos outros atalhos. */
export function filtrosDoAtalho(f: FiltrosFila, atalho: AtalhoResumo | null): FiltrosFila {
  const base: FiltrosFila = {
    ...f,
    vencidos: false,
    vencem_24h: false,
    sinalizados: false,
    atribuicao: 'todos',
  };
  switch (atalho) {
    case 'meus':
      return { ...base, atribuicao: 'meus' };
    case 'vencidos':
      return { ...base, vencidos: true, ordenar: 'prazo' };
    case 'vencem_24h':
      // Por prazo, os que vencem primeiro chegam na primeira página.
      return { ...base, vencem_24h: true, ordenar: 'prazo' };
    case 'sem_atribuicao':
      return { ...base, atribuicao: 'sem' };
    case 'sinalizados':
      return { ...base, sinalizados: true };
    default:
      return base;
  }
}

type Props = {
  resumo: ResumoFila | null;
  ativo: AtalhoResumo | null;
  onEscolher: (atalho: AtalhoResumo | null) => void;
};

export function ResumoFilaBar({ resumo, ativo, onEscolher }: Props) {
  const colors = useColors();

  return (
    <View style={styles.raiz}>
      <View style={styles.titulo}>
        <AppText variant="caption" tone="secondary">
          {resumo
            ? `${resumo.abertos} abertos · ${resumo.concluidos_hoje} concluídos hoje`
            : 'Resumo indisponível agora'}
        </AppText>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.linha}
        accessibilityLabel="Atalhos da fila">
        {ATALHOS.map((a) => {
          const selecionado = ativo === a.chave;
          const cor = corDoTom(colors, a.tom);
          const valor = resumo ? resumo[a.chave] : null;
          return (
            <Pressable
              key={a.chave}
              onPress={() => onEscolher(selecionado ? null : a.chave)}
              accessibilityRole="togglebutton"
              accessibilityState={{ selected: selecionado }}
              accessibilityLabel={`${a.rotulo}: ${valor ?? 'sem dado'}`}
              accessibilityHint={selecionado ? 'Toque para ver a fila inteira' : 'Filtra a fila'}
              style={({ pressed }) => [
                styles.contador,
                {
                  backgroundColor: selecionado ? cor.bg : colors.surface,
                  borderColor: selecionado ? cor.border : colors.border,
                  borderWidth: selecionado ? 2 : 1,
                },
                pressed && { backgroundColor: colors.surfacePressed },
              ]}>
              <View style={styles.contadorTopo}>
                <Ionicons name={a.icone} size={16} color={cor.fg} />
                <AppText variant="title" style={{ color: cor.fg }} inControl>
                  {valor ?? '–'}
                </AppText>
              </View>
              <AppText variant="caption" tone="secondary" numberOfLines={1} inControl>
                {a.rotulo}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  raiz: {
    gap: Spacing[1],
  },
  titulo: {
    paddingHorizontal: Layout.gutter,
  },
  linha: {
    gap: Spacing[2],
    paddingHorizontal: Layout.gutter,
  },
  contador: {
    minWidth: 96,
    minHeight: Layout.minTouch + 12,
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
    borderRadius: Radius.md,
    justifyContent: 'center',
    gap: Spacing[0.5],
  },
  contadorTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[1.5],
  },
});
