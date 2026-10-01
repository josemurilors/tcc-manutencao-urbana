/**
 * Catálogo do design system (só em desenvolvimento).
 *
 * Mostra cada primitivo de `components/ui` em todas as variantes, com troca de
 * tema na própria tela. Serve para QA visual (contraste, fonte grande, alvo de
 * toque) e para demonstrar o app. Fora do `__DEV__` a rota redireciona.
 *
 * Abrir: Conta → Preferências → "Catálogo do design system", ou a URL /dev/catalogo.
 */

import { Ionicons } from '@expo/vector-icons';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { AppErrorBoundary } from '@/components/error-boundary';
import { SyncIndicator } from '@/components/sync-indicator';
import { Badge } from '@/components/ui/badge';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FilterChips } from '@/components/ui/chips';
import { Divider } from '@/components/ui/divider';
import { IconButton } from '@/components/ui/icon-button';
import { ListItem } from '@/components/ui/list-item';
import { SectionHeader } from '@/components/ui/section-header';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton, SkeletonCard } from '@/components/ui/skeleton';
import { StateView, type StateKind } from '@/components/ui/state-view';
import { SubScreen } from '@/components/ui/sub-screen';
import { AppText } from '@/components/ui/text';
import {
  corDoStatus,
  Radius,
  Spacing,
  Typography,
  type Paleta,
  type StatusChave,
  type Tom,
  type TypographyVariant,
} from '@/constants/theme';
import { useTheme, type PreferenciaTema } from '@/context/theme-context';
import { useToast } from '@/context/toast-context';

const TONS: Tom[] = ['neutral', 'primary', 'success', 'warning', 'danger', 'info'];

/** Rótulos só para a demonstração; a fonte oficial é `constants/status.ts`. */
const STATUS_DEMO: { chave: StatusChave; rotulo: string; icone: keyof typeof Ionicons.glyphMap }[] = [
  { chave: 'pendente', rotulo: 'Recebido', icone: 'mail-unread' },
  { chave: 'em_analise', rotulo: 'Em análise', icone: 'search' },
  { chave: 'agendado', rotulo: 'Programado', icone: 'calendar' },
  { chave: 'em_andamento', rotulo: 'Em execução', icone: 'construct' },
  { chave: 'concluido', rotulo: 'Resolvido', icone: 'checkmark-circle' },
  { chave: 'rejeitado', rotulo: 'Não procede', icone: 'close-circle' },
];

const CORES: (keyof Paleta)[] = [
  'bg',
  'surface',
  'surfaceRaised',
  'textPrimary',
  'textSecondary',
  'textMuted',
  'border',
  'borderStrong',
  'primary',
  'primaryText',
  'danger',
  'success',
  'warning',
  'info',
];

export default function CatalogoScreen() {
  if (!__DEV__) return <Redirect href="/" />;
  return <Catalogo />;
}

function Catalogo() {
  const { colors, preferencia, setPreferencia } = useTheme();
  const toast = useToast();
  const { fontScale } = useWindowDimensions();
  const [estado, setEstado] = useState<StateKind>('empty');
  const [filtro, setFiltro] = useState<'todos' | 'abertos' | 'meus'>('todos');
  const [folha, setFolha] = useState(false);
  const [seguindo, setSeguindo] = useState(false);
  const [bomba, setBomba] = useState(0);

  return (
    <SubScreen title="Catálogo">
      <Card>
        <SectionHeader title="Tema" subtitle={`Fonte do sistema: ${fontScale.toFixed(2)}x`} />
        <SegmentedControl<PreferenciaTema>
          accessibilityLabel="Tema"
          value={preferencia}
          onChange={setPreferencia}
          options={[
            { value: 'sistema', label: 'Automático' },
            { value: 'claro', label: 'Claro' },
            { value: 'escuro', label: 'Escuro' },
          ]}
        />
        <AppText variant="caption" tone="muted">
          Para testar fonte grande, aumente o tamanho da fonte nas configurações do aparelho: textos
          crescem até 2x e controles até 1,6x.
        </AppText>
      </Card>

      <SectionHeader title="Cores" subtitle="Tokens semânticos; contraste conferido por npm run check:contrast" />
      <View style={styles.grade}>
        {CORES.map((nome) => (
          <View key={nome} style={styles.amostra}>
            <View
              style={[styles.cor, { backgroundColor: colors[nome] as string, borderColor: colors.border }]}
            />
            <AppText variant="caption" tone="secondary" numberOfLines={1}>
              {nome}
            </AppText>
          </View>
        ))}
      </View>

      <SectionHeader title="Tipografia" />
      <Card>
        {(Object.keys(Typography) as TypographyVariant[]).map((v) => (
          <AppText key={v} variant={v}>
            {v} · {Typography[v].fontSize}/{Typography[v].lineHeight}
          </AppText>
        ))}
        <Divider spacing={Spacing[1]} />
        <AppText tone="secondary">Texto secundário</AppText>
        <AppText tone="muted">Texto auxiliar (mínimo legível)</AppText>
        <AppText tone="brand">Link ou valor em destaque</AppText>
      </Card>

      <SectionHeader title="Botões" />
      <Card>
        <View style={styles.linha}>
          <Button>Primário</Button>
          <Button variant="secondary">Secundário</Button>
        </View>
        <View style={styles.linha}>
          <Button variant="danger">Perigo</Button>
          <Button variant="ghost">Discreto</Button>
        </View>
        <View style={styles.linha}>
          <Button size="sm">Pequeno</Button>
          <Button size="xs" variant="secondary">
            Mínimo
          </Button>
          <Button loading>Carregando</Button>
          <Button disabled>Inativo</Button>
        </View>
        <Button block icon={<Ionicons name="megaphone" size={18} color={colors.onPrimary} />}>
          Reportar problema
        </Button>
      </Card>

      <SectionHeader title="Botões de ícone" subtitle="Alvo de toque sempre ≥ 44 px" />
      <Card>
        <View style={styles.linha}>
          <IconButton icon="arrow-back" accessibilityLabel="Voltar" />
          <IconButton icon="locate" variant="surface" accessibilityLabel="Centralizar" />
          <IconButton
            icon="navigate"
            variant="surface"
            selected={seguindo}
            onPress={() => setSeguindo((s) => !s)}
            accessibilityLabel="Seguir minha posição"
          />
          <IconButton icon="trash" variant="danger" accessibilityLabel="Excluir" />
          <IconButton icon="close" size="sm" accessibilityLabel="Fechar" />
          <IconButton icon="add" variant="primary" size="lg" floating accessibilityLabel="Novo chamado" />
          <IconButton icon="refresh" variant="surface" loading accessibilityLabel="Atualizando" />
        </View>
      </Card>

      <SectionHeader title="Selos" subtitle="Texto + ícone: a cor nunca é a única pista" />
      <Card>
        <View style={styles.linhaQuebra}>
          {TONS.map((t) => (
            <Badge key={t} tone={t} label={t} />
          ))}
        </View>
        <View style={styles.linhaQuebra}>
          {TONS.map((t) => (
            <Badge key={t} tone={t} label={t} variant="solid" size="md" />
          ))}
        </View>
        <Divider spacing={Spacing[1]} />
        <View style={styles.linhaQuebra}>
          {STATUS_DEMO.map((s) => (
            <Badge key={s.chave} color={corDoStatus(colors, s.chave)} icon={s.icone} label={s.rotulo} />
          ))}
        </View>
        <View style={styles.linha}>
          {STATUS_DEMO.map((s) => (
            <Badge
              key={s.chave}
              compact
              color={corDoStatus(colors, s.chave)}
              icon={s.icone}
              label={s.rotulo}
            />
          ))}
        </View>
      </Card>

      <SectionHeader title="Seleção" />
      <Card>
        <SegmentedControl
          accessibilityLabel="Período"
          value={filtro}
          onChange={setFiltro}
          options={[
            { value: 'todos', label: 'Todos' },
            { value: 'abertos', label: 'Abertos', icon: 'time-outline' },
            { value: 'meus', label: 'Meus' },
          ]}
        />
      </Card>
      <FilterChips
        accessibilityLabel="Filtro"
        value={filtro}
        onChange={setFiltro}
        options={[
          { value: 'todos', label: 'Todos' },
          { value: 'abertos', label: 'Abertos' },
          { value: 'meus', label: 'Meus chamados' },
        ]}
      />

      <SectionHeader
        title="Cards e listas"
        action={{ label: 'Ver todos', onPress: () => toast.info('Ação do cabeçalho de seção') }}
      />
      <Card variant="outlined">
        <AppText variant="title">Card outlined</AppText>
        <AppText tone="secondary">Padrão de listas e blocos.</AppText>
      </Card>
      <Card variant="raised">
        <AppText variant="title">Card raised</AppText>
        <AppText tone="secondary">Superfície acima, com sombra.</AppText>
      </Card>
      <Card variant="filled" onPress={() => toast('Card tocado')} accessibilityLabel="Card tocável">
        <AppText variant="title">Card filled tocável</AppText>
        <AppText tone="secondary">Toque para ver o toast.</AppText>
      </Card>
      <Card padding={Spacing[2]}>
        <ListItem
          leading="trail-sign"
          title="Buraco na Rua das Flores"
          subtitle="Pavimentação · 120 m"
          meta="Protocolo 2026-000123"
          trailing={<Badge color={corDoStatus(colors, 'em_andamento')} icon="construct" label="Em execução" />}
          onPress={() => toast.info('Abrir chamado')}
        />
        <Divider inset={56} />
        <ListItem leading="notifications" title="Notificações" onPress={() => {}} />
        <Divider inset={56} />
        <ListItem leading="log-out" title="Sair" destructive onPress={() => {}} />
        <Divider inset={56} />
        <ListItem leading="information-circle" title="Versão" subtitle="1.0.0 (sem ação)" />
      </Card>
      <Divider label="ou" spacing={Spacing[2]} />

      <SectionHeader title="Carregamento" />
      <Card>
        <View style={styles.linha}>
          <Skeleton circle height={40} />
          <View style={styles.flex}>
            <Skeleton width="60%" />
            <Skeleton width="35%" height={12} style={{ marginTop: Spacing[2] }} />
          </View>
        </View>
      </Card>
      <SkeletonCard />

      <SectionHeader title="Estados" />
      <SegmentedControl<StateKind>
        accessibilityLabel="Estado"
        value={estado}
        onChange={setEstado}
        options={[
          { value: 'loading', label: 'Carreg.' },
          { value: 'empty', label: 'Vazio' },
          { value: 'error', label: 'Erro' },
          { value: 'offline', label: 'Offline' },
        ]}
      />
      <Card padding={0}>
        <StateView
          kind={estado}
          skeleton={estado === 'loading' ? 2 : 0}
          icon={estado === 'empty' ? 'megaphone-outline' : undefined}
          title={estado === 'empty' ? 'Você ainda não reportou nenhum problema' : undefined}
          description={
            estado === 'empty' ? 'Viu um buraco, poste apagado ou entulho? Reporte em segundos.' : undefined
          }
          action={estado === 'empty' ? { label: 'Reportar agora', onPress: () => toast('Reportar') } : undefined}
          onRetry={() => toast.info('Tentando de novo...')}
          style={estado === 'loading' ? { padding: Spacing[3] } : undefined}
        />
      </Card>

      <SectionHeader title="Toasts" subtitle="Duração por severidade; segurar pausa" />
      <Card>
        <View style={styles.linhaQuebra}>
          <Button size="sm" variant="secondary" onPress={() => toast('Chamado enviado!')}>
            Sucesso (API antiga)
          </Button>
          <Button size="sm" variant="secondary" onPress={() => toast.info('Aguardando sinal do GPS...')}>
            Info
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onPress={() => toast.warning('Você está longe do local do chamado.')}>
            Aviso
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onPress={() =>
              toast.error('Não foi possível atualizar o status.', {
                action: { label: 'Tentar de novo', onPress: () => toast.info('Tentando...') },
              })
            }>
            Erro + ação
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onPress={() =>
              toast.success('Chamado arquivado.', {
                action: { label: 'Desfazer', onPress: () => toast.info('Desfeito') },
              })
            }>
            Desfazer
          </Button>
        </View>
      </Card>

      <SectionHeader title="Folha inferior e fila offline" />
      <Card>
        <Button variant="secondary" onPress={() => setFolha(true)}>
          Abrir folha
        </Button>
        <AppText variant="caption" tone="muted">
          Indicador da fila (só aparece com itens na fila ou sem conexão):
        </AppText>
        <SyncIndicator />
      </Card>

      <SectionHeader title="Erro de render" subtitle="ErrorBoundary local (o global cobre o app)" />
      <Card padding={0} style={bomba % 2 === 1 ? styles.caixaErro : undefined}>
        <AppErrorBoundary key={bomba}>
          <Bomba armada={bomba % 2 === 1} onArmar={() => setBomba((b) => b + 1)} />
        </AppErrorBoundary>
      </Card>
      {bomba % 2 === 1 ? (
        <Button variant="ghost" onPress={() => setBomba((b) => b + 1)}>
          Desarmar exemplo
        </Button>
      ) : null}

      <BottomSheet
        visible={folha}
        onClose={() => setFolha(false)}
        title="Alterar status"
        description="3 chamados selecionados"
        footer={
          <>
            <Button variant="secondary" style={styles.flex} onPress={() => setFolha(false)}>
              Cancelar
            </Button>
            <Button style={styles.flex} onPress={() => setFolha(false)}>
              Aplicar
            </Button>
          </>
        }>
        {STATUS_DEMO.slice(0, 4).map((s) => (
          <ListItem
            key={s.chave}
            leading={s.icone}
            title={s.rotulo}
            onPress={() => setFolha(false)}
          />
        ))}
      </BottomSheet>
    </SubScreen>
  );
}

function Bomba({ armada, onArmar }: { armada: boolean; onArmar: () => void }) {
  if (armada) throw new Error('Exemplo de erro de render do catálogo');
  return (
    <View style={styles.bomba}>
      <Button variant="danger" onPress={onArmar}>
        Provocar erro
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  grade: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[3],
  },
  amostra: {
    width: 96,
    gap: Spacing[1],
  },
  cor: {
    height: 40,
    borderWidth: 1,
    borderRadius: Radius.md,
  },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing[2],
  },
  linhaQuebra: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
  },
  flex: {
    flex: 1,
  },
  caixaErro: {
    height: 420,
    overflow: 'hidden',
  },
  bomba: {
    padding: Spacing[4],
    alignItems: 'flex-start',
  },
});
