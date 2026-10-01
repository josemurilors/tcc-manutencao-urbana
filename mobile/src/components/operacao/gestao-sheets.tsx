/**
 * Folhas de decisão de gestor (contrato §3: gestor+): atribuir a equipe ou
 * servidor, alterar o prazo (SLA) com motivo e mudar a prioridade.
 *
 * O `AtribuirSheet` só escolhe o destino e devolve; quem chama executa — assim
 * a mesma folha serve à ficha (um chamado) e à barra de lote (vários).
 */

import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { StateView } from '@/components/ui/state-view';
import { AppText } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { Layout, Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import type { DadosAtribuicao, EquipeOperacao, Prioridade } from '@/types/operacao';

import { OpcoesRadio } from './campos';
import { PRIORIDADES } from './regras';

const PAPEL_ROTULO: Record<string, string> = {
  operador: 'Operador',
  gestor: 'Gestor',
  admin_municipal: 'Administrador',
  super_admin: 'Administrador',
};

type AtribuirProps = {
  visible: boolean;
  equipes: EquipeOperacao[];
  /** Quantos chamados recebem a atribuição (texto do título). */
  quantidade?: number;
  enviando?: boolean;
  onClose: () => void;
  onEscolher: (dados: DadosAtribuicao, rotulo: string) => void;
  onRecarregar?: () => void;
};

export function AtribuirSheet({
  visible,
  equipes,
  quantidade = 1,
  enviando,
  onClose,
  onEscolher,
  onRecarregar,
}: AtribuirProps) {
  const colors = useColors();
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={quantidade > 1 ? `Atribuir ${quantidade} chamados` : 'Atribuir chamado'}
      description="Escolha a equipe inteira ou uma pessoa dela.">
      {equipes.length === 0 ? (
        <StateView
          kind="error"
          title="Nenhuma equipe disponível"
          description="Cadastre equipes na gestão do município ou tente carregar de novo."
          onRetry={onRecarregar}
          retryLabel="Carregar equipes"
        />
      ) : (
        equipes.map((e) => (
          <View key={e.id} style={styles.equipe}>
            <Pressable
              disabled={enviando}
              onPress={() => onEscolher({ equipe_id: e.id, atendente_id: null }, `Equipe ${e.nome}`)}
              accessibilityRole="button"
              accessibilityLabel={`Atribuir à equipe ${e.nome}`}
              style={({ pressed }) => [
                styles.linha,
                { borderColor: colors.border, backgroundColor: pressed ? colors.surfacePressed : colors.surfaceRaised },
              ]}>
              <Ionicons name="people" size={20} color={colors.primaryText} />
              <View style={styles.flex}>
                <AppText variant="label">{e.nome}</AppText>
                <AppText variant="caption" tone="secondary">
                  {[e.secretaria_nome, `${e.membros.length} ${e.membros.length === 1 ? 'pessoa' : 'pessoas'}`]
                    .filter(Boolean)
                    .join(' · ')}
                </AppText>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </Pressable>
            {e.membros.map((m) => (
              <Pressable
                key={m.id}
                disabled={enviando}
                onPress={() => onEscolher({ equipe_id: e.id, atendente_id: String(m.id) }, m.nome)}
                accessibilityRole="button"
                accessibilityLabel={`Atribuir a ${m.nome}, ${PAPEL_ROTULO[m.papel] ?? m.papel}, equipe ${e.nome}`}
                style={({ pressed }) => [
                  styles.membro,
                  { backgroundColor: pressed ? colors.surfacePressed : 'transparent' },
                ]}>
                <Ionicons name="person-circle-outline" size={20} color={colors.textSecondary} />
                <AppText variant="bodySm" style={styles.flex}>
                  {m.nome}
                </AppText>
                <AppText variant="caption" tone="muted">
                  {PAPEL_ROTULO[m.papel] ?? m.papel}
                </AppText>
              </Pressable>
            ))}
          </View>
        ))
      )}
    </BottomSheet>
  );
}

type SlaProps = {
  visible: boolean;
  prazoAtualDias?: number | null;
  enviando?: boolean;
  onClose: () => void;
  onSalvar: (dias: number, motivo: string) => void;
};

export function SlaSheet({ visible, prazoAtualDias, enviando, onClose, onSalvar }: SlaProps) {
  const [dias, setDias] = useState(prazoAtualDias ? String(prazoAtualDias) : '');
  const [motivo, setMotivo] = useState('');
  const n = Number(dias);
  const valido = Number.isInteger(n) && n >= 1 && n <= 365 && motivo.trim().length >= 5;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Alterar prazo (SLA)"
      description="O novo prazo conta a partir da abertura do chamado e fica registrado no histórico."
      footer={
        <>
          <Button variant="secondary" onPress={onClose}>
            Cancelar
          </Button>
          <Button
            block
            style={styles.flex}
            loading={enviando}
            disabled={!valido}
            onPress={() => onSalvar(n, motivo.trim())}>
            Salvar prazo
          </Button>
        </>
      }>
      <TextField
        label="Prazo em dias"
        value={dias}
        onChangeText={(t) => setDias(t.replace(/\D/g, ''))}
        keyboardType="number-pad"
        hint={prazoAtualDias ? `Prazo atual: ${prazoAtualDias} dias.` : undefined}
      />
      <TextField
        label="Motivo"
        value={motivo}
        onChangeText={setMotivo}
        multiline
        placeholder="Ex.: depende de licitação de material"
      />
    </BottomSheet>
  );
}

type PrioridadeProps = {
  visible: boolean;
  atual?: string | null;
  enviando?: boolean;
  onClose: () => void;
  onSalvar: (p: Prioridade) => void;
};

export function PrioridadeSheet({ visible, atual, enviando, onClose, onSalvar }: PrioridadeProps) {
  const [valor, setValor] = useState<Prioridade | null>((atual as Prioridade) || null);
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Prioridade"
      description="Muda a posição do chamado na fila de todos."
      footer={
        <>
          <Button variant="secondary" onPress={onClose}>
            Cancelar
          </Button>
          <Button
            block
            style={styles.flex}
            loading={enviando}
            disabled={!valor || valor === atual}
            onPress={() => valor && onSalvar(valor)}>
            Salvar
          </Button>
        </>
      }>
      <OpcoesRadio rotulo="Prioridade" opcoes={PRIORIDADES} valor={valor} onChange={setValor} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  equipe: {
    gap: Spacing[1],
  },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    minHeight: Layout.minTouch + 8,
    paddingHorizontal: Spacing[3],
    borderWidth: 1,
    borderRadius: Radius.md,
  },
  membro: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    minHeight: Layout.minTouch,
    paddingLeft: Spacing[8],
    paddingRight: Spacing[3],
    borderRadius: Radius.md,
  },
});
