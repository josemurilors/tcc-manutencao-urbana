/**
 * Aba Conta — hub de configurações: cartão de perfil no topo e três grupos:
 *
 * - Minha participação: meus chamados, consultar protocolo, notificações.
 * - Prefeitura (só equipe): operação; painel e administração para gestor+.
 * - Conta e privacidade: dados da conta, preferências, termos e privacidade.
 *
 * Os formulários vivem nas telas de `app/ajustes/`; deslogado, a aba vira o
 * convite para entrar.
 */

import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { AuthWelcome } from '@/components/auth-welcome';
import { ROTULO_PAPEL, TOM_PAPEL, usePapel } from '@/components/gestao/papeis';
import { Badge } from '@/components/ui/badge';
import { MenuRow } from '@/components/ui/menu-row';
import { AppText } from '@/components/ui/text';
import { Card } from '@/components/ui/screen';
import { SubScreen } from '@/components/ui/sub-screen';
import { FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useColors } from '@/context/theme-context';
import { useProgresso } from '@/services/progresso';

export default function ContaScreen() {
  const colors = useColors();
  const { user, isAuthenticated } = useAuth();
  const progresso = useProgresso(isAuthenticated);
  const { papel, ehEquipe, ehGestor } = usePapel();

  // Deslogado, a aba inteira é o convite para entrar — as preferências
  // (tema, idioma) só aparecem depois do login.
  if (!isAuthenticated) {
    return <AuthWelcome />;
  }

  return (
    <SubScreen title="Conta">
      <View style={styles.secao}>
        <Card>
          <View style={styles.perfil}>
            <View style={[styles.avatar, { backgroundColor: colors.bgElevated }]}>
              <Text style={[styles.avatarTexto, { color: colors.textSecondary }]}>
                {user?.nome?.charAt(0)?.toUpperCase() ?? '?'}
              </Text>
            </View>
            <View style={styles.perfilTexto}>
              <Text style={[styles.perfilNome, { color: colors.textPrimary }]}>
                {user?.nome || 'Usuário'}
              </Text>
              <Text style={[styles.meta, { color: colors.textMuted }]}>{user?.email}</Text>
              {user?.municipio?.nome ? (
                <Text style={[styles.meta, { color: colors.gold500 }]}>
                  {user.municipio.nome} - {user.municipio.uf_sigla}
                </Text>
              ) : null}
              {ehEquipe ? (
                // Quem é da prefeitura precisa saber com que papel está
                // logado — o mesmo app serve cidadão e servidor.
                <Badge
                  label={`Equipe da prefeitura · ${ROTULO_PAPEL[papel]}`}
                  tone={TOM_PAPEL[papel]}
                  icon="shield-checkmark"
                  style={styles.papel}
                />
              ) : null}
            </View>
            <Ionicons
              name={user?.email_verificado ? 'checkmark-circle' : 'alert-circle'}
              size={18}
              color={user?.email_verificado ? colors.success : colors.gold500}
              accessibilityLabel={
                user?.email_verificado ? 'E-mail verificado' : 'E-mail não verificado'
              }
            />
          </View>

          {progresso ? (
            <View style={styles.nivel}>
              <View style={styles.nivelLinha}>
                <Text style={[styles.nivelTitulo, { color: colors.gold500 }]}>
                  Nível {progresso.nivel} · {progresso.titulo}
                </Text>
                <Text style={[styles.meta, { color: colors.textMuted }]}>
                  {progresso.xp - progresso.xp_nivel}/{progresso.xp_proximo - progresso.xp_nivel}{' '}
                  XP
                </Text>
              </View>
              <View
                style={[styles.barra, { backgroundColor: colors.bgElevated }]}
                accessibilityLabel={`${progresso.xp} pontos de experiência, nível ${progresso.nivel}`}>
                <View
                  style={[
                    styles.barraCheia,
                    {
                      backgroundColor: colors.gold500,
                      width: `${Math.min(
                        100,
                        Math.round(
                          ((progresso.xp - progresso.xp_nivel) /
                            (progresso.xp_proximo - progresso.xp_nivel)) *
                            100,
                        ),
                      )}%`,
                    },
                  ]}
                />
              </View>
            </View>
          ) : null}
        </Card>
      </View>

      {!user?.email_verificado ? (
        <View style={styles.secao}>
          <Card style={{ borderColor: colors.gold500 }}>
            <MenuRow
              icon="mail-unread"
              label="Verifique seu e-mail"
              detail="Digite o código que enviamos para ativar sua conta"
              destaque
              onPress={() => router.push('/ajustes/perfil')}
            />
          </Card>
        </View>
      ) : null}

      <View style={styles.secao}>
        <TituloSecao>Minha participação</TituloSecao>
        <Card>
          <MenuRow
            icon="megaphone"
            label="Meus chamados"
            detail="Tudo que você reportou e a situação de cada um"
            onPress={() => router.push('/meus-chamados')}
          />
          <MenuRow
            icon="search"
            label="Consultar protocolo"
            detail="Acompanhe um chamado pelo número, mesmo aberto por outra pessoa ou pelo 156"
            onPress={() => router.push('/protocolo')}
          />
          <MenuRow
            icon="notifications"
            label="Notificações"
            detail="Avisos sobre os seus chamados"
            onPress={() => router.push('/notificacoes' as Href)}
          />
        </Card>
      </View>

      {ehEquipe ? (
        <View style={styles.secao}>
          <TituloSecao>
            {user?.municipio?.nome ? `Prefeitura — ${user.municipio.nome}` : 'Prefeitura'}
          </TituloSecao>
          <Card>
            <MenuRow
              icon="construct"
              label="Operação"
              detail="Fila de chamados para assumir e atender"
              onPress={() => router.push('/(tabs)/operacao' as Href)}
            />
            {ehGestor ? (
              <>
                <MenuRow
                  icon="stats-chart"
                  label="Painel"
                  detail="Indicadores de atendimento, prazos e satisfação"
                  onPress={() => router.push('/(tabs)/painel' as Href)}
                />
                <MenuRow
                  icon="business"
                  label="Administração do município"
                  detail="Equipe, secretarias, categorias e prazos, respostas-padrão, moderação e auditoria"
                  onPress={() => router.push('/admin' as Href)}
                />
              </>
            ) : null}
          </Card>
        </View>
      ) : null}

      <View style={styles.secao}>
        <TituloSecao>Conta e privacidade</TituloSecao>
        <Card>
          <MenuRow
            icon="person"
            label="Conta"
            detail="Nome, senha, verificação, seus dados e sair"
            onPress={() => router.push('/ajustes/perfil')}
          />
          <MenuRow
            icon="options"
            label="Preferências"
            detail="Tema e idioma"
            onPress={() => router.push('/ajustes/preferencias')}
          />
          <MenuRow
            icon="document-text"
            label="Termos de Uso"
            onPress={() => router.push('/termos' as Href)}
          />
          <MenuRow
            icon="lock-closed"
            label="Política de Privacidade"
            onPress={() => router.push('/privacidade' as Href)}
          />
        </Card>
      </View>
    </SubScreen>
  );
}

function TituloSecao({ children }: { children: React.ReactNode }) {
  return (
    <AppText variant="label" tone="muted" accessibilityRole="header" style={styles.tituloSecao}>
      {children}
    </AppText>
  );
}

const styles = StyleSheet.create({
  secao: {
    gap: Spacing[2],
  },
  tituloSecao: {
    paddingHorizontal: Spacing[1],
  },
  perfil: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarTexto: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.semibold,
  },
  perfilTexto: {
    flex: 1,
    gap: 2,
  },
  perfilNome: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
  },
  meta: {
    fontSize: FontSize.xs,
  },
  papel: {
    marginTop: Spacing[1],
  },
  nivel: {
    marginTop: Spacing[3],
    gap: Spacing[1],
  },
  nivelLinha: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  nivelTitulo: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },
  barra: {
    height: 6,
    borderRadius: Radius.full,
    overflow: 'hidden',
  },
  barraCheia: {
    height: '100%',
    borderRadius: Radius.full,
  },
});
