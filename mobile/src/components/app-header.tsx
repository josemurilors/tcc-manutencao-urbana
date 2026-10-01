/** Cabeçalho do app — porte do `AppHeader` de `frontend/src/App.jsx`. */

import { Image } from 'expo-image';
import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { SyncIndicator } from '@/components/sync-indicator';
import { IconButton } from '@/components/ui/icon-button';
import { AppText } from '@/components/ui/text';
import { hitSlopPara, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useTheme } from '@/context/theme-context';
import { useNaoLidas } from '@/hooks/use-nao-lidas';

const LOGO = require('@/assets/images/icon.png');

type Props = {
  /** Mensagem que substitui os controles (ex.: instrução ao posicionar o pino). */
  hint?: string;
};

/** "9+" a partir de 10: o selo é um aviso, não um placar. */
function rotuloContagem(total: number) {
  return total > 9 ? '9+' : String(total);
}

/**
 * Sino da central de notificações com o número de não lidas. Exportado à
 * parte para telas sem o cabeçalho completo (o mapa, por exemplo) o usarem
 * no próprio grupo de botões. Some sem sessão.
 */
export function SinoNotificacoes({
  floating,
  style,
}: {
  /** Sombra, para flutuar sobre o mapa. */
  floating?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const { isAuthenticated } = useAuth();
  const total = useNaoLidas() ?? 0;

  if (!isAuthenticated) return null;

  const temNovas = total > 0;
  const rotulo = temNovas
    ? `Notificações, ${total} não ${total === 1 ? 'lida' : 'lidas'}`
    : 'Notificações';

  return (
    <View style={style}>
      <IconButton
        icon={temNovas ? 'notifications' : 'notifications-outline'}
        accessibilityLabel={rotulo}
        accessibilityHint="Abre a central de notificações"
        variant={floating ? 'surface' : 'ghost'}
        floating={floating}
        onPress={() => router.push('/notificacoes' as Href)}
      />
      {temNovas ? (
        // O número já vai no rótulo do botão; o selo é só visual.
        <View
          pointerEvents="none"
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          style={[styles.selo, { backgroundColor: colors.danger, borderColor: colors.bg }]}>
          <AppText variant="caption" weight="700" inControl style={{ color: colors.onDanger }}>
            {rotuloContagem(total)}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

export function AppHeader({ hint }: Props) {
  const { theme, colors, toggle } = useTheme();
  const { isAuthenticated } = useAuth();

  return (
    <View
      style={[
        styles.header,
        { backgroundColor: colors.bgElevated, borderBottomColor: colors.borderDefault },
      ]}>
      <View style={styles.marca}>
        <View style={[styles.logoCaixa, { borderColor: colors.icon }]}>
          <Image source={LOGO} style={styles.logo} contentFit="cover" />
        </View>
        <View style={styles.marcaTexto}>
          <AppText variant="label" numberOfLines={1}>
            Central de Inteligência Urbana
          </AppText>
          <AppText variant="caption" tone="muted" numberOfLines={1}>
            Chamados para Serviços Públicos
          </AppText>
        </View>
      </View>

      {hint ? (
        <AppText variant="caption" tone="brand" numberOfLines={2} style={styles.hint}>
          {hint}
        </AppText>
      ) : (
        <View style={styles.acoes}>
          <SyncIndicator />
          <IconButton
            icon={theme === 'dark' ? 'sunny' : 'moon'}
            accessibilityLabel={theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}
            size="sm"
            onPress={toggle}
          />
          <SinoNotificacoes />
          {!isAuthenticated ? (
            <Pressable
              onPress={() => router.push('/login')}
              accessibilityRole="button"
              hitSlop={hitSlopPara(64, 36)}
              style={[styles.entrar, { borderColor: colors.borderDefault }]}>
              <AppText variant="bodySm" tone="secondary" weight="500" inControl>
                Entrar
              </AppText>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing[3],
    minHeight: 56,
    paddingHorizontal: Spacing[4],
    borderBottomWidth: 1,
  },
  marca: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    flexShrink: 1,
  },
  logoCaixa: {
    width: 28,
    height: 28,
    borderWidth: 1,
  },
  logo: {
    width: '100%',
    height: '100%',
  },
  marcaTexto: {
    flexShrink: 1,
  },
  hint: {
    flex: 1,
    textAlign: 'right',
  },
  acoes: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[1],
  },
  selo: {
    position: 'absolute',
    top: 2,
    right: 0,
    minWidth: 20,
    height: 20,
    paddingHorizontal: Spacing[1],
    borderRadius: Radius.full,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  entrar: {
    minHeight: 36,
    paddingHorizontal: Spacing[3],
    borderWidth: 1,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
