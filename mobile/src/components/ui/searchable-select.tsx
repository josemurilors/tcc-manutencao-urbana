/**
 * Seletor com busca.
 *
 * O web precisava do @tanstack/react-virtual para dar conta dos ~5.500
 * municípios; aqui a FlatList já é virtualizada, então a lista é montada como
 * uma sequência plana de cabeçalhos de UF e itens.
 */

import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ControlHeight, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';

export type SelectOption = {
  value: string;
  label: string;
  /** Agrupador — a sigla da UF, no caso dos municípios. */
  group: string;
};

type Props = {
  options: SelectOption[];
  value?: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  searchPlaceholder?: string;
  emptyText?: string;
};

type Row =
  | { type: 'group'; key: string; group: string }
  | { type: 'item'; key: string; item: SelectOption };

function normalize(str: string) {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Selecione...',
  label,
  searchPlaceholder = 'Pesquisar município...',
  emptyText = 'Nenhum município encontrado',
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const selected = options.find((o) => o.value === value);

  const rows = useMemo<Row[]>(() => {
    const norm = normalize(search);
    const filtered = !norm
      ? options
      : options.filter(
          (o) => normalize(o.label).includes(norm) || normalize(o.group).includes(norm),
        );

    const groups = new Map<string, SelectOption[]>();
    for (const o of filtered) {
      const atual = groups.get(o.group);
      if (atual) atual.push(o);
      else groups.set(o.group, [o]);
    }

    const out: Row[] = [];
    for (const [group, items] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      out.push({ type: 'group', key: `grupo:${group}`, group });
      for (const item of items) out.push({ type: 'item', key: item.value, item });
    }
    return out;
  }, [options, search]);

  function fechar() {
    setOpen(false);
    setSearch('');
  }

  return (
    <View style={styles.wrapper}>
      {label ? <Text style={[styles.label, { color: colors.textMuted }]}>{label}</Text> : null}

      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={label ?? placeholder}
        accessibilityValue={{ text: selected?.label ?? 'nenhum' }}
        style={[
          styles.gatilho,
          { backgroundColor: colors.bgInput, borderColor: colors.borderDefault },
        ]}>
        <Text
          numberOfLines={1}
          style={[
            styles.gatilhoTexto,
            { color: selected ? colors.textPrimary : colors.textMuted },
          ]}>
          {selected ? `${selected.label} - ${selected.group}` : placeholder}
        </Text>
        <Ionicons name="chevron-expand" size={14} color={colors.textMuted} />
      </Pressable>

      <Modal visible={open} animationType="slide" onRequestClose={fechar} transparent>
        <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
          <View
            style={[
              styles.painel,
              {
                backgroundColor: colors.bgElevated,
                borderColor: colors.borderDefault,
                paddingBottom: insets.bottom,
              },
            ]}>
            <View style={[styles.busca, { borderBottomColor: colors.borderDefault }]}>
              <Ionicons name="search" size={16} color={colors.textMuted} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder={searchPlaceholder}
                placeholderTextColor={colors.textMuted}
                autoFocus
                style={[styles.buscaInput, { color: colors.textPrimary }]}
              />
              <Pressable onPress={fechar} accessibilityRole="button" accessibilityLabel="Fechar">
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </Pressable>
            </View>

            <FlatList
              data={rows}
              keyExtractor={(row) => row.key}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <Text style={[styles.vazio, { color: colors.textMuted }]}>{emptyText}</Text>
              }
              renderItem={({ item: row }) =>
                row.type === 'group' ? (
                  <View style={[styles.grupo, { backgroundColor: colors.bgPrimary }]}>
                    <Text style={[styles.grupoTexto, { color: colors.textMuted }]}>{row.group}</Text>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => {
                      onChange(row.item.value);
                      fechar();
                    }}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.item,
                      pressed && { backgroundColor: colors.bgHover },
                    ]}>
                    <Text style={[styles.itemTexto, { color: colors.textSecondary }]}>
                      {row.item.label}
                    </Text>
                    {row.item.value === value ? (
                      <Ionicons name="checkmark" size={16} color={colors.gold500} />
                    ) : null}
                  </Pressable>
                )
              }
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: Spacing[1],
  },
  label: {
    fontSize: FontSize.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  gatilho: {
    height: ControlHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    paddingHorizontal: Spacing[4],
    borderWidth: 1,
    borderRadius: Radius.md,
  },
  gatilhoTexto: {
    flex: 1,
    fontSize: FontSize.sm,
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  painel: {
    maxHeight: '80%',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
  },
  busca: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    borderBottomWidth: 1,
  },
  buscaInput: {
    flex: 1,
    fontSize: FontSize.sm,
  },
  grupo: {
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[1],
  },
  grupoTexto: {
    fontSize: FontSize.xs - 2,
    fontWeight: FontWeight.bold,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
  },
  itemTexto: {
    fontSize: FontSize.sm,
  },
  vazio: {
    textAlign: 'center',
    paddingVertical: Spacing[8],
    fontSize: FontSize.xs,
  },
});
