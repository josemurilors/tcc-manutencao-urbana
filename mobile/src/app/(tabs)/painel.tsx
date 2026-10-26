/**
 * Painel executivo (contrato v3, §7.4 — `api/v1/bi/`), para gestor+.
 *
 * Hierarquia pensada para o secretário que abre o app entre duas reuniões:
 * 1. Em 10 segundos: uma frase que resume a situação e os quatro números que
 *    respondem "estamos dando conta?" — fila aberta, vencidos, % no prazo e
 *    tempo típico de solução, cada um com a variação contra o período
 *    anterior colorida pela polaridade (fila subindo é ruim).
 * 2. Fluxo: entrou × saiu e a fila ao longo do tempo.
 * 3. Onde agir: ranking por categoria/bairro/secretaria/equipe, idade da
 *    fila, pontos que concentram e que reincidem — tudo tocável até o chamado.
 * 4. Qualidade e equipe: demais KPIs, satisfação do cidadão e produtividade.
 *
 * Cada seção carrega sozinha (ver `use-secao`): uma rota fora do ar derruba só
 * o próprio cartão, nunca a tela.
 */

import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { podeVerPainel } from '@/components/bi/acesso';
import { BarraFiltros } from '@/components/bi/barra-filtros';
import { useCoresGrafico } from '@/components/bi/cores';
import { FolhaExportar } from '@/components/bi/exportar';
import {
  descreverPeriodo,
  diasNoIntervalo,
  fmtBalde,
  fmtBaldeLongo,
  fmtDataCurta,
  fmtDataLonga,
  fmtDecimal,
  fmtHoras,
  fmtNumero,
  fmtPct,
  granularidadePara,
} from '@/components/bi/formato';
import { ListaHotspots } from '@/components/bi/hotspots';
import { ListaSugestoes, ListaSugestoesIa } from '@/components/bi/sugestoes';
import {
  calcularDelta,
  fmtKpi,
  fmtKpiExtenso,
  KPIS,
  valorKpi,
} from '@/components/bi/metricas';
import { abrirDrill, ROTULO_DIMENSAO } from '@/components/bi/navegar';
import { useFiltrosBi } from '@/components/bi/use-filtros-bi';
import { useSecao, type Secao } from '@/components/bi/use-secao';
import { ChartCard, ColumnChart, HorizontalBarChart, Legenda, LineChart } from '@/components/charts';
import { IconButton } from '@/components/ui/icon-button';
import { KpiCard } from '@/components/ui/kpi-card';
import { LARGURA_MAX_CONTEUDO, ResponsiveGrid, useBreakpoint } from '@/components/ui/responsive';
import { SectionHeader } from '@/components/ui/section-header';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton } from '@/components/ui/skeleton';
import { StateView } from '@/components/ui/state-view';
import { AppText } from '@/components/ui/text';
import { corDoTom, Layout, Radius, Spacing, type Tom } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useColors } from '@/context/theme-context';
import { api } from '@/services/api';
import { apiBi } from '@/services/api-bi';
import type { BiChaveKpi, BiFiltros, BiKpisResposta, DimensaoBi, RecorteLista } from '@/types/bi';

/** Os quatro números do topo, na ordem de leitura. */
const KPIS_TOPO: BiChaveKpi[] = ['backlog', 'backlog_vencido', 'pct_no_prazo', 'lead_time_p50_h'];
const KPIS_SECUNDARIOS: BiChaveKpi[] = [
  'recebidos',
  'resolvidos',
  'taxa_resolucao',
  'primeira_resposta_p50_h',
  'lead_time_p90_h',
  'reabertura_pct',
  'rejeitados',
  'cidadaos_ativos',
];

/** KPIs de contagem que abrem a lista dos chamados contados. */
const RECORTE_DO_KPI: Partial<Record<BiChaveKpi, RecorteLista>> = {
  recebidos: 'recebidos',
  resolvidos: 'resolvidos',
  rejeitados: 'rejeitados',
};

const DIMENSOES_RANKING: { value: Exclude<DimensaoBi, 'status'>; label: string }[] = [
  { value: 'categoria', label: 'Categoria' },
  { value: 'bairro', label: 'Bairro' },
  { value: 'secretaria', label: 'Secretaria' },
  { value: 'equipe', label: 'Equipe' },
];

const LARGURA_MAX = LARGURA_MAX_CONTEUDO;

export default function PainelScreen() {
  const { user, isAuthenticated } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  if (!isAuthenticated || !podeVerPainel(user)) {
    return (
      <View style={[styles.tela, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
        <StateView
          kind="empty"
          icon="lock-closed-outline"
          title="Painel restrito à gestão"
          description="Os indicadores do município ficam disponíveis para gestores e administradores da prefeitura."
        />
      </View>
    );
  }

  return <PainelGestor />;
}

function PainelGestor() {
  const colors = useColors();
  const cg = useCoresGrafico();
  const insets = useSafeAreaInsets();
  const { largura: width } = useBreakpoint();
  const { user } = useAuth();
  const { filtros, rotulos, pronto, erroPersistencia, aplicar, escolherPeriodo, limparRecortes } = useFiltrosBi(
    user?.id,
  );

  const [dimensao, setDimensao] = useState<Exclude<DimensaoBi, 'status'>>('categoria');
  const [exportarAberto, setExportarAberto] = useState(false);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const [puxando, setPuxando] = useState(false);

  const chave = JSON.stringify(filtros);
  const granularidade = granularidadePara(filtros.inicio, filtros.fim);
  const f = pronto ? filtros : null;

  // Cada seção some da lista de espera quando os filtros ainda não foram lidos.
  const kpis = useSecao(
    f
      ? () =>
          apiBi.kpis(f).then((r) => {
            setAtualizadoEm(new Date());
            return r;
          })
      : null,
    chave,
  );
  const series = useSecao(f ? () => apiBi.series(f, granularidade) : null, `${chave}|${granularidade}`);
  const ranking = useSecao(f ? () => apiBi.distribuicao(f, dimensao) : null, `${chave}|${dimensao}`, false);
  const aging = useSecao(f ? () => apiBi.aging(f) : null, chave);
  const satisfacao = useSecao(f ? () => apiBi.satisfacao(f) : null, chave);
  const produtividade = useSecao(f ? () => apiBi.produtividade(f) : null, chave);
  const hotspots = useSecao(f ? () => apiBi.hotspots(f) : null, chave);
  // Regras sobre o município inteiro: não dependem dos filtros, carregam uma vez.
  const sugestoes = useSecao(f ? () => api.adminEstatisticas() : null, 'sugestoes');
  // Achados da IA leve: abertos recentes do município, também fora dos filtros.
  const sugestoesIa = useSecao(f ? () => apiBi.sugestoesIa(f) : null, 'sugestoes-ia');

  const secoes = [kpis, series, ranking, aging, satisfacao, produtividade, hotspots, sugestoes, sugestoesIa];
  const secoesRef = useRef(secoes);
  const atualizadoRef = useRef(atualizadoEm);
  useEffect(() => {
    secoesRef.current = secoes;
    atualizadoRef.current = atualizadoEm;
  });

  const recarregarTudo = useCallback(async () => {
    await Promise.all(secoesRef.current.map((s) => s.recarregar()));
  }, []);

  // Voltar à aba depois de horas (o app fica aberto na mesa) traz dado novo,
  // mas não a cada troca rápida de aba: só se o último carregamento tem 5 min.
  useFocusEffect(
    useCallback(() => {
      const ultimo = atualizadoRef.current;
      if (ultimo && Date.now() - ultimo.getTime() > 5 * 60_000) recarregarTudo();
    }, [recarregarTudo]),
  );

  async function puxarParaAtualizar() {
    setPuxando(true);
    try {
      await recarregarTudo();
    } finally {
      setPuxando(false);
    }
  }

  // Recorte ativo sem rótulo salvo (veio de versão antiga) ainda aparece, pelo valor.
  const recortes = [
    filtros.categoria_id ? (rotulos.categoria ?? `Categoria ${filtros.categoria_id}`) : null,
    filtros.secretaria_id ? (rotulos.secretaria ?? `Secretaria ${filtros.secretaria_id}`) : null,
    filtros.equipe_id ? (rotulos.equipe ?? `Equipe ${filtros.equipe_id}`) : null,
    filtros.bairro ? (rotulos.bairro ?? filtros.bairro) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const comparacao = textoComparacao(kpis.dados, filtros);
  const largo = width >= 900;

  return (
    <View style={[styles.tela, { backgroundColor: colors.bg }]}>
      <ScrollView
        contentContainerStyle={[
          styles.conteudo,
          { paddingTop: insets.top + Spacing[3], paddingBottom: insets.bottom + Spacing[16] },
        ]}
        refreshControl={
          <RefreshControl refreshing={puxando} onRefresh={puxarParaAtualizar} tintColor={colors.primaryText} />
        }>
        <View style={styles.limite}>
          {/* Cabeçalho */}
          <View style={styles.cabecalho}>
            <View style={styles.flex1}>
              <AppText variant="headline" accessibilityRole="header">
                Painel da gestão
              </AppText>
              <AppText variant="caption" tone="muted">
                {[user?.municipio?.nome, atualizadoEm ? `Dados de ${fmtHoraMinuto(atualizadoEm)}` : null]
                  .filter(Boolean)
                  .join(' · ') || 'Indicadores do município'}
              </AppText>
            </View>
            <IconButton
              icon="refresh"
              accessibilityLabel="Atualizar dados"
              onPress={recarregarTudo}
              loading={secoes.some((s) => s.carregando) && !!atualizadoEm}
            />
            <IconButton
              icon="download-outline"
              variant="surface"
              accessibilityLabel="Exportar planilha ou relatório"
              onPress={() => setExportarAberto(true)}
            />
          </View>
        </View>

        <View style={styles.limiteSemGutter}>
          <BarraFiltros
            filtros={filtros}
            rotulos={rotulos}
            onPeriodo={escolherPeriodo}
            onAplicar={aplicar}
            onLimpar={limparRecortes}
          />
        </View>

        <View style={[styles.limite, styles.secoes]}>
          <AppText variant="caption" tone="secondary" accessibilityLiveRegion="polite">
            {descreverPeriodo(filtros.periodo, filtros.inicio, filtros.fim)}
            {filtros.periodo !== 'personalizado'
              ? ` (${fmtDataCurta(filtros.inicio)} a ${fmtDataCurta(filtros.fim)})`
              : ''}
            {recortes ? ` · ${recortes}` : ''}
            {comparacao ? ` · comparado com ${comparacao.intervalo}` : ''}
          </AppText>
          {erroPersistencia ? (
            <AppText variant="caption" tone="warning">
              Não foi possível lembrar seus filtros neste aparelho ({erroPersistencia}).
            </AppText>
          ) : null}

          {/* 1. Em 10 segundos */}
          <View style={styles.secao}>
            {kpis.erro && !kpis.dados ? (
              <StateView
                kind="error"
                title="Indicadores indisponíveis"
                description={kpis.erro}
                onRetry={kpis.recarregar}
              />
            ) : !kpis.dados ? (
              <EsqueletoKpis quantos={4} />
            ) : (
              <>
                <Manchete dados={kpis.dados} />
                <GradeKpi>
                  {KPIS_TOPO.map((k) => (
                    <CartaoKpi
                      key={k}
                      chave={k}
                      dados={kpis.dados as BiKpisResposta}
                      comparacao={comparacao?.curto}
                      destaque
                      onPress={
                        k === 'backlog_vencido'
                          ? () => abrirDrill(filtros, 'vencidos')
                          : k === 'backlog'
                            ? () => abrirDrill(filtros, 'status')
                            : undefined
                      }
                    />
                  ))}
                </GradeKpi>
              </>
            )}
          </View>

          {/* 2. Fluxo */}
          <View style={[styles.secao, largo && styles.duasColunas]}>
            <View style={[styles.coluna, largo && styles.colunaLarga]}>
              <SecaoGrafico secao={series} titulo="Entradas e saídas">
                {(dados) => {
                  const rotulosX = dados.map((d) => fmtBalde(d.periodo, granularidade));
                  const longos = dados.map((d) => fmtBaldeLongo(d.periodo, granularidade));
                  const porGran = granularidade === 'dia' ? 'por dia' : granularidade === 'semana' ? 'por semana' : 'por mês';
                  return (
                    <ChartCard
                      title="Entradas e saídas"
                      subtitle={`Chamados recebidos e resolvidos ${porGran}. Resolvidos abaixo dos recebidos = fila crescendo.`}
                      tabela={{
                        colunas: ['Período', 'Recebidos', 'Resolvidos', 'Em aberto'],
                        linhas: dados.map((d, i) => [longos[i], d.recebidos, d.resolvidos, d.backlog]),
                      }}>
                      <Legenda
                        itens={[
                          { cor: cg.recebidos, rotulo: 'Recebidos', forma: 'linha' },
                          { cor: cg.resolvidos, rotulo: 'Resolvidos', forma: 'linha' },
                        ]}
                      />
                      <LineChart
                        titulo={`Recebidos e resolvidos ${porGran}`}
                        rotulosX={rotulosX}
                        rotulosLongos={longos}
                        formatarValor={fmtNumero}
                        series={[
                          { key: 'rec', label: 'Recebidos', color: cg.recebidos, values: dados.map((d) => d.recebidos) },
                          { key: 'res', label: 'Resolvidos', color: cg.resolvidos, values: dados.map((d) => d.resolvidos) },
                        ]}
                      />
                    </ChartCard>
                  );
                }}
              </SecaoGrafico>
            </View>
            <View style={[styles.coluna, largo && styles.colunaLarga]}>
              <SecaoGrafico secao={series} titulo="Fila em aberto">
                {(dados) => {
                  const longos = dados.map((d) => fmtBaldeLongo(d.periodo, granularidade));
                  const primeiro = dados[0]?.backlog ?? 0;
                  const ultimo = dados[dados.length - 1]?.backlog ?? 0;
                  return (
                    <ChartCard
                      title="Fila em aberto"
                      subtitle={
                        dados.length > 1
                          ? `De ${fmtNumero(primeiro)} para ${fmtNumero(ultimo)} chamados no período${
                              ultimo > primeiro ? ' — subindo' : ultimo < primeiro ? ' — caindo' : ''
                            }.`
                          : 'Chamados abertos ao fim de cada período.'
                      }
                      tabela={{
                        colunas: ['Período', 'Em aberto'],
                        linhas: dados.map((d, i) => [longos[i], d.backlog]),
                      }}>
                      <LineChart
                        titulo="Chamados em aberto ao fim de cada período"
                        rotulosX={dados.map((d) => fmtBalde(d.periodo, granularidade))}
                        rotulosLongos={longos}
                        formatarValor={fmtNumero}
                        series={[
                          {
                            key: 'backlog',
                            label: 'Em aberto',
                            color: cg.backlog,
                            values: dados.map((d) => d.backlog),
                            area: true,
                          },
                        ]}
                      />
                    </ChartCard>
                  );
                }}
              </SecaoGrafico>
            </View>
          </View>

          {/* 3. Onde agir */}
          <View style={styles.secao}>
            <SectionHeader
              title="Onde agir"
              subtitle="Toque numa barra para ver os chamados abertos daquela fatia."
            />
            <View style={[styles.secao, largo && styles.duasColunas]}>
              <View style={[styles.coluna, largo && styles.colunaLarga]}>
                <ChartCard
                  title={`Abertos por ${ROTULO_DIMENSAO[dimensao].singular.toLowerCase()}`}
                  subtitle="Em vermelho, a parte com prazo vencido."
                  action={{
                    label: 'Ver todos',
                    onPress: () => abrirDrill(filtros, dimensao),
                    accessibilityLabel: `Ver todos os ${ROTULO_DIMENSAO[dimensao].plural.toLowerCase()} em tabela`,
                  }}
                  tabela={
                    ranking.dados
                      ? {
                          colunas: [ROTULO_DIMENSAO[dimensao].singular, 'Abertos', 'Vencidos', 'Recebidos', 'Resolvidos', 'No prazo', 'Tempo típico'],
                          linhas: ordenarRanking(ranking.dados).map((l) => [
                            l.rotulo || String(l.chave),
                            l.abertos,
                            l.vencidos,
                            l.recebidos,
                            l.resolvidos,
                            fmtPct(l.pct_no_prazo),
                            fmtHoras(l.lead_time_p50_h),
                          ]),
                        }
                      : undefined
                  }>
                  <SegmentedControl
                    options={DIMENSOES_RANKING}
                    value={dimensao}
                    onChange={setDimensao}
                    accessibilityLabel="Agrupar por"
                  />
                  {ranking.erro && !ranking.dados ? (
                    <StateView kind="error" description={ranking.erro} onRetry={ranking.recarregar} />
                  ) : !ranking.dados ? (
                    <Skeleton height={180} />
                  ) : (
                    <HorizontalBarChart
                      titulo={`Ranking de chamados abertos por ${ROTULO_DIMENSAO[dimensao].singular.toLowerCase()}`}
                      itens={ordenarRanking(ranking.dados)
                        .slice(0, 8)
                        .map((l) => ({
                          chave: String(l.chave),
                          rotulo: l.rotulo || 'Não informado',
                          valor: l.abertos,
                          critico: l.vencidos,
                          detalhe: [
                            l.pct_no_prazo != null ? `${fmtPct(l.pct_no_prazo)} no prazo` : null,
                            l.lead_time_p50_h != null ? `${fmtHoras(l.lead_time_p50_h)} típico` : null,
                            `${fmtNumero(l.recebidos)} recebidos`,
                          ]
                            .filter(Boolean)
                            .join(' · '),
                        }))}
                      formatarValor={fmtNumero}
                      rotuloCritico="vencidos"
                      cor={cg.unica}
                      vazio="Nenhum chamado aberto neste recorte."
                      dicaToque="Abre a lista de chamados abertos"
                      onPressItem={(item) => abrirDrill(filtros, dimensao, { chave: item.chave, rotulo: item.rotulo })}
                    />
                  )}
                </ChartCard>
              </View>

              <View style={[styles.coluna, largo && styles.colunaLarga]}>
                <SecaoGrafico secao={aging} titulo="Idade da fila">
                  {(dados) => {
                    const total = dados.reduce((a, d) => a + d.total, 0);
                    const vencidos = dados.reduce((a, d) => a + d.vencidos, 0);
                    return (
                      <ChartCard
                        title="Idade da fila"
                        subtitle={`Há quanto tempo os ${fmtNumero(total)} chamados abertos esperam${
                          vencidos ? `; ${fmtNumero(vencidos)} já passaram do prazo` : ''
                        }.`}
                        action={
                          vencidos
                            ? {
                                label: 'Ver vencidos',
                                onPress: () => abrirDrill(filtros, 'vencidos'),
                                accessibilityLabel: `Ver os ${vencidos} chamados com prazo vencido`,
                              }
                            : undefined
                        }
                        tabela={{
                          colunas: ['Aberto há', 'Total', 'No prazo', 'Vencidos'],
                          linhas: dados.map((d) => [rotuloFaixa(d.faixa), d.total, d.total - d.vencidos, d.vencidos]),
                        }}>
                        <Legenda
                          itens={[
                            { cor: cg.unica, rotulo: 'Dentro do prazo' },
                            { cor: cg.critico, rotulo: 'Prazo vencido' },
                          ]}
                        />
                        <ColumnChart
                          titulo="Chamados abertos por tempo de espera"
                          formatarValor={fmtNumero}
                          itens={dados.map((d) => ({
                            chave: d.faixa,
                            rotulo: d.faixa.replace('>', '+'),
                            partes: [
                              { valor: Math.max(d.total - d.vencidos, 0), cor: cg.unica, rotulo: 'no prazo' },
                              { valor: d.vencidos, cor: cg.critico, rotulo: 'vencidos' },
                            ],
                          }))}
                          descrever={(item) => {
                            const d = dados.find((x) => x.faixa === item.chave);
                            if (!d) return item.rotulo;
                            return `${rotuloFaixa(d.faixa)}: ${fmtNumero(d.total)} chamados, ${fmtNumero(d.vencidos)} com prazo vencido`;
                          }}
                        />
                      </ChartCard>
                    );
                  }}
                </SecaoGrafico>
              </View>
            </View>

            <SecaoGrafico secao={hotspots} titulo="Pontos críticos">
              {(dados) => (
                <ChartCard
                  title="Pontos críticos"
                  subtitle="Onde os chamados se concentram e onde o mesmo problema volta.">
                  <ListaHotspots
                    dados={dados}
                    onAbrirReincidencia={(r) =>
                      // A reincidência conta os recebidos no período: a lista mostra esses, da mesma categoria.
                      abrirDrill(
                        r.categoria_id != null ? { ...filtros, categoria_id: String(r.categoria_id) } : filtros,
                        'bairro',
                        { chave: r.bairro, rotulo: `${r.categoria} · ${r.bairro}` },
                        'recebidos',
                      )
                    }
                  />
                </ChartCard>
              )}
            </SecaoGrafico>

            <SecaoGrafico secao={sugestoes} titulo="Sugestões de ação">
              {(dados) => (
                <ChartCard
                  title="Sugestões de ação"
                  subtitle="Calculadas sobre o município inteiro, nos últimos meses — não seguem os filtros acima.">
                  <ListaSugestoes dados={dados} />
                </ChartCard>
              )}
            </SecaoGrafico>

            <SecaoGrafico secao={sugestoesIa} titulo="Achados da IA">
              {(dados) => (
                <ChartCard
                  title="Achados da IA"
                  subtitle="A IA do sistema lê os relatos abertos: agrupa os que descrevem o mesmo problema e destaca os que citam risco.">
                  <ListaSugestoesIa dados={dados} />
                </ChartCard>
              )}
            </SecaoGrafico>
          </View>

          {/* 4. Qualidade e equipe */}
          <View style={styles.secao}>
            <SectionHeader title="Demanda e qualidade" subtitle="Toque em ⓘ para ver como cada número é calculado." />
            {kpis.dados ? (
              <GradeKpi>
                {KPIS_SECUNDARIOS.map((k) => {
                  const recorte = RECORTE_DO_KPI[k];
                  return (
                    <CartaoKpi
                      key={k}
                      chave={k}
                      dados={kpis.dados as BiKpisResposta}
                      comparacao={comparacao?.curto}
                      onPress={recorte ? () => abrirDrill(filtros, 'todos', null, recorte) : undefined}
                    />
                  );
                })}
              </GradeKpi>
            ) : kpis.erro ? null : (
              <EsqueletoKpis quantos={4} />
            )}
          </View>

          <View style={[styles.secao, largo && styles.duasColunas]}>
            <View style={[styles.coluna, largo && styles.colunaLarga]}>
              <SecaoGrafico secao={satisfacao} titulo="Satisfação do cidadão">
                {(dados) => {
                  const notas = [1, 2, 3, 4, 5].map((n) => Number(dados.distribuicao?.[String(n)] ?? 0));
                  const totalNotas = notas.reduce((a, b) => a + b, 0);
                  const delta = kpis.dados
                    ? calcularDelta('csat_media', dados.media, valorKpi(kpis.dados.kpis_anterior, 'csat_media'))
                    : null;
                  return (
                    <ChartCard
                      title="Satisfação do cidadão"
                      subtitle="Notas de 1 a 5 dadas pelos autores dos chamados resolvidos."
                      tabela={{
                        colunas: ['Nota', 'Avaliações', '% do total'],
                        linhas: notas.map((q, i) => [
                          `${i + 1} ${i === 0 ? 'estrela' : 'estrelas'}`,
                          q,
                          fmtPct(totalNotas ? (q / totalNotas) * 100 : null),
                        ]),
                      }}>
                      <View style={styles.csatTopo} accessible accessibilityLabel={`Nota média ${fmtKpiExtenso('nota', dados.media)}, ${fmtNumero(dados.respostas)} avaliações${delta ? `, ${delta.extenso}` : ''}`}>
                        <AppText variant="display">{dados.media == null ? '—' : fmtDecimal(dados.media)}</AppText>
                        <View style={styles.flex1}>
                          <Estrelas nota={dados.media ?? 0} />
                          <AppText variant="caption" tone="muted">
                            {fmtNumero(dados.respostas)} avaliações
                            {delta && delta.direcao !== 'igual'
                              ? ` · ${delta.texto} ${delta.avaliacao === 'bom' ? 'melhor' : 'pior'} ${comparacao?.curto ?? ''}`
                              : ''}
                          </AppText>
                        </View>
                      </View>
                      {dados.respostas > 0 && dados.respostas < 20 ? (
                        <AppText variant="caption" tone="warning">
                          Poucas avaliações: a média ainda pode mudar bastante.
                        </AppText>
                      ) : null}
                      <ColumnChart
                        titulo="Distribuição das notas"
                        height={150}
                        formatarValor={fmtNumero}
                        itens={notas.map((q, i) => ({
                          chave: String(i + 1),
                          rotulo: `${i + 1}★`,
                          partes: [{ valor: q, cor: cg.notas[i], rotulo: 'avaliações' }],
                        }))}
                        descrever={(item) => {
                          const q = notas[Number(item.chave) - 1];
                          return `Nota ${item.chave}: ${fmtNumero(q)} avaliações (${fmtPct(totalNotas ? (q / totalNotas) * 100 : null)})`;
                        }}
                      />
                      {dados.comentarios?.length ? (
                        <View style={styles.comentarios}>
                          <AppText variant="label">Últimos comentários</AppText>
                          {dados.comentarios.slice(0, 3).map((c, i) => (
                            <View
                              key={`${c.protocolo ?? i}-${c.criado_em}`}
                              style={[styles.comentario, { borderLeftColor: cg.notas[Math.min(Math.max(c.nota, 1), 5) - 1] }]}
                              accessible
                              accessibilityLabel={`Nota ${c.nota}: ${c.comentario}`}>
                              <AppText variant="bodySm" numberOfLines={3}>
                                “{c.comentario}”
                              </AppText>
                              <AppText variant="caption" tone="muted">
                                {c.nota}★{c.protocolo ? ` · ${c.protocolo}` : ''} · {fmtDataLonga(c.criado_em.slice(0, 10))}
                              </AppText>
                            </View>
                          ))}
                        </View>
                      ) : null}
                    </ChartCard>
                  );
                }}
              </SecaoGrafico>
            </View>

            <View style={[styles.coluna, largo && styles.colunaLarga]}>
              <SecaoGrafico secao={produtividade} titulo="Produtividade da equipe">
                {(todos) => {
                  // Gestor e admin sem nada atribuído só poluiriam o gráfico; a tabela mostra todos.
                  const dados = todos.filter((p) => p.concluidos > 0 || p.em_andamento > 0);
                  return (
                  <ChartCard
                    title="Produtividade da equipe"
                    subtitle="Chamados concluídos por servidor no período."
                    tabela={{
                      colunas: ['Servidor', 'Concluídos', 'Em andamento', 'Tempo típico', 'Equipe'],
                      linhas: [...todos]
                        .sort((a, b) => b.concluidos - a.concluidos)
                        .map((p) => [p.nome, p.concluidos, p.em_andamento, fmtHoras(p.lead_time_p50_h), p.equipe_nome ?? '—']),
                    }}>
                    <HorizontalBarChart
                      titulo="Concluídos por servidor"
                      itens={[...dados]
                        .sort((a, b) => b.concluidos - a.concluidos)
                        .slice(0, 10)
                        .map((p) => ({
                          chave: String(p.usuario_id),
                          rotulo: p.equipe_nome ? `${p.nome} · ${p.equipe_nome}` : p.nome,
                          valor: p.concluidos,
                          detalhe: [
                            `${fmtNumero(p.em_andamento)} em andamento`,
                            p.lead_time_p50_h != null ? `${fmtHoras(p.lead_time_p50_h)} típico` : null,
                          ]
                            .filter(Boolean)
                            .join(' · '),
                        }))}
                      formatarValor={fmtNumero}
                      cor={cg.resolvidos}
                      vazio="Nenhum chamado com servidor responsável no período. Atribua os chamados na Operação para medir a produtividade."
                    />
                  </ChartCard>
                  );
                }}
              </SecaoGrafico>
            </View>
          </View>
        </View>
      </ScrollView>

      <FolhaExportar
        visivel={exportarAberto}
        onFechar={() => setExportarAberto(false)}
        filtros={filtros}
        recortes={recortes}
      />
    </View>
  );
}

/* --------------------------------------------------------------- pedaços */

function CartaoKpi({
  chave,
  dados,
  comparacao,
  destaque,
  onPress,
}: {
  chave: BiChaveKpi;
  dados: BiKpisResposta;
  comparacao?: string;
  destaque?: boolean;
  onPress?: () => void;
}) {
  const def = KPIS[chave];
  const atual = valorKpi(dados.kpis, chave);
  const anterior = valorKpi(dados.kpis_anterior, chave);
  return (
    <KpiCard
      title={def.titulo}
      value={fmtKpi(def.formato, atual)}
      valueA11y={fmtKpiExtenso(def.formato, atual)}
      icon={def.icone}
      ajuda={def.ajuda}
      delta={calcularDelta(chave, atual, anterior)}
      comparacao={dados.kpis_anterior ? comparacao : undefined}
      destaque={destaque}
      alerta={chave === 'backlog_vencido' && (atual ?? 0) > 0}
      onPress={onPress}
      onPressHint={onPress ? 'Abre a lista de chamados' : undefined}
    />
  );
}

/**
 * A frase do topo: o que mudou, em português de gabinete. Monta só com o que
 * veio do servidor; KPI ausente simplesmente não entra na frase.
 */
function Manchete({ dados }: { dados: BiKpisResposta }) {
  const colors = useColors();
  const { kpis, kpis_anterior: ant } = dados;
  const partes: string[] = [];
  let tom: Tom = 'success';

  // Sem fila no período anterior (cidade começando a usar), "cresceu 97" não informa nada.
  const backlogAnterior = valorKpi(ant, 'backlog');
  const dBacklog = backlogAnterior ? calcularDelta('backlog', kpis.backlog, backlogAnterior) : null;
  if (dBacklog && dBacklog.direcao !== 'igual') {
    partes.push(
      `A fila ${dBacklog.direcao === 'subiu' ? 'cresceu' : 'diminuiu'} ${dBacklog.texto.replace(/^[+−]/, '')} e está em ${fmtNumero(kpis.backlog)} chamados abertos`,
    );
    if (dBacklog.avaliacao === 'ruim') tom = 'warning';
  } else {
    partes.push(`${fmtNumero(kpis.backlog)} chamados abertos`);
  }

  if (kpis.backlog_vencido > 0) {
    const pct = kpis.backlog > 0 ? Math.round((kpis.backlog_vencido / kpis.backlog) * 100) : null;
    partes.push(`${fmtNumero(kpis.backlog_vencido)} já passaram do prazo${pct != null ? ` (${pct}% da fila)` : ''}`);
    tom = pct != null && pct >= 20 ? 'danger' : 'warning';
  }

  if (kpis.recebidos > 0 || kpis.resolvidos > 0) {
    const saldo = kpis.resolvidos - kpis.recebidos;
    partes.push(
      `entraram ${fmtNumero(kpis.recebidos)} e foram resolvidos ${fmtNumero(kpis.resolvidos)}${
        saldo < 0 ? ' — a prefeitura está resolvendo menos do que recebe' : saldo > 0 ? ' — a fila está sendo vencida' : ''
      }`,
    );
  }

  if (kpis.pct_no_prazo != null) partes.push(`${fmtPct(kpis.pct_no_prazo)} resolvidos no prazo`);

  const frase = partes.length ? partes.join('; ').replace(/^./, (c) => c.toUpperCase()) + '.' : '';
  const cor = corDoTom(colors, tom);
  const icone = tom === 'success' ? 'checkmark-circle' : tom === 'danger' ? 'alert-circle' : 'warning';

  return (
    <View
      style={[styles.manchete, { backgroundColor: cor.bg, borderColor: cor.border }]}
      accessible
      accessibilityRole="summary"
      accessibilityLabel={`Resumo: ${frase}`}>
      <Ionicons name={icone} size={22} color={cor.fg} />
      <AppText variant="bodySm" style={styles.flex1}>
        {frase}
      </AppText>
    </View>
  );
}

/** Envelope de seção com gráfico: carregando, erro com "tentar de novo" ou conteúdo. */
function SecaoGrafico<T>({
  secao,
  titulo,
  children,
}: {
  secao: Secao<T>;
  titulo: string;
  children: (dados: T) => React.ReactNode;
}) {
  const colors = useColors();
  if (secao.dados) return <>{children(secao.dados)}</>;
  if (secao.erro) {
    return (
      <View style={[styles.cartaoErro, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <AppText variant="label">{titulo}</AppText>
        <StateView kind="error" description={secao.erro} onRetry={secao.recarregar} style={styles.erroCompacto} />
      </View>
    );
  }
  return (
    <View style={[styles.cartaoErro, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <AppText variant="label">{titulo}</AppText>
      <Skeleton height={160} />
    </View>
  );
}

/**
 * Grade dos cartões de KPI. No celular/tablet os cartões quebram linha pelo
 * `flexBasis` deles; no computador a grade é fixa em 4 colunas iguais.
 */
function GradeKpi({ children }: { children: React.ReactNode }) {
  const { desktop } = useBreakpoint();
  if (desktop) {
    return (
      // `row` na célula: o `flexBasis`/`flexGrow` do cartão vale na largura.
      <ResponsiveGrid columns={4} gap={Spacing[2]} itemStyle={styles.celulaKpi}>
        {children}
      </ResponsiveGrid>
    );
  }
  return <View style={styles.gradeKpi}>{children}</View>;
}

function EsqueletoKpis({ quantos }: { quantos: number }) {
  return (
    <View accessibilityLabel="Carregando indicadores" accessibilityRole="progressbar">
      <GradeKpi>
        {Array.from({ length: quantos }, (_, i) => (
          <View key={i} style={styles.kpiEsqueleto}>
            <Skeleton height={104} />
          </View>
        ))}
      </GradeKpi>
    </View>
  );
}

function Estrelas({ nota }: { nota: number }) {
  const colors = useColors();
  return (
    <View style={styles.estrelas} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[1, 2, 3, 4, 5].map((n) => (
        <Ionicons
          key={n}
          name={nota >= n - 0.25 ? 'star' : nota >= n - 0.75 ? 'star-half' : 'star-outline'}
          size={18}
          color={colors.warning}
        />
      ))}
    </View>
  );
}

/* -------------------------------------------------------------- funções */

function ordenarRanking<T extends { abertos: number; vencidos: number }>(linhas: T[]) {
  return [...linhas].sort((a, b) => b.abertos - a.abertos || b.vencidos - a.vencidos);
}

function rotuloFaixa(faixa: string) {
  switch (faixa) {
    case '0-2d':
      return 'até 2 dias';
    case '3-7d':
      return '3 a 7 dias';
    case '8-15d':
      return '8 a 15 dias';
    case '16-30d':
      return '16 a 30 dias';
    case '>30d':
      return 'mais de 30 dias';
    default:
      return faixa;
  }
}

/** "vs 30 dias anteriores" e o intervalo do período de comparação. */
function textoComparacao(dados: BiKpisResposta | null, f: BiFiltros) {
  const ant = dados?.anterior;
  if (!ant?.inicio || !ant?.fim) return null;
  const dias = diasNoIntervalo(f.inicio, f.fim);
  const curto =
    f.periodo === '12m' ? 'vs 12 meses anteriores' : `vs ${dias} ${dias === 1 ? 'dia anterior' : 'dias anteriores'}`;
  return { curto, intervalo: `${fmtDataLonga(ant.inicio)} a ${fmtDataLonga(ant.fim)}` };
}

function fmtHoraMinuto(d: Date) {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} às ${String(
    d.getHours(),
  ).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  tela: {
    flex: 1,
  },
  conteudo: {
    gap: Spacing[3],
  },
  limite: {
    width: '100%',
    maxWidth: LARGURA_MAX,
    alignSelf: 'center',
    paddingHorizontal: Layout.gutter,
  },
  limiteSemGutter: {
    width: '100%',
    maxWidth: LARGURA_MAX,
    alignSelf: 'center',
  },
  secoes: {
    gap: Layout.sectionGap,
  },
  secao: {
    gap: Spacing[3],
  },
  cabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[1],
  },
  flex1: {
    flex: 1,
  },
  gradeKpi: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
  },
  celulaKpi: {
    flexDirection: 'row',
  },
  kpiEsqueleto: {
    flexGrow: 1,
    flexBasis: 150,
  },
  manchete: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing[2],
    padding: Spacing[3],
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  duasColunas: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing[3],
  },
  coluna: {
    gap: Spacing[3],
  },
  // Só lado a lado: empilhado, `flex: 1` dividiria a altura entre as colunas
  // e abriria um buraco embaixo da mais baixa.
  colunaLarga: {
    flex: 1,
    minWidth: 0,
  },
  cartaoErro: {
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing[4],
    gap: Spacing[3],
  },
  erroCompacto: {
    paddingVertical: Spacing[4],
  },
  csatTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
  },
  estrelas: {
    flexDirection: 'row',
    gap: 2,
  },
  comentarios: {
    gap: Spacing[2],
  },
  comentario: {
    borderLeftWidth: 3,
    paddingLeft: Spacing[2],
    gap: 2,
  },
});
