/**
 * Aba Conta — hub de configurações: cartão de perfil no topo e submenus
 * (Conta, Preferências e, para admins, administração). Os formulários vivem
 * nas telas de `app/ajustes/`; deslogado, a aba vira o convite para entrar.
 */

import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { AuthWelcome } from '@/components/auth-welcome';
import { MenuRow } from '@/components/ui/menu-row';
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

      <View style={styles.secao}>
        <Card>
          <MenuRow
            icon="megaphone"
            label="Meus chamados"
            detail="Tudo que você reportou e a situação de cada um"
            onPress={() => router.push('/meus-chamados')}
          />
          <MenuRow
            icon="person"
            label="Conta"
            detail="Nome, senha, verificação e sair"
            onPress={() => router.push('/ajustes/perfil')}
          />
          <MenuRow
            icon="options"
            label="Preferências"
            detail="Tema e idioma"
            onPress={() => router.push('/ajustes/preferencias')}
          />
          {user?.admin ? (
            <MenuRow
              icon="people"
              label="Gerenciar usuários"
              detail="Administração do sistema"
              onPress={() => router.push('/admin/usuarios')}
            />
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
    </SubScreen>
  );
}

const styles = StyleSheet.create({
  secao: {
    gap: Spacing[2],
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
