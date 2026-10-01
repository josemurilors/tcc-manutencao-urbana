/**
 * Lista de chamados — porte de `frontend/src/pages/DefectList.jsx`.
 *
 * A tabela com colunas ordenáveis do web virou uma lista de cartões com um
 * seletor de ordenação; a seleção em lote do admin continua, agora ativada por
 * toque longo no cartão.
 */

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DefectSheet } from '@/components/defect-sheet';
import { Button } from '@/components/ui/button';
import { FilterChips } from '@/components/ui/chips';
import { EmptyState, LoadingState, PageHeading } from '@/components/ui/screen';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/status-badge';
import { BATCH_STATUS_OPTIONS, STATUS_ABERTOS, STATUS_FECHADOS } from '@/constants/status';
import { FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useColors } from '@/context/theme-context';
import { useToast } from '@/context/toast-context';
import { api } from '@/services/api';
import type { Defeito, TipoSinalizacao } from '@/types';
import { concluidoEm, formatarData, maskName, totalApoios } from '@/utils/format';

type Filtro = 'todos' | 'pendentes' | 'atendidos' | 'vinculados' | 'meus';
type Ordem = 'recentes' | 'antigos' | 'apoios' | 'titulo' | 'status';

const ORDENS = [
  { value: 'recentes', label: 'Mais recentes' },
  { value: 'antigos', label: 'Mais antigos' },
  { value: 'apoios', label: 'Mais apoiados' },
  { value: 'titulo', label: 'Título (A-Z)' },
  { value: 'status', label: 'Status' },
];

export default function ChamadosScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const addToast = useToast();
  const { user, isAuthenticated } = useAuth();
  const isAdmin = !!user?.admin;

  const [defeitos, setDefeitos] = useState<Defeito[]>([]);
  const [meusIds, setMeusIds] = useState<Set<number>>(new Set());
  const [apoiei, setApoiei] = useState<Set<number>>(new Set());
  const [sinalizei, setSinalizei] = useState<Map<number, TipoSinalizacao>>(new Map());
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [ordem, setOrdem] = useState<Ordem>('recentes');
  const [carregando, setCarregando] = useState(true);
  const [selecionado, setSelecionado] = useState<Defeito | null>(null);
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());
  const [statusLote, setStatusLote] = useState('');
  const [enviandoLote, setEnviandoLote] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [todos, meus] = await Promise.all([
        api.listDefeitos(),
        isAuthenticated ? api.meusDefeitos() : Promise.resolve([]),
      ]);
      setDefeitos(todos);
      setMeusIds(new Set(meus.map((d) => d.id)));
    } catch {
      // Mantém o que já estava em tela.
    } finally {
      setCarregando(false);
    }
  }, [isAuthenticated]);

  useFocusEffect(
    useCallback(() => {
      carregar();
    }, [carregar]),
  );

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelado = false;
    api
      .apoiei()
      .then((r) => {
        if (!cancelado) setApoiei(new Set(r.ids));
      })
      .catch(() => {});
    api
      .sinalizei()
      .then((r) => {
        if (!cancelado) {
          // Ids são UUIDs (strings) em runtime, como em `apoiei`.
          setSinalizei(new Map(Object.entries(r.sinalizacoes) as unknown as [number, TipoSinalizacao][]));
        }
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, [isAuthenticated]);

  const filtros = useMemo(() => {
    const base: { value: Filtro; label: string }[] = [
      { value: 'todos', label: 'Todos' },
      { value: 'pendentes', label: 'Pendentes' },
      { value: 'atendidos', label: 'Atendidos' },
    ];
    if (isAdmin) base.push({ value: 'vinculados', label: 'Vinculados' });
    if (isAuthenticated) base.push({ value: 'meus', label: 'Meus Chamados' });
    return base;
  }, [isAdmin, isAuthenticated]);

  const lista = useMemo(() => {
    const filtrados = defeitos.filter((d) => {
      if (filtro === 'pendentes') return STATUS_ABERTOS.includes(d.status);
      if (filtro === 'atendidos') return STATUS_FECHADOS.includes(d.status);
      if (filtro === 'vinculados') return !!d.tem_atendente || d.atendente_id != null;
      if (filtro === 'meus') return meusIds.has(d.id);
      return true;
    });

    return [...filtrados].sort((a, b) => {
      switch (ordem) {
        case 'antigos':
          return a.criado_em.localeCompare(b.criado_em);
        case 'apoios':
          return totalApoios(b) - totalApoios(a);
        case 'titulo':
          return (a.titulo ?? '').localeCompare(b.titulo ?? '');
        case 'status':
          return a.status.localeCompare(b.status);
        default:
          return b.criado_em.localeCompare(a.criado_em);
      }
    });
  }, [defeitos, filtro, meusIds, ordem]);

  function aplicarPatch(id: number, patch: Partial<Defeito>) {
    setDefeitos((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
    setSelecionado((prev) => (prev?.id === id ? { ...prev, ...patch } : prev));
  }

  function substituir(defeito: Defeito) {
    setDefeitos((prev) => prev.map((d) => (d.id === defeito.id ? defeito : d)));
    setSelecionado(defeito);
  }

  function remover(id: number) {
    setDefeitos((prev) => prev.filter((d) => d.id !== id));
    setSelecionado((prev) => (prev?.id === id ? null : prev));
  }

  function alternarApoio(id: number, apoiado: boolean) {
    setApoiei((prev) => {
      const next = new Set(prev);
      if (apoiado) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function alterarSinalizacao(id: number, tipo: TipoSinalizacao | null) {
    setSinalizei((prev) => {
      const next = new Map(prev);
      if (tipo) next.set(id, tipo);
      else next.delete(id);
      return next;
    });
  }

  function alternarSelecao(id: number) {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function abrirDetalhe(defeito: Defeito) {
    // Em modo de seleção o toque marca em vez de abrir.
    if (selecionados.size > 0) {
      alternarSelecao(defeito.id);
      return;
    }
    setSelecionado(defeito);
    try {
      setSelecionado(await api.detalharDefeito(defeito.id));
    } catch {
      // Mantém o resumo da listagem.
    }
  }

  async function aplicarLote() {
    if (!statusLote || selecionados.size === 0) return;
    setEnviandoLote(true);
    try {
      const ids = [...selecionados];
      const res = await api.batchStatusDefeitos(ids, statusLote);
      addToast(`Status atualizado em ${res.updated} chamado(s)!`);
      setDefeitos((prev) =>
        prev.map((d) => (selecionados.has(d.id) ? { ...d, status: statusLote } : d)),
      );
      setSelecionados(new Set());
      setStatusLote('');
    } catch (err) {
      addToast('Erro: ' + (err instanceof Error ? err.message : 'Erro no lote'), 'error');
    } finally {
      setEnviandoLote(false);
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bgPrimary, paddingTop: insets.top }]}>
      <PageHeading
        title="Lista de Chamados"
        subtitle="Acompanhe todos os chamados de serviços públicos"
      />

      <FilterChips
        options={filtros}
        value={filtro}
        onChange={setFiltro}
        accessibilityLabel="Filtros de chamados"
      />

      <View style={styles.ordenacao}>
        <Select
          options={ORDENS}
          value={ordem}
          onChange={(v) => setOrdem(v as Ordem)}
          title="Ordenar por"
          placeholder="Ordenar"
        />
      </View>

      {carregando ? (
        <LoadingState />
      ) : (
        <FlatList
          data={lista}
          keyExtractor={(d) => String(d.id)}
          contentContainerStyle={[styles.listaConteudo, { paddingBottom: insets.bottom + 120 }]}
          ListEmptyComponent={<EmptyState label="Nenhum chamado encontrado." />}
          renderItem={({ item }) => (
            <ChamadoCard
              defeito={item}
              selecionado={selecionados.has(item.id)}
              modoSelecao={selecionados.size > 0}
              podeSelecionar={isAdmin}
              onPress={() => abrirDetalhe(item)}
              onLongPress={() => isAdmin && alternarSelecao(item.id)}
            />
          )}
        />
      )}

      {isAdmin && selecionados.size > 0 ? (
        <View
          style={[
            styles.barraLote,
            {
              backgroundColor: colors.bgElevated,
              borderTopColor: colors.borderDefault,
              paddingBottom: insets.bottom + Spacing[3],
            },
          ]}>
          <Text style={[styles.loteTexto, { color: colors.textPrimary }]}>
            {selecionados.size} selecionado{selecionados.size === 1 ? '' : 's'}
          </Text>
          <View style={styles.loteControles}>
            <View style={styles.loteSelect}>
              <Select
                options={BATCH_STATUS_OPTIONS.map(([value, label]) => ({ value, label }))}
                value={statusLote}
                onChange={setStatusLote}
                title="Novo status"
                placeholder="Novo status"
              />
            </View>
            <Button
              size="sm"
              onPress={aplicarLote}
              loading={enviandoLote}
              disabled={!statusLote}>
              Aplicar
            </Button>
            <Button size="sm" variant="ghost" onPress={() => setSelecionados(new Set())}>
              Limpar
            </Button>
          </View>
        </View>
      ) : null}

      <DefectSheet
        key={selecionado?.id}
        defeito={selecionado}
        apoiado={selecionado ? apoiei.has(selecionado.id) : false}
        onClose={() => setSelecionado(null)}
        onPatch={aplicarPatch}
        onReplace={substituir}
        onApoioToggle={alternarApoio}
        sinalizacao={selecionado ? (sinalizei.get(selecionado.id) ?? null) : null}
        onSinalizacaoChange={alterarSinalizacao}
        onRemove={remover}
      />
    </View>
  );
}

function ChamadoCard({
  defeito,
  selecionado,
  modoSelecao,
  podeSelecionar,
  onPress,
  onLongPress,
}: {
  defeito: Defeito;
  selecionado: boolean;
  modoSelecao: boolean;
  podeSelecionar: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const colors = useColors();

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={defeito.titulo}
      accessibilityState={{ selected: selecionado }}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.bgSurface,
          borderColor: selecionado ? colors.gold500 : colors.borderDefault,
          opacity: pressed ? 0.85 : 1,
        },
      ]}>
      {modoSelecao && podeSelecionar ? (
        <Ionicons
          name={selecionado ? 'checkbox' : 'square-outline'}
          size={18}
          color={selecionado ? colors.gold500 : colors.textMuted}
        />
      ) : null}

      {defeito.imagem_thumbnail ? (
        <Image
          source={{ uri: defeito.imagem_thumbnail }}
          style={styles.miniatura}
          contentFit="cover"
          transition={120}
        />
      ) : null}

      <View style={styles.cardTexto}>
        <Text style={[styles.cardTitulo, { color: colors.textPrimary }]} numberOfLines={1}>
          {defeito.titulo}
        </Text>
        <StatusBadge status={defeito.status} concluidoEm={concluidoEm(defeito)} />
        <Text style={[styles.cardMeta, { color: colors.textMuted }]} numberOfLines={1}>
          {[defeito.categoria, defeito.bairro, defeito.autor_nome || maskName(defeito.usuario?.nome)]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        <View style={styles.cardRodape}>
          <Text style={[styles.cardMeta, { color: colors.textMuted }]}>
            {formatarData(defeito.criado_em)}
          </Text>
          {totalApoios(defeito) > 0 ? (
            <View style={styles.apoios}>
              <Ionicons name="thumbs-up" size={11} color={colors.textMuted} />
              <Text style={[styles.cardMeta, { color: colors.textMuted }]}>
                {totalApoios(defeito)}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  ordenacao: {
    paddingHorizontal: Spacing[4],
    paddingTop: Spacing[3],
  },
  listaConteudo: {
    padding: Spacing[4],
    gap: Spacing[2],
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    borderWidth: 1,
    padding: Spacing[3],
  },
  miniatura: {
    width: 56,
    height: 56,
    borderRadius: Radius.md,
  },
  cardTexto: {
    flex: 1,
    gap: Spacing[1],
  },
  cardTitulo: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  cardMeta: {
    fontSize: FontSize.xs,
  },
  cardRodape: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
  },
  apoios: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[1],
  },
  barraLote: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    padding: Spacing[3],
    gap: Spacing[2],
  },
  loteTexto: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },
  loteControles: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
  loteSelect: {
    flex: 1,
  },
});
