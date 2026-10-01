/**
 * Único passo depois do login com Google: como a pessoa quer ser chamada e,
 * se a conta é nova, o aceite dos Termos e da Política (no cadastro por
 * e-mail isso fica no próprio formulário).
 */

import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { AceiteTermos } from '@/components/auth-flow';
import { Button } from '@/components/ui/button';
import { AppText } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { Radius, Spacing } from '@/constants/theme';
import { precisaAceitarTermos, useAuth } from '@/context/auth-context';
import { useColors } from '@/context/theme-context';
import { useToast } from '@/context/toast-context';
import { api } from '@/services/api';
import { contaApi } from '@/services/api-conta';
import { mensagemDeErro } from '@/utils/erro';

export default function EscolherNomeScreen() {
  const colors = useColors();
  const toast = useToast();
  const { user, updateUser } = useAuth();

  const [nome, setNome] = useState(user?.nome ?? '');
  const [aceito, setAceito] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Decidido uma vez: depois do aceite o campo deixa de ser nulo e a caixa
  // não pode sumir no meio do envio.
  const [pedeAceite] = useState(() => precisaAceitarTermos(user));

  async function handleSubmit() {
    const limpo = nome.trim();
    if (limpo.length < 2) {
      setError('Informe um nome com pelo menos 2 caracteres.');
      return;
    }
    if (pedeAceite && !aceito) {
      setError('Para continuar, aceite os Termos de Uso e a Política de Privacidade.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      if (pedeAceite) {
        const res = await contaApi.aceitarTermos();
        await updateUser({ aceite_termos_em: res.aceite_termos_em ?? new Date().toISOString() });
      }
      await api.updateProfile({ nome: limpo });
      await updateUser({ nome: limpo });
      toast.success('Tudo pronto!');
      router.replace('/(tabs)/mapa');
    } catch (err) {
      setError(mensagemDeErro(err, 'Não foi possível salvar. Tente de novo.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View
          style={[
            styles.cartao,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}>
          <AppText variant="title" accessibilityRole="header">
            Como quer ser chamado?
          </AppText>
          <AppText variant="bodySm" tone="secondary">
            Para outros moradores aparece só o primeiro nome e a inicial do sobrenome. Você pode
            mudar depois na aba Conta.
          </AppText>

          <TextField
            label="Nome"
            value={nome}
            onChangeText={setNome}
            placeholder="Seu nome"
            autoFocus
            maxLength={80}
            invalid={!!error && nome.trim().length < 2}
            onSubmitEditing={handleSubmit}
            returnKeyType="done"
          />

          {pedeAceite ? (
            <AceiteTermos aceito={aceito} onChange={setAceito} invalido={!!error && !aceito} />
          ) : null}

          {error ? (
            <AppText variant="caption" tone="danger" accessibilityRole="alert">
              {error}
            </AppText>
          ) : null}

          <Button block onPress={handleSubmit} loading={loading}>
            Continuar
          </Button>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: Spacing[4],
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  cartao: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing[6],
    gap: Spacing[4],
  },
});
