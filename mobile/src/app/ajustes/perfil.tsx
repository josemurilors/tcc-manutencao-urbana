/**
 * Submenu "Conta": nome, verificação de e-mail, troca de senha, notificações
 * no celular, os direitos da LGPD (baixar meus dados, termos, privacidade),
 * sair e excluir a conta (exigência da Play Store / App Store).
 * Aberto a partir do hub da aba Conta.
 */

import { Ionicons } from '@expo/vector-icons';
import { Redirect, router, type Href } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, View } from 'react-native';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ListItem } from '@/components/ui/list-item';
import { Card, SectionHeading } from '@/components/ui/screen';
import { SubScreen } from '@/components/ui/sub-screen';
import { AppText } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { papelDe, useAuth } from '@/context/auth-context';
import { useColors } from '@/context/theme-context';
import { useToast } from '@/context/toast-context';
import { usePush, type EstadoPush } from '@/hooks/use-push';
import { api } from '@/services/api';
import { baixarMeusDados } from '@/services/api-conta';
import { limparProgresso } from '@/services/progresso';
import { mensagemDeErro } from '@/utils/erro';
import { formatarCpf, formatarData } from '@/utils/format';

/** Nome do papel para a própria pessoa ler (servidor da prefeitura). */
const ROTULO_PAPEL: Record<string, string> = {
  operador: 'Operador(a) da prefeitura',
  gestor: 'Gestor(a) da prefeitura',
  admin_municipal: 'Administrador(a) da prefeitura',
  super_admin: 'Administrador(a) da plataforma',
};

/** Mesmo mínimo do cadastro e da recuperação de senha. */
const SENHA_MINIMA = 8;

const TEXTO_PUSH: Record<EstadoPush, string> = {
  carregando: 'Verificando…',
  indisponivel:
    'Neste aparelho os avisos aparecem só na central de notificações do app.',
  'nao-perguntado':
    'Receba um aviso no celular quando a prefeitura atualizar um chamado seu ou que você apoiou.',
  desligado: 'Os avisos no celular estão desligados neste aparelho.',
  negado:
    'As notificações do app estão bloqueadas nos ajustes do celular. Libere por lá para voltar a receber.',
  ativo: 'Você recebe um aviso no celular quando um chamado seu ou que você apoiou muda.',
};

export default function PerfilScreen() {
  const colors = useColors();
  const addToast = useToast();
  const { user, isAuthenticated, updateUser, logout } = useAuth();

  // O formulário parte do usuário carregado; guardamos só o que foi editado,
  // para não precisar sincronizar estado dentro de um efeito.
  const [nomeEditado, setNomeEditado] = useState<string | null>(null);
  const nome = nomeEditado ?? user?.nome ?? '';
  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [codigo, setCodigo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [verificando, setVerificando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [baixando, setBaixando] = useState(false);
  const push = usePush();

  if (!isAuthenticated) {
    return <Redirect href="/(tabs)/conta" />;
  }

  async function salvar() {
    const nomeLimpo = nome.trim();
    const mudouNome = nomeLimpo !== (user?.nome ?? '');
    const mudaSenha = !!senhaAtual || !!novaSenha;
    if (mudouNome && !nomeLimpo) {
      addToast.error('O nome não pode ficar em branco.');
      return;
    }
    // Antes, um campo de senha preenchido sozinho era ignorado em silêncio e
    // a tela ainda dizia "salvo".
    if (mudaSenha && (!senhaAtual || !novaSenha)) {
      addToast.error('Para trocar a senha, preencha a senha atual e a nova.');
      return;
    }
    if (mudaSenha && novaSenha.length < SENHA_MINIMA) {
      addToast.error(`A nova senha precisa de pelo menos ${SENHA_MINIMA} caracteres.`);
      return;
    }
    if (!mudouNome && !mudaSenha) {
      addToast.info('Nada para salvar.');
      return;
    }
    setSalvando(true);
    try {
      if (mudouNome) {
        await api.updateProfile({ nome: nomeLimpo });
        await updateUser({ nome: nomeLimpo });
        // Volta a espelhar o usuário salvo.
        setNomeEditado(null);
      }
      if (mudaSenha) {
        await api.updatePassword(senhaAtual, novaSenha);
        setSenhaAtual('');
        setNovaSenha('');
      }
      addToast.success(
        mudouNome && mudaSenha ? 'Nome e senha atualizados.' : mudouNome ? 'Nome atualizado.' : 'Senha alterada.',
      );
    } catch (err) {
      addToast.error('Não foi possível salvar. ' + mensagemDeErro(err, 'Tente de novo.'));
    } finally {
      setSalvando(false);
    }
  }

  async function verificarEmail() {
    if (codigo.length < 6) {
      addToast('Digite o código de verificação.', 'error');
      return;
    }
    setVerificando(true);
    try {
      await api.verificarEmail(codigo);
      await updateUser({ email_verificado: true });
      addToast('Email verificado com sucesso!');
      setCodigo('');
    } catch (err) {
      addToast('Erro: ' + (err instanceof Error ? err.message : ''), 'error');
    } finally {
      setVerificando(false);
    }
  }

  async function reenviarCodigo() {
    try {
      await api.reenviarCodigo();
      addToast('Código reenviado para seu email.');
    } catch (err) {
      addToast('Erro: ' + (err instanceof Error ? err.message : ''), 'error');
    }
  }

  async function alternarPush() {
    try {
      if (push.estado === 'ativo') {
        await push.desativar();
        addToast.info('Avisos no celular desligados.');
        return;
      }
      const final = await push.ativar();
      if (final === 'ativo') addToast.success('Pronto! Você vai receber os avisos no celular.');
      else if (final === 'negado')
        addToast.warning('As notificações foram bloqueadas. Dá para liberar nos ajustes do celular.');
    } catch (err) {
      addToast.error('Não foi possível mudar os avisos. ' + mensagemDeErro(err, 'Tente de novo.'));
    }
  }

  async function baixarDados() {
    setBaixando(true);
    try {
      await baixarMeusDados();
    } catch (err) {
      addToast.error(
        'Não foi possível baixar seus dados. ' + mensagemDeErro(err, 'Tente de novo em instantes.'),
      );
    } finally {
      setBaixando(false);
    }
  }

  async function excluirConta() {
    setExcluindo(true);
    try {
      await api.deleteAccount();
      await logout({ contaExcluida: true });
      limparProgresso();
      addToast('Sua conta foi excluída.');
      router.replace('/(tabs)/mapa');
    } catch (err) {
      addToast(
        'Não foi possível excluir a conta. ' + mensagemDeErro(err, 'Tente de novo.'),
        'error',
      );
    } finally {
      setExcluindo(false);
    }
  }

  function confirmarExclusao() {
    const mensagem =
      'Isso apaga seu cadastro, apoios e sinalizações. Os chamados que você abriu ' +
      'continuam no mapa, sem seu nome. Não dá para desfazer.';
    if (Platform.OS === 'web') {
      if (window.confirm(`Excluir conta?

${mensagem}`)) excluirConta();
      return;
    }
    Alert.alert('Excluir conta?', mensagem, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Excluir', style: 'destructive', onPress: excluirConta },
    ]);
  }

  return (
    <SubScreen title="Conta" fallback="/(tabs)/conta">
      <Card>
        <SectionHeading title="Dados" subtitle={user?.email} />
        <TextField label="Nome completo" value={nome} onChangeText={setNomeEditado} />
        {papelDe(user) !== 'cidadao' ? (
          <Badge
            label={ROTULO_PAPEL[papelDe(user)] ?? 'Equipe da prefeitura'}
            tone="primary"
            icon="shield-checkmark"
            size="md"
          />
        ) : null}
        {/* O backend manda o CPF já mascarado ('***.456.789-**'). */}
        {user?.cpf ? (
          <TextField
            label="CPF"
            value={user.cpf.includes('*') ? user.cpf : formatarCpf(user.cpf)}
            editable={false}
          />
        ) : null}
      </Card>

      {user?.suspenso_ate && new Date(user.suspenso_ate) > new Date() ? (
        <Card style={{ borderColor: colors.danger }}>
          <View accessible accessibilityRole="alert" style={{ gap: Spacing[1] }}>
            <Badge label="Conta suspensa" tone="danger" />
            <AppText variant="bodySm" tone="secondary">
              Até {formatarData(user.suspenso_ate)} você não pode abrir chamados, apoiar ou
              sinalizar. Isso acontece quando a moderação da prefeitura encontra reportes que
              descumprem os Termos de Uso.
            </AppText>
          </View>
        </Card>
      ) : null}

      {!user?.email_verificado ? (
        <Card style={{ borderColor: colors.gold500 }}>
          <SectionHeading
            title="Verificação de E-mail"
            subtitle="Digite o código enviado para seu e-mail."
          />
          <TextField
            value={codigo}
            onChangeText={(v) => setCodigo(v.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            keyboardType="number-pad"
            maxLength={6}
            style={{ textAlign: 'center', letterSpacing: 6 }}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing[2] }}>
            <Button size="sm" onPress={verificarEmail} loading={verificando}>
              Verificar
            </Button>
            <Button size="sm" variant="ghost" onPress={reenviarCodigo}>
              Reenviar código
            </Button>
          </View>
        </Card>
      ) : null}

      <Card>
        <SectionHeading title="Alterar Senha" subtitle="Atualize sua senha de acesso" />
        <TextField
          label="Senha atual"
          value={senhaAtual}
          onChangeText={setSenhaAtual}
          secureTextEntry
          autoComplete="current-password"
        />
        <TextField
          label="Nova senha"
          value={novaSenha}
          onChangeText={setNovaSenha}
          placeholder={`Mínimo ${SENHA_MINIMA} caracteres`}
          secureTextEntry
          autoComplete="new-password"
        />
      </Card>

      <Button block onPress={salvar} loading={salvando}>
        Salvar Alterações
      </Button>

      <Card>
        <SectionHeading title="Notificações no celular" subtitle={TEXTO_PUSH[push.estado]} />
        {push.estado === 'ativo' ? (
          <Badge label="Ativas neste aparelho" tone="success" />
        ) : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing[2] }}>
          {push.estado === 'nao-perguntado' || push.estado === 'desligado' ? (
            <Button
              size="sm"
              onPress={alternarPush}
              loading={push.ocupado}
              icon={<Ionicons name="notifications" size={16} color={colors.onPrimary} />}>
              Ativar avisos
            </Button>
          ) : null}
          {push.estado === 'ativo' ? (
            <Button size="sm" variant="secondary" onPress={alternarPush} loading={push.ocupado}>
              Desligar avisos
            </Button>
          ) : null}
          {push.estado === 'negado' ? (
            <Button size="sm" variant="secondary" onPress={push.abrirAjustesDoAparelho}>
              Abrir ajustes do celular
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            onPress={() => router.push('/notificacoes' as Href)}
            icon={<Ionicons name="list" size={16} color={colors.textSecondary} />}>
            Ver notificações
          </Button>
        </View>
      </Card>

      <Card>
        <SectionHeading
          title="Seus dados"
          subtitle="Pela LGPD, você pode ver tudo o que guardamos sobre você e levar com você."
        />
        <ListItem
          leading="download-outline"
          title="Baixar meus dados"
          subtitle="Arquivo com seu cadastro, chamados, apoios e avisos"
          onPress={baixarDados}
          disabled={baixando}
          trailing={baixando ? <AppText variant="caption" tone="muted">Preparando…</AppText> : undefined}
          accessibilityHint="Gera um arquivo JSON e abre as opções para salvar ou compartilhar"
        />
        <ListItem
          leading="document-text-outline"
          title="Termos de Uso"
          onPress={() => router.push('/termos' as Href)}
        />
        <ListItem
          leading="lock-closed-outline"
          title="Política de Privacidade"
          onPress={() => router.push('/privacidade' as Href)}
        />
      </Card>

      <Button
        block
        variant="danger"
        onPress={async () => {
          await logout();
          limparProgresso();
          addToast('Sessão encerrada.');
          router.replace('/(tabs)/mapa');
        }}
        icon={<Ionicons name="log-out" size={16} color={colors.error} />}>
        Sair
      </Button>

      <Button
        block
        variant="ghost"
        onPress={confirmarExclusao}
        loading={excluindo}
        icon={<Ionicons name="trash-outline" size={16} color={colors.textSecondary} />}>
        Excluir minha conta
      </Button>
    </SubScreen>
  );
}
