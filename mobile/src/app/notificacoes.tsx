/**
 * Central de notificações: o que aconteceu com os chamados da pessoa (e com
 * os que ela apoiou), do mais recente para o mais antigo.
 *
 * Não lidas vêm em destaque com fundo, selo "Nova" (texto + ícone, não só
 * cor) e são anunciadas como "Não lida" ao leitor de tela. Tocar marca como
 * lida e abre o chamado. Paginação infinita, puxar para atualizar e "Marcar
 * todas como lidas". O selo do sino é atualizado junto (`use-nao-lidas`).
 */

import { Ionicons } from '@expo/vector-icons';
import { Redirect, router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { ListItem } from '@/components/ui/list-item';
import { StateView } from '@/components/ui/state-view';
import { AppText } from '@/components/ui/text';
import { corDoTom, Layout, Radius, Spacing, type Tom } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useOfflineSyncContext } from '@/context/offline-sync-context';
import { useColors } from '@/context/theme-context';
import { useToast, useToastOffset } from '@/context/toast-context';
import { decrementarNaoLidas, definirNaoLidas, recarregarNaoLidas } from '@/hooks/use-nao-lidas';
import { rotaDoChamado } from '@/hooks/use-push';
import { notificacoesApi } from '@/services/api-notificacoes';
import type { Notificacao, PaginaNotificacoes } from '@/types/notificacoes';
import { mensagemDeErro } from '@/utils/erro';

type IconName = keyof typeof Ionicons.glyphMap;

/** Ícone e tom por tipo — o ícone carrega o sentido, a cor só reforça. */
const VISUAL_DO_TIPO: Record<string, { icone: IconName; tom: Tom }> = {
  status: { icone: 'sync', tom: 'info' },
  resposta: { icone: 'chatbubble-ellipses', tom: 'primary' },
  avaliar: { icone: 'star', tom: 'warning' },
  apoio_marco: { icone: 'people', tom: 'success' },
  sla_alerta: { icone: 'alarm', tom: 'danger' },
  atribuido: { icone: 'person-add', tom: 'info' },
  moderacao: { icone: 'shield-checkmark', tom: 'neutral' },
};
const VISUAL_PADRAO = { icone: 'notifications' as IconName, tom: 'neutral' as Tom };

/** "agora", "há 5 min", "há 2 h", "ontem", "há 3 dias" ou a data. */
function tempoRelativo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.floor(horas / 24);
  if (dias === 1) return 'ontem';
  if (dias < 7) return `há ${dias} dias`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

type Estado = 'carregando' | 'pronto' | 'erro';

export default function NotificacoesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { isAuthenticated } = useAuth();
  const { online } = useOfflineSyncContext();
  useToastOffset(Spacing[4]);

  const [itens, setItens] = useState<Notificacao[]>([]);
  const [estado, setEstado] = useState<Estado>('carregando');
  const [mensagemErro, setMensagemErro] = useState('');
  const [proximaPagina, setProximaPagina] = useState<number | null>(null);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [atualizando, setAtualizando] = useState(false);
  const [marcandoTodas, setMarcandoTodas] = useState(false);
  // Evita duas páginas iguais quando o onEndReached dispara em rajada.
  const buscandoPagina = useRef(false);

  const aplicarPrimeira = useCallback((pagina: PaginaNotificacoes) => {
    setItens(pagina.results);
    setProximaPagina(pagina.next ? 2 : null);
    setEstado('pronto');
    // A lista é a fonte mais fresca: o sino acompanha.
    recarregarNaoLidas().catch((err) => console.warn('[notificações] contador', err));
  }, []);

  const carregarPrimeira = useCallback(
    () => notificacoesApi.listar(1).then(aplicarPrimeira),
    [aplicarPrimeira],
  );

  const falhou = useCallback((err: unknown) => {
    setMensagemErro(
      mensagemDeErro(err, 'O servidor não respondeu como esperado. Tente de novo em instantes.'),
    );
    console.warn('[notificações] lista', err);
    setEstado('erro');
  }, []);

  function tentar() {
    setEstado('carregando');
    carregarPrimeira().catch(falhou);
  }

  // Primeira carga: o estado já nasce "carregando".
  useEffect(() => {
    if (isAuthenticated) notificacoesApi.listar(1).then(aplicarPrimeira).catch(falhou);
  }, [isAuthenticated, aplicarPrimeira, falhou]);

  if (!isAuthenticated) {
    return <Redirect href="/(tabs)/conta" />;
  }

  async function atualizar() {
    setAtualizando(true);
    try {
      await carregarPrimeira();
    } catch (err) {
      toast.error(
        'Não foi possível atualizar as notificações. ' + mensagemDeErro(err, 'Tente de novo.'),
      );
    } finally {
      setAtualizando(false);
    }
  }

  async function carregarMais() {
    if (!proximaPagina || buscandoPagina.current) return;
    buscandoPagina.current = true;
    setCarregandoMais(true);
    try {
      const pagina = await notificacoesApi.listar(proximaPagina);
      setItens((prev) => {
        const vistos = new Set(prev.map((n) => n.id));
        return [...prev, ...pagina.results.filter((n) => !vistos.has(n.id))];
      });
      setProximaPagina(pagina.next ? proximaPagina + 1 : null);
    } catch (err) {
      toast.error('Não foi possível carregar mais notificações.', {
        action: { label: 'Tentar de novo', onPress: carregarMais },
      });
      console.warn('[notificações] página', proximaPagina, err);
    } finally {
      buscandoPagina.current = false;
      setCarregandoMais(false);
    }
  }

  async function abrir(n: Notificacao) {
    if (!n.lida_em) {
      const agora = new Date().toISOString();
      setItens((prev) => prev.map((x) => (x.id === n.id ? { ...x, lida_em: agora } : x)));
      decrementarNaoLidas();
      notificacoesApi.marcarLida(n.id).catch((err) => {
        // Volta a "não lida" para a tela não mentir sobre o servidor.
        setItens((prev) => prev.map((x) => (x.id === n.id ? { ...x, lida_em: null } : x)));
        recarregarNaoLidas().catch(() => definirNaoLidas(null));
        console.warn('[notificações] marcar lida', err);
      });
    }
    if (n.defeito_id !== null && n.defeito_id !== undefined && n.defeito_id !== '') {
      router.push(rotaDoChamado(n.defeito_id));
    }
  }

  async function marcarTodas() {
    setMarcandoTodas(true);
    const antes = itens;
    const agora = new Date().toISOString();
    setItens((prev) => prev.map((n) => (n.lida_em ? n : { ...n, lida_em: agora })));
    try {
      await notificacoesApi.marcarTodasLidas();
      definirNaoLidas(0);
      toast.success('Tudo marcado como lido.');
    } catch (err) {
      setItens(antes);
      toast.error('Não foi possível marcar como lidas. ' + mensagemDeErro(err, 'Tente de novo.'));
    } finally {
      setMarcandoTodas(false);
    }
  }

  function voltar() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/mapa');
  }

  const temNaoLidas = itens.some((n) => !n.lida_em);

  const cabecalho = (
    <View style={[styles.cabecalho, { paddingTop: insets.top + Spacing[2] }]}>
      <IconButton icon="arrow-back" accessibilityLabel="Voltar" onPress={voltar} />
      <AppText variant="title" accessibilityRole="header" style={styles.titulo}>
        Notificações
      </AppText>
      {estado === 'pronto' && temNaoLidas ? (
        <Button
          size="sm"
          variant="ghost"
          onPress={marcarTodas}
          loading={marcandoTodas}
          accessibilityLabel="Marcar todas as notificações como lidas"
          icon={<Ionicons name="checkmark-done" size={16} color={colors.textSecondary} />}>
          Marcar todas
        </Button>
      ) : null}
    </View>
  );

  function renderItem({ item: n }: { item: Notificacao }) {
    const visual = VISUAL_DO_TIPO[n.tipo] ?? VISUAL_PADRAO;
    const cor = corDoTom(colors, visual.tom);
    const naoLida = !n.lida_em;
    const quando = tempoRelativo(n.criado_em);
    const temChamado = n.defeito_id !== null && n.defeito_id !== undefined && n.defeito_id !== '';
    return (
      <ListItem
        title={n.titulo}
        subtitle={n.corpo || undefined}
        meta={quando}
        leading={
          <View style={[styles.icone, { backgroundColor: cor.bg }]}>
            <Ionicons name={visual.icone} size={20} color={cor.fg} />
          </View>
        }
        trailing={
          naoLida ? (
            <Badge label="Nova" tone="primary" icon="ellipse" />
          ) : temChamado ? (
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          ) : (
            <View />
          )
        }
        onPress={() => abrir(n)}
        accessibilityLabel={[naoLida ? 'Não lida' : null, n.titulo, n.corpo, quando]
          .filter(Boolean)
          .join('. ')}
        accessibilityHint={temChamado ? 'Abre o chamado' : 'Marca como lida'}
        style={[
          styles.item,
          naoLida && { backgroundColor: colors.primarySubtle, borderColor: colors.primary },
        ]}
      />
    );
  }

  let corpo: React.ReactNode;
  if (estado === 'carregando') {
    corpo = <StateView kind="loading" title="Carregando notificações" skeleton={5} />;
  } else if (estado === 'erro') {
    corpo = (
      <StateView
        kind={online ? 'error' : 'offline'}
        title={online ? 'Não foi possível carregar suas notificações' : undefined}
        description={online ? mensagemErro || undefined : undefined}
        onRetry={tentar}
      />
    );
  } else {
    corpo = (
      <FlatList
        data={itens}
        keyExtractor={(n) => String(n.id)}
        renderItem={renderItem}
        contentContainerStyle={[
          styles.lista,
          { paddingBottom: insets.bottom + Spacing[8] },
          itens.length === 0 && styles.listaVazia,
        ]}
        ItemSeparatorComponent={() => <View style={{ height: Spacing[2] }} />}
        onEndReached={carregarMais}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={atualizando}
            onRefresh={atualizar}
            tintColor={colors.primaryText}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          <StateView
            kind="empty"
            icon="notifications-off-outline"
            title="Tudo em dia"
            description="Quando a prefeitura atualizar um chamado seu ou que você apoiou, o aviso aparece aqui."
          />
        }
        ListFooterComponent={
          carregandoMais ? (
            <ActivityIndicator
              style={styles.rodape}
              color={colors.primaryText}
              accessibilityLabel="Carregando mais notificações"
            />
          ) : null
        }
      />
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      {cabecalho}
      {corpo}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  cabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    paddingHorizontal: Spacing[2],
    paddingBottom: Spacing[2],
  },
  titulo: {
    flex: 1,
  },
  lista: {
    paddingHorizontal: Layout.gutter,
    paddingTop: Spacing[2],
  },
  listaVazia: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  item: {
    paddingHorizontal: Spacing[3],
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: Radius.lg,
  },
  icone: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rodape: {
    paddingVertical: Spacing[4],
  },
});
