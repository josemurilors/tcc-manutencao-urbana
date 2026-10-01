/**
 * Equipe da prefeitura (contrato v3, 7.6 `membros/`): quem trabalha no app e
 * com que papel. Substitui a antiga "Gerenciar usuários", que listava todas as
 * contas do sistema e promovia com um toque, sem confirmar.
 *
 * - Busca por nome/e-mail (300 ms de espera) e filtro por papel, paginada
 *   no servidor com rolagem infinita.
 * - Gestor consulta; só o administrador convida, muda papel/lotação e revoga.
 * - Convidar um e-mail com conta vincula na hora; sem conta, vira convite
 *   enviado por e-mail, que aparece em "Convites pendentes" (reenviar ou
 *   cancelar) até a pessoa entrar no app com esse e-mail verificado.
 * - Toda alteração pede confirmação e cai na auditoria do backend.
 */

import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { confirmar, mensagemDeErro } from '@/components/gestao/confirmar';
import { EstadoCarga } from '@/components/gestao/estado-carga';
import { GestaoShell } from '@/components/gestao/gestao-shell';
import { OpcaoRadio } from '@/components/gestao/opcao-radio';
import {
  DESCRICAO_PAPEL,
  ehPapel,
  PAPEIS_EQUIPE,
  ROTULO_PAPEL,
  TOM_PAPEL,
  usePapel,
} from '@/components/gestao/papeis';
import { useDados } from '@/components/gestao/use-dados';
import { useListaPaginada } from '@/components/gestao/use-lista-paginada';
import { Badge } from '@/components/ui/badge';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { FilterChips } from '@/components/ui/chips';
import { ListItem } from '@/components/ui/list-item';
import { Select } from '@/components/ui/select';
import { StateView } from '@/components/ui/state-view';
import { TextField } from '@/components/ui/text-field';
import { AppText } from '@/components/ui/text';
import { Layout, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useColors } from '@/context/theme-context';
import { useToast } from '@/context/toast-context';
import { apiGestao } from '@/services/api-gestao';
import type {
  AlteracaoMembro,
  Convite,
  Equipe,
  Membro,
  PapelEquipe,
  Secretaria,
} from '@/types/gestao';
import { formatarData } from '@/utils/format';

type FiltroPapel = 'todos' | PapelEquipe;

const FILTROS: { value: FiltroPapel; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'operador', label: 'Operadores' },
  { value: 'gestor', label: 'Gestores' },
  { value: 'admin_municipal', label: 'Administradores' },
];

const OPCOES_PAPEL = PAPEIS_EQUIPE.map((p) => ({
  value: p,
  label: ROTULO_PAPEL[p],
  descricao: DESCRICAO_PAPEL[p],
}));

// Sem exigir ponto no domínio: o vínculo é com uma conta que já existe, e o
// cadastro aceita domínios internos (ex.: servidor@intranet).
const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;

/** Valor do Select para "nenhuma" (o Select trabalha com string). */
const NENHUMA = '';

function useDebounce<T>(valor: T, ms: number) {
  const [atrasado, setAtrasado] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setAtrasado(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return atrasado;
}

export default function EquipeScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { ehAdmin } = usePapel();

  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<FiltroPapel>('todos');
  const q = useDebounce(busca.trim(), 300);

  const lista = useListaPaginada<Membro>(
    (page) => apiGestao.membros({ q, papel: filtro === 'todos' ? undefined : filtro, page }),
    `${q}|${filtro}`,
  );

  // Lotação (secretaria/equipe) só interessa a quem edita.
  const lotacao = useDados(
    () => Promise.all([apiGestao.secretarias(), apiGestao.equipes()]),
    ehAdmin,
  );
  const secretarias = lotacao.dados?.[0] ?? [];
  const equipes = lotacao.dados?.[1] ?? [];

  // Convites pendentes: acessório da lista; falhou, a equipe aparece igual.
  const convites = useDados(apiGestao.convites);
  const pendentes = convites.dados ?? [];

  const [selecionado, setSelecionado] = useState<Membro | null>(null);
  const [convidando, setConvidando] = useState(false);
  const [conviteAberto, setConviteAberto] = useState<Convite | null>(null);

  const filtrando = !!q || filtro !== 'todos';

  return (
    <GestaoShell
      title="Equipe"
      subtitle={lista.estado === 'pronto' ? `${lista.total} na equipe` : undefined}
      minimo="gestor"
      acao={ehAdmin ? { icon: 'person-add', label: 'Convidar pessoa', onPress: () => setConvidando(true) } : undefined}>
      <View style={styles.filtros}>
        <TextField
          value={busca}
          onChangeText={setBusca}
          placeholder="Buscar por nome ou e-mail"
          accessibilityLabel="Buscar na equipe por nome ou e-mail"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          containerStyle={styles.busca}
        />
        <FilterChips
          options={FILTROS}
          value={filtro}
          onChange={setFiltro}
          accessibilityLabel="Filtrar por papel"
        />
      </View>

      {lista.estado !== 'pronto' ? (
        <EstadoCarga
          estado={lista.estado}
          erro={lista.erro}
          onRetry={lista.recarregar}
          oQue="a equipe"
        />
      ) : (
        <FlatList
          data={lista.itens}
          keyExtractor={(m) => String(m.id)}
          contentContainerStyle={[styles.lista, { paddingBottom: insets.bottom + Spacing[16] }]}
          onEndReached={lista.carregarMais}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={lista.atualizando}
              onRefresh={() => {
                lista.atualizar();
                convites.atualizar();
              }}
            />
          }
          ListHeaderComponent={
            !filtrando && pendentes.length ? (
              <ConvitesPendentes
                convites={pendentes}
                onAbrir={ehAdmin ? setConviteAberto : undefined}
              />
            ) : null
          }
          ListEmptyComponent={
            filtrando ? (
              <StateView
                kind="empty"
                icon="search"
                title="Ninguém encontrado"
                description="Confira a grafia ou limpe os filtros."
                action={{
                  label: 'Limpar filtros',
                  onPress: () => {
                    setBusca('');
                    setFiltro('todos');
                  },
                }}
              />
            ) : (
              <StateView
                kind="empty"
                icon="people-outline"
                title="Ainda não há equipe"
                description={
                  ehAdmin
                    ? 'Convide os servidores que vão atender os chamados. Quem ainda não tem conta recebe o convite por e-mail.'
                    : 'O administrador do município ainda não convidou ninguém.'
                }
                action={ehAdmin ? { label: 'Convidar pessoa', onPress: () => setConvidando(true) } : undefined}
              />
            )
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
          renderItem={({ item }) => (
            <LinhaMembro membro={item} onPress={ehAdmin ? () => setSelecionado(item) : undefined} />
          )}
        />
      )}

      {/* Folhas montadas só quando abertas, com `key` por pessoa: o
          formulário nasce com os valores dela, sem efeito para resetar. */}
      {selecionado ? (
        <MembroSheet
          key={selecionado.id}
          membro={selecionado}
          secretarias={secretarias}
          equipes={equipes}
          lotacaoFalhou={lotacao.estado === 'erro' || lotacao.estado === 'offline'}
          onFechar={() => setSelecionado(null)}
          onAlterado={(novo) => {
            if (novo) lista.substituir((m) => m.id === novo.id, novo);
            else lista.substituir((m) => m.id === selecionado.id, null);
          }}
        />
      ) : null}
      {convidando ? (
        <ConviteSheet
          secretarias={secretarias}
          equipes={equipes}
          onFechar={() => setConvidando(false)}
          onConvidado={(tipo) => {
            if (tipo === 'membro') lista.recarregar();
            convites.atualizar();
          }}
        />
      ) : null}
      {conviteAberto ? (
        <ConvitePendenteSheet
          key={conviteAberto.id}
          convite={conviteAberto}
          onFechar={() => setConviteAberto(null)}
          onAlterado={convites.atualizar}
        />
      ) : null}
    </GestaoShell>
  );
}

function lotacaoDe(m: Pick<Membro, 'secretaria_nome' | 'equipe_nome'>) {
  return [m.secretaria_nome, m.equipe_nome].filter(Boolean).join(' · ');
}

function textoAbertos(n: number) {
  return n === 1 ? '1 chamado aberto' : `${n} chamados abertos`;
}

function LinhaMembro({ membro, onPress }: { membro: Membro; onPress?: () => void }) {
  const papel = ehPapel(membro.papel) ? membro.papel : 'operador';
  const lotacao = lotacaoDe(membro);
  const suspenso = membro.suspenso_ate && new Date(membro.suspenso_ate) > new Date();
  const abertos = membro.chamados_abertos ?? 0;
  return (
    <ListItem
      title={membro.nome || membro.email}
      subtitle={membro.email}
      meta={[lotacao || 'Sem secretaria definida', abertos ? textoAbertos(abertos) : null]
        .filter(Boolean)
        .join(' · ')}
      leading="person-circle"
      onPress={onPress}
      accessibilityLabel={`${membro.nome}, ${ROTULO_PAPEL[papel]}, ${membro.email}${
        lotacao ? `, ${lotacao}` : ''
      }${abertos ? `, ${textoAbertos(abertos)}` : ''}${suspenso ? ', suspenso' : ''}`}
      accessibilityHint={onPress ? 'Abre as opções de papel e acesso' : undefined}
      trailing={
        <View style={styles.selos}>
          <Badge label={ROTULO_PAPEL[papel]} tone={TOM_PAPEL[papel]} icon="shield-checkmark" />
          {suspenso ? <Badge label="Suspenso" tone="danger" /> : null}
        </View>
      }
    />
  );
}

/** Opções de secretaria/equipe para os Selects (equipe filtrada pela secretaria). */
function useOpcoesLotacao(secretarias: Secretaria[], equipes: Equipe[], secretariaId: string) {
  return useMemo(() => {
    const opSecretarias = [
      { value: NENHUMA, label: 'Nenhuma' },
      ...secretarias
        .filter((s) => s.ativo)
        .map((s) => ({ value: String(s.id), label: s.sigla ? `${s.nome} (${s.sigla})` : s.nome })),
    ];
    const opEquipes = [
      { value: NENHUMA, label: 'Nenhuma' },
      ...equipes
        .filter((e) => e.ativo && (!secretariaId || String(e.secretaria_id ?? '') === secretariaId))
        .map((e) => ({ value: String(e.id), label: e.nome })),
    ];
    return { opSecretarias, opEquipes };
  }, [secretarias, equipes, secretariaId]);
}

function paraId(valor: string) {
  return valor === NENHUMA ? null : Number(valor);
}

function MembroSheet({
  membro,
  secretarias,
  equipes,
  lotacaoFalhou,
  onFechar,
  onAlterado,
}: {
  membro: Membro;
  secretarias: Secretaria[];
  equipes: Equipe[];
  lotacaoFalhou: boolean;
  onFechar: () => void;
  /** `null` = a pessoa saiu da equipe. */
  onAlterado: (novo: Membro | null) => void;
}) {
  const { user } = useAuth();
  const colors = useColors();
  const toast = useToast();
  const [papel, setPapel] = useState<PapelEquipe>(
    membro.papel === 'gestor' || membro.papel === 'admin_municipal' ? membro.papel : 'operador',
  );
  const [secretariaId, setSecretariaId] = useState(
    membro.secretaria_id ? String(membro.secretaria_id) : NENHUMA,
  );
  const [equipeId, setEquipeId] = useState(membro.equipe_id ? String(membro.equipe_id) : NENHUMA);
  const [salvando, setSalvando] = useState(false);
  const [revogando, setRevogando] = useState(false);

  const { opSecretarias, opEquipes } = useOpcoesLotacao(secretarias, equipes, secretariaId);

  const euMesmo = String(user?.id ?? '') === String(membro.id);
  const plataforma = membro.papel === 'super_admin';
  const bloqueado = euMesmo || plataforma;

  const mudou =
    papel !== membro.papel ||
    paraId(secretariaId) !== (membro.secretaria_id ?? null) ||
    paraId(equipeId) !== (membro.equipe_id ?? null);

  async function salvar() {
    const trocaPapel = papel !== membro.papel;
    if (trocaPapel) {
      const ok = await confirmar({
        titulo: 'Alterar papel?',
        mensagem: `${membro.nome} passa de ${ROTULO_PAPEL[membro.papel] ?? membro.papel} para ${ROTULO_PAPEL[papel]}. ${DESCRICAO_PAPEL[papel]}`,
        confirmar: 'Alterar',
      });
      if (!ok) return;
    }
    setSalvando(true);
    // Só o que mudou: reenviar uma lotação que foi desativada depois seria
    // recusado e travaria a troca de papel.
    const corpo: AlteracaoMembro = {};
    if (trocaPapel) corpo.papel = papel;
    if (paraId(secretariaId) !== (membro.secretaria_id ?? null)) corpo.secretaria_id = paraId(secretariaId);
    if (paraId(equipeId) !== (membro.equipe_id ?? null)) corpo.equipe_id = paraId(equipeId);
    try {
      const novo = await apiGestao.alterarMembro(membro.id, corpo);
      // Se o backend não devolver o membro, monta a partir do que foi enviado.
      const secretaria = secretarias.find((s) => s.id === paraId(secretariaId));
      const equipe = equipes.find((e) => e.id === paraId(equipeId));
      onAlterado(
        novo && typeof novo === 'object' && 'id' in novo
          ? novo
          : {
              ...membro,
              papel,
              secretaria_id: paraId(secretariaId),
              secretaria_nome: secretaria?.nome ?? null,
              equipe_id: paraId(equipeId),
              equipe_nome: equipe?.nome ?? null,
            },
      );
      toast.success('Alterações salvas');
      onFechar();
    } catch (err) {
      toast.error(`Não foi possível salvar: ${mensagemDeErro(err)}`);
    } finally {
      setSalvando(false);
    }
  }

  async function revogar() {
    const abertos = membro.chamados_abertos ?? 0;
    const ok = await confirmar({
      titulo: 'Revogar acesso?',
      mensagem: `${membro.nome} deixa a equipe e volta a usar o app como cidadão. ${
        abertos
          ? `${textoAbertos(abertos)} com esta pessoa ${abertos === 1 ? 'volta' : 'voltam'} para a fila sem atendente. `
          : ''
      }A conta continua e você pode convidar de novo depois.`,
      confirmar: 'Revogar',
      destrutivo: true,
    });
    if (!ok) return;
    setRevogando(true);
    try {
      const r = await apiGestao.revogarMembro(membro.id);
      onAlterado(null);
      const liberados = r?.chamados_liberados ?? 0;
      toast.success(
        liberados
          ? `Acesso de ${membro.nome} revogado. ${textoAbertos(liberados)} ${liberados === 1 ? 'voltou' : 'voltaram'} para a fila.`
          : `Acesso de ${membro.nome} revogado`,
      );
      onFechar();
    } catch (err) {
      toast.error(`Não foi possível revogar: ${mensagemDeErro(err)}`);
    } finally {
      setRevogando(false);
    }
  }

  return (
    <BottomSheet
      visible
      onClose={onFechar}
      title={membro.nome || membro.email}
      description={membro.email}
      footer={
        bloqueado ? (
          <Button variant="secondary" onPress={onFechar} block style={styles.botao}>
            Fechar
          </Button>
        ) : (
          <>
            <Button
              variant="danger"
              onPress={revogar}
              loading={revogando}
              disabled={salvando}
              icon={<Ionicons name="person-remove" size={16} color={colors.danger} />}
              style={styles.botao}>
              Revogar
            </Button>
            <Button
              onPress={salvar}
              loading={salvando}
              disabled={!mudou || revogando}
              style={styles.botao}>
              Salvar
            </Button>
          </>
        )
      }>
      {bloqueado ? (
        <StateView
          kind="empty"
          icon="lock-closed-outline"
          title={euMesmo ? 'Este é você' : 'Conta da plataforma'}
          description={
            euMesmo
              ? 'Ninguém altera o próprio papel: peça a outro administrador do município.'
              : 'Contas da equipe da plataforma não são geridas pela prefeitura.'
          }
        />
      ) : (
        <>
          <AppText variant="label">Papel</AppText>
          <OpcaoRadio
            opcoes={OPCOES_PAPEL}
            valor={papel}
            onChange={setPapel}
            accessibilityLabel="Papel na equipe"
          />
          <Select
            label="Secretaria"
            title="Secretaria"
            options={opSecretarias}
            value={secretariaId}
            onChange={(v) => {
              setSecretariaId(v);
              // Equipe de outra secretaria deixa de valer.
              const equipe = equipes.find((e) => String(e.id) === equipeId);
              if (equipe && v && String(equipe.secretaria_id ?? '') !== v) setEquipeId(NENHUMA);
            }}
          />
          <Select
            label="Equipe de campo"
            title="Equipe de campo"
            options={opEquipes}
            value={equipeId}
            onChange={setEquipeId}
          />
          {lotacaoFalhou ? (
            <AppText variant="caption" tone="warning">
              Não foi possível carregar secretarias e equipes. A lotação atual é mantida.
            </AppText>
          ) : null}
        </>
      )}
    </BottomSheet>
  );
}

function ConviteSheet({
  secretarias,
  equipes,
  onFechar,
  onConvidado,
}: {
  secretarias: Secretaria[];
  equipes: Equipe[];
  onFechar: () => void;
  /** `membro` = conta existente vinculada; `convite` = e-mail sem conta. */
  onConvidado: (tipo: 'membro' | 'convite') => void;
}) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [papel, setPapel] = useState<PapelEquipe>('operador');
  const [secretariaId, setSecretariaId] = useState(NENHUMA);
  const [equipeId, setEquipeId] = useState(NENHUMA);
  const [enviando, setEnviando] = useState(false);
  const [tentou, setTentou] = useState(false);
  const { opSecretarias, opEquipes } = useOpcoesLotacao(secretarias, equipes, secretariaId);

  const emailOk = EMAIL_RE.test(email.trim());

  async function enviar() {
    setTentou(true);
    if (!emailOk) return;
    setEnviando(true);
    try {
      const r = await apiGestao.convidarMembro({
        email: email.trim().toLowerCase(),
        papel,
        secretaria_id: paraId(secretariaId),
        equipe_id: paraId(equipeId),
      });
      if (r && 'convite' in r) {
        // Sem conta com este e-mail: virou convite pendente.
        if (r.email_enviado) {
          toast.success(
            `Convite enviado para ${r.convite.email}. O acesso entra quando a pessoa criar a conta.`,
          );
        } else {
          toast.warning(
            `Convite criado, mas o e-mail não saiu. Avise ${r.convite.email} para criar a conta no app com este e-mail.`,
          );
        }
        onConvidado('convite');
      } else {
        toast.success(`${email.trim()} agora faz parte da equipe como ${ROTULO_PAPEL[papel]}`);
        onConvidado('membro');
      }
      onFechar();
    } catch (err) {
      // A mensagem do backend (ex.: "já atua em outro município") diz o que fazer.
      toast.error(`Não foi possível convidar: ${mensagemDeErro(err)}`);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <BottomSheet
      visible
      onClose={onFechar}
      title="Convidar para a equipe"
      description="Quem já tem conta entra na equipe na hora. Quem não tem recebe um convite por e-mail e ganha o acesso ao criar a conta com este e-mail."
      footer={
        <>
          <Button variant="secondary" onPress={onFechar} style={styles.botao}>
            Cancelar
          </Button>
          <Button onPress={enviar} loading={enviando} style={styles.botao}>
            Convidar
          </Button>
        </>
      }>
      <TextField
        label="E-mail"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        placeholder="nome@prefeitura.gov.br"
        invalid={tentou && !emailOk}
        hint={tentou && !emailOk ? 'Digite um e-mail válido.' : undefined}
        accessibilityLabel="E-mail da pessoa"
      />
      <AppText variant="label">Papel</AppText>
      <OpcaoRadio
        opcoes={OPCOES_PAPEL}
        valor={papel}
        onChange={setPapel}
        accessibilityLabel="Papel na equipe"
      />
      <Select
        label="Secretaria (opcional)"
        title="Secretaria"
        options={opSecretarias}
        value={secretariaId}
        onChange={(v) => {
          setSecretariaId(v);
          setEquipeId(NENHUMA);
        }}
      />
      <Select
        label="Equipe de campo (opcional)"
        title="Equipe de campo"
        options={opEquipes}
        value={equipeId}
        onChange={setEquipeId}
      />
    </BottomSheet>
  );
}

function validadeDoConvite(c: Convite) {
  return c.expirado ? 'Convite vencido' : `Vale até ${formatarData(c.expira_em)}`;
}

function ConvitesPendentes({
  convites,
  onAbrir,
}: {
  convites: Convite[];
  /** Só o administrador reenvia/cancela; sem isto, a lista é só leitura. */
  onAbrir?: (c: Convite) => void;
}) {
  return (
    <View style={styles.convites}>
      <AppText variant="label" accessibilityRole="header">
        Convites pendentes ({convites.length})
      </AppText>
      {convites.map((c) => {
        const papel = ehPapel(c.papel) ? c.papel : 'operador';
        return (
          <ListItem
            key={c.id}
            title={c.email}
            subtitle={[lotacaoDe(c), validadeDoConvite(c)].filter(Boolean).join(' · ')}
            leading="mail"
            onPress={onAbrir ? () => onAbrir(c) : undefined}
            accessibilityLabel={`Convite para ${c.email}, ${ROTULO_PAPEL[papel]}, ${validadeDoConvite(c)}`}
            accessibilityHint={onAbrir ? 'Abre as opções de reenviar ou cancelar' : undefined}
            trailing={
              <View style={styles.selos}>
                <Badge label={ROTULO_PAPEL[papel]} tone={TOM_PAPEL[papel]} icon={null} />
                {c.expirado ? <Badge label="Vencido" tone="warning" /> : null}
              </View>
            }
          />
        );
      })}
      <AppText variant="label" accessibilityRole="header" style={styles.tituloMembros}>
        Na equipe
      </AppText>
    </View>
  );
}

function ConvitePendenteSheet({
  convite,
  onFechar,
  onAlterado,
}: {
  convite: Convite;
  onFechar: () => void;
  onAlterado: () => void;
}) {
  const colors = useColors();
  const toast = useToast();
  const [reenviando, setReenviando] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const papel = ehPapel(convite.papel) ? convite.papel : 'operador';
  const lotacao = lotacaoDe(convite);

  async function reenviar() {
    setReenviando(true);
    try {
      const r = await apiGestao.reenviarConvite(convite.id);
      if (r?.email_enviado) toast.success(`Convite reenviado para ${convite.email}`);
      else toast.warning('Prazo renovado, mas o e-mail não saiu. Avise a pessoa por outro meio.');
      onAlterado();
      onFechar();
    } catch (err) {
      toast.error(`Não foi possível reenviar: ${mensagemDeErro(err)}`);
    } finally {
      setReenviando(false);
    }
  }

  async function cancelar() {
    const ok = await confirmar({
      titulo: 'Cancelar convite?',
      mensagem: `${convite.email} não vai mais entrar na equipe ao criar a conta. Você pode convidar de novo depois.`,
      confirmar: 'Cancelar convite',
      destrutivo: true,
    });
    if (!ok) return;
    setCancelando(true);
    try {
      await apiGestao.cancelarConvite(convite.id);
      toast.success('Convite cancelado');
      onAlterado();
      onFechar();
    } catch (err) {
      toast.error(`Não foi possível cancelar: ${mensagemDeErro(err)}`);
    } finally {
      setCancelando(false);
    }
  }

  return (
    <BottomSheet
      visible
      onClose={onFechar}
      title={convite.email}
      description={`Convite para ${ROTULO_PAPEL[papel]}${lotacao ? ` · ${lotacao}` : ''}`}
      footer={
        <>
          <Button
            variant="danger"
            onPress={cancelar}
            loading={cancelando}
            disabled={reenviando}
            icon={<Ionicons name="close-circle" size={16} color={colors.danger} />}
            style={styles.botao}>
            Cancelar convite
          </Button>
          <Button onPress={reenviar} loading={reenviando} disabled={cancelando} style={styles.botao}>
            Reenviar
          </Button>
        </>
      }>
      <AppText variant="bodySm" tone="secondary">
        {convite.expirado
          ? 'O prazo deste convite acabou. Reenviar manda o e-mail de novo e renova o prazo.'
          : `${validadeDoConvite(convite)}. A pessoa ganha o acesso quando criar a conta (ou entrar) com este e-mail e confirmá-lo.`}
      </AppText>
      {convite.convidado_por_nome ? (
        <AppText variant="caption" tone="muted">
          {`Convidado por ${convite.convidado_por_nome}${
            convite.criado_em ? ` em ${formatarData(convite.criado_em)}` : ''
          }.`}
        </AppText>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  convites: {
    gap: Spacing[1],
    paddingBottom: Spacing[2],
  },
  tituloMembros: {
    paddingTop: Spacing[3],
  },
  filtros: {
    gap: Spacing[2],
    paddingBottom: Spacing[2],
  },
  busca: {
    paddingHorizontal: Layout.gutter,
  },
  lista: {
    paddingHorizontal: Layout.gutter,
    gap: Spacing[1],
    flexGrow: 1,
  },
  selos: {
    alignItems: 'flex-end',
    gap: Spacing[1],
  },
  rodape: {
    paddingVertical: Spacing[4],
  },
  botao: {
    flex: 1,
  },
});
