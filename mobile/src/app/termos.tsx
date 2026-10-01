/**
 * Termos de Uso, em linguagem simples. Aberto pelo aceite do cadastro e por
 * Conta. A versão (`VERSAO_TERMOS`) acompanha o texto: mudou algo relevante,
 * sobe a versão e o app pede o aceite de novo.
 */

import { router, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { SubScreen } from '@/components/ui/sub-screen';
import { AppText } from '@/components/ui/text';
import { Spacing } from '@/constants/theme';

const ATUALIZADO_EM = '1º de outubro de 2026';

const SECOES: { titulo: string; paragrafos: string[] }[] = [
  {
    titulo: 'O que é a CIU',
    paragrafos: [
      'A Central de Inteligência Urbana (CIU) liga quem mora na cidade à prefeitura: você reporta um problema na rua — buraco, poste apagado, entulho, árvore caída — com foto e local, e acompanha o atendimento até o fim.',
      'A CIU não é canal de emergência. Em caso de risco à vida, ligue 190 (Polícia), 192 (SAMU) ou 193 (Bombeiros).',
    ],
  },
  {
    titulo: 'Quem pode usar',
    paragrafos: [
      'Qualquer pessoa com 13 anos ou mais. A conta é pessoal: não compartilhe sua senha e use informações verdadeiras.',
    ],
  },
  {
    titulo: 'Como reportar do jeito certo',
    paragrafos: [
      'Reporte só problemas reais, em espaço público, que você viu. Tire a foto na hora e no local.',
      'Evite fotografar rostos e placas de carro. Não coloque na descrição dados pessoais de outras pessoas (nome, telefone, endereço de alguém).',
      'Respeito sempre: ofensas, ameaças, propaganda e conteúdo falso são removidos.',
    ],
  },
  {
    titulo: 'Moderação',
    paragrafos: [
      'Moradores podem apoiar um chamado ou avisar que ele já foi resolvido ou não existe. Reportes falsos geram advertências (que expiram em 90 dias) e a equipe da prefeitura pode remover conteúdo ou suspender contas que descumprirem estes termos. Toda ação da moderação fica registrada.',
    ],
  },
  {
    titulo: 'O que fica público',
    paragrafos: [
      'Chamados são informação de interesse de todos: título, descrição, categoria, foto, local e situação aparecem para qualquer pessoa no mapa.',
      'Para outros moradores seu nome aparece abreviado (por exemplo, "Maria S."). Seu e-mail e seu CPF nunca são exibidos.',
    ],
  },
  {
    titulo: 'O papel da prefeitura',
    paragrafos: [
      'Quem decide e executa o serviço é a prefeitura do município onde o problema está. Os prazos mostrados são estimativas do atendimento; a prefeitura pode reprogramar, juntar chamados repetidos ou recusar o que não for da competência dela, sempre com uma explicação.',
    ],
  },
  {
    titulo: 'Avisos',
    paragrafos: [
      'Mandamos avisos sobre os seus chamados e os que você apoiou (dentro do app e, se você permitir, por notificação no celular). Você pode desligar as notificações em Conta a qualquer momento.',
    ],
  },
  {
    titulo: 'Sua conta é sua',
    paragrafos: [
      'Você pode baixar uma cópia dos seus dados e excluir a conta quando quiser, em Conta → Conta. Os chamados que você abriu continuam no mapa, sem ligação com você.',
    ],
  },
  {
    titulo: 'Mudanças nestes termos',
    paragrafos: [
      'Se algo importante mudar, avisamos no app e pedimos que você leia e aceite de novo.',
    ],
  },
];

export default function TermosScreen() {
  return (
    <SubScreen title="Termos de Uso">
      <AppText variant="bodySm" tone="muted">
        Última atualização em {ATUALIZADO_EM}
      </AppText>
      {SECOES.map((secao) => (
        <View key={secao.titulo} style={styles.secao}>
          <AppText variant="title" accessibilityRole="header">
            {secao.titulo}
          </AppText>
          {secao.paragrafos.map((p) => (
            <AppText key={p.slice(0, 32)} variant="body" tone="secondary">
              {p}
            </AppText>
          ))}
        </View>
      ))}
      <Button
        variant="secondary"
        block
        onPress={() => router.push('/privacidade' as Href)}
        accessibilityHint="Abre a Política de Privacidade">
        Ler a Política de Privacidade
      </Button>
    </SubScreen>
  );
}

const styles = StyleSheet.create({
  secao: {
    gap: Spacing[2],
    marginTop: Spacing[3],
  },
});
