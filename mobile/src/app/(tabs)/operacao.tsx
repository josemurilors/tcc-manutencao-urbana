/**
 * Operação — a mesa de trabalho da equipe da prefeitura (operador+), separada
 * do mapa do cidadão de propósito: aqui não se reporta nada; o que existe é a
 * **fila** e o atendimento.
 *
 * - A fila vem paginada do servidor (`operacao/fila/`, contrato v3 §7.1),
 *   sempre do município do usuário — a operação nunca mistura cidades.
 * - No topo, o resumo (meus, vencidos, vencem em 24 h, sem responsável,
 *   sinalizados) funciona como atalho de filtro; abaixo, busca, ordenação
 *   (prioridade/prazo/distância...) e filtros.
 * - Cartões com SLA restante colorido, score, apoios e sinalizações. Toque abre
 *   a ficha de atendimento. Ação em lote: botão "Selecionar" (funciona no web,
 *   onde não há toque longo) ou toque longo no cartão.
 * - Visão de mapa com o **roteiro do dia**, que sobrevive a fechar o app.
 * - **Offline**: sem rede, a tela mostra a última fila salva e as ações vão
 *   para uma fila idempotente que sincroniza depois (faixa de pendências).
 *   A drenagem é global (`OperacaoSyncProvider` no layout raiz): segue
 *   funcionando com o app em outra aba.
 */

import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChamadoCard } from '@/components/operacao/chamado-card';
import { FiltrosFilaBar } from '@/components/operacao/filtros-fila';
import { LoteBarra, type EfeitoLote } from '@/components/operacao/lote-barra';
import { MapaOperacao } from '@/components/operacao/mapa-operacao';
import { FaixaOffline } from '@/components/operacao/pendencias';
import { ehGestor, identificador, MOTIVOS_PULO, nomeCategoria } from '@/components/operacao/regras';
import { atalhoAtivo, filtrosDoAtalho, ResumoFilaBar } from '@/components/operacao/resumo-fila';
import { useCatalogos } from '@/components/operacao/use-catalogos';
import { FILTROS_PADRAO, useFila } from '@/components/operacao/use-fila';
import { OperacaoSheet } from '@/components/operacao-sheet';
import type { Roteiro } from '@/components/roteiro-panel';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StateView } from '@/components/ui/state-view';
import { AppText } from '@/components/ui/text';
import { statusFechado } from '@/constants/status';
import { Layout, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useSyncOperacao } from '@/context/offline-sync-context';
import { useColors } from '@/context/theme-context';
import { useToast } from '@/context/toast-context';
import { useLocalizacao } from '@/hooks/use-localizacao';
import { exigeFotoAoConcluir } from '@/services/api-operacao';
import {
  executarOuEnfileirar,
  lerRoteiro,
  salvarRoteiro,
  type MotivoPulo,
} from '@/services/operacao-offline';
import type { ChamadoFila } from '@/types/operacao';

type Visao = 'lista' | 'mapa';

/** No mapa a fila carrega mais páginas sozinha, até este total de pinos. */
const LIMITE_MAPA = 100;

/** Algum recorte além da ordenação? (o estado vazio oferece "Limpar filtros") */
function temFiltro(f: typeof FILTROS_PADRAO) {
  return !!(
    f.status ||
    f.categoria_id != null ||
    f.equipe_id != null ||
    (f.atribuicao && f.atribuicao !== 'todos') ||
    f.vencidos ||
    f.vencem_24h ||
    f.sinalizados ||
    f.bairro ||
    f.q?.trim()
  );
}

/**
 * Recalcula o progresso do roteiro: parada fechada ou pulada conta como
 * feita, e a atual é a primeira que sobrou.
 */
function progresso(r: Roteiro): Roteiro {
  const feitas = new Set(r.concluidas);
  for (const p of r.paradas) if (statusFechado(p.status)) feitas.add(String(p.id));
  for (const id of Object.keys(r.puladas)) feitas.add(id);
  let atual = r.paradas.findIndex((p) => !feitas.has(String(p.id)));
  if (atual < 0) atual = r.paradas.length;
  return { ...r, concluidas: [...feitas], atual };
}

export default function OperacaoScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { user } = useAuth();
  const { posicao, bussola, permitido, erro: erroGps, tentarNovamente } = useLocalizacao();

  const meuId = user?.id != null ? String(user.id) : null;
  const gestor = ehGestor(user);

  const fila = useFila(posicao);
  const catalogos = useCatalogos();
  const { carregar: carregarFila, recarregarResumo, atualizarItem, carregarMais } = fila;
  const sync = useSyncOperacao();
  const { aoEnviar } = sync;
  // O que estava na fila offline chegou ao servidor: a fila na tela recarrega.
  useEffect(() => aoEnviar(() => carregarFila()), [aoEnviar, carregarFila]);

  const [visao, setVisao] = useState<Visao>('lista');
  const [aberto, setAberto] = useState<ChamadoFila | null>(null);
  const [selecao, setSelecao] = useState<Set<string>>(new Set());
  // Modo seleção ligado pelo botão "Selecionar" (no web não há toque longo).
  // Com algo marcado a seleção está ativa de qualquer jeito.
  const [modoSelecao, setModoSelecao] = useState(false);
  const selecionando = modoSelecao || selecao.size > 0;
  const [roteiro, setRoteiro] = useState<Roteiro | null>(null);

  // No mapa, a primeira página (20) não basta para montar um roteiro: busca
  // mais páginas em sequência até `LIMITE_MAPA`, parando em erro ou no cache.
  const precisaMaisNoMapa =
    visao === 'mapa' &&
    !!fila.next &&
    !fila.carregandoMais &&
    !fila.cacheDe &&
    !fila.erro &&
    fila.itens.length < LIMITE_MAPA;
  useEffect(() => {
    if (precisaMaisNoMapa) carregarMais();
  }, [precisaMaisNoMapa, carregarMais, fila.itens.length]);

  // A fila já carrega ao montar; ao voltar para a aba, recarrega.
  const primeiroFoco = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (primeiroFoco.current) {
        primeiroFoco.current = false;
        return;
      }
      carregarFila();
    }, [carregarFila]),
  );

  // Roteiro do dia salvo no aparelho (sobrevive a fechar o app). Só depois de
  // lido é que mudanças passam a ser gravadas — senão o `null` inicial apagaria
  // o roteiro salvo antes de ele ser carregado.
  const roteiroLido = useRef(false);
  useEffect(() => {
    let vivo = true;
    lerRoteiro(meuId)
      .then((r) => {
        if (vivo && r) setRoteiro(progresso(r));
      })
      .catch((err) => {
        if (__DEV__) console.warn('[operacao] roteiro salvo ilegível', err);
      })
      .finally(() => {
        roteiroLido.current = true;
      });
    return () => {
      vivo = false;
    };
  }, [meuId]);

  useEffect(() => {
    if (!roteiroLido.current) return;
    salvarRoteiro(roteiro).catch((err) => {
      // O roteiro segue na tela; só não sobreviveria a fechar o app.
      if (__DEV__) console.warn('[operacao] roteiro não salvo', err);
    });
  }, [roteiro]);

  const mudarRoteiro = useCallback((fn: (r: Roteiro | null) => Roteiro | null) => {
    setRoteiro((atual) => {
      const novo = fn(atual);
      return novo ? progresso(novo) : null;
    });
  }, []);

  // A fila recarregada traz o status novo das paradas (ex.: outro servidor concluiu).
  useEffect(() => {
    if (fila.itens.length === 0) return;
    const porId = new Map(fila.itens.map((c) => [String(c.id), c]));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sincroniza o roteiro com dado externo
    setRoteiro((r) => {
      if (!r || !r.paradas.some((p) => porId.has(String(p.id)))) return r;
      return progresso({ ...r, paradas: r.paradas.map((p) => porId.get(String(p.id)) ?? p) });
    });
  }, [fila.itens]);

  /** Novo estado de um chamado: fila, ficha aberta e roteiro andam juntos. */
  const aoAtualizar = useCallback(
    (id: ChamadoFila['id'], patch: Partial<ChamadoFila>) => {
      atualizarItem(id, patch);
      setAberto((a) => (a && String(a.id) === String(id) ? { ...a, ...patch } : a));
      mudarRoteiro((r) =>
        r ? { ...r, paradas: r.paradas.map((p) => (String(p.id) === String(id) ? { ...p, ...patch } : p)) } : r,
      );
      recarregarResumo();
    },
    [atualizarItem, mudarRoteiro, recarregarResumo],
  );

  const alternarSelecao = useCallback((c: ChamadoFila) => {
    setSelecao((prev) => {
      const next = new Set(prev);
      const id = String(c.id);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const tocar = useCallback(
    (c: ChamadoFila) => {
      if (selecionando) alternarSelecao(c);
      else setAberto(c);
    },
    [selecionando, alternarSelecao],
  );

  const sairDaSelecao = useCallback(() => {
    setSelecao(new Set());
    setModoSelecao(false);
  }, []);

  // Trocar para o mapa encerra a seleção (a barra de lote é só da lista).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reação à troca de visão
    if (visao !== 'lista') sairDaSelecao();
  }, [visao, sairDaSelecao]);

  function aposLote(e: EfeitoLote) {
    e.ids.forEach((id) => {
      const c = fila.itens.find((x) => String(x.id) === id);
      if (c) atualizarItem(c.id, e.patch);
    });
    // Ficam selecionados só os que falharam, para a pessoa ver e decidir.
    const restantes = [...selecao].filter((id) => !e.ids.includes(id));
    setSelecao(new Set(restantes));
    if (restantes.length === 0) setModoSelecao(false);
    recarregarResumo();
  }

  function pular(motivo: MotivoPulo) {
    const parada = roteiro?.paradas[roteiro.atual];
    if (!parada) return;
    mudarRoteiro((r) => (r ? { ...r, puladas: { ...r.puladas, [String(parada.id)]: motivo } } : r));
    // O que a equipe viu no local vira registro para a gestão.
    if (motivo === 'ja_resolvido' || motivo === 'nao_localizado') {
      const rotulo = MOTIVOS_PULO.find((m) => m.value === motivo)?.label ?? motivo;
      executarOuEnfileirar(
        { tipo: 'nota', defeito_id: parada.id, texto: `Roteiro do dia: parada pulada — ${rotulo.toLowerCase()}.` },
        `Nota do roteiro · ${identificador(parada)}`,
      ).catch((err) => {
        toast.error(`Parada pulada, mas a nota não foi registrada: ${err instanceof Error ? err.message : 'erro'}`);
      });
    }
  }

  function encerrar() {
    if (!roteiro) return;
    const puladas = Object.keys(roteiro.puladas).length;
    const feitas = roteiro.concluidas.length - puladas;
    mudarRoteiro(() => null);
    toast.info(`Roteiro encerrado: ${feitas} atendida${feitas === 1 ? '' : 's'}, ${puladas} pulada${puladas === 1 ? '' : 's'}.`);
  }

  const selecionados = useMemo(
    () => fila.itens.filter((c) => selecao.has(String(c.id))),
    [fila.itens, selecao],
  );
  const visiveis = fila.estado === 'pronto' ? fila.itens : [];
  const todosMarcados = visiveis.length > 0 && visiveis.every((c) => selecao.has(String(c.id)));
  const exigirFoto = exigeFotoAoConcluir(fila.resumo);
  const ativo = atalhoAtivo(fila.filtros);
  const proximaParada = roteiro?.paradas[roteiro.atual];

  const cabecalho = (
    <View style={[styles.topo, { paddingTop: insets.top + Spacing[2] }]}>
      <View style={styles.tituloLinha}>
        <View style={styles.flex}>
          <AppText variant="headline" accessibilityRole="header">
            Operação
          </AppText>
          <AppText variant="caption" tone="secondary" numberOfLines={1}>
            {user?.municipio ? `${user.municipio.nome}/${user.municipio.uf_sigla}` : 'Fila do seu município'}
          </AppText>
        </View>
        <SegmentedControl<Visao>
          accessibilityLabel="Ver a fila como"
          options={[
            { value: 'lista', label: 'Lista', icon: 'list' },
            { value: 'mapa', label: 'Mapa', icon: 'map' },
          ]}
          value={visao}
          onChange={setVisao}
          style={styles.visao}
        />
      </View>
      <FaixaOffline cacheDe={fila.cacheDe} />
    </View>
  );

  const cabecalhoLista = (
    <View style={styles.cabecalhoLista}>
      <ResumoFilaBar
        resumo={fila.resumo}
        ativo={ativo}
        onEscolher={(a) => fila.setFiltros((f) => filtrosDoAtalho(f, a))}
      />
      <FiltrosFilaBar
        // Remonta quando busca/bairro mudam por fora (ex.: "Limpar filtros"), para o campo não ficar com texto velho.
        key={`${fila.filtros.q ?? ''}|${fila.filtros.bairro ?? ''}`}
        filtros={fila.filtros}
        onChange={fila.setFiltros}
        categorias={catalogos.categorias}
        equipes={catalogos.equipes}
        temPosicao={!!posicao}
        gestor={gestor}
      />
      {roteiro && proximaParada ? (
        <Card
          variant="filled"
          padding={Spacing[3]}
          onPress={() => setVisao('mapa')}
          accessibilityLabel={`Roteiro do dia: ${roteiro.concluidas.length} de ${roteiro.paradas.length}. Próxima parada ${nomeCategoria(proximaParada)}. Abrir no mapa`}
          style={styles.margem}>
          <View style={styles.linha}>
            <Ionicons name="navigate" size={18} color={colors.primaryText} />
            <View style={styles.flex}>
              <AppText variant="label">
                Roteiro do dia · {roteiro.concluidas.length}/{roteiro.paradas.length}
              </AppText>
              <AppText variant="caption" tone="secondary" numberOfLines={1}>
                Próxima: {nomeCategoria(proximaParada)}
                {proximaParada.rua ? ` · ${proximaParada.rua}` : ''}
              </AppText>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </View>
        </Card>
      ) : null}
      <View style={[styles.linha, styles.margem]}>
        <AppText variant="caption" tone="muted" style={styles.flex}>
          {fila.count === 1 ? '1 chamado' : `${fila.count} chamados`}
          {selecionando ? ` · ${selecao.size} ${selecao.size === 1 ? 'marcado' : 'marcados'}` : ''}
        </AppText>
        {selecionando ? (
          <>
            {visiveis.length > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                onPress={() =>
                  setSelecao(todosMarcados ? new Set() : new Set(visiveis.map((c) => String(c.id))))
                }
                accessibilityHint="Marca ou desmarca os chamados carregados na lista">
                {todosMarcados ? 'Desmarcar todos' : 'Marcar todos'}
              </Button>
            ) : null}
            <Button size="sm" variant="secondary" onPress={sairDaSelecao}>
              Cancelar
            </Button>
          </>
        ) : visiveis.length > 0 ? (
          <Button
            size="sm"
            variant="secondary"
            onPress={() => setModoSelecao(true)}
            accessibilityHint="Liga a seleção de vários chamados para agir em lote"
            icon={<Ionicons name="checkbox-outline" size={16} color={colors.textPrimary} />}>
            Selecionar
          </Button>
        ) : null}
      </View>
    </View>
  );

  function corpoVazio() {
    if (fila.estado === 'carregando') return <StateView kind="loading" title="Carregando a fila" />;
    if (fila.estado === 'offline') {
      return (
        <StateView
          kind="offline"
          description="Sem conexão e nenhuma fila salva neste aparelho ainda. Assim que houver rede, ela fica guardada para uso offline."
          onRetry={() => carregarFila()}
        />
      );
    }
    if (fila.estado === 'erro') {
      return (
        <StateView
          kind="error"
          title="Não foi possível carregar a fila"
          description={fila.erro ?? undefined}
          onRetry={() => carregarFila()}
        />
      );
    }
    const filtrando = temFiltro(fila.filtros);
    return (
      <StateView
        kind="empty"
        icon={filtrando ? 'filter' : 'checkmark-done-circle'}
        title={filtrando ? 'Nada com esses filtros' : 'Fila zerada'}
        description={filtrando ? 'Tente outro recorte ou limpe os filtros.' : 'Nenhum chamado aberto na sua cidade agora.'}
        action={filtrando ? { label: 'Limpar filtros', onPress: () => fila.setFiltros(() => FILTROS_PADRAO) } : undefined}
      />
    );
  }

  if (fila.estado === 'bloqueado') {
    return (
      <View style={[styles.raiz, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
        <StateView
          kind="empty"
          icon="business-outline"
          title="Sem município de operação"
          description={`Você só opera chamados da cidade a que está vinculado. Peça a um administrador para vincular seu usuário a um município. Como cidadão, você continua podendo reportar pela aba Mapa.${fila.erro ? `\n\n${fila.erro}` : ''}`}
          action={{ label: 'Verificar de novo', onPress: () => carregarFila() }}
        />
      </View>
    );
  }

  return (
    <View style={[styles.raiz, { backgroundColor: colors.bg }]}>
      {cabecalho}

      {visao === 'lista' ? (
        <FlatList
          data={visiveis}
          keyExtractor={(c) => String(c.id)}
          extraData={[selecao, selecionando, sync.idsPendentes]}
          ListHeaderComponent={cabecalhoLista}
          ListEmptyComponent={corpoVazio()}
          contentContainerStyle={[styles.lista, { paddingBottom: Spacing[6] + (selecao.size > 0 ? 160 : 0) }]}
          style={fila.buscando ? styles.esmaecida : undefined}
          renderItem={({ item }) => (
            <View style={styles.margem}>
              <ChamadoCard
                chamado={item}
                icone={catalogos.icones.get(nomeCategoria(item))}
                meuId={meuId}
                pendente={sync.idsPendentes.has(String(item.id))}
                modoSelecao={selecionando}
                selecionado={selecao.has(String(item.id))}
                onPress={tocar}
                onLongPress={alternarSelecao}
              />
            </View>
          )}
          refreshControl={
            <RefreshControl
              refreshing={fila.atualizando}
              onRefresh={() => {
                fila.puxar();
                sync.sincronizar(true);
              }}
              tintColor={colors.primaryText}
              colors={[colors.primary]}
            />
          }
          onEndReachedThreshold={0.4}
          onEndReached={() => fila.carregarMais()}
          ListFooterComponent={
            fila.carregandoMais ? (
              <StateView kind="loading" skeleton={1} title="Carregando mais" />
            ) : fila.next && fila.erro ? (
              <View style={styles.rodapeLista}>
                <Button variant="secondary" onPress={() => fila.carregarMais()}>
                  Carregar mais
                </Button>
              </View>
            ) : null
          }
        />
      ) : (
        <MapaOperacao
          itens={fila.itens}
          roteiro={roteiro}
          icones={catalogos.icones}
          posicao={posicao}
          bussola={bussola}
          erroGps={erroGps}
          permitidoGps={permitido}
          tentarGps={tentarNovamente}
          meuId={meuId}
          selecionadoId={aberto ? String(aberto.id) : null}
          pendentes={sync.idsPendentes}
          rodape={Spacing[4]}
          onAbrir={setAberto}
          onRoteiro={(r) => mudarRoteiro(() => r)}
          onPular={pular}
          onEncerrar={encerrar}
        />
      )}

      {visao === 'lista' && selecionados.length > 0 ? (
        <LoteBarra
          selecionados={selecionados}
          meuId={meuId}
          gestor={gestor}
          equipes={catalogos.equipes}
          onRecarregarEquipes={catalogos.recarregar}
          exigirFoto={exigirFoto}
          onLimpar={sairDaSelecao}
          onAplicado={aposLote}
        />
      ) : null}

      <OperacaoSheet
        chamado={aberto}
        catalogos={catalogos}
        pendente={aberto ? sync.idsPendentes.has(String(aberto.id)) : false}
        exigirFoto={exigirFoto}
        origem={posicao}
        onClose={() => setAberto(null)}
        onAtualizado={aoAtualizar}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  raiz: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  topo: {
    gap: Spacing[2],
    paddingBottom: Spacing[2],
  },
  tituloLinha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    paddingHorizontal: Layout.gutter,
  },
  visao: {
    width: 188,
  },
  cabecalhoLista: {
    gap: Spacing[3],
    paddingBottom: Spacing[2],
  },
  lista: {
    gap: Spacing[2],
  },
  margem: {
    marginHorizontal: Layout.gutter,
  },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
  esmaecida: {
    opacity: 0.6,
  },
  rodapeLista: {
    alignItems: 'center',
    padding: Spacing[4],
  },
});
