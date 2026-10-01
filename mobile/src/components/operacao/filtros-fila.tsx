/**
 * Busca, ordenação e filtros da fila.
 *
 * Na tela fica o que se usa toda hora — busca (protocolo, endereço, texto) e a
 * ordenação. O resto (status, atribuição, categoria, equipe, bairro) mora numa
 * folha, e o botão de filtros mostra quantos estão ligados.
 */

import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { FilterChips } from '@/components/ui/chips';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select } from '@/components/ui/select';
import { AppText } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { rotuloOperacao, STATUS_ABERTOS } from '@/constants/status';
import { Layout, Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import type {
  Atribuicao,
  CategoriaOperacao,
  EquipeOperacao,
  FiltrosFila,
  OrdemFila,
} from '@/types/operacao';

const ORDENS: { value: OrdemFila; label: string }[] = [
  { value: 'score', label: 'Prioridade' },
  { value: 'prazo', label: 'Prazo' },
  { value: 'distancia', label: 'Mais perto' },
  { value: 'antigos', label: 'Mais antigos' },
  { value: 'apoios', label: 'Mais apoiados' },
];

const TODOS = '__todos__';

/** Quantos filtros da folha estão ligados (fora busca e ordem). */
function contarFiltros(f: FiltrosFila) {
  return [
    f.status,
    f.categoria_id != null,
    f.equipe_id != null,
    f.atribuicao && f.atribuicao !== 'todos',
    f.bairro,
  ].filter(Boolean).length;
}

type Props = {
  filtros: FiltrosFila;
  onChange: (f: Partial<FiltrosFila>) => void;
  categorias: CategoriaOperacao[];
  equipes: EquipeOperacao[];
  temPosicao: boolean;
  /** Gestor+ filtra por equipe; o operador vê a fila da cidade e a dele. */
  gestor: boolean;
};

export function FiltrosFilaBar({ filtros, onChange, categorias, equipes, temPosicao, gestor }: Props) {
  const colors = useColors();
  const [busca, setBusca] = useState(filtros.q ?? '');
  const [bairro, setBairro] = useState(filtros.bairro ?? '');
  const [folha, setFolha] = useState(false);
  const total = contarFiltros(filtros);

  const ordens = ORDENS.filter((o) => o.value !== 'distancia' || temPosicao);

  return (
    <View style={styles.raiz}>
      <View style={styles.linhaBusca}>
        <TextField
          value={busca}
          onChangeText={setBusca}
          placeholder="Protocolo, rua ou palavra"
          accessibilityLabel="Buscar na fila"
          returnKeyType="search"
          onSubmitEditing={() => onChange({ q: busca })}
          onBlur={() => {
            if ((filtros.q ?? '') !== busca) onChange({ q: busca });
          }}
          containerStyle={styles.busca}
        />
        <Pressable
          onPress={() => setFolha(true)}
          accessibilityRole="button"
          accessibilityLabel={total > 0 ? `Filtros, ${total} ativos` : 'Filtros'}
          style={({ pressed }) => [
            styles.botaoFiltro,
            {
              borderColor: total > 0 ? colors.primary : colors.borderStrong,
              backgroundColor: pressed ? colors.surfacePressed : total > 0 ? colors.primarySubtle : 'transparent',
            },
          ]}>
          <Ionicons name="options" size={20} color={total > 0 ? colors.primaryText : colors.textPrimary} />
          {total > 0 ? (
            <AppText variant="label" tone="brand" inControl>
              {total}
            </AppText>
          ) : null}
        </Pressable>
      </View>

      <FilterChips
        options={ordens}
        value={filtros.ordenar}
        onChange={(ordenar) => onChange({ ordenar })}
        accessibilityLabel="Ordenar fila por"
      />

      <BottomSheet
        visible={folha}
        onClose={() => setFolha(false)}
        title="Filtrar a fila"
        description="Por padrão a fila mostra os chamados abertos da sua cidade; em Situação dá para ver os encerrados."
        footer={
          <>
            <Button
              variant="secondary"
              onPress={() => {
                setBairro('');
                onChange({
                  status: undefined,
                  categoria_id: undefined,
                  equipe_id: undefined,
                  atribuicao: 'todos',
                  bairro: undefined,
                });
                setFolha(false);
              }}>
              Limpar
            </Button>
            <Button
              style={styles.flex}
              block
              onPress={() => {
                // O bairro digitado vale ao fechar, mesmo sem "Enter" (web e teclados sem "concluir").
                if ((filtros.bairro ?? '') !== bairro.trim()) onChange({ bairro: bairro.trim() || undefined });
                setFolha(false);
              }}>
              Ver resultados
            </Button>
          </>
        }>
        <AppText variant="label">Situação</AppText>
        <FilterChips
          options={[
            { value: TODOS, label: 'Todos abertos' },
            ...STATUS_ABERTOS.map((s) => ({ value: s, label: rotuloOperacao(s) })),
            { value: 'fechados', label: 'Encerrados' },
          ]}
          value={filtros.status ?? TODOS}
          onChange={(v) => onChange({ status: v === TODOS ? undefined : v })}
          accessibilityLabel="Situação do chamado"
        />

        <AppText variant="label">Responsável</AppText>
        <SegmentedControl<Atribuicao>
          accessibilityLabel="Responsável"
          options={[
            { value: 'todos', label: 'Todos' },
            { value: 'meus', label: 'Meus' },
            { value: 'equipe', label: 'Equipe' },
            { value: 'sem', label: 'Ninguém' },
          ]}
          value={filtros.atribuicao ?? 'todos'}
          onChange={(atribuicao) => onChange({ atribuicao })}
        />

        {categorias.length > 0 ? (
          <Select
            label="Categoria"
            title="Categoria"
            options={[
              { value: TODOS, label: 'Todas as categorias' },
              ...categorias.map((c) => ({
                value: String(c.categoria_id),
                label: `${c.icone ? c.icone + ' ' : ''}${c.nome}`,
              })),
            ]}
            value={filtros.categoria_id != null ? String(filtros.categoria_id) : TODOS}
            onChange={(v) => onChange({ categoria_id: v === TODOS ? undefined : Number(v) })}
          />
        ) : null}

        {gestor && equipes.length > 0 ? (
          <Select
            label="Equipe"
            title="Equipe"
            options={[
              { value: TODOS, label: 'Todas as equipes' },
              ...equipes.map((e) => ({ value: String(e.id), label: e.nome })),
            ]}
            value={filtros.equipe_id != null ? String(filtros.equipe_id) : TODOS}
            onChange={(v) => onChange({ equipe_id: v === TODOS ? undefined : Number(v) })}
          />
        ) : null}

        <TextField
          label="Bairro"
          value={bairro}
          onChangeText={setBairro}
          placeholder="Ex.: Centro"
          onSubmitEditing={() => onChange({ bairro: bairro.trim() || undefined })}
          onBlur={() => {
            if ((filtros.bairro ?? '') !== bairro.trim()) onChange({ bairro: bairro.trim() || undefined });
          }}
          returnKeyType="done"
        />
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  raiz: {
    gap: Spacing[2],
  },
  linhaBusca: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing[2],
    paddingHorizontal: Layout.gutter,
  },
  busca: {
    flex: 1,
  },
  botaoFiltro: {
    minWidth: 48,
    height: 48,
    paddingHorizontal: Spacing[3],
    borderWidth: 1,
    borderRadius: Radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[1],
  },
  flex: {
    flex: 1,
  },
});
