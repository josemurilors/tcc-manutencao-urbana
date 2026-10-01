/**
 * Confirmação de ação sem campo de texto: `Alert` no nativo e
 * `window.confirm` no web (o `Alert.alert` do react-native-web não mostra
 * botões). Mesmo padrão de `app/ajustes/perfil.tsx`. Ações que pedem motivo
 * usam `AcaoSheet`.
 */

import { Alert, Platform } from 'react-native';

type Opcoes = {
  titulo: string;
  mensagem: string;
  /** Rótulo do botão que confirma ("Revogar", "Excluir"). */
  confirmar: string;
  destrutivo?: boolean;
};

export function confirmar({ titulo, mensagem, confirmar: rotulo, destrutivo }: Opcoes) {
  return new Promise<boolean>((resolve) => {
    if (Platform.OS === 'web') {
      resolve(typeof window !== 'undefined' && window.confirm(`${titulo}\n\n${mensagem}`));
      return;
    }
    Alert.alert(
      titulo,
      mensagem,
      [
        { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
        { text: rotulo, style: destrutivo ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/** Mensagem de erro legível para toast/estado de erro. */
export function mensagemDeErro(err: unknown, padrao = 'Tente de novo em instantes.') {
  return err instanceof Error && err.message ? err.message : padrao;
}

/** Falha de rede (sem resposta do servidor), para usar o estado `offline`. */
export function ehErroDeRede(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return (
    msg === 'Network request failed' || msg === 'Failed to fetch' || msg.includes('NetworkError')
  );
}
