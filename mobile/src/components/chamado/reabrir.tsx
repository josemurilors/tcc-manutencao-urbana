/**
 * Reabrir um chamado resolvido que voltou a dar problema (ou que a prefeitura
 * deu como feito sem fazer). Só o autor, até 30 dias depois de resolvido
 * (`fluxo.REABERTURA_AUTOR_DIAS`); o motivo é obrigatório porque vai para a
 * equipe e para o histórico público.
 */

import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { AppText } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { normalizarStatus } from '@/constants/status';
import { Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import { useToast } from '@/context/toast-context';
import { apiCidadao } from '@/services/api-cidadao';
import type { ChamadoDetalhe } from '@/types/cidadao';

const PRAZO_REABERTURA_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_MOTIVO = 10;
const MAX_MOTIVO = 500;

export function podeReabrir(d: ChamadoDetalhe) {
  if (!d.eh_autor || normalizarStatus(d.status) !== 'concluido') return false;
  const resolvido = d.resolvido_em ?? d.atendido_em;
  if (!resolvido) return true;
  return Date.now() - new Date(resolvido).getTime() <= PRAZO_REABERTURA_MS;
}

export function ReabrirChamado({
  defeito,
  onAtualizado,
}: {
  defeito: ChamadoDetalhe;
  onAtualizado: (d: ChamadoDetalhe) => void;
}) {
  const colors = useColors();
  const toast = useToast();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);

  if (!podeReabrir(defeito)) return null;

  const curto = motivo.trim().length < MIN_MOTIVO;

  async function enviar() {
    if (curto) return;
    setEnviando(true);
    try {
      const atualizado = await apiCidadao.reabrir(defeito.id, motivo.trim());
      onAtualizado(atualizado);
      setAberto(false);
      setMotivo('');
      toast.success('Chamado reaberto. A prefeitura foi avisada.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível reabrir o chamado.');
    } finally {
      setEnviando(false);
    }
  }

  if (!aberto) {
    return (
      <Button
        variant="secondary"
        size="sm"
        onPress={() => setAberto(true)}
        icon={<Ionicons name="refresh" size={16} color={colors.textPrimary} />}
        accessibilityHint="Abre um campo para explicar por que o problema continua">
        O problema voltou? Reabrir
      </Button>
    );
  }

  return (
    <View style={[styles.caixa, { borderColor: colors.warning, backgroundColor: colors.warningSubtle }]}>
      <AppText variant="label">Reabrir chamado</AppText>
      <AppText variant="bodySm" tone="secondary">
        Conte o que continua errado. O chamado volta para a fila da prefeitura com o mesmo protocolo.
      </AppText>
      <TextField
        label="Motivo"
        value={motivo}
        onChangeText={(t) => setMotivo(t.slice(0, MAX_MOTIVO))}
        placeholder="Ex.: o buraco abriu de novo depois da chuva"
        multiline
        maxLength={MAX_MOTIVO}
        invalid={motivo.length > 0 && curto}
        hint={curto ? `Escreva pelo menos ${MIN_MOTIVO} caracteres.` : `${motivo.length}/${MAX_MOTIVO}`}
      />
      <View style={styles.acoes}>
        <Button onPress={enviar} loading={enviando} disabled={curto}>
          Reabrir chamado
        </Button>
        <Button variant="ghost" onPress={() => setAberto(false)}>
          Cancelar
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  caixa: {
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing[4],
    gap: Spacing[3],
  },
  acoes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
  },
});
