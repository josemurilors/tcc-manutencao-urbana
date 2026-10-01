/**
 * Barra de filtros do painel: período (atalhos + datas personalizadas) e
 * recortes por categoria, secretaria e bairro.
 *
 * Fica numa faixa só, acima de tudo, porque vale para a tela inteira: todo
 * KPI e gráfico abaixo responde a ela. Cada recorte ativo aparece como chip
 * preenchido com o nome escolhido, para o gestor nunca ler um número sem
 * saber de que fatia ele é.
 */

import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StateView } from '@/components/ui/state-view';
import { AppText } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { Layout, Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import { apiBi } from '@/services/api-bi';
import type { BiFiltros, OpcaoFiltro, PeriodoRapido } from '@/types/bi';

import { dataDeIso, diasNoIntervalo, isoDeTextoBr, isoLocal, textoBrDeIso } from './formato';
import type { RotulosFiltro } from './use-filtros-bi';

type Recorte = 'categoria' | 'secretaria' | 'equipe' | 'bairro';

const TITULO_RECORTE: Record<Recorte, { titulo: string; todos: string }> = {
  categoria: { titulo: 'Categoria', todos: 'Todas as categorias' },
  secretaria: { titulo: 'Secretaria', todos: 'Todas as secretarias' },
  equipe: { titulo: 'Equipe', todos: 'Todas as equipes' },
  bairro: { titulo: 'Bairro', todos: 'Todos os bairros' },
};

const PERIODOS: { value: PeriodoRapido; label: string }[] = [
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: '90d', label: '90 dias' },
  { value: '12m', label: '12 meses' },
];

/** Janela máxima do personalizado: além disso as consultas ficam pesadas e a série vira ruído. */
const MAX_DIAS = 731;

type Props = {
  filtros: BiFiltros;
  rotulos: RotulosFiltro;
  onPeriodo: (p: Exclude<PeriodoRapido, 'personalizado'>) => void;
  onAplicar: (mudanca: Partial<BiFiltros>, rotulos?: Partial<RotulosFiltro>) => void;
  onLimpar: () => void;
};

export function BarraFiltros({ filtros, rotulos, onPeriodo, onAplicar, onLimpar }: Props) {
  const colors = useColors();
  const [aberto, setAberto] = useState<Recorte | null>(null);
  const [datasAbertas, setDatasAbertas] = useState(false);

  const valorDo = (r: Recorte) =>
    r === 'categoria'
      ? filtros.categoria_id
      : r === 'secretaria'
        ? filtros.secretaria_id
        : r === 'equipe'
          ? filtros.equipe_id
          : filtros.bairro;
  const algumRecorte = !!(filtros.categoria_id || filtros.secretaria_id || filtros.bairro || filtros.equipe_id);
  const personalizado = filtros.periodo === 'personalizado';

  return (
    <View style={styles.raiz}>
      <View style={styles.linhaPeriodo}>
        <SegmentedControl
          options={PERIODOS}
          value={filtros.periodo}
          onChange={(p) => {
            if (p !== 'personalizado') onPeriodo(p);
          }}
          accessibilityLabel="Período"
          style={styles.segmentos}
        />
        <Pressable
          onPress={() => setDatasAbertas(true)}
          accessibilityRole="button"
          accessibilityLabel={
            personalizado
              ? `Período personalizado: ${textoBrDeIso(filtros.inicio)} a ${textoBrDeIso(filtros.fim)}. Alterar`
              : 'Escolher datas'
          }
          accessibilityState={{ selected: personalizado }}
          style={[
            styles.botaoDatas,
            {
              backgroundColor: personalizado ? colors.primary : colors.bgSubtle,
              borderColor: personalizado ? colors.primary : colors.border,
            },
          ]}>
          <Ionicons name="calendar" size={18} color={personalizado ? colors.onPrimary : colors.textSecondary} />
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {(Object.keys(TITULO_RECORTE) as Recorte[]).map((r) => {
          const valor = valorDo(r);
          const ativo = !!valor;
          const rotulo = ativo ? (rotulos[r] ?? String(valor)) : TITULO_RECORTE[r].titulo;
          return (
            <Pressable
              key={r}
              onPress={() => setAberto(r)}
              accessibilityRole="button"
              accessibilityLabel={`${TITULO_RECORTE[r].titulo}: ${ativo ? rotulo : 'todos'}. Alterar filtro`}
              style={[
                styles.chip,
                {
                  backgroundColor: ativo ? colors.primarySubtle : 'transparent',
                  borderColor: ativo ? colors.primary : colors.borderStrong,
                },
              ]}>
              <AppText variant="caption" weight="600" inControl numberOfLines={1} style={styles.chipTexto}>
                {rotulo}
              </AppText>
              <Ionicons name="chevron-down" size={14} color={colors.textSecondary} />
            </Pressable>
          );
        })}
        {algumRecorte ? (
          <Pressable
            onPress={onLimpar}
            accessibilityRole="button"
            accessibilityLabel="Limpar filtros de categoria, secretaria, equipe e bairro"
            style={[styles.chip, { borderColor: 'transparent' }]}>
            <Ionicons name="close" size={14} color={colors.textSecondary} />
            <AppText variant="caption" tone="secondary" inControl>
              Limpar
            </AppText>
          </Pressable>
        ) : null}
      </ScrollView>

      {aberto ? (
        <SeletorRecorte
          recorte={aberto}
          filtros={filtros}
          valor={valorDo(aberto) ?? null}
          onFechar={() => setAberto(null)}
          onEscolher={(op) => {
            const campo = aberto === 'bairro' ? 'bairro' : (`${aberto}_id` as const);
            onAplicar({ [campo]: op?.value ?? null }, { [aberto]: op?.label });
            setAberto(null);
          }}
        />
      ) : null}

      {datasAbertas ? (
        <SeletorDatas
          filtros={filtros}
          onFechar={() => setDatasAbertas(false)}
          onAplicar={(inicio, fim) => {
            onAplicar({ periodo: 'personalizado', inicio, fim });
            setDatasAbertas(false);
          }}
        />
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------ recortes */

function SeletorRecorte({
  recorte,
  filtros,
  valor,
  onFechar,
  onEscolher,
}: {
  recorte: Recorte;
  filtros: BiFiltros;
  valor: string | null;
  onFechar: () => void;
  onEscolher: (op: OpcaoFiltro | null) => void;
}) {
  const colors = useColors();
  const [opcoes, setOpcoes] = useState<OpcaoFiltro[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');

  const buscar = useCallback(() => {
    const fn =
      recorte === 'categoria'
        ? apiBi.opcoesCategoria
        : recorte === 'secretaria'
          ? apiBi.opcoesSecretaria
          : recorte === 'equipe'
            ? apiBi.opcoesEquipe
            : apiBi.opcoesBairro;
    return fn(filtros)
      .then(setOpcoes)
      .catch((e: unknown) => setErro(e instanceof Error ? e.message : 'Falha ao carregar as opções.'));
    // As opções dependem do período, não dos outros recortes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorte, filtros.inicio, filtros.fim]);

  // A folha é montada a cada abertura, então o estado inicial já é "carregando".
  useEffect(() => {
    buscar();
  }, [buscar]);

  function tentarDeNovo() {
    setErro(null);
    setOpcoes(null);
    buscar();
  }

  const visiveis = useMemo(() => {
    const termo = normalizar(busca);
    return (opcoes ?? []).filter((o) => !termo || normalizar(o.label).includes(termo));
  }, [opcoes, busca]);

  const { titulo, todos } = TITULO_RECORTE[recorte];

  return (
    <BottomSheet visible onClose={onFechar} title={`Filtrar por ${titulo.toLowerCase()}`}>
      {opcoes && opcoes.length > 8 ? (
        <TextField
          placeholder={`Buscar ${titulo.toLowerCase()}`}
          value={busca}
          onChangeText={setBusca}
          accessibilityLabel={`Buscar ${titulo.toLowerCase()}`}
          autoCorrect={false}
        />
      ) : null}
      {erro ? (
        <StateView kind="error" title="Não foi possível carregar as opções" description={erro} onRetry={tentarDeNovo} />
      ) : opcoes == null ? (
        <StateView kind="loading" skeleton={0} title="Carregando opções" />
      ) : (
        <View>
          {[{ value: '', label: todos }, ...visiveis].map((op) => {
            const marcado = (op.value || null) === (valor || null);
            return (
              <Pressable
                key={op.value || '__todos'}
                onPress={() => onEscolher(op.value ? op : null)}
                accessibilityRole="radio"
                accessibilityState={{ checked: marcado, selected: marcado }}
                style={({ pressed }) => [
                  styles.opcao,
                  { borderBottomColor: colors.border },
                  pressed && { backgroundColor: colors.surfacePressed },
                ]}>
                <AppText variant="body" style={styles.flex1} weight={marcado ? '600' : undefined}>
                  {op.label}
                </AppText>
                {marcado ? <Ionicons name="checkmark" size={20} color={colors.primaryText} /> : null}
              </Pressable>
            );
          })}
          {visiveis.length === 0 ? (
            <AppText variant="bodySm" tone="muted" style={styles.semOpcoes}>
              {busca ? 'Nada encontrado com esse nome.' : 'Nenhuma opção com chamados no período.'}
            </AppText>
          ) : null}
        </View>
      )}
    </BottomSheet>
  );
}

function normalizar(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/* --------------------------------------------------------------- datas */

function SeletorDatas({
  filtros,
  onFechar,
  onAplicar,
}: {
  filtros: BiFiltros;
  onFechar: () => void;
  onAplicar: (inicio: string, fim: string) => void;
}) {
  // Montada a cada abertura: parte do período em vigor, não do que foi
  // digitado e cancelado da outra vez.
  const [inicio, setInicio] = useState(textoBrDeIso(filtros.inicio));
  const [fim, setFim] = useState(textoBrDeIso(filtros.fim));
  const [erro, setErro] = useState<string | null>(null);

  function aplicar() {
    const i = isoDeTextoBr(inicio);
    const f = isoDeTextoBr(fim);
    if (!i || !f) {
      setErro('Use datas válidas no formato dd/mm/aaaa.');
      return;
    }
    if (dataDeIso(i) > dataDeIso(f)) {
      setErro('A data inicial precisa ser anterior à final.');
      return;
    }
    if (f > isoLocal(new Date())) {
      setErro('A data final não pode estar no futuro.');
      return;
    }
    if (diasNoIntervalo(i, f) > MAX_DIAS) {
      setErro('Escolha um período de até 2 anos.');
      return;
    }
    onAplicar(i, f);
  }

  return (
    <BottomSheet
      visible
      onClose={onFechar}
      title="Período personalizado"
      description="Os indicadores são comparados com o mesmo número de dias imediatamente antes."
      footer={
        <>
          <Button variant="secondary" onPress={onFechar} style={styles.flex1}>
            Cancelar
          </Button>
          <Button onPress={aplicar} style={styles.flex1}>
            Aplicar
          </Button>
        </>
      }>
      <TextField
        label="De"
        value={inicio}
        onChangeText={(t) => setInicio(mascaraData(t))}
        placeholder="dd/mm/aaaa"
        keyboardType="number-pad"
        maxLength={10}
        accessibilityLabel="Data inicial, dia barra mês barra ano"
        invalid={!!erro}
      />
      <TextField
        label="Até"
        value={fim}
        onChangeText={(t) => setFim(mascaraData(t))}
        placeholder="dd/mm/aaaa"
        keyboardType="number-pad"
        maxLength={10}
        accessibilityLabel="Data final, dia barra mês barra ano"
        invalid={!!erro}
      />
      {erro ? (
        <AppText variant="bodySm" tone="danger" accessibilityRole="alert">
          {erro}
        </AppText>
      ) : null}
    </BottomSheet>
  );
}

/** Insere as barras enquanto digita: "01082026" -> "01/08/2026". */
function mascaraData(t: string) {
  const n = t.replace(/\D/g, '').slice(0, 8);
  if (n.length > 4) return `${n.slice(0, 2)}/${n.slice(2, 4)}/${n.slice(4)}`;
  if (n.length > 2) return `${n.slice(0, 2)}/${n.slice(2)}`;
  return n;
}

const styles = StyleSheet.create({
  raiz: {
    gap: Spacing[2],
  },
  linhaPeriodo: {
    flexDirection: 'row',
    gap: Spacing[2],
    paddingHorizontal: Layout.gutter,
  },
  segmentos: {
    flex: 1,
  },
  botaoDatas: {
    width: Layout.minTouch,
    height: Layout.minTouch,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chips: {
    gap: Spacing[2],
    paddingHorizontal: Layout.gutter,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[1],
    minHeight: Layout.minTouch - 4,
    maxWidth: 240,
    paddingHorizontal: Spacing[3],
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  chipTexto: {
    flexShrink: 1,
  },
  opcao: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    minHeight: Layout.minTouch + 4,
    paddingHorizontal: Spacing[1],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  semOpcoes: {
    paddingVertical: Spacing[4],
    textAlign: 'center',
  },
  flex1: {
    flex: 1,
  },
});
