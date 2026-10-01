/**
 * Avaliação do atendimento (1–5 estrelas + comentário), só do autor e só de
 * chamado resolvido; o backend aceita editar por 7 dias (contrato v3 §7.2).
 * Vira o CSAT do BI da prefeitura — por isso cada estrela tem nome, para a
 * nota ter o mesmo sentido para todo mundo.
 */

import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { AppText } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { Layout, Radius, Spacing } from '@/constants/theme';
import { normalizarStatus } from '@/constants/status';
import { useColors } from '@/context/theme-context';
import { useToast } from '@/context/toast-context';
import { apiCidadao } from '@/services/api-cidadao';
import type { ChamadoDetalhe } from '@/types/cidadao';

const NOMES = ['Muito ruim', 'Ruim', 'Regular', 'Bom', 'Excelente'];
const JANELA_EDICAO_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_COMENTARIO = 500;

/** O autor ainda pode avaliar (ou rever a nota) este chamado? */
export function podeAvaliar(d: ChamadoDetalhe) {
  if (!d.eh_autor || normalizarStatus(d.status) !== 'concluido') return false;
  if (!d.avaliado_em) return true;
  return Date.now() - new Date(d.avaliado_em).getTime() < JANELA_EDICAO_MS;
}

/** Selo "avaliar" da lista: resolvido, do autor, sem nota ainda. */
export function aguardaAvaliacao(d: ChamadoDetalhe) {
  return !!d.eh_autor && normalizarStatus(d.status) === 'concluido' && d.avaliacao_nota == null;
}

export function Estrelas({
  valor,
  onChange,
  tamanho = 32,
}: {
  valor: number;
  onChange?: (nota: number) => void;
  tamanho?: number;
}) {
  const colors = useColors();
  if (!onChange) {
    return (
      <View style={styles.estrelas} accessible accessibilityLabel={`Nota ${valor} de 5: ${NOMES[valor - 1] ?? ''}`}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Ionicons key={n} name={n <= valor ? 'star' : 'star-outline'} size={tamanho} color={colors.primary} />
        ))}
      </View>
    );
  }
  return (
    <View style={styles.estrelas} accessibilityRole="radiogroup" accessibilityLabel="Nota do atendimento">
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable
          key={n}
          onPress={() => onChange(n)}
          accessibilityRole="radio"
          accessibilityLabel={`${n} ${n === 1 ? 'estrela' : 'estrelas'}: ${NOMES[n - 1]}`}
          accessibilityState={{ checked: n === valor, selected: n === valor }}
          style={styles.alvo}>
          <Ionicons
            name={n <= valor ? 'star' : 'star-outline'}
            size={tamanho}
            color={n <= valor ? colors.primary : colors.borderStrong}
          />
        </Pressable>
      ))}
    </View>
  );
}

export function AvaliacaoChamado({
  defeito,
  onAtualizado,
}: {
  defeito: ChamadoDetalhe;
  onAtualizado: (d: ChamadoDetalhe) => void;
}) {
  const colors = useColors();
  const toast = useToast();
  const jaAvaliado = defeito.avaliacao_nota != null;
  const [editando, setEditando] = useState(!jaAvaliado);
  const [nota, setNota] = useState(defeito.avaliacao_nota ?? 0);
  const [comentario, setComentario] = useState(defeito.avaliacao_comentario ?? '');
  const [enviando, setEnviando] = useState(false);

  if (!defeito.eh_autor || normalizarStatus(defeito.status) !== 'concluido') return null;
  const editavel = podeAvaliar(defeito);

  async function enviar() {
    if (nota < 1) {
      toast.warning('Escolha de 1 a 5 estrelas.');
      return;
    }
    setEnviando(true);
    try {
      const atualizado = await apiCidadao.avaliar(defeito.id, nota, comentario.trim());
      onAtualizado(atualizado);
      setEditando(false);
      toast.success('Obrigado! Sua avaliação ajuda a prefeitura a melhorar.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível enviar a avaliação.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <View style={[styles.caixa, { backgroundColor: colors.surface, borderColor: colors.primary }]}>
      <AppText variant="title" accessibilityRole="header">
        {jaAvaliado && !editando ? 'Sua avaliação' : 'Como foi o atendimento?'}
      </AppText>

      {editando && editavel ? (
        <>
          <AppText variant="bodySm" tone="secondary">
            O problema foi resolvido. Conte como foi — a prefeitura acompanha estas notas.
          </AppText>
          <Estrelas valor={nota} onChange={setNota} />
          {nota > 0 ? (
            <AppText variant="label" tone="brand">
              {NOMES[nota - 1]}
            </AppText>
          ) : null}
          <TextField
            label="Comentário (opcional)"
            value={comentario}
            onChangeText={(t) => setComentario(t.slice(0, MAX_COMENTARIO))}
            placeholder="O que ficou bom ou o que faltou?"
            multiline
            maxLength={MAX_COMENTARIO}
            hint={`${comentario.length}/${MAX_COMENTARIO}`}
          />
          <View style={styles.acoes}>
            <Button onPress={enviar} loading={enviando} disabled={nota < 1}>
              {jaAvaliado ? 'Salvar avaliação' : 'Enviar avaliação'}
            </Button>
            {jaAvaliado ? (
              <Button variant="ghost" onPress={() => setEditando(false)}>
                Cancelar
              </Button>
            ) : null}
          </View>
        </>
      ) : (
        <>
          <Estrelas valor={defeito.avaliacao_nota ?? 0} tamanho={24} />
          {defeito.avaliacao_comentario ? (
            <AppText variant="bodySm" tone="secondary">
              “{defeito.avaliacao_comentario}”
            </AppText>
          ) : null}
          {editavel ? (
            <Button size="sm" variant="secondary" onPress={() => setEditando(true)}>
              Alterar avaliação
            </Button>
          ) : null}
        </>
      )}
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
  estrelas: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[1],
  },
  alvo: {
    minWidth: Layout.minTouch,
    minHeight: Layout.minTouch,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acoes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
  },
});
