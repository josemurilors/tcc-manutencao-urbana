/**
 * Meus chamados — tudo que o usuário reportou, com o que ele quer saber de
 * relance: em que pé está, até quando a prefeitura tem para resolver (ou se
 * atrasou) e se falta avaliar um atendimento. O toque abre a página do
 * chamado (`/chamado/[id]`), com histórico, resposta, avaliação e reabertura.
 */

import { Ionicons } from '@expo/vector-icons';
import { Redirect, router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { aguardaAvaliacao } from '@/components/chamado/avaliacao';
import { dataCurta, lerPrazo } from '@/components/chamado/prazo';
import { StatusChamado } from '@/components/chamado/status-chamado';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StateView } from '@/components/ui/state-view';
import { SubScreen } from '@/components/ui/sub-screen';
import { AppText } from '@/components/ui/text';
import { normalizarStatus, statusAberto } from '@/constants/status';
import { corDoTom, Layout, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useColors } from '@/context/theme-context';
import { apiCidadao } from '@/services/api-cidadao';
import type { Defeito } from '@/types';
import type { FiltroMeusChamados } from '@/types/cidadao';
import { totalApoios } from '@/utils/format';

type Estado =
  | { tipo: 'carregando' }
  | { tipo: 'ok'; defeitos: Defeito[] }
  | { tipo: 'erro'; offline: boolean; mensagem: string };

function filtrar(defeitos: Defeito[], filtro: FiltroMeusChamados) {
  if (filtro === 'abertos') return defeitos.filter((d) => statusAberto(d.status));
  if (filtro === 'resolvidos') return defeitos.filter((d) => normalizarStatus(d.status) === 'concluido');
  return defeitos;
}

export default function MeusChamadosScreen() {
  const colors = useColors();
  const { isAuthenticated } = useAuth();
  const [estado, setEstado] = useState<Estado>({ tipo: 'carregando' });
  const [filtro, setFiltro] = useState<FiltroMeusChamados>('abertos');
  const filtroEscolhido = useRef(false);

  const carregar = useCallback(() => {
    let cancelado = false;
    apiCidadao
      .meusChamados()
      .then((defeitos) => {
        if (cancelado) return;
        setEstado({ tipo: 'ok', defeitos });
        // Sem nada aberto, abre direto em "Todos" para a tela não nascer vazia.
        if (!filtroEscolhido.current && !defeitos.some((d) => statusAberto(d.status))) {
          setFiltro('todos');
        }
      })
      .catch((err: unknown) => {
        if (cancelado) return;
        const mensagem = err instanceof Error ? err.message : 'Erro ao carregar';
        setEstado({
          tipo: 'erro',
          offline: /network request failed|failed to fetch|networkerror/i.test(mensagem),
          mensagem,
        });
      });
    return () => {
      cancelado = true;
    };
  }, []);

  // Recarrega ao voltar da página do chamado (avaliou, reabriu, apoiou...).
  useFocusEffect(
    useCallback(() => {
      if (!isAuthenticated) return;
      return carregar();
    }, [carregar, isAuthenticated]),
  );

  const defeitos = useMemo(() => (estado.tipo === 'ok' ? estado.defeitos : []), [estado]);
  const contagem = useMemo(
    () => ({
      abertos: filtrar(defeitos, 'abertos').length,
      resolvidos: filtrar(defeitos, 'resolvidos').length,
      todos: defeitos.length,
    }),
    [defeitos],
  );
  const avaliar = defeitos.filter(aguardaAvaliacao).length;
  const visiveis = filtrar(defeitos, filtro);

  if (!isAuthenticated) {
    return <Redirect href="/(tabs)/conta" />;
  }

  function escolher(f: FiltroMeusChamados) {
    filtroEscolhido.current = true;
    setFiltro(f);
  }

  return (
    <SubScreen title="Meus chamados" fallback="/(tabs)/conta">
      <View style={styles.topo}>
        <SegmentedControl
          accessibilityLabel="Filtrar chamados"
          value={filtro}
          onChange={escolher}
          options={[
            { value: 'abertos', label: `Abertos (${contagem.abertos})` },
            { value: 'resolvidos', label: `Resolvidos (${contagem.resolvidos})` },
            { value: 'todos', label: `Todos (${contagem.todos})` },
          ]}
        />
        <Button
          variant="ghost"
          size="sm"
          onPress={() => router.push('/protocolo')}
          icon={<Ionicons name="search" size={16} color={colors.textSecondary} />}>
          Consultar por protocolo
        </Button>
      </View>

      {avaliar > 0 && estado.tipo === 'ok' ? (
        <AvisoAvaliar total={avaliar} onPress={() => escolher('resolvidos')} />
      ) : null}

      {estado.tipo === 'carregando' ? (
        <StateView kind="loading" title="Carregando seus chamados" />
      ) : estado.tipo === 'erro' ? (
        <StateView
          kind={estado.offline ? 'offline' : 'error'}
          description={estado.offline ? undefined : estado.mensagem}
          onRetry={() => {
            setEstado({ tipo: 'carregando' });
            carregar();
          }}
        />
      ) : defeitos.length === 0 ? (
        <StateView
          kind="empty"
          icon="megaphone-outline"
          title="Você ainda não abriu nenhum chamado"
          description="Viu um buraco, poste apagado ou entulho? Reporte pelo mapa com uma foto — leva menos de um minuto."
          action={{ label: 'Ir para o mapa', onPress: () => router.navigate('/(tabs)/mapa') }}
        />
      ) : visiveis.length === 0 ? (
        <StateView
          kind="empty"
          icon={filtro === 'abertos' ? 'checkmark-done-outline' : 'file-tray-outline'}
          title={filtro === 'abertos' ? 'Nenhum chamado em aberto' : 'Nenhum chamado resolvido ainda'}
          description={
            filtro === 'abertos'
              ? 'Tudo que você reportou já foi encerrado.'
              : 'Quando a prefeitura resolver, eles aparecem aqui para você avaliar.'
          }
          action={{ label: 'Ver todos', onPress: () => escolher('todos') }}
        />
      ) : (
        visiveis.map((d) => <ChamadoCard key={String(d.id)} defeito={d} />)
      )}
    </SubScreen>
  );
}

function AvisoAvaliar({ total, onPress }: { total: number; onPress: () => void }) {
  const colors = useColors();
  return (
    <Card variant="filled" onPress={onPress} accessibilityLabel={`${total} chamados resolvidos aguardam sua avaliação. Ver resolvidos`}>
      <View style={styles.linha}>
        <Ionicons name="star" size={18} color={colors.primaryText} />
        <AppText variant="bodySm" style={styles.flex}>
          {total === 1
            ? '1 chamado resolvido aguarda sua avaliação.'
            : `${total} chamados resolvidos aguardam sua avaliação.`}
        </AppText>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </View>
    </Card>
  );
}

function ChamadoCard({ defeito: d }: { defeito: Defeito }) {
  const colors = useColors();
  const prazo = lerPrazo(d);
  const tomPrazo = prazo ? corDoTom(colors, prazo.tom) : null;
  const local = [d.rua, d.bairro].filter(Boolean).join(' · ');
  const apoios = totalApoios(d);
  const avaliar = aguardaAvaliacao(d);
  const titulo = d.titulo || d.categoria_nome || d.categoria || 'Chamado';

  const resumo = [
    titulo,
    d.protocolo ? `protocolo ${d.protocolo}` : '',
    prazo?.titulo ?? '',
    avaliar ? 'aguarda sua avaliação' : '',
  ]
    .filter(Boolean)
    .join(', ');

  // "Ver no mapa" fica fora da área que abre a página: no web, cada Pressable
  // com papel de botão vira <button>, e botão não pode conter botão.
  return (
    <Card padding={0}>
      <Pressable
        onPress={() => router.push({ pathname: '/chamado/[id]', params: { id: String(d.id) } })}
        accessibilityRole="button"
        accessibilityLabel={resumo}
        accessibilityHint="Abre o andamento do chamado"
        style={({ pressed }) => [styles.area, pressed && { backgroundColor: colors.surfacePressed }]}>
        <View style={styles.linhaTopo}>
          <StatusChamado status={d.status} />
          {avaliar ? <Badge tone="primary" icon="star" label="Avaliar" /> : null}
          <View style={styles.flex} />
          <AppText variant="caption" tone="muted">
            {dataCurta(d.criado_em)}
          </AppText>
        </View>

        <AppText variant="label" numberOfLines={2}>
          {titulo}
        </AppText>
        {d.protocolo ? (
          <AppText variant="caption" tone="muted">
            Protocolo {d.protocolo}
          </AppText>
        ) : null}
        {local ? (
          <AppText variant="bodySm" tone="secondary" numberOfLines={1}>
            {local}
          </AppText>
        ) : null}

        {prazo && tomPrazo ? (
          <View style={styles.linha}>
            <Ionicons
              name={prazo.atrasado ? 'alert-circle' : prazo.tom === 'success' ? 'checkmark-circle' : 'time-outline'}
              size={16}
              color={tomPrazo.fg}
            />
            <AppText variant="caption" weight="600" style={{ color: tomPrazo.fg }}>
              {prazo.titulo}
            </AppText>
            {prazo.detalhe ? (
              <AppText variant="caption" tone="muted" numberOfLines={1} style={styles.flex}>
                · {prazo.detalhe}
              </AppText>
            ) : null}
          </View>
        ) : null}
      </Pressable>

      <View style={[styles.rodape, { borderTopColor: colors.border }]}>
        <View style={styles.linha}>
          <Ionicons name="people-outline" size={14} color={colors.textMuted} />
          <AppText variant="caption" tone="muted">
            {apoios === 0 ? 'Sem apoios ainda' : `${apoios} ${apoios === 1 ? 'apoio' : 'apoios'}`}
          </AppText>
        </View>
        <Pressable
          onPress={() => router.navigate({ pathname: '/(tabs)/mapa', params: { abrir: String(d.id) } })}
          accessibilityRole="button"
          accessibilityLabel={`Ver ${titulo} no mapa`}
          style={styles.verNoMapa}>
          <Ionicons name="map-outline" size={16} color={colors.primaryText} />
          <AppText variant="label" tone="brand" inControl>
            Ver no mapa
          </AppText>
        </Pressable>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  topo: {
    gap: Spacing[2],
  },
  area: {
    padding: Spacing[4],
    gap: Spacing[1.5],
  },
  linhaTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing[2],
    marginBottom: Spacing[1],
  },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[1.5],
  },
  flex: {
    flex: 1,
  },
  rodape: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[4],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  verNoMapa: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[1],
    minHeight: Layout.minTouch,
    paddingHorizontal: Spacing[1],
  },
});
