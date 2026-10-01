/**
 * `/chamado/<id>` — página pública do chamado. Destino do link compartilhado
 * (https://tcc.josemurilors.com.br/chamado/<id>, `ciu://chamado/<id>`), do
 * "Acompanhar" depois de reportar e dos "resolvidos recentemente" do portal
 * de transparência.
 *
 * Abre para visitante sem login. Nesse caso a página não mostra quem
 * reportou (nem o nome mascarado — o mapa faz o mesmo) e ganha, no rodapé,
 * o convite para baixar o app ou entrar.
 */

import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChamadoPagina } from '@/components/chamado/chamado-pagina';
import { ConviteApp } from '@/components/transparencia/convite-app';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useColors } from '@/context/theme-context';
import { apiCidadao } from '@/services/api-cidadao';

export default function ChamadoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const alvo = String(id ?? '');
  const { isAuthenticated } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  async function carregar() {
    const detalhe = await apiCidadao.detalhe(alvo);
    return isAuthenticated ? detalhe : { ...detalhe, autor_nome: undefined, usuario: null };
  }

  return (
    <View style={[styles.tela, { backgroundColor: colors.bg }]}>
      <View style={styles.tela}>
        <ChamadoPagina chave={`id:${alvo}|${isAuthenticated ? 'sessao' : 'visitante'}`} carregar={carregar} />
      </View>
      {isAuthenticated ? null : (
        <View
          style={[
            styles.rodape,
            { paddingBottom: insets.bottom + Spacing[2], borderTopColor: colors.border, backgroundColor: colors.surface },
          ]}>
          <ConviteApp
            modo="faixa"
            titulo="Acompanhe e apoie pelo CIU"
            texto="Com uma conta você confirma problemas, recebe avisos de andamento e reporta outros na sua rua."
            style={styles.convite}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tela: {
    flex: 1,
  },
  rodape: {
    paddingTop: Spacing[2],
    paddingHorizontal: Spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  convite: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
});
