/**
 * Secretarias e equipes de campo (contrato v3, 7.6 `secretarias/`,
 * `equipes/`). A secretaria é o órgão responsável que aparece para o cidadão
 * e na OS; a equipe é quem vai à rua. Categorias apontam para secretarias e
 * a fila da operação filtra por equipe.
 *
 * Gestor consulta; o administrador cria, edita, desativa e exclui. Desativar
 * é o caminho preferido: excluir uma secretaria com chamados no histórico
 * pode ser recusado pelo backend (409).
 */

import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { confirmar, mensagemDeErro } from '@/components/gestao/confirmar';
import { EstadoCarga } from '@/components/gestao/estado-carga';
import { GestaoShell } from '@/components/gestao/gestao-shell';
import { usePapel } from '@/components/gestao/papeis';
import { SwitchRow } from '@/components/gestao/switch-row';
import { useDados } from '@/components/gestao/use-dados';
import { Badge } from '@/components/ui/badge';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { ListItem } from '@/components/ui/list-item';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select } from '@/components/ui/select';
import { StateView } from '@/components/ui/state-view';
import { TextField } from '@/components/ui/text-field';
import { Layout, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import { useToast } from '@/context/toast-context';
import { apiGestao } from '@/services/api-gestao';
import type { Equipe, Secretaria } from '@/types/gestao';

type Aba = 'secretarias' | 'equipes';

/** `null` fechado; `'nova'` criando; objeto editando. */
type Edicao<T> = T | 'nova' | null;
type Aberta<T> = Exclude<Edicao<T>, null>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SecretariasScreen() {
  const insets = useSafeAreaInsets();
  const { ehAdmin } = usePapel();
  const [aba, setAba] = useState<Aba>('secretarias');
  const [editSecretaria, setEditSecretaria] = useState<Edicao<Secretaria>>(null);
  const [editEquipe, setEditEquipe] = useState<Edicao<Equipe>>(null);

  const dados = useDados(() => Promise.all([apiGestao.secretarias(), apiGestao.equipes()]));
  const secretarias = useMemo(() => dados.dados?.[0] ?? [], [dados.dados]);
  const equipes = useMemo(() => dados.dados?.[1] ?? [], [dados.dados]);

  const nomeSecretaria = useMemo(
    () => new Map(secretarias.map((s) => [s.id, s.sigla || s.nome])),
    [secretarias],
  );

  function novo() {
    if (aba === 'secretarias') setEditSecretaria('nova');
    else setEditEquipe('nova');
  }

  const refresh = <RefreshControl refreshing={dados.atualizando} onRefresh={dados.atualizar} />;
  const rodape = { paddingBottom: insets.bottom + Spacing[16] };

  return (
    <GestaoShell
      title="Secretarias e equipes"
      minimo="gestor"
      acao={
        ehAdmin
          ? {
              icon: 'add',
              label: aba === 'secretarias' ? 'Nova secretaria' : 'Nova equipe',
              onPress: novo,
            }
          : undefined
      }>
      <View style={styles.abas}>
        <SegmentedControl
          options={[
            { value: 'secretarias', label: 'Secretarias', icon: 'business' },
            { value: 'equipes', label: 'Equipes', icon: 'people' },
          ]}
          value={aba}
          onChange={setAba}
          accessibilityLabel="Mostrar"
        />
      </View>

      {dados.estado !== 'pronto' ? (
        <EstadoCarga
          estado={dados.estado}
          erro={dados.erro}
          onRetry={dados.recarregar}
          oQue="as secretarias"
        />
      ) : aba === 'secretarias' ? (
        <FlatList
          data={secretarias}
          keyExtractor={(s) => String(s.id)}
          contentContainerStyle={[styles.lista, rodape]}
          refreshControl={refresh}
          ListEmptyComponent={
            <StateView
              kind="empty"
              icon="business-outline"
              title="Nenhuma secretaria cadastrada"
              description="Cadastre os órgãos que respondem pelos chamados — por exemplo, Obras ou Meio Ambiente."
              action={ehAdmin ? { label: 'Cadastrar secretaria', onPress: novo } : undefined}
            />
          }
          renderItem={({ item }) => {
            const qtd = equipes.filter((e) => e.secretaria_id === item.id).length;
            return (
              <ListItem
                title={item.sigla ? `${item.nome} (${item.sigla})` : item.nome}
                subtitle={item.email || 'Sem e-mail de contato'}
                meta={qtd === 1 ? '1 equipe' : `${qtd} equipes`}
                leading="business"
                onPress={ehAdmin ? () => setEditSecretaria(item) : undefined}
                trailing={<SeloAtivo ativo={item.ativo} />}
              />
            );
          }}
        />
      ) : (
        <FlatList
          data={equipes}
          keyExtractor={(e) => String(e.id)}
          contentContainerStyle={[styles.lista, rodape]}
          refreshControl={refresh}
          ListEmptyComponent={
            <StateView
              kind="empty"
              icon="people-outline"
              title="Nenhuma equipe cadastrada"
              description="Equipes de campo recebem chamados atribuídos pelo gestor. Ex.: Tapa-buraco Zona Norte."
              action={ehAdmin ? { label: 'Cadastrar equipe', onPress: novo } : undefined}
            />
          }
          renderItem={({ item }) => {
            const secretaria =
              item.secretaria_nome ||
              (item.secretaria_id ? nomeSecretaria.get(item.secretaria_id) : null);
            return (
              <ListItem
                title={item.nome}
                subtitle={secretaria ? `Secretaria: ${secretaria}` : 'Sem secretaria'}
                meta={
                  item.total_membros !== undefined
                    ? item.total_membros === 1
                      ? '1 membro'
                      : `${item.total_membros} membros`
                    : undefined
                }
                leading="people"
                onPress={ehAdmin ? () => setEditEquipe(item) : undefined}
                trailing={<SeloAtivo ativo={item.ativo} />}
              />
            );
          }}
        />
      )}

      {/* Montadas só quando abertas, com `key` pelo item: o formulário
          nasce preenchido, sem efeito para resetar. */}
      {editSecretaria ? (
        <SecretariaSheet
          key={editSecretaria === 'nova' ? 'nova' : editSecretaria.id}
          edicao={editSecretaria}
          onFechar={() => setEditSecretaria(null)}
          onSalvo={dados.atualizar}
        />
      ) : null}
      {editEquipe ? (
        <EquipeSheet
          key={editEquipe === 'nova' ? 'nova' : editEquipe.id}
          edicao={editEquipe}
          secretarias={secretarias}
          onFechar={() => setEditEquipe(null)}
          onSalvo={dados.atualizar}
        />
      ) : null}
    </GestaoShell>
  );
}

function SeloAtivo({ ativo }: { ativo: boolean }) {
  return ativo ? (
    <Badge label="Ativa" tone="success" />
  ) : (
    <Badge label="Inativa" tone="neutral" icon="pause-circle" />
  );
}

function RodapeEdicao({
  editando,
  salvando,
  excluindo,
  onSalvar,
  onExcluir,
  onCancelar,
}: {
  editando: boolean;
  salvando: boolean;
  excluindo: boolean;
  onSalvar: () => void;
  onExcluir: () => void;
  onCancelar: () => void;
}) {
  const colors = useColors();
  return (
    <>
      {editando ? (
        <Button
          variant="danger"
          onPress={onExcluir}
          loading={excluindo}
          disabled={salvando}
          icon={<Ionicons name="trash" size={16} color={colors.danger} />}
          style={styles.botao}>
          Excluir
        </Button>
      ) : (
        <Button variant="secondary" onPress={onCancelar} style={styles.botao}>
          Cancelar
        </Button>
      )}
      <Button onPress={onSalvar} loading={salvando} disabled={excluindo} style={styles.botao}>
        Salvar
      </Button>
    </>
  );
}

function SecretariaSheet({
  edicao,
  onFechar,
  onSalvo,
}: {
  edicao: Aberta<Secretaria>;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const toast = useToast();
  const existente = edicao !== 'nova' ? edicao : null;
  const [nome, setNome] = useState(existente?.nome ?? '');
  const [sigla, setSigla] = useState(existente?.sigla ?? '');
  const [email, setEmail] = useState(existente?.email ?? '');
  const [ativo, setAtivo] = useState(existente?.ativo ?? true);
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);

  const nomeOk = nome.trim().length >= 3;
  const emailOk = !email.trim() || EMAIL_RE.test(email.trim());

  async function salvar() {
    setTentou(true);
    if (!nomeOk || !emailOk) return;
    setSalvando(true);
    const corpo = { nome: nome.trim(), sigla: sigla.trim().toUpperCase(), email: email.trim(), ativo };
    try {
      if (existente) await apiGestao.salvarSecretaria(existente.id, corpo);
      else await apiGestao.criarSecretaria(corpo);
      toast.success(existente ? 'Secretaria atualizada' : 'Secretaria cadastrada');
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
      titulo: 'Excluir secretaria?',
      mensagem: `"${existente.nome}" deixa de existir no app. Se ela já tem chamados ou categorias, prefira desativá-la para manter o histórico.`,
      confirmar: 'Excluir',
      destrutivo: true,
    });
    if (!ok) return;
    setExcluindo(true);
    try {
      await apiGestao.excluirSecretaria(existente.id);
      toast.success('Secretaria excluída');
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
      title={existente ? 'Editar secretaria' : 'Nova secretaria'}
      footer={
        <RodapeEdicao
          editando={!!existente}
          salvando={salvando}
          excluindo={excluindo}
          onSalvar={salvar}
          onExcluir={excluir}
          onCancelar={onFechar}
        />
      }>
      <TextField
        label="Nome"
        value={nome}
        onChangeText={setNome}
        placeholder="Secretaria de Obras"
        invalid={tentou && !nomeOk}
        hint={tentou && !nomeOk ? 'Informe o nome (mínimo de 3 letras).' : undefined}
      />
      <TextField
        label="Sigla (opcional)"
        value={sigla}
        onChangeText={setSigla}
        placeholder="SEOBRAS"
        autoCapitalize="characters"
        maxLength={16}
      />
      <TextField
        label="E-mail de contato (opcional)"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="obras@prefeitura.gov.br"
        invalid={tentou && !emailOk}
        hint={tentou && !emailOk ? 'E-mail inválido.' : 'Recebe cópia das ordens de serviço.'}
      />
      <SwitchRow
        label="Ativa"
        descricao="Secretaria inativa não aparece para novas categorias e atribuições."
        valor={ativo}
        onChange={setAtivo}
      />
    </BottomSheet>
  );
}

function EquipeSheet({
  edicao,
  secretarias,
  onFechar,
  onSalvo,
}: {
  edicao: Aberta<Equipe>;
  secretarias: Secretaria[];
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const toast = useToast();
  const existente = edicao !== 'nova' ? edicao : null;
  const [nome, setNome] = useState(existente?.nome ?? '');
  const [secretariaId, setSecretariaId] = useState(
    existente?.secretaria_id ? String(existente.secretaria_id) : '',
  );
  const [ativo, setAtivo] = useState(existente?.ativo ?? true);
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);

  const opcoes = useMemo(
    () => [
      { value: '', label: 'Nenhuma' },
      ...secretarias
        .filter((s) => s.ativo || String(s.id) === secretariaId)
        .map((s) => ({ value: String(s.id), label: s.nome })),
    ],
    [secretarias, secretariaId],
  );

  const nomeOk = nome.trim().length >= 3;

  async function salvar() {
    setTentou(true);
    if (!nomeOk) return;
    setSalvando(true);
    const corpo = {
      nome: nome.trim(),
      secretaria_id: secretariaId ? Number(secretariaId) : null,
      ativo,
    };
    try {
      if (existente) await apiGestao.salvarEquipe(existente.id, corpo);
      else await apiGestao.criarEquipe(corpo);
      toast.success(existente ? 'Equipe atualizada' : 'Equipe cadastrada');
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
      titulo: 'Excluir equipe?',
      mensagem: `"${existente.nome}" deixa de existir. Os membros continuam na equipe da prefeitura, só sem esta lotação.`,
      confirmar: 'Excluir',
      destrutivo: true,
    });
    if (!ok) return;
    setExcluindo(true);
    try {
      await apiGestao.excluirEquipe(existente.id);
      toast.success('Equipe excluída');
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
      title={existente ? 'Editar equipe' : 'Nova equipe'}
      footer={
        <RodapeEdicao
          editando={!!existente}
          salvando={salvando}
          excluindo={excluindo}
          onSalvar={salvar}
          onExcluir={excluir}
          onCancelar={onFechar}
        />
      }>
      <TextField
        label="Nome"
        value={nome}
        onChangeText={setNome}
        placeholder="Tapa-buraco Zona Norte"
        invalid={tentou && !nomeOk}
        hint={tentou && !nomeOk ? 'Informe o nome (mínimo de 3 letras).' : undefined}
      />
      <Select
        label="Secretaria"
        title="Secretaria"
        options={opcoes}
        value={secretariaId}
        onChange={setSecretariaId}
      />
      <SwitchRow
        label="Ativa"
        descricao="Equipe inativa não recebe novas atribuições."
        valor={ativo}
        onChange={setAtivo}
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  abas: {
    paddingHorizontal: Layout.gutter,
    paddingBottom: Spacing[3],
  },
  lista: {
    paddingHorizontal: Layout.gutter,
    gap: Spacing[1],
    flexGrow: 1,
  },
  botao: {
    flex: 1,
  },
});
