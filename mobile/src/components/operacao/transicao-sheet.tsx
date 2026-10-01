/**
 * Folha de mudança de status (POST `operacao/chamados/<id>/transicao/`).
 *
 * Cada destino pede o que o fluxo exige e o que o mercado trata como mínimo:
 * - **Concluir**: checklist da categoria, foto do "depois" pela câmera com GPS
 *   (obrigatória só quando a prefeitura exige, `parametros.exigir_foto_conclusao`
 *   — padrão: exige) e resposta ao cidadão (com respostas prontas);
 * - **Rejeitar** (gestor+): motivo obrigatório; "duplicado" exige escolher o
 *   chamado original (busca por protocolo ou texto) e a resposta ao cidadão;
 * - **Reabrir** (gestor+): motivo obrigatório;
 * - demais (triar, programar, iniciar): nota interna e resposta opcionais.
 *
 * Sem rede, a ação entra na fila offline e a tela aplica o novo status com o
 * selo "envio pendente".
 */

import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { AppText } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { rotuloOperacao } from '@/constants/status';
import { Layout, Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import { useToast } from '@/context/toast-context';
import { apiOperacao } from '@/services/api-operacao';
import { executarOuEnfileirar } from '@/services/operacao-offline';
import type { ChamadoFila, DadosTransicao, MotivoRejeicao, RespostaPadrao } from '@/types/operacao';

import { ChecklistCampo, FotoCampo, OpcoesRadio, RespostasPadraoChips } from './campos';
import type { Evidencia } from './evidencia';
import { identificador, MOTIVOS_REJEICAO, nomeCategoria, REGEX_PROTOCOLO, VERBO_TRANSICAO } from './regras';

/** Texto inicial ao cidadão por motivo de rejeição (editável). */
const TEXTO_REJEICAO: Record<MotivoRejeicao, string> = {
  duplicado:
    'Este problema já tinha sido registrado em outro chamado, que segue em atendimento. Acompanhe o andamento por ele.',
  fora_da_competencia:
    'Este problema não é de responsabilidade da prefeitura. Encaminhe ao órgão ou empresa responsável.',
  nao_localizado:
    'Nossa equipe esteve no local indicado e não encontrou o problema. Se ele continuar, abra um novo chamado com uma foto atual.',
  ja_resolvido: 'Verificamos que o problema já tinha sido resolvido.',
  improcedente: 'Analisamos o relato e ele não se enquadra nos serviços de zeladoria urbana.',
  outro: '',
};

export type ResultadoTransicao = { para: string; chamado: ChamadoFila | null; offline: boolean };

type Props = {
  chamado: ChamadoFila;
  /** Destino; `null` = folha fechada. */
  para: string | null;
  respostas: RespostaPadrao[];
  /** A prefeitura exige a foto do depois para concluir (padrão: sim). */
  exigirFoto?: boolean;
  onClose: () => void;
  onFeito: (r: ResultadoTransicao) => void;
};

export function TransicaoSheet({ chamado, para, respostas, exigirFoto = true, onClose, onFeito }: Props) {
  if (!para) return null;
  // `key` zera o formulário a cada abertura.
  return (
    <Formulario
      key={`${chamado.id}-${para}`}
      chamado={chamado}
      para={para}
      respostas={respostas}
      exigirFoto={exigirFoto}
      onClose={onClose}
      onFeito={onFeito}
    />
  );
}

function Formulario({
  chamado,
  para,
  respostas,
  exigirFoto = true,
  onClose,
  onFeito,
}: Props & { para: string }) {
  const colors = useColors();
  const toast = useToast();
  const checklist = chamado.checklist ?? [];

  const [texto, setTexto] = useState('');
  const [resposta, setResposta] = useState('');
  const [motivo, setMotivo] = useState<MotivoRejeicao | null>(null);
  const [original, setOriginal] = useState<ChamadoFila | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [evidencia, setEvidencia] = useState<Evidencia | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [tentou, setTentou] = useState(false);

  const concluir = para === 'concluido';
  const rejeitar = para === 'rejeitado';
  const reabrir = para === 'pendente';
  const verbo = VERBO_TRANSICAO[para]?.rotulo ?? rotuloOperacao(para);

  // O que falta, em frases: aparece no rodapé e explica o botão desabilitado.
  const faltando: string[] = [];
  if (concluir && exigirFoto && !evidencia) faltando.push('a foto do serviço concluído');
  if (concluir && marcados.size < checklist.length) faltando.push('todos os itens do checklist');
  if (rejeitar && !motivo) faltando.push('o motivo');
  if (rejeitar && motivo === 'duplicado' && !original) faltando.push('o chamado original');
  if (rejeitar && resposta.trim().length < 10) faltando.push('a explicação ao cidadão');
  if (reabrir && texto.trim().length < 5) faltando.push('o motivo da reabertura');

  async function enviar() {
    setTentou(true);
    if (faltando.length > 0) return;
    const dados: DadosTransicao = { para };
    if (texto.trim()) dados.texto = texto.trim();
    if (resposta.trim()) dados.resposta_publica = resposta.trim();
    if (rejeitar && motivo) dados.motivo = motivo;
    if (rejeitar && motivo === 'duplicado' && original) dados.duplicado_de = String(original.id);
    if (concluir && checklist.length > 0) dados.checklist = [...marcados];

    setEnviando(true);
    try {
      const r = await executarOuEnfileirar<ChamadoFila>(
        {
          tipo: 'transicao',
          defeito_id: chamado.id,
          dados,
          foto: evidencia?.foto ?? null,
          local: evidencia?.local ?? null,
        },
        `${verbo} ${identificador(chamado)}`,
      );
      if (r.offline) {
        toast.warning('Sem conexão: a mudança foi guardada e será enviada quando a rede voltar.');
        onFeito({ para, chamado: null, offline: true });
      } else {
        toast.success(`${identificador(chamado)}: ${rotuloOperacao(para).toLowerCase()}.`);
        onFeito({ para, chamado: r.resposta, offline: false });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível mudar o status.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <BottomSheet
      visible
      onClose={onClose}
      title={`${verbo} · ${identificador(chamado)}`}
      description={`${nomeCategoria(chamado)}${chamado.rua ? ` · ${chamado.rua}` : ''}`}
      footer={
        <View style={styles.rodape}>
          {tentou && faltando.length > 0 ? (
            <View style={styles.falta} accessibilityLiveRegion="polite">
              <Ionicons name="alert-circle" size={16} color={colors.danger} />
              <AppText variant="caption" tone="danger" style={styles.flex}>
                Falta {faltando.join(', ')}.
              </AppText>
            </View>
          ) : null}
          <View style={styles.botoes}>
            <Button variant="secondary" onPress={onClose}>
              Cancelar
            </Button>
            <Button
              block
              style={styles.flex}
              variant={rejeitar ? 'danger' : 'primary'}
              loading={enviando}
              onPress={enviar}>
              {verbo}
            </Button>
          </View>
        </View>
      }>
      {concluir ? (
        <>
          {checklist.length > 0 ? (
            <View style={styles.bloco}>
              <AppText variant="label">Checklist do serviço</AppText>
              <AppText variant="caption" tone="secondary">
                Confirme cada etapa antes de concluir.
              </AppText>
              <ChecklistCampo itens={checklist} marcados={marcados} onChange={setMarcados} />
            </View>
          ) : null}
          <FotoCampo
            rotulo="Foto do depois"
            obrigatoria={exigirFoto}
            evidencia={evidencia}
            onChange={setEvidencia}
          />
        </>
      ) : null}

      {rejeitar ? (
        <View style={styles.bloco}>
          <AppText variant="label">Motivo da rejeição</AppText>
          <OpcoesRadio
            rotulo="Motivo da rejeição"
            opcoes={MOTIVOS_REJEICAO}
            valor={motivo}
            onChange={(m) => {
              setMotivo(m);
              // Só preenche se a pessoa ainda não escreveu nada próprio.
              const modelos = Object.values(TEXTO_REJEICAO);
              if (!resposta.trim() || modelos.includes(resposta)) setResposta(TEXTO_REJEICAO[m]);
            }}
          />
          {motivo === 'duplicado' ? (
            <BuscaOriginal chamado={chamado} escolhido={original} onEscolher={setOriginal} />
          ) : null}
        </View>
      ) : null}

      {reabrir ? (
        <TextField
          label="Motivo da reabertura"
          value={texto}
          onChangeText={setTexto}
          multiline
          invalid={tentou && texto.trim().length < 5}
          hint="Aparece no histórico público do chamado."
          placeholder="Ex.: o problema voltou; o serviço ficou incompleto"
        />
      ) : null}

      <View style={styles.bloco}>
        <TextField
          label={rejeitar ? 'Explicação ao cidadão' : 'Resposta ao cidadão (opcional)'}
          value={resposta}
          onChangeText={setResposta}
          multiline
          invalid={rejeitar && tentou && resposta.trim().length < 10}
          hint="Aparece no acompanhamento do chamado e gera aviso para quem reportou."
          placeholder={concluir ? 'Ex.: buraco tapado com asfalto a quente.' : 'Escreva em linguagem simples.'}
        />
        <RespostasPadraoChips respostas={respostas} categoriaId={chamado.categoria_id} onEscolher={setResposta} />
      </View>

      {!reabrir ? (
        <TextField
          label="Nota interna (opcional)"
          value={texto}
          onChangeText={setTexto}
          multiline
          hint="Fica no histórico como nota interna: só a equipe da prefeitura vê."
        />
      ) : null}
    </BottomSheet>
  );
}

/** Busca do chamado original para marcar duplicado: protocolo exato ou texto na fila. */
function BuscaOriginal({
  chamado,
  escolhido,
  onEscolher,
}: {
  chamado: ChamadoFila;
  escolhido: ChamadoFila | null;
  onEscolher: (c: ChamadoFila | null) => void;
}) {
  const colors = useColors();
  const [termo, setTermo] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [resultados, setResultados] = useState<ChamadoFila[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function buscar() {
    const t = termo.trim();
    if (!t) return;
    setBuscando(true);
    setErro(null);
    try {
      let lista: ChamadoFila[];
      if (REGEX_PROTOCOLO.test(t)) {
        lista = [await apiOperacao.porProtocolo(t)];
      } else {
        // O original pode estar aberto ou já fechado (contrato §1).
        lista = (await apiOperacao.fila({ q: t, ordenar: 'score', status: 'todos' })).results ?? [];
      }
      setResultados(lista.filter((c) => String(c.id) !== String(chamado.id)));
    } catch (err) {
      setResultados(null);
      setErro(err instanceof Error ? err.message : 'Não foi possível buscar.');
    } finally {
      setBuscando(false);
    }
  }

  if (escolhido) {
    return (
      <View style={[styles.escolhido, { borderColor: colors.primary, backgroundColor: colors.primarySubtle }]}>
        <Ionicons name="link" size={18} color={colors.primaryText} />
        <View style={styles.flex}>
          <AppText variant="label">Original: {identificador(escolhido)}</AppText>
          <AppText variant="caption" tone="secondary" numberOfLines={1}>
            {nomeCategoria(escolhido)} · {escolhido.rua || 'sem endereço'} · {rotuloOperacao(escolhido.status)}
          </AppText>
        </View>
        <Button size="sm" variant="ghost" onPress={() => onEscolher(null)}>
          Trocar
        </Button>
      </View>
    );
  }

  return (
    <View style={styles.bloco}>
      <View style={styles.linhaBusca}>
        <TextField
          value={termo}
          onChangeText={setTermo}
          placeholder="Protocolo (2026-000123) ou rua"
          accessibilityLabel="Buscar chamado original"
          returnKeyType="search"
          onSubmitEditing={buscar}
          containerStyle={styles.flex}
        />
        <Button variant="secondary" onPress={buscar} loading={buscando} accessibilityLabel="Buscar">
          Buscar
        </Button>
      </View>
      {erro ? (
        <AppText variant="caption" tone="danger">
          {erro}
        </AppText>
      ) : null}
      {resultados && resultados.length === 0 ? (
        <AppText variant="caption" tone="secondary">
          Nenhum chamado encontrado. Tente pelo protocolo exato.
        </AppText>
      ) : null}
      {resultados?.slice(0, 8).map((c) => (
        <Pressable
          key={String(c.id)}
          onPress={() => onEscolher(c)}
          accessibilityRole="button"
          accessibilityLabel={`Escolher ${identificador(c)}, ${nomeCategoria(c)}, ${c.rua ?? ''}`}
          style={({ pressed }) => [
            styles.resultado,
            { borderColor: colors.border, backgroundColor: pressed ? colors.surfacePressed : 'transparent' },
          ]}>
          <View style={styles.flex}>
            <AppText variant="label">{identificador(c)}</AppText>
            <AppText variant="caption" tone="secondary" numberOfLines={1}>
              {nomeCategoria(c)} · {c.rua || 'sem endereço'} · {rotuloOperacao(c.status)}
            </AppText>
          </View>
          <Ionicons name="add-circle" size={20} color={colors.primaryText} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  bloco: {
    gap: Spacing[2],
  },
  rodape: {
    flex: 1,
    gap: Spacing[2],
  },
  botoes: {
    flexDirection: 'row',
    gap: Spacing[2],
  },
  falta: {
    flexDirection: 'row',
    gap: Spacing[1],
    alignItems: 'flex-start',
  },
  linhaBusca: {
    flexDirection: 'row',
    gap: Spacing[2],
    alignItems: 'center',
  },
  resultado: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    minHeight: Layout.minTouch + 4,
    padding: Spacing[2],
    borderWidth: 1,
    borderRadius: Radius.md,
  },
  escolhido: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    padding: Spacing[3],
    borderWidth: 1,
    borderRadius: Radius.md,
  },
});
