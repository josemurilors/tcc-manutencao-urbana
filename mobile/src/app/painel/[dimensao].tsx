/**
 * Drill-down do painel: do número para a lista e da lista para o chamado.
 *
 * Duas formas, conforme a URL:
 * - `/painel/bairro` (sem `chave`): a tabela completa daquela dimensão, com
 *   todas as colunas da distribuição e ordenação escolhida. Tocar numa linha
 *   desce para a lista dela.
 * - `/painel/bairro?chave=centro`, `/painel/vencidos` ou `/painel/todos`: os
 *   chamados por trás do número tocado (`bi/chamados/`, mesma regra de
 *   contagem do painel), com troca entre abertos, vencidos, recebidos,
 *   resolvidos e rejeitados (`?recorte=`). Tocar abre o chamado no mapa.
 *
 * Os filtros do painel chegam pelos parâmetros (ver `components/bi/navegar`).
 */

import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { podeVerPainel } from '@/components/bi/acesso';
import { descreverPeriodo, fmtHoras, fmtNumero, fmtPct } from '@/components/bi/formato';
import {
  abrirChamado,
  abrirDrill,
  DIMENSOES_DRILL,
  filtrosDosParams,
  RECORTES_LISTA,
  ROTULO_DIMENSAO,
  type DimensaoDrill,
} from '@/components/bi/navegar';
import { mensagemAmigavel, useSecao } from '@/components/bi/use-secao';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FilterChips } from '@/components/ui/chips';
import { IconButton } from '@/components/ui/icon-button';
import { StateView } from '@/components/ui/state-view';
import { AppText } from '@/components/ui/text';
import { rotuloOperacao } from '@/constants/status';
import { corDoStatus, Layout, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useColors } from '@/context/theme-context';
import { apiBi } from '@/services/api-bi';
import type { BiDistribuicaoLinha, ChamadoBi, RecorteLista } from '@/types/bi';

type Ordem = 'abertos' | 'vencidos' | 'recebidos' | 'pct_no_prazo' | 'lead_time_p50_h';

const ORDENS: { value: Ordem; label: string }[] = [
  { value: 'abertos', label: 'Mais abertos' },
  { value: 'vencidos', label: 'Mais vencidos' },
  { value: 'recebidos', label: 'Mais recebidos' },
  { value: 'pct_no_prazo', label: 'Pior % no prazo' },
  { value: 'lead_time_p50_h', label: 'Mais lentos' },
];

const RECORTE_ROTULO: Record<RecorteLista, { chip: string; titulo: string; total: [string, string]; vazio: string }> = {
  abertos: {
    chip: 'Em aberto',
    titulo: 'Chamados em aberto',
    total: ['chamado em aberto ao fim do período', 'chamados em aberto ao fim do período'],
    vazio: 'Nenhum chamado em aberto nesta fatia.',
  },
  vencidos: {
    chip: 'Prazo vencido',
    titulo: 'Chamados com prazo vencido',
    total: ['chamado com prazo vencido', 'chamados com prazo vencido'],
    vazio: 'Nenhum chamado com prazo vencido. Esta fatia está em dia.',
  },
  recebidos: {
    chip: 'Recebidos',
    titulo: 'Chamados recebidos',
    total: ['chamado recebido no período', 'chamados recebidos no período'],
    vazio: 'Nenhum chamado recebido no período.',
  },
  resolvidos: {
    chip: 'Resolvidos',
    titulo: 'Chamados resolvidos',
    total: ['chamado resolvido no período', 'chamados resolvidos no período'],
    vazio: 'Nenhum chamado resolvido no período.',
  },
  rejeitados: {
    chip: 'Rejeitados',
    titulo: 'Chamados rejeitados',
    total: ['chamado rejeitado no período', 'chamados rejeitados no período'],
    vazio: 'Nenhum chamado rejeitado no período.',
  },
};

/** Recorte inicial: o da URL; numa situação fechada, o número que ela tem. */
function recorteInicial(param: string | undefined, dimensao: DimensaoDrill | null, chave: string | null): RecorteLista {
  if (param && (RECORTES_LISTA as string[]).includes(param)) return param as RecorteLista;
  if (dimensao === 'vencidos') return 'vencidos';
  if (dimensao === 'status' && chave === 'concluido') return 'resolvidos';
  if (dimensao === 'status' && chave === 'rejeitado') return 'rejeitados';
  return 'abertos';
}

export default function DrillDownScreen() {
  const { user, isAuthenticated } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<Record<string, string>>();

  const dimensao = (DIMENSOES_DRILL as string[]).includes(params.dimensao)
    ? (params.dimensao as DimensaoDrill)
    : null;
  // O objeto de params muda de identidade a cada render: memoriza pelo conteúdo,
  // senão as listas abaixo recarregariam em laço.
  const paramsJson = JSON.stringify(params);
  const filtros = useMemo(() => filtrosDosParams(JSON.parse(paramsJson)), [paramsJson]);
  const chave = params.chave || null;
  const rotulo = params.rotulo || chave;
  const [recorte, setRecorte] = useState<RecorteLista>(() => recorteInicial(params.recorte, dimensao, chave));

  function voltar() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/painel');
  }

  const lista = !!dimensao && (!!chave || dimensao === 'vencidos' || dimensao === 'todos');
  const titulo = !dimensao
    ? 'Painel'
    : dimensao === 'vencidos' || dimensao === 'todos'
      ? RECORTE_ROTULO[recorte].titulo
      : chave
        ? (dimensao === 'status' ? rotuloOperacao(chave) : rotulo) ?? ''
        : `Por ${ROTULO_DIMENSAO[dimensao].singular.toLowerCase()}`;

  const contexto = [
    descreverPeriodo(filtros.periodo, filtros.inicio, filtros.fim),
    chave && dimensao && dimensao !== 'vencidos' && dimensao !== 'todos' ? ROTULO_DIMENSAO[dimensao].singular : null,
  ]
    .filter(Boolean)
    .join(' · ');

  let corpo: React.ReactNode;
  if (!isAuthenticated || !podeVerPainel(user)) {
    corpo = (
      <StateView
        kind="empty"
        icon="lock-closed-outline"
        title="Painel restrito à gestão"
        description="Esta lista faz parte dos indicadores da prefeitura."
      />
    );
  } else if (!dimensao) {
    corpo = (
      <StateView
        kind="empty"
        icon="help-circle-outline"
        title="Recorte desconhecido"
        description="Este link não corresponde a nenhuma visão do painel."
        action={{ label: 'Voltar ao painel', onPress: () => router.replace('/(tabs)/painel') }}
      />
    );
  } else if (lista) {
    corpo = (
      <ListaChamados filtros={filtros} dimensao={dimensao} chave={chave} recorte={recorte} onRecorte={setRecorte} />
    );
  } else {
    corpo = <TabelaDimensao filtros={filtros} dimensao={dimensao as Exclude<DimensaoDrill, 'vencidos' | 'todos'>} />;
  }

  return (
    <View style={[styles.tela, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      <View style={styles.cabecalho}>
        <IconButton icon="arrow-back" accessibilityLabel="Voltar" onPress={voltar} />
        <View style={styles.flex1}>
          <AppText variant="title" accessibilityRole="header" numberOfLines={2}>
            {titulo}
          </AppText>
          {dimensao ? (
            <AppText variant="caption" tone="muted" numberOfLines={2}>
              {contexto}
            </AppText>
          ) : null}
        </View>
      </View>
      <View style={[styles.flex1, styles.limite]}>{corpo}</View>
    </View>
  );
}

/* --------------------------------------------------- tabela da dimensão */

function TabelaDimensao({
  filtros,
  dimensao,
}: {
  filtros: ReturnType<typeof filtrosDosParams>;
  dimensao: Exclude<DimensaoDrill, 'vencidos' | 'todos'>;
}) {
  const insets = useSafeAreaInsets();
  const [ordem, setOrdem] = useState<Ordem>('abertos');
  const secao = useSecao(() => apiBi.distribuicao(filtros, dimensao), `${JSON.stringify(filtros)}|${dimensao}`);

  const linhas = useMemo(() => ordenar(secao.dados ?? [], ordem), [secao.dados, ordem]);

  if (secao.erro && !secao.dados) {
    return <StateView kind="error" description={secao.erro} onRetry={secao.recarregar} />;
  }
  if (!secao.dados) return <StateView kind="loading" skeleton={5} title="Carregando" />;

  return (
    <FlatList
      data={linhas}
      keyExtractor={(l) => String(l.chave)}
      contentContainerStyle={{ paddingBottom: insets.bottom + Spacing[10], gap: Spacing[2] }}
      ListHeaderComponent={
        <View style={styles.ordem}>
          <FilterChips options={ORDENS} value={ordem} onChange={setOrdem} accessibilityLabel="Ordenar por" />
        </View>
      }
      ListEmptyComponent={
        <StateView kind="empty" title="Nada neste recorte" description="Nenhum chamado no período com estes filtros." />
      }
      renderItem={({ item, index }) => (
        <LinhaDimensao
          linha={item}
          posicao={index + 1}
          dimensao={dimensao}
          onPress={() =>
            abrirDrill(
              filtros,
              dimensao,
              {
                chave: String(item.chave),
                rotulo: dimensao === 'status' ? rotuloOperacao(String(item.chave)) : item.rotulo || String(item.chave),
              },
              // Fatia sem nada aberto: a lista útil é a do que entrou ou saiu no período.
              item.abertos > 0 ? undefined : item.resolvidos > 0 ? 'resolvidos' : 'recebidos',
            )
          }
        />
      )}
    />
  );
}

function LinhaDimensao({
  linha,
  posicao,
  dimensao,
  onPress,
}: {
  linha: BiDistribuicaoLinha;
  posicao: number;
  dimensao: Exclude<DimensaoDrill, 'vencidos' | 'todos'>;
  onPress: () => void;
}) {
  const colors = useColors();
  const nome = dimensao === 'status' ? rotuloOperacao(String(linha.chave)) : linha.rotulo || 'Não informado';
  const metricas: [string, string][] = [
    ['Abertos', fmtNumero(linha.abertos)],
    ['Vencidos', fmtNumero(linha.vencidos)],
    ['Recebidos', fmtNumero(linha.recebidos)],
    ['Resolvidos', fmtNumero(linha.resolvidos)],
    ['No prazo', fmtPct(linha.pct_no_prazo)],
    ['Tempo típico', fmtHoras(linha.lead_time_p50_h)],
  ];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${posicao}º, ${nome}. ${metricas.map(([k, v]) => `${k}: ${v}`).join(', ')}`}
      accessibilityHint="Abre os chamados desta linha"
      style={({ pressed }) => [
        styles.linha,
        { backgroundColor: pressed ? colors.surfacePressed : colors.surface, borderColor: colors.border },
      ]}>
      <View style={styles.linhaTopo}>
        <AppText variant="caption" tone="muted" weight="700" style={styles.posicao}>
          {posicao}º
        </AppText>
        <AppText variant="label" style={styles.flex1} numberOfLines={2}>
          {nome}
        </AppText>
        {linha.vencidos > 0 ? (
          <Badge label={`${fmtNumero(linha.vencidos)} vencidos`} tone="danger" icon="alarm" size="sm" />
        ) : null}
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </View>
      <View style={styles.metricas}>
        {metricas.map(([k, v]) => (
          <View key={k} style={styles.metrica}>
            <AppText variant="caption" tone="muted">
              {k}
            </AppText>
            <AppText variant="bodySm" weight="600">
              {v}
            </AppText>
          </View>
        ))}
      </View>
    </Pressable>
  );
}

function ordenar(linhas: BiDistribuicaoLinha[], ordem: Ordem) {
  const v = (l: BiDistribuicaoLinha) => l[ordem];
  return [...linhas].sort((a, b) => {
    // "Pior % no prazo" é crescente; sem dado vai para o fim em qualquer ordem.
    const va = v(a);
    const vb = v(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return ordem === 'pct_no_prazo' ? va - vb : vb - va;
  });
}

/* ------------------------------------------------------ lista de chamados */

function ListaChamados({
  filtros,
  dimensao,
  chave,
  recorte,
  onRecorte,
}: {
  filtros: ReturnType<typeof filtrosDosParams>;
  dimensao: DimensaoDrill;
  chave: string | null;
  recorte: RecorteLista;
  onRecorte: (r: RecorteLista) => void;
}) {
  const insets = useSafeAreaInsets();
  const [itens, setItens] = useState<ChamadoBi[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [pagina, setPagina] = useState(1);
  const [temMais, setTemMais] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  // Troca de recorte no meio de um carregamento: a resposta antiga é descartada.
  const geracao = useRef(0);

  // Só o que vem depois da resposta mexe no estado: o "carregando" é ligado
  // por quem pede (troca de recorte, "Carregar mais", "Tentar de novo").
  const buscarPagina = useCallback(
    (p: number) => {
      const minha = ++geracao.current;
      return apiBi
        .chamados(filtros, { dimensao, chave, recorte }, p)
        .then((r) => {
          if (minha !== geracao.current) return;
          setItens((atual) => (p === 1 ? r.results : [...atual, ...r.results]));
          setTotal(r.count);
          setTemMais(!!r.next);
          setPagina(p);
          setErro(null);
        })
        .catch((e: unknown) => {
          if (minha === geracao.current) setErro(mensagemAmigavel(e, 'Falha ao carregar os chamados.'));
        })
        .finally(() => {
          if (minha === geracao.current) setCarregando(false);
        });
    },
    [filtros, dimensao, chave, recorte],
  );

  useEffect(() => {
    buscarPagina(1);
  }, [buscarPagina]);

  function carregar(p: number) {
    setCarregando(true);
    setErro(null);
    buscarPagina(p);
  }

  function trocarRecorte(r: RecorteLista) {
    if (r === recorte) return;
    setItens([]);
    setTotal(null);
    setTemMais(false);
    setErro(null);
    setCarregando(true);
    onRecorte(r);
  }

  const rot = RECORTE_ROTULO[recorte];
  const cabecalho = (
    <View style={styles.cabecalhoLista}>
      <View style={styles.ordem}>
        <FilterChips
          options={RECORTES_LISTA.map((r) => ({ value: r, label: RECORTE_ROTULO[r].chip }))}
          value={recorte}
          onChange={trocarRecorte}
          accessibilityLabel="Quais chamados mostrar"
        />
      </View>
      {total != null ? (
        <AppText variant="bodySm" tone="secondary" style={styles.total} accessibilityLiveRegion="polite">
          {fmtNumero(total)} {total === 1 ? rot.total[0] : rot.total[1]}
          {itens.length < total ? ` · mostrando ${fmtNumero(itens.length)}` : ''}
        </AppText>
      ) : null}
    </View>
  );

  let vazio: React.ReactNode;
  if (erro) {
    vazio = <StateView kind="error" description={erro} onRetry={() => carregar(1)} />;
  } else if (carregando) {
    vazio = <StateView kind="loading" skeleton={5} title="Carregando chamados" />;
  } else {
    vazio = <StateView kind="empty" icon="checkmark-done-outline" title="Nada aqui" description={rot.vazio} />;
  }

  return (
    <FlatList
      data={itens}
      keyExtractor={(c) => String(c.id)}
      contentContainerStyle={{ paddingBottom: insets.bottom + Spacing[10], gap: Spacing[2] }}
      ListHeaderComponent={cabecalho}
      ListEmptyComponent={vazio}
      renderItem={({ item }) => <LinhaChamado chamado={item} />}
      ListFooterComponent={
        itens.length === 0 ? null : erro ? (
          <StateView kind="error" description={erro} onRetry={() => carregar(pagina + 1)} />
        ) : temMais ? (
          <Button variant="secondary" onPress={() => carregar(pagina + 1)} loading={carregando} block>
            Carregar mais
          </Button>
        ) : null
      }
    />
  );
}

function LinhaChamado({ chamado }: { chamado: ChamadoBi }) {
  const colors = useColors();
  const cor = corDoStatus(colors, chamado.status);
  const prazo = descreverPrazo(chamado);
  const local = [chamado.rua, chamado.bairro].filter(Boolean).join(', ');
  const situacao = chamado.status_rotulo || rotuloOperacao(chamado.status);
  const quem = chamado.atendente_nome
    ? `com ${chamado.atendente_nome}`
    : chamado.equipe_nome
      ? `com ${chamado.equipe_nome}`
      : chamado.sla_restante_horas != null
        ? 'sem responsável'
        : null;
  const meta = [chamado.protocolo, chamado.categoria_nome, quem].filter(Boolean).join(' · ');

  return (
    <Pressable
      onPress={() => abrirChamado(chamado.id)}
      accessibilityRole="button"
      accessibilityLabel={`${chamado.titulo}. ${situacao}. ${prazo?.texto ?? ''}. ${local}. ${meta}`}
      accessibilityHint="Abre o chamado no mapa"
      style={({ pressed }) => [
        styles.linha,
        { backgroundColor: pressed ? colors.surfacePressed : colors.surface, borderColor: colors.border },
      ]}>
      <View style={styles.linhaTopo}>
        <AppText variant="label" style={styles.flex1} numberOfLines={2}>
          {chamado.titulo}
        </AppText>
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </View>
      <View style={styles.selos}>
        <Badge label={situacao} color={cor} size="sm" icon="ellipse" />
        {prazo ? <Badge label={prazo.texto} tone={prazo.tom} icon={prazo.icone} size="sm" /> : null}
      </View>
      {local ? (
        <AppText variant="caption" tone="secondary" numberOfLines={1}>
          {local}
        </AppText>
      ) : null}
      <AppText variant="caption" tone="muted" numberOfLines={1}>
        {meta}
      </AppText>
    </Pressable>
  );
}

function descreverPrazo(c: ChamadoBi) {
  // Fechado: o que importa é se cumpriu o prazo.
  if (c.no_prazo != null) {
    return c.no_prazo
      ? { texto: 'Resolvido no prazo', tom: 'success' as const, icone: 'checkmark-circle' as const }
      : { texto: 'Resolvido fora do prazo', tom: 'warning' as const, icone: 'alert-circle' as const };
  }
  const h = c.sla_restante_horas;
  if (h == null) return c.sla_vencido ? { texto: 'Prazo vencido', tom: 'danger' as const, icone: 'alarm' as const } : null;
  if (h < 0 || c.sla_vencido) {
    return { texto: `Vencido há ${fmtHoras(Math.abs(h))}`, tom: 'danger' as const, icone: 'alarm' as const };
  }
  if (h <= 24) return { texto: `Vence em ${fmtHoras(h)}`, tom: 'warning' as const, icone: 'time' as const };
  return { texto: `Prazo em ${fmtHoras(h)}`, tom: 'neutral' as const, icone: 'calendar-outline' as const };
}

const styles = StyleSheet.create({
  tela: {
    flex: 1,
  },
  cabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[1],
    paddingHorizontal: Spacing[2],
    paddingVertical: Spacing[2],
    width: '100%',
    maxWidth: 1200,
    alignSelf: 'center',
  },
  limite: {
    width: '100%',
    maxWidth: 1200,
    alignSelf: 'center',
    paddingHorizontal: Layout.gutter,
  },
  flex1: {
    flex: 1,
  },
  ordem: {
    marginHorizontal: -Layout.gutter,
    paddingBottom: Spacing[2],
  },
  total: {
    paddingBottom: Spacing[1],
  },
  cabecalhoLista: {
    gap: Spacing[1],
  },
  linha: {
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing[3],
    gap: Spacing[2],
    minHeight: Layout.minTouch,
  },
  linhaTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
  posicao: {
    minWidth: 24,
  },
  metricas: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[3],
  },
  metrica: {
    minWidth: 80,
  },
  selos: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[1.5],
  },
});
