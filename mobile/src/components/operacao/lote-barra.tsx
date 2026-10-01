/**
 * Barra de ações em lote (POST `operacao/lote/`), no rodapé da fila quando há
 * chamados selecionados.
 *
 * - Todos da equipe: **Assumir** (atribui a si mesmo) e **Mudar status** para
 *   triagem, programado ou em execução.
 * - Gestor+: também **Atribuir** a equipe/servidor e **Concluir** em lote
 *   (ex.: fechamento de mutirão). Rejeitar fica fora: exige motivo e é decisão
 *   chamado a chamado.
 *
 * O backend aplica item a item e devolve `{ok, erros}`; os erros aparecem
 * numa folha com o motivo de cada um, nada fica escondido.
 */

import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { AppText } from '@/components/ui/text';
import { BATCH_STATUS_OPTIONS } from '@/constants/status';
import { Elevation, Layout, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import { useToast } from '@/context/toast-context';
import { executarOuEnfileirar, type AcaoOperacao } from '@/services/operacao-offline';
import type { ChamadoFila, DadosAtribuicao, EquipeOperacao, ResultadoLote } from '@/types/operacao';

import { OpcoesRadio } from './campos';
import { AtribuirSheet } from './gestao-sheets';
import { identificador } from './regras';

export type EfeitoLote = {
  /** Ids que o servidor confirmou (ou todos, quando ficou offline). */
  ids: string[];
  patch: Partial<ChamadoFila>;
  offline: boolean;
};

type Props = {
  selecionados: ChamadoFila[];
  meuId: string | null;
  gestor: boolean;
  equipes: EquipeOperacao[];
  onRecarregarEquipes: () => void;
  onLimpar: () => void;
  onAplicado: (efeito: EfeitoLote) => void;
};

export function LoteBarra({
  selecionados,
  meuId,
  gestor,
  equipes,
  onRecarregarEquipes,
  onLimpar,
  onAplicado,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [folha, setFolha] = useState<'status' | 'atribuir' | null>(null);
  const [para, setPara] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erros, setErros] = useState<ResultadoLote['erros']>([]);

  const ids = selecionados.map((c) => c.id);
  const n = ids.length;
  const opcoesStatus = BATCH_STATUS_OPTIONS.filter(([v]) => gestor || v !== 'concluido').map(([value, label]) => ({
    value,
    label,
  }));

  async function aplicar(
    acao: Extract<AcaoOperacao, { tipo: 'lote' }>,
    rotulo: string,
    patch: Partial<ChamadoFila>,
  ) {
    setEnviando(true);
    try {
      const r = await executarOuEnfileirar<ResultadoLote>(acao, rotulo);
      setFolha(null);
      if (r.offline) {
        toast.warning(`Sem conexão: ${rotulo.toLowerCase()} será enviado quando a rede voltar.`);
        onAplicado({ ids: ids.map(String), patch, offline: true });
        return;
      }
      const ok = (r.resposta.ok ?? []).map(String);
      const falhas = r.resposta.erros ?? [];
      if (ok.length > 0) onAplicado({ ids: ok, patch, offline: false });
      if (falhas.length === 0) {
        toast.success(`${ok.length} ${ok.length === 1 ? 'chamado atualizado' : 'chamados atualizados'}.`);
      } else {
        setErros(falhas);
        toast.warning(`${ok.length} atualizado(s), ${falhas.length} não.`, {
          action: { label: 'Ver motivos', onPress: () => setErros(falhas) },
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível aplicar em lote.');
    } finally {
      setEnviando(false);
    }
  }

  function assumir() {
    if (!meuId) return;
    aplicar(
      { tipo: 'lote', ids, acao: 'atribuir', campos: { atendente_id: meuId } },
      `Assumir ${n} chamados`,
      { atendente_id: meuId, tem_atendente: true },
    );
  }

  function mudarStatus() {
    if (!para) return;
    aplicar(
      { tipo: 'lote', ids, acao: 'transicao', campos: { para } },
      `Mudar ${n} chamados para ${opcoesStatus.find((o) => o.value === para)?.label ?? para}`,
      { status: para },
    );
  }

  function atribuir(dados: DadosAtribuicao, rotulo: string) {
    aplicar({ tipo: 'lote', ids, acao: 'atribuir', campos: dados }, `Atribuir ${n} chamados a ${rotulo}`, {
      equipe_id: dados.equipe_id ?? null,
      atendente_id: dados.atendente_id ?? null,
      tem_atendente: !!dados.atendente_id,
    });
  }

  const nomesPorId = new Map(selecionados.map((c) => [String(c.id), identificador(c)]));

  return (
    <View
      style={[
        styles.barra,
        Elevation.lg,
        { backgroundColor: colors.surfaceRaised, borderTopColor: colors.border, paddingBottom: insets.bottom + Spacing[3] },
      ]}
      accessibilityLabel={`${n} chamados selecionados`}>
      <View style={styles.cabecalho}>
        <AppText variant="label">
          {n} {n === 1 ? 'selecionado' : 'selecionados'}
        </AppText>
        <Button size="sm" variant="ghost" onPress={onLimpar}>
          Cancelar seleção
        </Button>
      </View>
      <View style={styles.acoes}>
        <Button
          size="sm"
          onPress={assumir}
          loading={enviando && folha === null}
          icon={<Ionicons name="hand-left" size={16} color={colors.onPrimary} />}>
          Assumir
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onPress={() => {
            setPara(null);
            setFolha('status');
          }}
          icon={<Ionicons name="swap-horizontal" size={16} color={colors.textPrimary} />}>
          Mudar status
        </Button>
        {gestor ? (
          <Button
            size="sm"
            variant="secondary"
            onPress={() => setFolha('atribuir')}
            icon={<Ionicons name="people" size={16} color={colors.textPrimary} />}>
            Atribuir
          </Button>
        ) : null}
      </View>

      <BottomSheet
        visible={folha === 'status'}
        onClose={() => setFolha(null)}
        title={`Mudar status de ${n} chamados`}
        description="Cada chamado passa pelas regras do fluxo; o que não puder mudar volta com o motivo."
        footer={
          <Button block style={styles.flex} disabled={!para} loading={enviando} onPress={mudarStatus}>
            Aplicar
          </Button>
        }>
        <OpcoesRadio rotulo="Novo status" opcoes={opcoesStatus} valor={para} onChange={setPara} />
      </BottomSheet>

      <AtribuirSheet
        visible={folha === 'atribuir'}
        equipes={equipes}
        quantidade={n}
        enviando={enviando}
        onClose={() => setFolha(null)}
        onEscolher={atribuir}
        onRecarregar={onRecarregarEquipes}
      />

      <BottomSheet
        visible={erros.length > 0}
        onClose={() => setErros([])}
        title="Não foi possível atualizar"
        description="Estes chamados ficaram como estavam:">
        {erros.map((e) => (
          <Card key={String(e.id)} padding={Spacing[3]}>
            <AppText variant="label">{nomesPorId.get(String(e.id)) ?? `#${String(e.id).slice(0, 8)}`}</AppText>
            <AppText variant="caption" tone="danger">
              {e.detail}
            </AppText>
          </Card>
        ))}
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  barra: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    paddingTop: Spacing[2],
    paddingHorizontal: Layout.gutter,
    gap: Spacing[2],
    zIndex: 1100,
  },
  cabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  acoes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
  },
  flex: {
    flex: 1,
  },
});
