/**
 * Sugestões de ação (porte das "Recomendações Inteligentes" do antigo painel
 * web) e bairros com alta fora do normal. Vêm de `auth/admin/estatisticas/`,
 * que calcula por regras sobre o município inteiro — não seguem os filtros
 * de período do painel:
 *
 * - recapeamento: 3+ chamados de buraco/mobilidade no mesmo ponto;
 * - sazonalidade: categoria com alta de mais de 30% no mês;
 * - bairro crítico: bairro do topo com menos de 50% resolvidos;
 * - anomalia: bairro com o mês acima de 2 desvios da média histórica.
 */

import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Badge } from '@/components/ui/badge';
import { AppText } from '@/components/ui/text';
import { Layout, Spacing, type Tom } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import type { Estatisticas } from '@/types';
import type { BiSugestoesIa } from '@/types/bi';

import { fmtDecimal, fmtNumero } from './formato';

const ROTULO_TIPO: Record<string, string> = {
  recapeamento: 'Recapeamento',
  sazonalidade: 'Sazonalidade',
  bairro_critico: 'Bairro crítico',
};

const TOM_IMPACTO: Record<string, Tom> = { alta: 'danger', media: 'warning', baixa: 'success' };
const ROTULO_IMPACTO: Record<string, string> = { alta: 'Impacto alto', media: 'Impacto médio', baixa: 'Impacto baixo' };

export function ListaSugestoes({ dados }: { dados: Estatisticas }) {
  const colors = useColors();
  const recomendacoes = dados.recomendacoes ?? [];
  const anomalias = dados.anomalias ?? [];
  const linha = [styles.linha, { borderBottomColor: colors.border }];

  return (
    <View style={styles.raiz}>
      <View style={styles.grupo}>
        <AppText variant="label">O que fazer</AppText>
        {recomendacoes.length === 0 ? (
          <AppText variant="bodySm" tone="muted">
            Nenhuma ação sugerida agora: sem recorrência, alta de categoria ou bairro com baixa resolução.
          </AppText>
        ) : (
          recomendacoes.map((r, i) => (
            <View key={`${r.tipo}-${i}`} style={linha}>
              <View style={styles.selos}>
                <Badge label={ROTULO_IMPACTO[r.impacto] ?? r.impacto} tone={TOM_IMPACTO[r.impacto] ?? 'neutral'} />
                <AppText variant="caption" tone="muted">{ROTULO_TIPO[r.tipo] ?? r.tipo}</AppText>
              </View>
              <AppText variant="bodySm">{r.sugestao}</AppText>
              <AppText variant="caption" tone="muted">
                {[r.local !== r.bairro ? r.local : null, r.bairro, `${fmtNumero(r.ocorrencias)} ocorrências`]
                  .filter(Boolean)
                  .join(' · ')}
              </AppText>
            </View>
          ))
        )}
      </View>

      <View style={styles.grupo}>
        <AppText variant="label">Bairros com alta fora do normal</AppText>
        {anomalias.length === 0 ? (
          <AppText variant="bodySm" tone="muted">
            Nenhum bairro com o mês muito acima da própria média.
          </AppText>
        ) : (
          anomalias.map((a) => (
            <View key={a.bairro} style={linha}>
              <View style={styles.selos}>
                <Badge label={a.intensidade === 'alta' ? 'Alta forte' : 'Alta'} tone={a.intensidade === 'alta' ? 'danger' : 'warning'} />
                <AppText variant="bodySm" weight="600">{a.bairro}</AppText>
              </View>
              <AppText variant="caption" tone="muted">
                {fmtNumero(a.total_mes)} chamados este mês · média de {fmtDecimal(a.media_historica)} por mês ·{' '}
                {fmtDecimal(a.z_score)} desvios acima
              </AppText>
            </View>
          ))
        )}
      </View>
    </View>
  );
}

/**
 * Achados da IA leve (`bi/sugestoes-ia/`): relatos parecidos espalhados por
 * várias ruas e relatos que citam risco à pessoa. Toque no risco abre o chamado.
 */
export function ListaSugestoesIa({ dados }: { dados: BiSugestoesIa }) {
  const colors = useColors();
  const linha = [styles.linha, { borderBottomColor: colors.border }];

  if (!dados.ia_disponivel) {
    return (
      <AppText variant="bodySm" tone="muted">
        O serviço de IA está fora do ar agora. As sugestões por regra acima continuam valendo.
      </AppText>
    );
  }

  return (
    <View style={styles.raiz}>
      <AppText variant="caption" tone="muted">
        {fmtNumero(dados.analisados)} relatos abertos dos últimos 60 dias analisados.
      </AppText>

      <View style={styles.grupo}>
        <AppText variant="label">Mesmo problema em várias ruas</AppText>
        {dados.temas.length === 0 ? (
          <AppText variant="bodySm" tone="muted">
            Nenhum grupo de relatos parecidos em ruas diferentes.
          </AppText>
        ) : (
          dados.temas.map((t) => (
            <View key={t.ids.join()} style={linha}>
              <View style={styles.selos}>
                <Badge label={`${fmtNumero(t.total)} relatos`} tone="info" icon="sparkles" />
                <AppText variant="caption" tone="muted">{t.categoria}</AppText>
              </View>
              <AppText variant="bodySm">{t.sugestao}</AppText>
            </View>
          ))
        )}
      </View>

      <View style={styles.grupo}>
        <AppText variant="label">Risco citado no relato</AppText>
        {dados.riscos.length === 0 ? (
          <AppText variant="bodySm" tone="muted">
            Nenhum chamado aberto cita risco à pessoa.
          </AppText>
        ) : (
          dados.riscos.map((r) => (
            <Pressable
              key={r.id}
              accessibilityRole="link"
              accessibilityLabel={`Abrir chamado ${r.protocolo ?? ''}: ${r.categoria}, ${r.rua}`}
              onPress={() => router.push({ pathname: '/chamado/[id]', params: { id: r.id } })}
              style={[...linha, styles.linhaToque]}>
              <View style={styles.textos}>
                <View style={styles.selos}>
                  <Badge label="Atender em até 24 h" tone="danger" />
                  <AppText variant="caption" tone="muted">{r.protocolo}</AppText>
                </View>
                <AppText variant="bodySm" weight="600">
                  {r.categoria} · {[r.rua, r.bairro].filter(Boolean).join(', ')}
                </AppText>
                <AppText variant="caption" tone="muted">Cita: {r.termos.join(', ')}</AppText>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>
          ))
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  raiz: { gap: Spacing[5] },
  grupo: { gap: Spacing[1] },
  linha: {
    gap: Spacing[1],
    minHeight: Layout.minTouch + 8,
    paddingVertical: Spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  selos: { flexDirection: 'row', alignItems: 'center', gap: Spacing[2], flexWrap: 'wrap' },
  linhaToque: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  textos: { flex: 1, gap: Spacing[1] },
});
