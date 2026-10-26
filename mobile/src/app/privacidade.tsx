/**
 * Política de Privacidade dentro do app, em linguagem simples.
 *
 * Segue a política publicada no site (`public/privacidade.html`) e
 * acrescenta o que o app passou a fazer depois dela: notificações no
 * celular, central de avisos e exportação dos dados. Ao mudar uma, mude a
 * outra — a Play Store confere que as duas dizem o mesmo.
 */

import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { SubScreen } from '@/components/ui/sub-screen';
import { AppText } from '@/components/ui/text';
import { Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import { useToast } from '@/context/toast-context';

const ATUALIZADO_EM = '1º de outubro de 2026';
const URL_POLITICA = 'https://tcc.josemurilors.com.br/privacidade.html';
const CONTATO = 'caioalencarcinel@gmail.com';

type Secao = { titulo: string; paragrafos?: string[]; itens?: string[] };

const SECOES: Secao[] = [
  {
    titulo: 'Resumo',
    paragrafos: [
      'Usamos seus dados só para fazer o serviço funcionar: registrar e acompanhar chamados e avisar você do andamento. Não vendemos dados, não mostramos anúncios e não usamos seus dados para publicidade. Tudo segue a Lei Geral de Proteção de Dados (LGPD, Lei 13.709/2018).',
    ],
  },
  {
    titulo: 'O que coletamos e para quê',
    itens: [
      'Nome e e-mail — para identificar você, mandar o código de verificação e avisos sobre seus chamados.',
      'CPF (opcional) — para evitar contas repetidas. Fica guardado cifrado e nunca é mostrado.',
      'Localização — só com o app aberto e com sua permissão, para posicionar o chamado e mostrar o que há perto. Não rastreamos em segundo plano.',
      'Fotos — as que você anexa ao chamado, para mostrar o problema. A foto fica pública junto com o chamado.',
      'Chamados, apoios, sinalizações e avaliações — para manter o mapa, medir o atendimento e calcular seu nível.',
      'Identificador de notificações do aparelho — só se você permitir as notificações, para mandar os avisos ao seu celular. Apagado ao sair da conta neste aparelho ou ao desligar os avisos.',
      'Registros técnicos (endereço IP e horário) — para segurança e diagnóstico. Guardados por até 30 dias.',
    ],
  },
  {
    titulo: 'O que é público',
    paragrafos: [
      'Título, descrição, categoria, foto, local e situação do chamado aparecem para qualquer pessoa. Para outros moradores seu nome aparece abreviado (por exemplo, "Maria S."). Seu e-mail e seu CPF nunca aparecem.',
    ],
  },
  {
    titulo: 'Com quem compartilhamos',
    itens: [
      'Prefeitura do município do chamado: a equipe vê os chamados com seu nome, para atender e responder. Tudo o que ela faz no chamado fica registrado.',
      'Google: no login com Google e no mapa do app Android.',
      'Serviço de rotas (OSRM): recebe origem e destino quando a equipe pede o trajeto até um chamado.',
      'Provedor de e-mail: recebe seu endereço para enviar códigos e avisos.',
      'Serviço de notificações do Expo, Google e Apple: recebe o identificador do aparelho e o texto do aviso, para entregá-lo.',
      'Cloudflare: intermedia o tráfego e vê o endereço IP.',
    ],
  },
  {
    titulo: 'Por quanto tempo guardamos',
    paragrafos: [
      'Os dados da conta ficam enquanto ela existir. Chamados permanecem no mapa por serem registro público. Advertências por reportes falsos expiram em 90 dias. Registros técnicos são apagados em até 30 dias.',
    ],
  },
  {
    titulo: 'Seus direitos',
    itens: [
      'Ver e baixar seus dados: em Conta → Conta → Baixar meus dados, você recebe um arquivo com tudo o que temos sobre você.',
      'Corrigir: mude seu nome em Conta → Conta.',
      'Desligar avisos: em Conta → Conta → Notificações no celular.',
      'Excluir a conta: em Conta → Conta → Excluir minha conta. É imediato e apaga nome, e-mail, CPF, apoios, sinalizações, advertências e identificadores de notificação. Os chamados ficam no mapa sem ligação com você.',
    ],
  },
  {
    titulo: 'Segurança',
    paragrafos: [
      'Senhas são guardadas com hash, o CPF é cifrado, toda a comunicação usa HTTPS e a sessão fica no armazenamento seguro do celular.',
    ],
  },
  {
    titulo: 'Crianças',
    paragrafos: ['O serviço não é destinado a menores de 13 anos.'],
  },
  {
    titulo: 'Fale com a gente',
    paragrafos: [`Dúvidas ou pedidos sobre seus dados: ${CONTATO}.`],
  },
];

export default function PrivacidadeScreen() {
  const colors = useColors();
  const toast = useToast();

  async function abrirVersaoCompleta() {
    try {
      await WebBrowser.openBrowserAsync(URL_POLITICA);
    } catch (err) {
      toast.error('Não foi possível abrir o navegador. Acesse ' + URL_POLITICA);
      console.warn('[privacidade] navegador', err);
    }
  }

  return (
    <SubScreen title="Privacidade">
      <AppText variant="bodySm" tone="muted">
        Última atualização em {ATUALIZADO_EM}
      </AppText>
      {SECOES.map((secao) => (
        <View key={secao.titulo} style={styles.secao}>
          <AppText variant="title" accessibilityRole="header">
            {secao.titulo}
          </AppText>
          {secao.paragrafos?.map((p) => (
            <AppText key={p.slice(0, 32)} variant="body" tone="secondary">
              {p}
            </AppText>
          ))}
          {secao.itens?.map((item) => (
            <View key={item.slice(0, 32)} style={styles.item}>
              <AppText variant="body" tone="muted" accessibilityElementsHidden>
                •
              </AppText>
              <AppText variant="body" tone="secondary" style={styles.itemTexto}>
                {item}
              </AppText>
            </View>
          ))}
        </View>
      ))}
      <Button
        variant="secondary"
        block
        onPress={abrirVersaoCompleta}
        accessibilityHint="Abre a política no navegador"
        icon={<Ionicons name="open-outline" size={16} color={colors.textPrimary} />}>
        Ver a versão publicada no site
      </Button>
    </SubScreen>
  );
}

const styles = StyleSheet.create({
  secao: {
    gap: Spacing[2],
    marginTop: Spacing[3],
  },
  item: {
    flexDirection: 'row',
    gap: Spacing[2],
  },
  itemTexto: {
    flex: 1,
  },
});
