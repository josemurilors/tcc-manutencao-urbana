/**
 * Histórico real do chamado (`GET /defeitos/<id>/eventos/`).
 *
 * Se os eventos não carregam, mostra o resumo montado com os campos do
 * chamado e diz isso com todas as letras, com "Tentar de novo" — o cidadão
 * não fica achando que a prefeitura não fez nada quando o problema é a rede.
 */

import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { AppText } from '@/components/ui/text';
import { Timeline } from '@/components/ui/timeline';
import { Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import { apiCidadao } from '@/services/api-cidadao';
import type { Defeito, DefeitoEvento } from '@/types';
import { getTimelineItems, timelineDosEventos, type VisaoTimeline } from '@/utils/timeline';

/** Resultado guardado com a chave da busca que o produziu. */
type Resultado =
  | { chave: string; tipo: 'ok'; eventos: DefeitoEvento[] }
  | { chave: string; tipo: 'erro'; mensagem: string };

export function HistoricoChamado({
  defeito,
  visao = 'cidadao',
}: {
  defeito: Defeito;
  visao?: VisaoTimeline;
}) {
  const colors = useColors();
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const id = defeito.id;
  // Recarrega quando algo que gera evento muda (status, resposta, avaliação, apoios...).
  const chave = [
    id,
    defeito.status,
    defeito.resposta_publica ?? '',
    defeito.avaliado_em ?? '',
    defeito.reaberturas ?? 0,
    defeito.total_apoios ?? 0,
    defeito.atualizado_em ?? '',
    tentativa,
  ].join('|');

  useEffect(() => {
    let cancelado = false;
    apiCidadao
      .eventos(id)
      .then((eventos) => {
        if (!cancelado) setResultado({ chave, tipo: 'ok', eventos });
      })
      .catch((err: unknown) => {
        if (cancelado) return;
        setResultado({
          chave,
          tipo: 'erro',
          mensagem: err instanceof Error ? err.message : 'Erro ao carregar o histórico',
        });
      });
    return () => {
      cancelado = true;
    };
  }, [chave, id]);

  // Enquanto recarrega, o histórico anterior continua na tela (sem piscar).
  const estado =
    resultado && (resultado.chave === chave || resultado.tipo === 'ok') ? resultado : null;

  if (!estado) {
    return (
      <View style={styles.carregando} accessibilityRole="progressbar" accessibilityLabel="Carregando histórico">
        <ActivityIndicator color={colors.primaryText} />
        <AppText variant="bodySm" tone="muted">
          Carregando histórico...
        </AppText>
      </View>
    );
  }

  if (estado.tipo === 'erro') {
    return (
      <View style={styles.container}>
        <View style={styles.aviso} accessibilityRole="alert">
          <Ionicons name="cloud-offline-outline" size={16} color={colors.warning} />
          <AppText variant="caption" tone="secondary" style={styles.flex}>
            Mostrando um resumo: não foi possível carregar o histórico completo.
          </AppText>
          <Button size="xs" variant="ghost" onPress={() => setTentativa((n) => n + 1)}>
            Tentar de novo
          </Button>
        </View>
        <Timeline items={getTimelineItems(defeito)} />
      </View>
    );
  }

  const itens = timelineDosEventos(estado.eventos, visao);
  // Chamado antigo, anterior ao histórico de eventos: resumo pelos campos.
  return <Timeline items={itens.length ? itens : getTimelineItems(defeito)} />;
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing[3],
  },
  carregando: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    paddingVertical: Spacing[2],
  },
  aviso: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
  flex: {
    flex: 1,
  },
});
