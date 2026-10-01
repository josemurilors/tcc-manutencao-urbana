/**
 * Respostas-padrão (contrato v3, 7.5 `operacao/respostas-padrao/`): textos
 * prontos que a equipe escolhe ao responder o cidadão, rejeitar ou concluir
 * um chamado. Sem nenhuma cadastrada, a operação mostra sugestões genéricas
 * (`components/operacao/use-catalogos.ts`); aqui o município escreve as suas.
 *
 * Gestor ou mais cria, edita e exclui. A resposta pode valer para qualquer
 * categoria ou só para uma (aparece só nos chamados dela).
 *
 * A rota é da operação e só conhece o município do próprio usuário: o
 * super_admin não troca de município aqui.
 */

import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { confirmar, mensagemDeErro } from '@/components/gestao/confirmar';
import { EstadoCarga } from '@/components/gestao/estado-carga';
import { GestaoShell } from '@/components/gestao/gestao-shell';
import { useDados } from '@/components/gestao/use-dados';
import { Badge } from '@/components/ui/badge';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { ListItem } from '@/components/ui/list-item';
import { Select } from '@/components/ui/select';
import { StateView } from '@/components/ui/state-view';
import { TextField } from '@/components/ui/text-field';
import { AppText } from '@/components/ui/text';
import { Layout, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import { useToast } from '@/context/toast-context';
import { apiGestao } from '@/services/api-gestao';
import type { CategoriaGestao, RespostaPadraoEntrada, RespostaPadraoGestao } from '@/types/gestao';

type Edicao = RespostaPadraoGestao | 'nova' | null;

// Limites do backend (`operacao/serializers.py::RespostaPadraoSerializer`).
const TITULO_MAX = 120;
const TEXTO_MAX = 2000;

/** Valor do Select para "qualquer categoria" (o Select trabalha com string). */
const TODAS = '';

export default function RespostasScreen() {
  const insets = useSafeAreaInsets();
  const [edicao, setEdicao] = useState<Edicao>(null);

  const dados = useDados(() =>
    Promise.all([
      apiGestao.respostasPadrao(),
      // Categoria é só o rótulo da linha: falhou, a lista sai sem ele.
      apiGestao.categorias().catch((err: unknown) => {
        console.warn('[respostas] categorias falharam:', err);
        return [] as CategoriaGestao[];
      }),
    ]),
  );
  const respostas = useMemo(() => dados.dados?.[0] ?? [], [dados.dados]);
  const categorias = useMemo(() => dados.dados?.[1] ?? [], [dados.dados]);
  const nomeCategoria = useMemo(
    () => new Map(categorias.map((c) => [c.categoria_id, c.nome])),
    [categorias],
  );

  return (
    <GestaoShell
      title="Respostas-padrão"
      subtitle={dados.estado === 'pronto' ? `${respostas.length} cadastradas` : undefined}
      minimo="gestor"
      semSeletorMunicipio
      acao={{ icon: 'add', label: 'Nova resposta', onPress: () => setEdicao('nova') }}>
      {dados.estado !== 'pronto' ? (
        <EstadoCarga
          estado={dados.estado}
          erro={dados.erro}
          onRetry={dados.recarregar}
          oQue="as respostas-padrão"
        />
      ) : (
        <FlatList
          data={respostas}
          keyExtractor={(r) => String(r.id)}
          contentContainerStyle={[styles.lista, { paddingBottom: insets.bottom + Spacing[16] }]}
          refreshControl={<RefreshControl refreshing={dados.atualizando} onRefresh={dados.atualizar} />}
          ListHeaderComponent={
            respostas.length ? (
              <AppText variant="bodySm" tone="secondary" style={styles.intro}>
                A equipe escolhe estes textos ao responder o cidadão. Toque para editar.
              </AppText>
            ) : null
          }
          ListEmptyComponent={
            <StateView
              kind="empty"
              icon="chatbubbles-outline"
              title="Nenhuma resposta cadastrada"
              description="Enquanto isso, a equipe vê sugestões genéricas. Escreva as respostas do seu município: avisos de vistoria, prazos, encaminhamentos."
              action={{ label: 'Escrever a primeira', onPress: () => setEdicao('nova') }}
            />
          }
          renderItem={({ item }) => {
            const categoria = item.categoria_id ? nomeCategoria.get(item.categoria_id) : null;
            return (
              <ListItem
                title={item.titulo}
                subtitle={item.texto}
                leading="chatbubble-ellipses"
                onPress={() => setEdicao(item)}
                accessibilityHint="Abre para editar ou excluir"
                trailing={
                  <Badge
                    label={item.categoria_id ? (categoria ?? 'Uma categoria') : 'Todas'}
                    tone={item.categoria_id ? 'info' : 'neutral'}
                    icon={null}
                  />
                }
              />
            );
          }}
        />
      )}

      {edicao ? (
        <RespostaSheet
          key={edicao === 'nova' ? 'nova' : edicao.id}
          edicao={edicao}
          categorias={categorias}
          onFechar={() => setEdicao(null)}
          onSalvo={dados.atualizar}
        />
      ) : null}
    </GestaoShell>
  );
}

function RespostaSheet({
  edicao,
  categorias,
  onFechar,
  onSalvo,
}: {
  edicao: Exclude<Edicao, null>;
  categorias: CategoriaGestao[];
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const colors = useColors();
  const toast = useToast();
  const existente = edicao !== 'nova' ? edicao : null;
  const [titulo, setTitulo] = useState(existente?.titulo ?? '');
  const [texto, setTexto] = useState(existente?.texto ?? '');
  const [categoriaId, setCategoriaId] = useState(
    existente?.categoria_id ? String(existente.categoria_id) : TODAS,
  );
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);

  const opCategorias = useMemo(
    () => [
      { value: TODAS, label: 'Todas as categorias' },
      ...categorias
        .filter((c) => c.ativo || String(c.categoria_id) === categoriaId)
        .map((c) => ({ value: String(c.categoria_id), label: c.nome })),
    ],
    [categorias, categoriaId],
  );

  const tituloOk = titulo.trim().length >= 3;
  const textoOk = texto.trim().length >= 10;

  async function salvar() {
    setTentou(true);
    if (!tituloOk || !textoOk) return;
    setSalvando(true);
    const corpo: RespostaPadraoEntrada = {
      titulo: titulo.trim(),
      texto: texto.trim(),
      categoria_id: categoriaId === TODAS ? null : Number(categoriaId),
    };
    try {
      if (existente) await apiGestao.salvarRespostaPadrao(existente.id, corpo);
      else await apiGestao.criarRespostaPadrao(corpo);
      toast.success(existente ? 'Resposta atualizada' : 'Resposta cadastrada');
      onSalvo();
      onFechar();
    } catch (err) {
      toast.error(`Não foi possível salvar: ${mensagemDeErro(err)}`);
    } finally {
      setSalvando(false);
    }
  }

  async function excluir() {
    if (!existente) return;
    const ok = await confirmar({
      titulo: 'Excluir resposta?',
      mensagem: `"${existente.titulo}" deixa de aparecer para a equipe. Respostas já enviadas aos cidadãos não mudam.`,
      confirmar: 'Excluir',
      destrutivo: true,
    });
    if (!ok) return;
    setExcluindo(true);
    try {
      await apiGestao.excluirRespostaPadrao(existente.id);
      toast.success('Resposta excluída');
      onSalvo();
      onFechar();
    } catch (err) {
      toast.error(`Não foi possível excluir: ${mensagemDeErro(err)}`);
    } finally {
      setExcluindo(false);
    }
  }

  return (
    <BottomSheet
      visible
      onClose={onFechar}
      title={existente ? 'Editar resposta' : 'Nova resposta'}
      description="O cidadão lê este texto no histórico do chamado."
      footer={
        <>
          {existente ? (
            <Button
              variant="danger"
              onPress={excluir}
              loading={excluindo}
              disabled={salvando}
              icon={<Ionicons name="trash" size={16} color={colors.danger} />}
              style={styles.botao}>
              Excluir
            </Button>
          ) : (
            <Button variant="secondary" onPress={onFechar} style={styles.botao}>
              Cancelar
            </Button>
          )}
          <Button onPress={salvar} loading={salvando} disabled={excluindo} style={styles.botao}>
            Salvar
          </Button>
        </>
      }>
      <TextField
        label="Título"
        value={titulo}
        onChangeText={setTitulo}
        maxLength={TITULO_MAX}
        placeholder="Ex.: Vistoria agendada"
        invalid={tentou && !tituloOk}
        hint={tentou && !tituloOk ? 'Dê um título curto (mínimo 3 letras).' : 'Só a equipe vê o título.'}
      />
      <TextField
        label="Texto"
        value={texto}
        onChangeText={setTexto}
        maxLength={TEXTO_MAX}
        multiline
        textAlignVertical="top"
        style={styles.texto}
        placeholder="Ex.: Recebemos seu chamado e a equipe fará a vistoria nos próximos dias."
        invalid={tentou && !textoOk}
        hint={
          tentou && !textoOk
            ? 'Escreva a resposta (mínimo 10 letras).'
            : `${texto.length}/${TEXTO_MAX} caracteres`
        }
      />
      <View style={styles.categoria}>
        <Select
          label="Categoria"
          title="Vale para"
          options={opCategorias}
          value={categoriaId}
          onChange={setCategoriaId}
        />
        <AppText variant="caption" tone="muted">
          Com uma categoria, a resposta só aparece nos chamados dela.
        </AppText>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  lista: {
    paddingHorizontal: Layout.gutter,
    gap: Spacing[1],
    flexGrow: 1,
  },
  intro: {
    paddingBottom: Spacing[2],
  },
  texto: {
    minHeight: 120,
  },
  categoria: {
    gap: Spacing[1],
  },
  botao: {
    flex: 1,
  },
});
