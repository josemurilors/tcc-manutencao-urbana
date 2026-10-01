/** Submenu "Preferências": tema e idioma. Aberto a partir do hub da aba Conta. */

import { Redirect, router, type Href } from 'expo-router';

import { MenuRow } from '@/components/ui/menu-row';
import { Card } from '@/components/ui/screen';
import { SegmentedControl, type SegmentOption } from '@/components/ui/segmented-control';
import { SubScreen } from '@/components/ui/sub-screen';
import { AppText } from '@/components/ui/text';
import { useAuth } from '@/context/auth-context';
import { useTheme, type PreferenciaTema } from '@/context/theme-context';

const OPCOES_TEMA: SegmentOption<PreferenciaTema>[] = [
  { value: 'sistema', label: 'Automático', icon: 'phone-portrait-outline' },
  { value: 'claro', label: 'Claro', icon: 'sunny-outline' },
  { value: 'escuro', label: 'Escuro', icon: 'moon-outline' },
];

export default function PreferenciasScreen() {
  const { preferencia, setPreferencia } = useTheme();
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <Redirect href="/(tabs)/conta" />;
  }

  return (
    <SubScreen title="Preferências" fallback="/(tabs)/conta">
      <Card>
        <AppText variant="label" accessibilityRole="header">
          Tema
        </AppText>
        <SegmentedControl
          accessibilityLabel="Tema"
          options={OPCOES_TEMA}
          value={preferencia}
          onChange={setPreferencia}
        />
        <AppText variant="caption" tone="muted">
          {preferencia === 'sistema'
            ? 'Segue o modo claro ou escuro do seu aparelho.'
            : 'Fixo, independente do aparelho.'}
        </AppText>
      </Card>
      <Card>
        <MenuRow icon="language" label="Idioma" value="Português (BR)" />
      </Card>
      {__DEV__ ? (
        <Card>
          <MenuRow
            icon="color-palette"
            label="Catálogo do design system"
            detail="Só em desenvolvimento"
            // A rota existe só para dev e não entra nas rotas tipadas geradas.
            onPress={() => router.push('/dev/catalogo' as Href)}
          />
        </Card>
      ) : null}
    </SubScreen>
  );
}
