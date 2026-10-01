/**
 * Painel "Transparência da cidade", aberto pela visão expandida do mapa.
 *
 * A primeira aba responde à pergunta que o cidadão (e o gestor numa demo)
 * faz primeiro: a prefeitura resolve? Mostra os indicadores públicos dos
 * últimos 90 dias (`GET /transparencia/<codigo>/`, contrato v3 §7.5) — quantos
 * resolveu, quanto no prazo, em quanto tempo e com que satisfação —, o
 * desempenho por tipo e os últimos resolvidos. As outras abas são os rankings
 * de abertos de antes, com os dados de `GET /defeitos/municipio/`.
 */

import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { FilterChips } from '@/components/ui/chips';
import { IconButton } from '@/components/ui/icon-button';
import { StateView } from '@/components/ui/state-view';
import { AppText } from '@/components/ui/text';
import { Elevation, Layout, Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import { transparencia as buscarTransparencia } from '@/services/api-mapa';
import type { Defeito, VisaoMunicipio } from '@/types';
import type { Transparencia } from '@/types/mapa';
import { totalApoios } from '@/utils/format';

type Aba = 'cidade' | 'tipos' | 'antigas' | 'apoiadas';

const ABAS: { value: Aba; label: string }[] = [
  { value: 'cidade', label: 'Desempenho' },
  { value: 'tipos', label: 'Abertos por tipo' },
  { value: 'antigas', label: 'Mais antigos' },
  { value: 'apoiadas', label: 'Mais confirmados' },
];

type Props = {
  visao: VisaoMunicipio;
  /** Emoji por nome de categoria, para os rankings. */
  icones: Map<string, string>;
  onSelecionar: (defeito: Defeito) => void;
  /** Abre um chamado que não está entre os abertos carregados (últimos resolvidos). */
  onAbrirChamado: (id: string) => void;
  onFechar: () => void;
};

function diasDesde(iso: string) {
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (dias <= 0) return 'hoje';
  if (dias === 1) return 'há 1 dia';
  if (dias < 30) return `há ${dias} dias`;
  const meses = Math.floor(dias / 30);
  return meses === 1 ? 'há 1 mês' : `há ${meses} meses`;
}

function nomeCategoria(d: Defeito) {
  return d.categoria_nome ?? d.categoria ?? '';
}

function dias(n: number | null | undefined) {
  if (n == null) return '—';
  const arredondado = n < 10 ? Math.round(n * 10) / 10 : Math.round(n);
  const texto = arredondado.toLocaleString('pt-BR');
  return arredondado === 1 ? '1 dia' : `${texto} dias`;
}

function pct(n: number | null | undefined) {
  return n == null ? '—' : `${Math.round(n)}%`;
}

export function MunicipioPanel({ visao, icones, onSelecionar, onAbrirChamado, onFechar }: Props) {
  const colors = useColors();
  const [aba, setAba] = useState<Aba>('cidade');
  const [recolhido, setRecolhido] = useState(false);
  const codigo = visao.municipio.codigo;
  // "Tentar de novo" sobe a tentativa e refaz a busca; a resposta guarda de
  // qual cidade/tentativa veio, e o carregando é derivado disso.
  const [tentativa, setTentativa] = useState(0);
  const [resposta, setResposta] = useState<{
    chave: string;
    dados: Transparencia | null;
    erro: string | null;
  } | null>(null);
  const chave = `${codigo}#${tentativa}`;

  useEffect(() => {
    let cancelado = false;
    buscarTransparencia(codigo)
      .then((dados) => {
        if (!cancelado) setResposta({ chave: `${codigo}#${tentativa}`, dados, erro: null });
      })
      .catch((err: unknown) => {
        if (cancelado) return;
        const erro = err instanceof Error ? err.message : 'Não foi possível carregar os indicadores.';
        setResposta({ chave: `${codigo}#${tentativa}`, dados: null, erro });
      });
    return () => {
      cancelado = true;
    };
  }, [codigo, tentativa]);

  const atual = resposta?.chave === chave ? resposta : null;
  const dados = atual?.dados ?? null;
  const erro = atual?.erro ?? null;
  const carregar = useCallback(() => setTentativa((n) => n + 1), []);

  const porId = useMemo(() => new Map(visao.defeitos.map((d) => [String(d.id), d])), [visao]);
  const lista = useMemo(() => {
    const ids = aba === 'antigas' ? visao.mais_antigos : visao.mais_apoiados;
    return ids.map((id) => porId.get(String(id))).filter((d): d is Defeito => !!d);
  }, [aba, visao, porId]);
  const maior = visao.tipos[0]?.total ?? 1;

  return (
    <View
      style={[
        styles.painel,
        Elevation.lg,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
      accessibilityLabel={`Transparência da cidade de ${visao.municipio.nome}`}>
      <View style={styles.cabecalho}>
        <Ionicons name="stats-chart" size={18} color={colors.primaryText} />
        <View style={styles.titulos}>
          <AppText variant="label" numberOfLines={1} accessibilityRole="header">
            Transparência · {visao.municipio.nome}/{visao.municipio.uf_sigla}
          </AppText>
          <AppText variant="caption" tone="muted">
            {visao.total_abertos === 1
              ? '1 chamado em aberto agora'
              : `${visao.total_abertos.toLocaleString('pt-BR')} chamados em aberto agora`}
          </AppText>
        </View>
        <IconButton
          icon={recolhido ? 'chevron-up' : 'chevron-down'}
          size="sm"
          accessibilityLabel={recolhido ? 'Expandir painel da cidade' : 'Recolher painel da cidade'}
          onPress={() => setRecolhido((v) => !v)}
        />
        <IconButton
          icon="close"
          size="sm"
          accessibilityLabel="Fechar a visão da cidade e voltar à navegação"
          onPress={onFechar}
        />
      </View>

      {recolhido ? null : (
        <>
          <FilterChips options={ABAS} value={aba} onChange={setAba} accessibilityLabel="Seção do painel" />

          <ScrollView style={styles.corpo} contentContainerStyle={styles.corpoConteudo}>
            {aba === 'cidade' ? (
              erro ? (
                <StateView
                  kind="error"
                  title="Indicadores indisponíveis"
                  description="Os números de desempenho desta cidade ainda não estão disponíveis. Os chamados em aberto continuam nas outras abas."
                  onRetry={carregar}
                  style={styles.estado}
                />
              ) : !dados ? (
                <StateView kind="loading" skeleton={0} title="Carregando indicadores..." style={styles.estado} />
              ) : (
                <Desempenho dados={dados} icones={icones} onAbrirChamado={onAbrirChamado} />
              )
            ) : visao.total_abertos === 0 ? (
              <StateView
                kind="empty"
                icon="checkmark-done-circle-outline"
                title="Nenhum chamado em aberto"
                description="Esta cidade não tem problemas registrados esperando solução."
                style={styles.estado}
              />
            ) : aba === 'tipos' ? (
              visao.tipos.map((t, i) => (
                <View key={t.categoria} style={styles.linha}>
                  <AppText variant="caption" tone="muted" style={styles.posicao}>
                    {i + 1}
                  </AppText>
                  <AppText style={styles.icone}>{icones.get(t.categoria) ?? '📋'}</AppText>
                  <View style={styles.linhaTexto}>
                    <AppText variant="bodySm" weight="600" numberOfLines={1}>
                      {t.categoria}
                    </AppText>
                    <View style={[styles.barraFundo, { backgroundColor: colors.surfaceSunken }]}>
                      <View
                        style={[
                          styles.barra,
                          { backgroundColor: colors.primary, width: `${(t.total / maior) * 100}%` },
                        ]}
                      />
                    </View>
                  </View>
                  <AppText variant="bodySm" weight="700" style={styles.total}>
                    {t.total}
                  </AppText>
                </View>
              ))
            ) : lista.length === 0 ? (
              <StateView
                kind="empty"
                icon="people-outline"
                title="Nenhum chamado confirmado ainda"
                description="Quando vizinhos confirmarem um problema no local, ele aparece aqui."
                style={styles.estado}
              />
            ) : (
              lista.map((d, i) => (
                <Pressable
                  key={String(d.id)}
                  onPress={() => onSelecionar(d)}
                  accessibilityRole="button"
                  accessibilityLabel={`${nomeCategoria(d) || d.titulo}${d.rua ? `, ${d.rua}` : ''}. Abrir chamado`}
                  style={({ pressed }) => [styles.linha, pressed && { backgroundColor: colors.surfacePressed }]}>
                  <AppText variant="caption" tone="muted" style={styles.posicao}>
                    {i + 1}
                  </AppText>
                  <AppText style={styles.icone}>{icones.get(nomeCategoria(d)) ?? '📋'}</AppText>
                  <View style={styles.linhaTexto}>
                    <AppText variant="bodySm" weight="600" numberOfLines={1}>
                      {nomeCategoria(d) || d.titulo}
                      {d.rua ? ` · ${d.rua}` : ''}
                    </AppText>
                    <AppText variant="caption" tone="muted">
                      {aba === 'antigas'
                        ? `aberto ${diasDesde(d.criado_em)}`
                        : `${totalApoios(d)} confirmações · ${diasDesde(d.criado_em)}`}
                    </AppText>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                </Pressable>
              ))
            )}
          </ScrollView>
        </>
      )}
    </View>
  );
}

function Kpi({
  icone,
  rotulo,
  valor,
}: {
  icone: keyof typeof Ionicons.glyphMap;
  rotulo: string;
  valor: string;
}) {
  const colors = useColors();
  return (
    <View
      style={[styles.kpi, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}
      accessible
      accessibilityLabel={`${rotulo}: ${valor === '—' ? 'sem dados' : valor}`}>
      <View style={styles.kpiTopo}>
        <Ionicons name={icone} size={14} color={colors.primaryText} />
        <AppText variant="caption" tone="secondary" numberOfLines={2} style={styles.flex}>
          {rotulo}
        </AppText>
      </View>
      <AppText variant="headline">{valor}</AppText>
    </View>
  );
}

function Desempenho({
  dados,
  icones,
  onAbrirChamado,
}: {
  dados: Transparencia;
  icones: Map<string, string>;
  onAbrirChamado: (id: string) => void;
}) {
  const colors = useColors();
  const k = dados.kpis_90d;
  const csat = k.csat_media == null ? '—' : `${k.csat_media.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}/5`;

  return (
    <View style={styles.desempenho}>
      {!dados.contratado ? (
        <View
          style={[styles.aviso, { backgroundColor: colors.infoSubtle, borderColor: colors.info }]}
          accessible
          accessibilityRole="text">
          <Ionicons name="information-circle" size={16} color={colors.info} />
          <AppText variant="caption" tone="secondary" style={styles.flex}>
            Esta prefeitura ainda não atende pelo app. Os números mostram o que os moradores
            registraram aqui.
          </AppText>
        </View>
      ) : null}

      <AppText variant="caption" tone="muted">
        Últimos 90 dias · {k.recebidos.toLocaleString('pt-BR')} problemas registrados
      </AppText>
      <View style={styles.kpis}>
        <Kpi icone="checkmark-done" rotulo="Resolvidos" valor={k.resolvidos.toLocaleString('pt-BR')} />
        <Kpi icone="timer-outline" rotulo="Resolvidos no prazo" valor={pct(k.pct_no_prazo)} />
        <Kpi icone="hourglass-outline" rotulo="Tempo mediano para resolver" valor={dias(k.tempo_mediano_dias)} />
        <Kpi icone="star-outline" rotulo="Satisfação de quem reportou" valor={csat} />
      </View>

      {dados.por_categoria.length > 0 ? (
        <View style={styles.bloco}>
          <AppText variant="label" accessibilityRole="header">
            Por tipo de problema
          </AppText>
          {dados.por_categoria.map((c) => (
            <View
              key={c.categoria}
              style={styles.linha}
              accessible
              accessibilityLabel={`${c.categoria}: ${c.resolvidos} de ${c.recebidos} resolvidos, ${pct(c.pct_no_prazo)} no prazo, tempo mediano ${dias(c.tempo_mediano_dias)}`}>
              <AppText style={styles.icone}>{c.icone || icones.get(c.categoria) || '📋'}</AppText>
              <View style={styles.linhaTexto}>
                <AppText variant="bodySm" weight="600" numberOfLines={1}>
                  {c.categoria}
                </AppText>
                <AppText variant="caption" tone="muted" numberOfLines={2}>
                  {c.resolvidos} de {c.recebidos} resolvidos · resolve em ~{dias(c.tempo_mediano_dias)}
                </AppText>
              </View>
              <AppText variant="bodySm" weight="700" style={styles.totalLargo}>
                {pct(c.pct_no_prazo)}
              </AppText>
            </View>
          ))}
          <AppText variant="caption" tone="muted" style={styles.notaDireita}>
            % = resolvidos dentro do prazo
          </AppText>
        </View>
      ) : null}

      <View style={styles.bloco}>
        <AppText variant="label" accessibilityRole="header">
          Resolvidos recentemente
        </AppText>
        {dados.ultimos_resolvidos.length === 0 ? (
          <AppText variant="bodySm" tone="muted">
            Nenhum problema resolvido nos últimos 90 dias.
          </AppText>
        ) : (
          dados.ultimos_resolvidos.map((r) => (
            <Pressable
              key={r.id}
              onPress={() => onAbrirChamado(r.id)}
              accessibilityRole="button"
              accessibilityLabel={`${r.categoria}${r.bairro ? `, ${r.bairro}` : ''}, resolvido ${diasDesde(r.resolvido_em)}${r.tem_foto_depois ? ', com foto' : ''}. Abrir chamado`}
              style={({ pressed }) => [styles.linha, pressed && { backgroundColor: colors.surfacePressed }]}>
              <Ionicons name="checkmark-circle" size={20} color={colors.success} />
              <View style={styles.linhaTexto}>
                <AppText variant="bodySm" weight="600" numberOfLines={1}>
                  {r.categoria || r.titulo}
                  {r.bairro ? ` · ${r.bairro}` : ''}
                </AppText>
                <AppText variant="caption" tone="muted" numberOfLines={1}>
                  Resolvido {diasDesde(r.resolvido_em)}
                  {r.protocolo ? ` · nº ${r.protocolo}` : ''}
                </AppText>
              </View>
              {r.tem_foto_depois ? (
                <Ionicons name="camera-outline" size={16} color={colors.textMuted} />
              ) : null}
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </Pressable>
          ))
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  painel: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingTop: Spacing[2],
    paddingBottom: Spacing[2],
    gap: Spacing[2],
  },
  cabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    paddingLeft: Spacing[3],
    paddingRight: Spacing[2],
  },
  titulos: {
    flex: 1,
  },
  corpo: {
    maxHeight: 320,
  },
  corpoConteudo: {
    paddingHorizontal: Spacing[3],
    gap: Spacing[1],
  },
  estado: {
    paddingVertical: Spacing[4],
  },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    minHeight: Layout.minTouch,
    paddingVertical: Spacing[1],
    borderRadius: Radius.md,
  },
  posicao: {
    width: 16,
    textAlign: 'right',
  },
  icone: {
    fontSize: 20,
    lineHeight: 26,
  },
  linhaTexto: {
    flex: 1,
    gap: 3,
  },
  barraFundo: {
    height: 5,
    borderRadius: Radius.full,
    overflow: 'hidden',
  },
  barra: {
    height: 5,
    borderRadius: Radius.full,
  },
  total: {
    minWidth: 24,
    textAlign: 'right',
  },
  totalLargo: {
    minWidth: 40,
    textAlign: 'right',
  },
  desempenho: {
    gap: Spacing[2],
    paddingBottom: Spacing[2],
  },
  aviso: {
    flexDirection: 'row',
    gap: Spacing[2],
    padding: Spacing[2],
    borderWidth: 1,
    borderRadius: Radius.md,
  },
  kpis: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
  },
  kpi: {
    flexGrow: 1,
    flexBasis: '45%',
    gap: Spacing[1],
    padding: Spacing[3],
    borderWidth: 1,
    borderRadius: Radius.md,
  },
  kpiTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[1],
  },
  bloco: {
    gap: Spacing[1],
    marginTop: Spacing[2],
  },
  notaDireita: {
    textAlign: 'right',
  },
  flex: {
    flex: 1,
  },
});
