/**
 * Submenu "Conta": nome, verificação de e-mail, troca de senha e sair.
 * Aberto a partir do hub da aba Conta.
 */

import { Ionicons } from '@expo/vector-icons';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card, SectionHeading } from '@/components/ui/screen';
import { SubScreen } from '@/components/ui/sub-screen';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useColors } from '@/context/theme-context';
import { useToast } from '@/context/toast-context';
import { api } from '@/services/api';
import { limparProgresso } from '@/services/progresso';
import { formatarCpf } from '@/utils/format';

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

  if (!isAuthenticated) {
    return <Redirect href="/(tabs)/conta" />;
  }

  async function salvar() {
    setSalvando(true);
    try {
      if (nome !== user?.nome) {
        await api.updateProfile({ nome });
        await updateUser({ nome });
      }
      if (senhaAtual && novaSenha) {
        await api.updatePassword(senhaAtual, novaSenha);
        setSenhaAtual('');
        setNovaSenha('');
      }
      // Volta a espelhar o usuário salvo.
      setNomeEditado(null);
      addToast('Alterações salvas com sucesso!');
    } catch (err) {
      addToast(
        'Erro ao salvar: ' + (err instanceof Error ? err.message : 'tente novamente'),
        'error',
      );
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

  return (
    <SubScreen title="Conta" fallback="/(tabs)/conta">
      <Card>
        <SectionHeading title="Dados" subtitle={user?.email} />
        <TextField label="Nome completo" value={nome} onChangeText={setNomeEditado} />
        {user?.cpf ? <TextField label="CPF" value={formatarCpf(user.cpf)} editable={false} /> : null}
      </Card>

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
          secureTextEntry
          autoComplete="new-password"
        />
      </Card>

      <Button block onPress={salvar} loading={salvando}>
        Salvar Alterações
      </Button>

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
    </SubScreen>
  );
}
