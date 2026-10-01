/**
 * Fluxo único de entrada: um campo de e-mail e os meios de login embaixo
 * (hoje, só Google). Ao continuar, o backend diz se o e-mail já tem conta —
 * se tiver, pede a senha; se não tiver, vira cadastro ali mesmo. Nada de
 * telas separadas de "Entrar" × "Criar conta".
 *
 * Etapas extras, todas no mesmo cartão:
 * - `esqueci` → `redefinir`: código de 6 dígitos por e-mail + nova senha;
 *   no fim já entra com a senha nova.
 * - `termos`: conta antiga que ainda não aceitou os Termos e a Política
 *   (LGPD) aceita antes de seguir. No cadastro o aceite é a caixa obrigatória.
 */

import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { GoogleButton } from '@/components/google-button';
import { Button } from '@/components/ui/button';
import { AppText } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { Layout, Radius, Spacing } from '@/constants/theme';
import { precisaAceitarTermos, useAuth } from '@/context/auth-context';
import { useColors } from '@/context/theme-context';
import { useToast } from '@/context/toast-context';
import { api } from '@/services/api';
import { contaApi } from '@/services/api-conta';
import type { AuthResponse } from '@/types';
import type { Usuario } from '@/types/conta';
import { mensagemDeErro as mensagem } from '@/utils/erro';

type Etapa = 'email' | 'senha' | 'cadastro' | 'esqueci' | 'redefinir' | 'termos';

const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SENHA_MINIMA = 8;
const ESPERA_REENVIO_S = 60;


/**
 * Caixa "Li e aceito" dos Termos e da Política, com os dois textos a um toque.
 * Os links são botões separados (e não trechos dentro da frase) para cada um
 * ter alvo de 44 px e rótulo próprio no leitor de tela.
 */
export function AceiteTermos({
  aceito,
  onChange,
  invalido,
}: {
  aceito: boolean;
  onChange: (valor: boolean) => void;
  invalido?: boolean;
}) {
  const colors = useColors();
  return (
    <View style={styles.aceite}>
      <Pressable
        onPress={() => onChange(!aceito)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: aceito }}
        accessibilityLabel="Li e aceito os Termos de Uso e a Política de Privacidade"
        style={styles.aceiteLinha}>
        <Ionicons
          name={aceito ? 'checkbox' : 'square-outline'}
          size={24}
          color={aceito ? colors.primaryText : invalido ? colors.danger : colors.textSecondary}
        />
        <AppText variant="bodySm" tone={invalido && !aceito ? 'danger' : 'secondary'} style={styles.flex}>
          Li e aceito os Termos de Uso e a Política de Privacidade.
        </AppText>
      </Pressable>
      <View style={styles.aceiteLinks}>
        <Pressable
          onPress={() => router.push('/termos' as Href)}
          accessibilityRole="link"
          accessibilityLabel="Ler os Termos de Uso"
          style={styles.link}>
          <AppText variant="bodySm" tone="brand" weight="600">
            Termos de Uso
          </AppText>
        </Pressable>
        <Pressable
          onPress={() => router.push('/privacidade' as Href)}
          accessibilityRole="link"
          accessibilityLabel="Ler a Política de Privacidade"
          style={styles.link}>
          <AppText variant="bodySm" tone="brand" weight="600">
            Política de Privacidade
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}

export function AuthFlow() {
  const colors = useColors();
  const toast = useToast();
  const { login } = useAuth();

  const [etapa, setEtapa] = useState<Etapa>('email');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [nome, setNome] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [codigo, setCodigo] = useState('');
  const [aceito, setAceito] = useState(false);
  // Login feito no servidor, à espera do aceite dos termos para abrir a sessão.
  const [pendente, setPendente] = useState<AuthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Reenvio do código liberado só depois de um minuto (o e-mail pode demorar).
  const [reenvioEm, setReenvioEm] = useState(0);
  const [agora, setAgora] = useState(() => Date.now());

  const senhasDiferem = !!confirmarSenha && senha !== confirmarSenha;
  const segundosParaReenvio = Math.max(0, Math.ceil((reenvioEm - agora) / 1000));

  useEffect(() => {
    if (etapa !== 'redefinir' || reenvioEm <= Date.now()) return;
    const timer = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [etapa, reenvioEm]);

  function irPara(nova: Etapa) {
    setEtapa(nova);
    setError('');
  }

  function trocarEmail() {
    irPara('email');
    setSenha('');
    setNome('');
    setConfirmarSenha('');
    setCodigo('');
    setAceito(false);
    setPendente(null);
  }

  /**
   * Abre a sessão — mas, se a conta ainda não aceitou os termos, segura o
   * login e pergunta antes. Abrir a sessão primeiro não serve: na aba Conta o
   * cartão de entrada some assim que há sessão, e o aceite nunca apareceria.
   */
  async function concluirEntrada(res: AuthResponse) {
    if (precisaAceitarTermos(res.user as Usuario | undefined)) {
      setPendente(res);
      setAceito(false);
      irPara('termos');
      return;
    }
    await login(res);
    router.replace('/(tabs)/mapa');
  }

  /** Grava o aceite com o token recém-emitido e devolve a resposta já com a data. */
  async function aceitarCom(res: AuthResponse): Promise<AuthResponse> {
    const atualizado = await contaApi.aceitarTermos(res.access);
    // O servidor devolve o usuário inteiro já com a data do aceite.
    return res.user ? { ...res, user: { ...res.user, ...atualizado } as Usuario } : res;
  }

  async function continuar() {
    setError('');
    const limpo = email.trim();
    if (!EMAIL_VALIDO.test(limpo)) {
      setError('Digite um e-mail válido, como nome@exemplo.com.');
      return;
    }
    setLoading(true);
    try {
      const res = await api.emailExiste(limpo);
      irPara(res.existe ? 'senha' : 'cadastro');
    } catch (err) {
      setError(mensagem(err, 'Não foi possível verificar o e-mail.'));
    } finally {
      setLoading(false);
    }
  }

  async function entrar() {
    setError('');
    if (!senha) {
      setError('Digite sua senha.');
      return;
    }
    setLoading(true);
    try {
      await concluirEntrada(await api.login(email.trim(), senha));
    } catch (err) {
      setError(mensagem(err, 'Não foi possível entrar.'));
    } finally {
      setLoading(false);
    }
  }

  async function cadastrar() {
    setError('');
    if (!nome.trim()) {
      setError('Digite seu nome.');
      return;
    }
    if (senha.length < SENHA_MINIMA) {
      setError(`A senha precisa de pelo menos ${SENHA_MINIMA} caracteres.`);
      return;
    }
    if (senha !== confirmarSenha) {
      setError('As senhas não conferem.');
      return;
    }
    if (!aceito) {
      setError('Para criar a conta, aceite os Termos de Uso e a Política de Privacidade.');
      return;
    }
    setLoading(true);
    try {
      let res = await api.register(nome.trim(), email.trim(), senha);
      try {
        res = await aceitarCom(res);
      } catch (err) {
        // A pessoa aceitou na tela; se o servidor não gravou, o próximo login
        // pergunta de novo (aceite_termos_em continua nulo lá).
        console.warn('[conta] aceite dos termos não registrado', err);
      }
      await login(res);
      toast.success('Conta criada! Enviamos um código para confirmar seu e-mail.');
      router.replace('/(tabs)/mapa');
    } catch (err) {
      setError(mensagem(err, 'Não foi possível criar a conta.'));
    } finally {
      setLoading(false);
    }
  }

  async function enviarCodigo() {
    setError('');
    setLoading(true);
    try {
      await contaApi.esqueciSenha(email.trim());
      setReenvioEm(Date.now() + ESPERA_REENVIO_S * 1000);
      setAgora(Date.now());
      setCodigo('');
      setSenha('');
      setConfirmarSenha('');
      irPara('redefinir');
    } catch (err) {
      setError(mensagem(err, 'Não foi possível enviar o código agora. Tente de novo em instantes.'));
    } finally {
      setLoading(false);
    }
  }

  async function reenviarCodigo() {
    setError('');
    try {
      await contaApi.esqueciSenha(email.trim());
      setReenvioEm(Date.now() + ESPERA_REENVIO_S * 1000);
      setAgora(Date.now());
      toast.info('Enviamos um novo código.');
    } catch (err) {
      setError(mensagem(err, 'Não foi possível reenviar o código.'));
    }
  }

  async function redefinir() {
    setError('');
    if (codigo.length !== 6) {
      setError('Digite o código de 6 dígitos que enviamos por e-mail.');
      return;
    }
    if (senha.length < SENHA_MINIMA) {
      setError(`A nova senha precisa de pelo menos ${SENHA_MINIMA} caracteres.`);
      return;
    }
    if (senha !== confirmarSenha) {
      setError('As senhas não conferem.');
      return;
    }
    setLoading(true);
    try {
      await contaApi.redefinirSenha(email.trim(), codigo, senha);
    } catch (err) {
      setError(mensagem(err, 'Não foi possível trocar a senha.'));
      setLoading(false);
      return;
    }
    // Senha trocada; entrar já com ela poupa a pessoa de digitar de novo.
    try {
      await concluirEntrada(await api.login(email.trim(), senha));
      toast.success('Senha alterada.');
    } catch (err) {
      console.warn('[conta] login após redefinir', err);
      setConfirmarSenha('');
      setCodigo('');
      setSenha('');
      irPara('senha');
      toast.success('Senha alterada. Entre com a nova senha.');
    } finally {
      setLoading(false);
    }
  }

  async function aceitarESeguir() {
    setError('');
    if (!aceito) {
      setError('Marque a caixa para continuar.');
      return;
    }
    if (!pendente) {
      trocarEmail();
      return;
    }
    setLoading(true);
    try {
      await login(await aceitarCom(pendente));
      router.replace('/(tabs)/mapa');
    } catch (err) {
      setError(mensagem(err, 'Não foi possível registrar o aceite.'));
    } finally {
      setLoading(false);
    }
  }

  function recusarTermos() {
    trocarEmail();
    toast.info('Sem o aceite dos termos não dá para usar a conta. Você pode voltar quando quiser.');
  }

  const emailFixo = (
    <Pressable
      onPress={trocarEmail}
      accessibilityRole="button"
      accessibilityLabel={`E-mail ${email.trim()}. Toque para usar outro e-mail`}
      style={[styles.emailFixo, { borderColor: colors.borderDefault }]}>
      <AppText variant="bodySm" tone="secondary" numberOfLines={1} style={styles.flexShrink}>
        {email.trim()}
      </AppText>
      <Ionicons name="pencil" size={16} color={colors.textMuted} />
    </Pressable>
  );

  const erro = error ? (
    <AppText variant="caption" tone="danger" accessibilityRole="alert" accessibilityLiveRegion="polite">
      {error}
    </AppText>
  ) : null;

  return (
    <View style={styles.container}>
      {etapa === 'email' ? (
        <>
          <TextField
            label="E-mail"
            value={email}
            onChangeText={setEmail}
            placeholder="seu@email.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            invalid={!!error}
            onSubmitEditing={continuar}
            returnKeyType="go"
          />
          {erro}
          <Button block onPress={continuar} loading={loading}>
            Continuar
          </Button>

          <View style={styles.divisor}>
            <View style={[styles.divisorLinha, { backgroundColor: colors.borderDefault }]} />
            <AppText variant="caption" tone="muted">
              ou
            </AppText>
            <View style={[styles.divisorLinha, { backgroundColor: colors.borderDefault }]} />
          </View>
          <GoogleButton />
        </>
      ) : null}

      {etapa === 'senha' ? (
        <>
          {emailFixo}
          <TextField
            label="Senha"
            value={senha}
            onChangeText={setSenha}
            placeholder="••••••••"
            secureTextEntry
            autoComplete="current-password"
            autoFocus
            invalid={!!error}
            onSubmitEditing={entrar}
            returnKeyType="go"
          />
          {erro}
          <Button block onPress={entrar} loading={loading}>
            Entrar
          </Button>
          <Pressable
            accessibilityRole="button"
            onPress={() => irPara('esqueci')}
            style={styles.rodape}>
            <AppText variant="bodySm" tone="brand" weight="600">
              Esqueci minha senha
            </AppText>
          </Pressable>
        </>
      ) : null}

      {etapa === 'esqueci' ? (
        <>
          {emailFixo}
          <AppText variant="title" accessibilityRole="header">
            Trocar a senha
          </AppText>
          <AppText variant="bodySm" tone="secondary">
            Vamos mandar um código de 6 dígitos para o e-mail acima. Com ele você cria uma senha
            nova.
          </AppText>
          {erro}
          <Button block onPress={enviarCodigo} loading={loading}>
            Enviar código
          </Button>
          <Pressable accessibilityRole="button" onPress={() => irPara('senha')} style={styles.rodape}>
            <AppText variant="bodySm" tone="secondary">
              Lembrei a senha
            </AppText>
          </Pressable>
        </>
      ) : null}

      {etapa === 'redefinir' ? (
        <>
          {emailFixo}
          <AppText variant="bodySm" tone="secondary">
            Se houver uma conta com este e-mail, o código chega em instantes. Confira também a
            caixa de spam.
          </AppText>
          <TextField
            label="Código"
            value={codigo}
            onChangeText={(v) => setCodigo(v.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={6}
            autoFocus
            accessibilityLabel="Código de 6 dígitos"
            style={styles.codigo}
          />
          <TextField
            label="Nova senha"
            value={senha}
            onChangeText={setSenha}
            placeholder={`Mínimo ${SENHA_MINIMA} caracteres`}
            secureTextEntry
            autoComplete="new-password"
          />
          <TextField
            label="Confirmar nova senha"
            value={confirmarSenha}
            onChangeText={setConfirmarSenha}
            placeholder="Repita a senha"
            secureTextEntry
            autoComplete="new-password"
            invalid={senhasDiferem}
            hint={senhasDiferem ? 'As senhas não conferem.' : undefined}
            onSubmitEditing={redefinir}
            returnKeyType="go"
          />
          {erro}
          <Button block onPress={redefinir} loading={loading}>
            Salvar nova senha
          </Button>
          <Button
            block
            variant="ghost"
            onPress={reenviarCodigo}
            disabled={segundosParaReenvio > 0}
            accessibilityHint={
              segundosParaReenvio > 0 ? `Disponível em ${segundosParaReenvio} segundos` : undefined
            }>
            {segundosParaReenvio > 0
              ? `Reenviar código em ${segundosParaReenvio}s`
              : 'Reenviar código'}
          </Button>
        </>
      ) : null}

      {etapa === 'cadastro' ? (
        <>
          {emailFixo}
          <AppText variant="bodySm" tone="muted">
            Primeira vez por aqui? Complete para criar sua conta.
          </AppText>
          <TextField
            label="Nome completo"
            value={nome}
            onChangeText={setNome}
            placeholder="Seu nome completo"
            autoComplete="name"
            autoFocus
          />
          <TextField
            label="Senha"
            value={senha}
            onChangeText={setSenha}
            placeholder={`Mínimo ${SENHA_MINIMA} caracteres`}
            secureTextEntry
            autoComplete="new-password"
          />
          <TextField
            label="Confirmar senha"
            value={confirmarSenha}
            onChangeText={setConfirmarSenha}
            placeholder="Repita a senha"
            secureTextEntry
            invalid={senhasDiferem}
            hint={senhasDiferem ? 'As senhas não conferem.' : undefined}
            onSubmitEditing={cadastrar}
            returnKeyType="go"
          />
          <AceiteTermos
            aceito={aceito}
            onChange={setAceito}
            invalido={!!error && !aceito}
          />
          {erro}
          <Button block onPress={cadastrar} loading={loading}>
            Criar conta
          </Button>
        </>
      ) : null}

      {etapa === 'termos' ? (
        <>
          <AppText variant="title" accessibilityRole="header">
            Antes de continuar
          </AppText>
          <AppText variant="bodySm" tone="secondary">
            Atualizamos os Termos de Uso e a Política de Privacidade. Eles explicam, em linguagem
            simples, o que fica público, o que a prefeitura vê e como baixar ou apagar seus dados.
          </AppText>
          <AceiteTermos aceito={aceito} onChange={setAceito} invalido={!!error && !aceito} />
          {erro}
          <Button block onPress={aceitarESeguir} loading={loading}>
            Aceitar e continuar
          </Button>
          <Button block variant="ghost" onPress={recusarTermos} disabled={loading}>
            Agora não
          </Button>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing[3],
  },
  flex: {
    flex: 1,
  },
  flexShrink: {
    flexShrink: 1,
  },
  divisor: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
  },
  divisorLinha: {
    flex: 1,
    height: 1,
  },
  emailFixo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing[2],
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing[3],
    minHeight: 48,
  },
  rodape: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: Layout.minTouch,
  },
  codigo: {
    textAlign: 'center',
    letterSpacing: 6,
    fontSize: 18,
  },
  aceite: {
    gap: Spacing[1],
  },
  aceiteLinha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    minHeight: Layout.minTouch,
  },
  aceiteLinks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[4],
    paddingLeft: 24 + Spacing[3],
  },
  link: {
    minHeight: Layout.minTouch,
    justifyContent: 'center',
  },
});
