/**
 * Consulta por protocolo. Pública: quem abriu pelo telefone 156, recebeu o
 * número por mensagem ou trocou de aparelho acompanha o chamado sem precisar
 * da conta de quem reportou.
 */

import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SubScreen } from '@/components/ui/sub-screen';
import { AppText } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import { normalizarProtocolo } from '@/services/api-cidadao';

export default function ConsultarProtocoloScreen() {
  const colors = useColors();
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  function consultar() {
    const protocolo = normalizarProtocolo(texto);
    if (!protocolo) {
      setErro('Digite o número completo, com o ano. Ex.: 2026-000123');
      return;
    }
    setErro(null);
    router.push({ pathname: '/protocolo/[protocolo]', params: { protocolo } });
  }

  return (
    <SubScreen title="Consultar protocolo">
      <Card>
        <View style={styles.cabecalho}>
          <Ionicons name="document-text-outline" size={22} color={colors.primaryText} />
          <AppText variant="title" style={styles.flex}>
            Acompanhe pelo número
          </AppText>
        </View>
        <AppText variant="bodySm" tone="secondary">
          Todo chamado recebe um protocolo no formato ano-número (ex.: 2026-000123). Ele aparece na
          confirmação do envio e em Meus chamados.
        </AppText>
        <TextField
          label="Número do protocolo"
          value={texto}
          onChangeText={(t) => {
            setTexto(t);
            if (erro) setErro(null);
          }}
          placeholder="2026-000123"
          keyboardType="numbers-and-punctuation"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={consultar}
          invalid={!!erro}
          hint={erro ?? 'Pode digitar só os números; a gente completa os zeros.'}
          accessibilityLabel="Número do protocolo"
        />
        <Button
          block
          onPress={consultar}
          disabled={texto.replace(/\D/g, '').length < 5}
          icon={<Ionicons name="search" size={18} color={colors.onPrimary} />}>
          Consultar
        </Button>
      </Card>
    </SubScreen>
  );
}

const styles = StyleSheet.create({
  cabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
  flex: {
    flex: 1,
  },
});
