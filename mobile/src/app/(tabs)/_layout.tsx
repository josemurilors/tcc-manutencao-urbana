/**
 * Abas principais. Substituem o header + dropdown de usuário do web:
 * mapa, operação e painel. A conta saiu da barra — vive
 * atrás do botão de menu no topo do mapa. Com uma aba só (visitante ou
 * cidadão: apenas o mapa) a barra inteira some.
 *
 * As abas seguem o papel (contrato v3, seção 3): operador+ vê Operação,
 * gestor+ vê também o Painel (BI). `usePapel` revalida o papel com o perfil
 * ao montar, então quem foi promovido ou perdeu o acesso vê a barra mudar
 * sem precisar sair e entrar de novo.
 */

import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';

import { usePapel } from '@/components/gestao/papeis';
import { useBreakpoint } from '@/components/ui/responsive';
import { FontSize } from '@/constants/theme';
import { useColors } from '@/context/theme-context';

export default function TabsLayout() {
  const colors = useColors();
  const { ehEquipe, ehGestor } = usePapel();

  // mapa (sempre) + operação (operador+) + painel (gestor+). Para o cidadão
  // sobra só o mapa, então a barra some — os chamados dele vivem em Conta >
  // Meus chamados.
  const abasVisiveis = 1 + (ehEquipe ? 1 : 0) + (ehGestor ? 1 : 0);
  // No computador (gestão na mesa) a barra vira lateral, com rótulo ao lado
  // do ícone; no celular segue embaixo, como sempre.
  const { desktop } = useBreakpoint();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.gold500,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarPosition: desktop ? 'left' : 'bottom',
        tabBarVariant: desktop ? 'material' : 'uikit',
        tabBarStyle: {
          backgroundColor: colors.bgElevated,
          borderTopColor: colors.borderDefault,
          ...(desktop ? { borderRightColor: colors.borderDefault } : null),
          display: abasVisiveis <= 1 ? 'none' : 'flex',
        },
        tabBarLabelStyle: { fontSize: desktop ? FontSize.sm : FontSize.xs - 2 },
      }}>
      <Tabs.Screen
        name="mapa"
        options={{
          title: 'Mapa',
          tabBarIcon: ({ color, size }) => <Ionicons name="map" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="operacao"
        options={{
          title: 'Operação',
          tabBarIcon: ({ color, size }) => <Ionicons name="construct" size={size} color={color} />,
          // Mapa de trabalho do operador: fila, meus atendimentos, finalizar.
          // Separado do mapa do cidadão para nenhum dos dois virar uma mistura.
          href: ehEquipe ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="painel"
        options={{
          title: 'Painel',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="stats-chart" size={size} color={color} />
          ),
          // BI é do gestor para cima (contrato v3, seção 7.4).
          href: ehGestor ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="conta"
        options={{
          title: 'Conta',
          // Fora da barra: abre pelo botão de menu no topo do mapa.
          href: null,
        }}
      />
    </Tabs>
  );
}
