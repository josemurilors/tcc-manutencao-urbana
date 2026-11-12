/**
 * Contas da plataforma (só super_admin, `gestao/usuarios/`): todas as pessoas
 * cadastradas, de qualquer município e papel. Equipe (`/admin/equipe`) é a
 * visão de UM município; aqui é a visão da plataforma. Tocar numa conta abre a
 * folha para trocar papel e município; lotação (secretaria/equipe) continua em
 * Equipe, e suspender cidadão em Moderação.
 *
 * Busca por nome/e-mail (300 ms de espera) e filtros de papel, situação e
 * município, paginados no servidor com rolagem infinita.
 */

import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { confirmar, mensagemDeErro } from '@/components/gestao/confirmar';
import { EstadoCarga } from '@/components/gestao/estado-carga';
import { GestaoShell } from '@/components/gestao/gestao-shell';
import { OpcaoRadio } from '@/components/gestao/opcao-radio';
import { DESCRICAO_PAPEL, ehPapel, ROTULO_PAPEL, TOM_PAPEL } from '@/components/gestao/papeis';
import { useMunicipios } from '@/components/gestao/seletor-municipio';
import { useDebounce } from '@/components/gestao/use-debounce';
import { useListaPaginada } from '@/components/gestao/use-lista-paginada';
import { Badge } from '@/components/ui/badge';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { FilterChips } from '@/components/ui/chips';
import { ListItem } from '@/components/ui/list-item';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { StateView } from '@/components/ui/state-view';
import { AppText } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { Layout, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useColors } from '@/context/theme-context';
import { useToast } from '@/context/toast-context';
import { apiGestao } from '@/services/api-gestao';
import type { AlteracaoConta, Papel, UsuarioPlataforma } from '@/types/gestao';
import { formatarData } from '@/utils/format';

type FiltroPapel = 'todos' | Papel;
type FiltroSituacao = 'todas' | 'ativo' | 'suspenso';

const FILTROS_PAPEL: { value: FiltroPapel; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'cidadao', label: 'Cidadãos' },
  { value: 'operador', label: 'Operadores' },
  { value: 'gestor', label: 'Gestores' },
  { value: 'admin_municipal', label: 'Administradores' },
  { value: 'super_admin', label: 'Plataforma' },
];

const FILTROS_SITUACAO: { value: FiltroSituacao; label: string }[] = [
  { value: 'todas', label: 'Qualquer situação' },
  { value: 'ativo', label: 'Ativas' },
  { value: 'suspenso', label: 'Suspensas' },
];

/** Valor do seletor para "todos os municípios" (filtro) ou "sem município" (conta). */
const TODOS = '';

const OPCOES_PAPEL = (['cidadao', 'operador', 'gestor', 'admin_municipal', 'super_admin'] as const).map((p) => ({
  value: p,
  label: ROTULO_PAPEL[p],
  descricao:
    p === 'cidadao'
      ? 'Usa o app como cidadão: abre e apoia chamados.'
      : p === 'super_admin'
        ? 'Equipe da plataforma: gere qualquer município. Conceda com cuidado.'
        : DESCRICAO_PAPEL[p],
}));

export default function ContasScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();

  const [busca, setBusca] = useState('');
  const [papel, setPapel] = useState<FiltroPapel>('todos');
  const [situacao, setSituacao] = useState<FiltroSituacao>('todas');
  const [municipio, setMunicipio] = useState(TODOS);
  const q = useDebounce(busca.trim(), 300);

  const { lista: municipios, falhou } = useMunicipios();
  const opcoesMunicipio = useMemo(
    () => [
      { value: TODOS, label: 'Todos os municípios', group: 'Plataforma' },
      ...(municipios ?? []).map((m) => ({ value: m.codigo, label: m.nome, group: m.uf_sigla })),
    ],
    [municipios],
  );

  const lista = useListaPaginada<UsuarioPlataforma>(
    (page) =>
      apiGestao.usuariosPlataforma({
        q,
        papel: papel === 'todos' ? undefined : papel,
        situacao: situacao === 'todas' ? undefined : situacao,
        municipio,
        page,
      }),
    `${q}|${papel}|${situacao}|${municipio}`,
  );

  const [selecionada, setSelecionada] = useState<UsuarioPlataforma | null>(null);

  const filtrando = !!q || papel !== 'todos' || situacao !== 'todas' || municipio !== TODOS;

  return (
    <GestaoShell
      title="Contas"
      subtitle={lista.estado === 'pronto' ? `${lista.total} na plataforma` : undefined}
      minimo="super_admin"
      semSeletorMunicipio>
      <View style={styles.filtros}>
        <TextField
          value={busca}
          onChangeText={setBusca}
          placeholder="Buscar por nome ou e-mail"
          accessibilityLabel="Buscar contas por nome ou e-mail"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          containerStyle={styles.campo}
        />
        <View style={styles.campo}>
          <SearchableSelect
            label="Município"
            options={opcoesMunicipio}
            value={municipio}
            placeholder={municipios ? 'Todos os municípios' : 'Carregando municípios…'}
            onChange={setMunicipio}
          />
          {falhou ? (
            <AppText variant="caption" tone="warning">
              Não foi possível carregar a lista de municípios.
            </AppText>
          ) : null}
        </View>
        <FilterChips
          options={FILTROS_PAPEL}
          value={papel}
          onChange={setPapel}
          accessibilityLabel="Filtrar por papel"
        />
        <FilterChips
          options={FILTROS_SITUACAO}
          value={situacao}
          onChange={setSituacao}
          accessibilityLabel="Filtrar por situação"
        />
      </View>

      {lista.estado !== 'pronto' ? (
        <EstadoCarga estado={lista.estado} erro={lista.erro} onRetry={lista.recarregar} oQue="as contas" />
      ) : (
        <FlatList
          data={lista.itens}
          keyExtractor={(u) => u.id}
          contentContainerStyle={[styles.lista, { paddingBottom: insets.bottom + Spacing[16] }]}
          onEndReached={lista.carregarMais}
          onEndReachedThreshold={0.4}
          refreshControl={<RefreshControl refreshing={lista.atualizando} onRefresh={lista.atualizar} />}
          ListEmptyComponent={
            <StateView
              kind="empty"
              icon={filtrando ? 'search' : 'people-outline'}
              title={filtrando ? 'Nenhuma conta encontrada' : 'Ainda não há contas'}
              description={filtrando ? 'Confira a grafia ou limpe os filtros.' : undefined}
              action={
                filtrando
                  ? {
                      label: 'Limpar filtros',
                      onPress: () => {
                        setBusca('');
                        setPapel('todos');
                        setSituacao('todas');
                        setMunicipio(TODOS);
                      },
                    }
                  : undefined
              }
            />
          }
          ListFooterComponent={
            lista.carregandoMais ? (
              <ActivityIndicator
                color={colors.primaryText}
                style={styles.rodape}
                accessibilityLabel="Carregando mais"
              />
            ) : null
          }
          renderItem={({ item }) => <LinhaConta conta={item} onPress={() => setSelecionada(item)} />}
        />
      )}

      {/* Montada só aberta, com `key` pela conta: o formulário nasce com os valores dela. */}
      {selecionada ? (
        <ContaSheet
          key={selecionada.id}
          conta={selecionada}
          municipios={opcoesMunicipio}
          onFechar={() => setSelecionada(null)}
          onAlterada={(nova) => lista.substituir((u) => u.id === nova.id, nova)}
        />
      ) : null}
    </GestaoShell>
  );
}

function LinhaConta({ conta, onPress }: { conta: UsuarioPlataforma; onPress: () => void }) {
  const papel = ehPapel(conta.papel) ? conta.papel : 'cidadao';
  const suspenso = !!conta.suspenso_ate && new Date(conta.suspenso_ate) > new Date();
  const cidade = conta.municipio_nome
    ? `${conta.municipio_nome} - ${conta.uf_sigla ?? ''}`.replace(/ - $/, '')
    : 'Sem município';
  const meta = [cidade, conta.criado_em ? `desde ${formatarData(conta.criado_em)}` : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <ListItem
      title={conta.nome || conta.email}
      subtitle={conta.email}
      meta={meta}
      leading="person-circle"
      onPress={onPress}
      accessibilityHint="Abre as opções de papel e município"
      accessibilityLabel={`${conta.nome}, ${ROTULO_PAPEL[papel]}, ${conta.email}, ${meta}${
        suspenso ? ', suspensa' : ''
      }${conta.email_verificado ? '' : ', e-mail não verificado'}`}
      trailing={
        <View style={styles.selos}>
          <Badge label={ROTULO_PAPEL[papel]} tone={TOM_PAPEL[papel]} icon={null} />
          {suspenso ? <Badge label="Suspensa" tone="danger" /> : null}
          {conta.email_verificado ? null : <Badge label="Sem e-mail verificado" tone="warning" icon={null} />}
        </View>
      }
    />
  );
}

function ContaSheet({
  conta,
  municipios,
  onFechar,
  onAlterada,
}: {
  conta: UsuarioPlataforma;
  municipios: { value: string; label: string; group: string }[];
  onFechar: () => void;
  onAlterada: (nova: UsuarioPlataforma) => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const [papel, setPapel] = useState<Papel>(ehPapel(conta.papel) ? conta.papel : 'cidadao');
  const [municipio, setMunicipio] = useState(conta.municipio_id ?? TODOS);
  const [salvando, setSalvando] = useState(false);

  const euMesmo = String(user?.id ?? '') === conta.id;
  const mudouPapel = papel !== conta.papel;
  const mudou = mudouPapel || municipio !== (conta.municipio_id ?? TODOS);
  // Servidor da prefeitura sem município não tem onde atuar (o backend também recusa).
  const faltaMunicipio = papel !== 'cidadao' && papel !== 'super_admin' && municipio === TODOS;

  async function salvar() {
    const ok = await confirmar({
      titulo: 'Alterar conta?',
      mensagem: `${conta.nome}: ${
        mudouPapel ? `papel de ${ROTULO_PAPEL[conta.papel]} para ${ROTULO_PAPEL[papel]}` : 'mudança de município'
      }. Se for servidor e sair do cargo ou da prefeitura, perde a lotação e os chamados abertos dele voltam para a fila.`,
      confirmar: 'Alterar',
      destrutivo: papel === 'super_admin',
    });
    if (!ok) return;
    setSalvando(true);
    // Só o que mudou, como em Equipe.
    const corpo: AlteracaoConta = {};
    if (mudouPapel) corpo.papel = papel;
    if (municipio !== (conta.municipio_id ?? TODOS)) corpo.municipio_id = municipio || null;
    try {
      onAlterada(await apiGestao.alterarConta(conta.id, corpo));
      toast.success('Alterações salvas');
      onFechar();
    } catch (err) {
      toast.error(`Não foi possível salvar: ${mensagemDeErro(err)}`);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <BottomSheet
      visible
      onClose={onFechar}
      title={conta.nome || conta.email}
      description={conta.email}
      footer={
        euMesmo ? (
          <Button variant="secondary" onPress={onFechar} block style={styles.botao}>
            Fechar
          </Button>
        ) : (
          <Button onPress={salvar} loading={salvando} disabled={!mudou || faltaMunicipio} block style={styles.botao}>
            Salvar
          </Button>
        )
      }>
      {euMesmo ? (
        <StateView
          kind="empty"
          icon="lock-closed-outline"
          title="Este é você"
          description="Ninguém altera o próprio papel: peça a outra pessoa da plataforma."
        />
      ) : (
        <>
          <AppText variant="label">Papel</AppText>
          <OpcaoRadio opcoes={OPCOES_PAPEL} valor={papel} onChange={setPapel} accessibilityLabel="Papel da conta" />
          <SearchableSelect
            label="Município"
            options={municipios.map((m) => (m.value === TODOS ? { ...m, label: 'Sem município' } : m))}
            value={municipio}
            placeholder="Sem município"
            onChange={setMunicipio}
          />
          {faltaMunicipio ? (
            <AppText variant="caption" tone="warning">
              Servidor da prefeitura precisa de um município.
            </AppText>
          ) : null}
        </>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  botao: {
    flex: 1,
  },
  filtros: {
    gap: Spacing[2],
    paddingBottom: Spacing[2],
  },
  campo: {
    paddingHorizontal: Layout.gutter,
    gap: Spacing[1],
  },
  lista: {
    paddingHorizontal: Layout.gutter,
    gap: Spacing[1],
    flexGrow: 1,
  },
  rodape: {
    paddingVertical: Spacing[4],
  },
  selos: {
    alignItems: 'flex-end',
    gap: Spacing[1],
  },
});
