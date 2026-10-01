/**
 * Folha "Camadas" do mapa: o que mostrar (abertos, resolvidos ou todos),
 * quais tipos de problema e se o mapa de calor fica ligado.
 *
 * Cada escolha vale na hora (o mapa recarrega por trás da folha) e fica
 * guardada no aparelho — ver `preferencias-mapa.ts`.
 */

import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StateView } from '@/components/ui/state-view';
import { AppText } from '@/components/ui/text';
import { Layout, Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import { FILTROS_PADRAO, type CategoriaMapa, type FiltrosMapa, type SituacaoMapa } from '@/types/mapa';

type Props = {
  visible: boolean;
  onClose: () => void;
  filtros: FiltrosMapa;
  onChange: (filtros: FiltrosMapa) => void;
  categorias: CategoriaMapa[];
  estadoCategorias: 'carregando' | 'erro' | 'pronto';
  onRecarregarCategorias: () => void;
  /** Na visão da cidade só existem abertos (o resumo do município não traz fechados). */
  visaoCidade?: boolean;
};

const SITUACOES: { value: SituacaoMapa; label: string }[] = [
  { value: 'abertos', label: 'Abertos' },
  { value: 'resolvidos', label: 'Resolvidos' },
  { value: 'todos', label: 'Todos' },
];

export function CamadasSheet({
  visible,
  onClose,
  filtros,
  onChange,
  categorias,
  estadoCategorias,
  onRecarregarCategorias,
  visaoCidade,
}: Props) {
  const colors = useColors();
  const selecionadas = new Set(filtros.categorias);
  const todas = filtros.categorias.length === 0;

  function alternarCategoria(id: number) {
    const proximas = new Set(selecionadas);
    if (proximas.has(id)) proximas.delete(id);
    else proximas.add(id);
    // Marcar todas equivale a não filtrar: volta ao "Todos os tipos".
    const lista = proximas.size === categorias.length ? [] : [...proximas];
    onChange({ ...filtros, categorias: lista });
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Camadas do mapa"
      description="Escolha o que aparece no mapa. Fica salvo neste aparelho."
      footer={
        <>
          <Button
            variant="ghost"
            onPress={() => onChange(FILTROS_PADRAO)}
            style={styles.botaoRodape}
            accessibilityHint="Volta a mostrar só os abertos, de todos os tipos, sem calor">
            Limpar
          </Button>
          <Button onPress={onClose} style={styles.botaoRodape}>
            Pronto
          </Button>
        </>
      }>
      <View style={styles.secao}>
        <AppText variant="label">Situação</AppText>
        <SegmentedControl
          options={SITUACOES}
          value={filtros.situacao}
          onChange={(situacao) => onChange({ ...filtros, situacao })}
          accessibilityLabel="Situação dos chamados"
        />
        <AppText variant="caption" tone="muted">
          {visaoCidade
            ? 'Na visão da cidade aparecem só os abertos; volte à navegação para ver resolvidos.'
            : filtros.situacao === 'resolvidos'
              ? 'Problemas que a prefeitura já resolveu aparecem com um selo de check.'
              : 'Abertos são os que ainda esperam solução.'}
        </AppText>
      </View>

      <View style={styles.secao}>
        <View style={styles.linhaTitulo}>
          <AppText variant="label">Tipos de problema</AppText>
          {!todas ? (
            <Pressable
              onPress={() => onChange({ ...filtros, categorias: [] })}
              accessibilityRole="button"
              hitSlop={10}>
              <AppText variant="label" tone="brand">
                Mostrar todos
              </AppText>
            </Pressable>
          ) : null}
        </View>
        {estadoCategorias === 'carregando' ? (
          <StateView kind="loading" skeleton={0} title="Carregando tipos..." style={styles.estado} />
        ) : estadoCategorias === 'erro' ? (
          <StateView
            kind="error"
            title="Não foi possível carregar os tipos"
            description="O mapa continua mostrando todos os tipos."
            onRetry={onRecarregarCategorias}
            style={styles.estado}
          />
        ) : (
          <View style={styles.chips} accessibilityLabel="Tipos de problema">
            {categorias.map((c) => {
              // Sem filtro, todos aparecem marcados: é o que o mapa mostra.
              const marcada = todas || selecionadas.has(c.id);
              return (
                <Pressable
                  key={c.id}
                  onPress={() =>
                    todas
                      ? onChange({ ...filtros, categorias: [c.id] })
                      : alternarCategoria(c.id)
                  }
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: marcada }}
                  accessibilityLabel={c.nome}
                  accessibilityHint={todas ? 'Mostra só este tipo' : undefined}
                  style={({ pressed }) => [
                    styles.chip,
                    {
                      backgroundColor: marcada && !todas ? colors.primarySubtle : colors.surface,
                      borderColor: marcada && !todas ? colors.primary : colors.borderStrong,
                    },
                    pressed && { backgroundColor: colors.surfacePressed },
                  ]}>
                  <AppText variant="bodySm" inControl>
                    {c.icone ? `${c.icone} ` : ''}
                    {c.nome}
                  </AppText>
                  {marcada && !todas ? (
                    <Ionicons name="checkmark" size={16} color={colors.primaryText} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      <View style={[styles.linhaSwitch, { borderColor: colors.border }]}>
        <Ionicons name="flame" size={20} color={colors.warning} />
        <View style={styles.textoSwitch}>
          <AppText variant="label">Mapa de calor</AppText>
          <AppText variant="caption" tone="muted">
            Mostra onde há mais chamados, mesmo os que não cabem como pinos.
          </AppText>
        </View>
        <Switch
          value={filtros.calor}
          onValueChange={(calor) => onChange({ ...filtros, calor })}
          accessibilityLabel="Mapa de calor"
          trackColor={{ true: colors.primary, false: colors.borderStrong }}
          thumbColor={colors.surfaceRaised}
          // react-native-web ignora `thumbColor` quando ligado e pinta de teal.
          {...({ activeThumbColor: colors.onPrimary } as object)}
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  secao: {
    gap: Spacing[2],
  },
  linhaTitulo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[1],
    minHeight: Layout.minTouch,
    paddingHorizontal: Spacing[3],
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  estado: {
    paddingVertical: Spacing[4],
  },
  linhaSwitch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    paddingTop: Spacing[3],
    borderTopWidth: 1,
    minHeight: Layout.minTouch,
  },
  textoSwitch: {
    flex: 1,
    gap: Spacing[0.5],
  },
  botaoRodape: {
    flex: 1,
  },
});
