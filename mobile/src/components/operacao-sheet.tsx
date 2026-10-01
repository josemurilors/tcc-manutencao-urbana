/**
 * Detalhe do chamado para o **operador** (aba Operação).
 *
 * Aqui ficam as ações de atendimento — assumir, registrar resposta, finalizar,
 * anexar registro e gerar a Ordem de Serviço — que não aparecem no sheet do
 * cidadão. O operador enxerga também quem está com o chamado: se é ele mesmo,
 * pode avançar; se é outra pessoa, só acompanha.
 */

import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { DefectDetail, detailStyles } from '@/components/defect-detail';
import { Button } from '@/components/ui/button';
import { statusAberto, statusFechado } from '@/constants/status';
import { FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useColors } from '@/context/theme-context';
import { useToast } from '@/context/toast-context';
import { api } from '@/services/api';
import type { Defeito, PickedImage } from '@/types';
import { descreverSinalizacoes } from '@/utils/format';
import { escolherDaGaleria, ImagemMuitoGrandeError } from '@/utils/image';

type Props = {
  defeito: Defeito | null;
  onClose: () => void;
  onPatch: (id: number, patch: Partial<Defeito>) => void;
  onReplace: (defeito: Defeito) => void;
};

export function OperacaoSheet({ defeito, onClose, onPatch, onReplace }: Props) {
  const colors = useColors();
  const addToast = useToast();
  const { user } = useAuth();

  const [acaoEmCurso, setAcaoEmCurso] = useState<string | null>(null);

  if (!defeito) return null;

  const fechado = statusFechado(defeito.status);
  const temAtendente = !!defeito.atendente_id;
  const souAtendente = temAtendente && String(defeito.atendente_id) === String(user?.id);

  const podeAtender = !temAtendente && !fechado;
  // Só quem assumiu avança o chamado; outro operador apenas acompanha.
  const podeAvancar = souAtendente && statusAberto(defeito.status);
  const slaVencido = !!defeito.sla_vencido && !fechado;
  const sinalizacoes = !fechado ? descreverSinalizacoes(defeito) : null;

  async function comAcao(chave: string, fn: () => Promise<void>) {
    setAcaoEmCurso(chave);
    try {
      await fn();
    } catch (err) {
      const mensagem = err instanceof Error ? err.message : 'Erro inesperado';
      addToast('Erro: ' + mensagem, 'error');
    } finally {
      setAcaoEmCurso(null);
    }
  }

  function handleAtender() {
    const id = defeito!.id;
    return comAcao('atender', async () => {
      await api.atenderDefeito(id);
      addToast('Chamado assumido!');
      onPatch(id, { status: 'em_andamento', atendente_id: user?.id ?? null, tem_atendente: true });
    });
  }

  function handleFinalizar() {
    const id = defeito!.id;
    return comAcao('finalizar', async () => {
      await api.finalizarDefeito(id);
      addToast('Chamado finalizado!');
      onPatch(id, { status: 'concluido', atendido_em: new Date().toISOString() });
    });
  }

  function handleAnexar() {
    const id = defeito!.id;
    return comAcao('anexar', async () => {
      let imagem: PickedImage | null = null;
      try {
        imagem = await escolherDaGaleria();
      } catch (err) {
        if (err instanceof ImagemMuitoGrandeError) {
          addToast(err.message, 'error');
          return;
        }
        throw err;
      }
      if (!imagem) return;
      await api.anexarImagem(id, imagem);
      addToast('Imagem anexada!');
      onReplace(await api.detalharDefeito(id));
    });
  }

  function handleGerarOS() {
    const id = defeito!.id;
    return comAcao('os', async () => {
      await api.gerarOS(id);
      addToast('Ordem de Serviço gerada!');
    });
  }

  const destaque =
    slaVencido || temAtendente || sinalizacoes ? (
      <View style={styles.faixas}>
        {sinalizacoes ? (
          <View style={[styles.faixa, { backgroundColor: colors.warning + '22' }]}>
            <Ionicons name="flag" size={14} color={colors.warning} />
            <Text style={[styles.faixaTexto, { color: colors.warning }]}>
              Cidadãos: {sinalizacoes}
            </Text>
          </View>
        ) : null}
        {slaVencido ? (
          <View style={[styles.faixa, { backgroundColor: colors.error + '22' }]}>
            <Ionicons name="alarm" size={14} color={colors.error} />
            <Text style={[styles.faixaTexto, { color: colors.error }]}>Prazo (SLA) vencido</Text>
          </View>
        ) : null}
        {temAtendente && !fechado ? (
          <View style={[styles.faixa, { backgroundColor: colors.bgElevated }]}>
            <Ionicons
              name={souAtendente ? 'person-circle' : 'person-circle-outline'}
              size={14}
              color={souAtendente ? colors.gold500 : colors.textSecondary}
            />
            <Text style={[styles.faixaTexto, { color: colors.textSecondary }]}>
              {souAtendente
                ? 'Você está atendendo este chamado'
                : 'Em atendimento por outro operador'}
            </Text>
          </View>
        ) : null}
      </View>
    ) : null;

  return (
    <DefectDetail defeito={defeito} onClose={onClose} rotuloApoios="apoios" destaque={destaque}>
      {podeAtender ? (
        <Button
          size="sm"
          onPress={handleAtender}
          loading={acaoEmCurso === 'atender'}
          icon={<Ionicons name="hand-left" size={14} color={colors.textInverse} />}>
          Assumir
        </Button>
      ) : null}

      {podeAvancar ? (
        <Button
          variant="danger"
          size="sm"
          onPress={handleFinalizar}
          loading={acaoEmCurso === 'finalizar'}
          icon={<Ionicons name="checkmark-done" size={14} color={colors.error} />}>
          Finalizar
        </Button>
      ) : null}

      {!fechado ? (
        <Button
          variant="secondary"
          size="sm"
          onPress={handleAnexar}
          loading={acaoEmCurso === 'anexar'}
          icon={<Ionicons name="image" size={14} color={colors.textSecondary} />}>
          Anexar
        </Button>
      ) : null}

      <Button
        variant="ghost"
        size="sm"
        onPress={handleGerarOS}
        loading={acaoEmCurso === 'os'}
        icon={<Ionicons name="document-text" size={14} color={colors.textSecondary} />}>
        Ordem de Serviço
      </Button>

      {fechado ? (
        <Text style={[detailStyles.aviso, { color: colors.textMuted }]}>Chamado concluído.</Text>
      ) : null}
    </DefectDetail>
  );
}

const styles = StyleSheet.create({
  faixas: {
    gap: Spacing[1],
  },
  faixa: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
    borderRadius: Radius.md,
  },
  faixaTexto: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },
});
