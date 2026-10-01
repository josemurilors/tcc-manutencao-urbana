/**
 * Confirmação de ação administrativa que precisa de justificativa (remover
 * chamado, suspender cidadão). O motivo vai para a auditoria e, em parte,
 * para quem sofreu a ação — por isso é obrigatório e tem tamanho mínimo.
 *
 * `Alert` não aceita campo de texto no Android, daí a folha própria.
 *
 * Monte só enquanto aberta e com `key` pelo alvo: cada abertura começa limpa
 * e o motivo de uma ação não vaza para a próxima pessoa/chamado.
 */

import { useState } from 'react';
import { View, StyleSheet } from 'react-native';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { AppText } from '@/components/ui/text';
import { Spacing } from '@/constants/theme';

const MOTIVO_MIN = 10;

type Props = {
  visivel: boolean;
  onFechar: () => void;
  titulo: string;
  descricao?: string;
  /** Rótulo do botão de confirmar ("Remover chamado"). */
  confirmar: string;
  destrutivo?: boolean;
  /** Pede o motivo (padrão: sim). */
  pedirMotivo?: boolean;
  /** Pede um número de dias (suspensão), com o valor inicial. */
  pedirDias?: number;
  /**
   * Executa a ação. Devolve `true` se deu certo (a folha fecha); em falha a
   * tela que chamou já avisou com toast e devolve `false` — a folha fica
   * aberta com o texto digitado para tentar de novo.
   */
  onConfirmar: (dados: { motivo: string; dias: number }) => Promise<boolean>;
};

export function AcaoSheet({
  visivel,
  onFechar,
  titulo,
  descricao,
  confirmar,
  destrutivo,
  pedirMotivo = true,
  pedirDias,
  onConfirmar,
}: Props) {
  const [motivo, setMotivo] = useState('');
  const [dias, setDias] = useState(String(pedirDias ?? ''));
  const [enviando, setEnviando] = useState(false);
  const [tentou, setTentou] = useState(false);

  const diasNum = Number.parseInt(dias, 10);
  const motivoOk = !pedirMotivo || motivo.trim().length >= MOTIVO_MIN;
  const diasOk = pedirDias === undefined || (Number.isFinite(diasNum) && diasNum >= 1 && diasNum <= 365);

  async function enviar() {
    setTentou(true);
    if (!motivoOk || !diasOk) return;
    setEnviando(true);
    const ok = await onConfirmar({ motivo: motivo.trim(), dias: diasNum });
    setEnviando(false);
    if (ok) onFechar();
  }

  return (
    <BottomSheet
      visible={visivel}
      onClose={onFechar}
      title={titulo}
      description={descricao}
      footer={
        <>
          <Button variant="secondary" onPress={onFechar} style={styles.botao}>
            Cancelar
          </Button>
          <Button
            variant={destrutivo ? 'danger' : 'primary'}
            onPress={enviar}
            loading={enviando}
            style={styles.botao}>
            {confirmar}
          </Button>
        </>
      }>
      {pedirDias !== undefined ? (
        <TextField
          label="Por quantos dias"
          value={dias}
          onChangeText={(t) => setDias(t.replace(/\D/g, ''))}
          keyboardType="number-pad"
          maxLength={3}
          invalid={tentou && !diasOk}
          hint={tentou && !diasOk ? 'Informe de 1 a 365 dias.' : 'De 1 a 365 dias.'}
          accessibilityLabel="Número de dias"
        />
      ) : null}
      {pedirMotivo ? (
        <View style={styles.campo}>
          <TextField
            label="Motivo"
            value={motivo}
            onChangeText={setMotivo}
            multiline
            maxLength={500}
            placeholder="Explique o que aconteceu. Fica registrado na auditoria."
            invalid={tentou && !motivoOk}
            accessibilityLabel="Motivo"
          />
          <AppText variant="caption" tone={tentou && !motivoOk ? 'danger' : 'muted'}>
            {tentou && !motivoOk
              ? `Escreva pelo menos ${MOTIVO_MIN} caracteres.`
              : `Mínimo de ${MOTIVO_MIN} caracteres.`}
          </AppText>
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  botao: {
    flex: 1,
  },
  campo: {
    gap: Spacing[1],
  },
});
