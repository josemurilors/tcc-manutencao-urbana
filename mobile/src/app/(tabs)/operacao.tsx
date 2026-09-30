/**
 * Mapa de operação — a mesa de trabalho do operador (admin), separada do mapa
 * do cidadão de propósito: aqui não se reporta nem se confirma nada; o que
 * existe é a **fila** de chamados e o fluxo assumir → responder → finalizar.
 *
 * A fila é a do **município a que o operador está vinculado** (o backend
 * recorta em `/defeitos/operacao/` e recusa assumir fora dele). Sem vínculo,
 * a tela explica em vez de mostrar o mapa. Como cidadão, na aba Mapa, a mesma
 * pessoa continua livre para reportar em qualquer cidade.
 *
 * - Sem filtros para aprender: se o operador já assumiu chamados, a tela
 *   mostra **só os dele**; se não assumiu nenhum, mostra **todos os abertos**
 *   da cidade. Um botão lateral (pessoa/pessoas) alterna entre as duas
 *   visões — separado do cabeçalho do painel para não ser acionado sem querer
 *   ao recolher a lista.
 * - O mapa mostra os pinos coloridos por status; o painel inferior lista os
 *   mesmos chamados, mais perto primeiro (ou mais antigo, sem GPS), com
 *   alerta de SLA vencido.
 * - Enquadrar ajusta o zoom para caber tudo; Recentralizar volta para a
 *   posição do operador.
 * - Tocar num pino ou num item abre o `OperacaoSheet`, com as ações de operador.
 *
 * **Rota inteligente**: o botão de rota junta sozinho os chamados abertos em
 * tela num raio ao redor do operador (raio ajustável, com contagem por
 * opção); "Traçar rota" ordena as paradas partindo da posição atual — pelo
 * OSRM (ruas) quando ele responde, senão em linha reta (`utils/rota.ts`) —,
 * assume em lote as que ainda não têm atendente e abre o `RoteiroPanel`, que
 * avança sozinho quando a parada atual é finalizada. Desmarcar um chamado (ou
 * o toque longo, para montar a seleção na mão) continua possível.
 */

import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MapSurface } from '@/components/map-surface';
import type {
  CirculoMapa,
  LinhaMapa,
  MapSurfaceHandle,
  MarcadorMapa,
  Regiao,
} from '@/components/map-surface.types';
import { OperacaoSheet } from '@/components/operacao-sheet';
import { RoteiroPanel, type Roteiro } from '@/components/roteiro-panel';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/ui/screen';
import { StatusBadge } from '@/components/ui/status-badge';
import { getStatusColor, STATUS_ABERTOS, STATUS_FECHADOS } from '@/constants/status';
import { FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useColors, useTheme } from '@/context/theme-context';
import { useToast } from '@/context/toast-context';
import { GpsJoystick } from '@/dev/gps-joystick';
import { useLocalizacao } from '@/hooks/use-localizacao';
import { api } from '@/services/api';
import { routeOsrm, tripOsrm } from '@/services/osrm';
import type { Categoria, Defeito, Operacao } from '@/types';
import { concluidoEm } from '@/utils/format';
import {
  caixaDosPontos,
  distanciaAte,
  formatarDistancia,
  haversineDistance,
  regiaoDaCaixa,
  REGIAO_PADRAO,
} from '@/utils/geo';
import { ordenarParadas } from '@/utils/rota';

const MOSTRAR_JOYSTICK = __DEV__ && Platform.OS === 'web';

/** Raios da rota automática, em metros; 0 = tudo que está em tela. */
const RAIOS_ROTA_M = [500, 1000, 2000, 5000, 0] as const;
const RAIO_ROTA_PADRAO_M = 1000;
/** Acima disso o 2-opt e o OSRM ficam lentos/recusam. */
const MAX_PARADAS = 25;
/**
 * O operador só entra no enquadramento se estiver a até essa distância de algum
 * chamado; mais longe (ex.: em outra cidade) o zoom abriria para cobrir as duas.
 */
const PERTO_PARA_ENQUADRAR_M = 5000;

function rotuloRaio(raio: number) {
  if (raio === 0) return 'Todos';
  return raio >= 1000 ? `${raio / 1000} km` : `${raio} m`;
}

function diasDesde(iso: string) {
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (dias <= 0) return 'hoje';
  if (dias === 1) return '1 dia';
  return `${dias} dias`;
}

export default function OperacaoScreen() {
  const colors = useColors();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const addToast = useToast();
  const { user } = useAuth();
  const { posicao, bussola, permitido, erro: erroGps, tentarNovamente } = useLocalizacao();

  const mapRef = useRef<MapSurfaceHandle>(null);
  const [defeitos, setDefeitos] = useState<Defeito[]>([]);
  const [municipioOp, setMunicipioOp] = useState<Operacao['municipio']>(null);
  const [carregando, setCarregando] = useState(true);
  // Mensagem do backend quando o operador não pode operar (sem município).
  const [bloqueio, setBloqueio] = useState<string | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  // Quem já assumiu chamados vê só os seus; "ver todos" abre a cidade inteira.
  const [verTodos, setVerTodos] = useState(false);
  const [selecionado, setSelecionado] = useState<Defeito | null>(null);
  const [painelAberto, setPainelAberto] = useState(true);
  const [mapaPronto, setMapaPronto] = useState(false);
  // Enquadra tudo uma vez por carga; depois disso a câmera é do operador.
  const enquadrouRef = useRef(false);

  // Rota inteligente: seleção de paradas e roteiro ativo.
  const [modoSelecao, setModoSelecao] = useState(false);
  const [selecao, setSelecao] = useState<Set<number>>(new Set());
  const [raioRota, setRaioRota] = useState<number>(RAIO_ROTA_PADRAO_M);
  const [roteiro, setRoteiro] = useState<Roteiro | null>(null);
  const [tracado, setTracado] = useState<LinhaMapa | null>(null);
  const [criandoRota, setCriandoRota] = useState(false);

  // Região em que o mapa nasce. Calculada uma vez, quando o mapa aparece (só
  // depois da fila chegar), para ele já abrir nos chamados em vez de nascer em
  // `REGIAO_PADRAO` e voar até eles. `enquadrado` diz se ela já cobre os
  // chamados e dispensa o enquadramento animado.
  const [inicial, setInicial] = useState<{ regiao: Regiao; enquadrado: boolean } | null>(null);

  const iconePorCategoria = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const c of categorias) if (c.icone) mapa.set(c.nome, c.icone);
    return mapa;
  }, [categorias]);

  const carregar = useCallback(async () => {
    try {
      const fila = await api.operacao();
      setDefeitos(fila.defeitos);
      setMunicipioOp(fila.municipio);
      setBloqueio(null);
    } catch (err) {
      // 403 = sem município vinculado; qualquer outro erro mantém a tela.
      const msg = err instanceof Error ? err.message : '';
      if (/munic[ií]pio|permiss/i.test(msg)) setBloqueio(msg);
    } finally {
      setCarregando(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      carregar();
    }, [carregar]),
  );

  useEffect(() => {
    api
      .listCategorias()
      .then(setCategorias)
      .catch(() => {});
  }, []);

  const meuId = user ? String(user.id) : null;

  /** Chamados abertos que eu assumi. */
  const meus = useMemo(
    () =>
      defeitos.filter((d) => STATUS_ABERTOS.includes(d.status) && String(d.atendente_id) === meuId),
    [defeitos, meuId],
  );
  const soOsMeus = meus.length > 0 && !verTodos;

  /** O que está em tela, ordenado: mais perto primeiro; sem GPS, mais antigo primeiro. */
  const lista = useMemo(() => {
    const filtrados = soOsMeus ? meus : defeitos.filter((d) => STATUS_ABERTOS.includes(d.status));
    const comDistancia = filtrados.map((defeito) => ({
      defeito,
      distancia: posicao
        ? distanciaAte(defeito, posicao.latitude, posicao.longitude)
        : Number.POSITIVE_INFINITY,
      icone: iconePorCategoria.get(defeito.categoria ?? defeito.categoria_nome ?? ''),
    }));
    return comDistancia.sort((a, b) =>
      posicao ? a.distancia - b.distancia : a.defeito.criado_em.localeCompare(b.defeito.criado_em),
    );
  }, [defeitos, meus, soOsMeus, posicao, iconePorCategoria]);

  /** Chamados abertos em tela, mais perto primeiro (base da rota automática). */
  // Chamados que outro operador ja assumiu ficam de fora da rota automatica:
  // o backend recusaria o "assumir" e a parada seria trabalho de outra pessoa.
  const abertosPorDistancia = useMemo(
    () =>
      lista.filter(
        (i) =>
          STATUS_ABERTOS.includes(i.defeito.status) &&
          (!i.defeito.atendente_id || String(i.defeito.atendente_id) === meuId),
      ),
    [lista, meuId],
  );

  /** Quantos chamados cada opção de raio pegaria. */
  const contagemPorRaio = useMemo(
    () =>
      RAIOS_ROTA_M.map((raio) => ({
        raio,
        total: abertosPorDistancia.filter((i) => raio === 0 || i.distancia <= raio).length,
      })),
    [abertosPorDistancia],
  );

  const circulos = useMemo<CirculoMapa[]>(() => {
    if (!modoSelecao || !posicao || raioRota === 0) return [];
    return [
      {
        key: 'raio-rota',
        centro: { latitude: posicao.latitude, longitude: posicao.longitude },
        raio: raioRota,
        corPreenchimento: 'rgba(212,175,55,0.08)',
        corBorda: 'rgba(212,175,55,0.6)',
        larguraBorda: 1,
      },
    ];
  }, [modoSelecao, posicao, raioRota]);

  /** Paradas do roteiro na versão mais recente de `defeitos` (status atualizado). */
  const paradasAtuais = useMemo(() => {
    if (!roteiro) return null;
    const porId = new Map(defeitos.map((d) => [d.id, d]));
    return roteiro.paradas.map((p) => porId.get(p.id) ?? p);
  }, [roteiro, defeitos]);

  const marcadores = useMemo<MarcadorMapa[]>(() => {
    if (roteiro && paradasAtuais) {
      // No roteiro só as paradas aparecem, numeradas; a atual em destaque.
      return paradasAtuais.map((defeito, i) => ({
        key: String(defeito.id),
        coordenada: { latitude: defeito.latitude, longitude: defeito.longitude },
        cor: roteiro.concluidas.has(defeito.id)
          ? '#6B7280'
          : getStatusColor(defeito.status, concluidoEm(defeito)),
        icone: iconePorCategoria.get(defeito.categoria ?? defeito.categoria_nome ?? ''),
        rotulo: String(i + 1),
        selecionado: i === roteiro.atual,
      }));
    }
    return lista.map(({ defeito, icone }) => ({
      key: String(defeito.id),
      coordenada: { latitude: defeito.latitude, longitude: defeito.longitude },
      cor: getStatusColor(defeito.status, concluidoEm(defeito)),
      icone,
      // Em modo de seleção o anel dourado marca quem entra na rota.
      emAlcance: modoSelecao && selecao.has(defeito.id),
      selecionado: selecionado?.id === defeito.id,
    }));
  }, [roteiro, paradasAtuais, lista, selecionado?.id, iconePorCategoria, modoSelecao, selecao]);

  /** Os pontos a enquadrar, com a posição do operador só se ele estiver perto deles. */
  function comPosicaoSePerto(pontos: { latitude: number; longitude: number }[]) {
    if (!posicao) return pontos;
    const perto =
      pontos.length === 0 ||
      pontos.some(
        (p) =>
          haversineDistance(p.latitude, p.longitude, posicao.latitude, posicao.longitude) <=
          PERTO_PARA_ENQUADRAR_M,
      );
    return perto ? [...pontos, posicao] : pontos;
  }

  function enquadrarPontos(pontos: { latitude: number; longitude: number }[]) {
    const caixa = caixaDosPontos(comPosicaoSePerto(pontos));
    if (!caixa) return false;
    mapRef.current?.animarPara(regiaoDaCaixa(caixa));
    return true;
  }

  function enquadrar() {
    const pontos = roteiro && paradasAtuais ? paradasAtuais : lista.map((i) => i.defeito);
    if (!enquadrarPontos(pontos)) addToast('Nenhum chamado para enquadrar.', 'info');
  }

  // Primeiro enquadramento: assim que mapa e dados existem.
  useEffect(() => {
    if (!mapaPronto || enquadrouRef.current || inicial?.enquadrado || defeitos.length === 0) return;
    enquadrouRef.current = true;
    const caixa = caixaDosPontos(comPosicaoSePerto(lista.map((i) => i.defeito)));
    if (caixa) mapRef.current?.animarPara(regiaoDaCaixa(caixa));
    else if (posicao) mapRef.current?.seguir(posicao);
  }, [mapaPronto, defeitos.length, lista, posicao, inicial]);

  function recentrar() {
    if (!posicao) {
      if (permitido === false) tentarNovamente();
      addToast(erroGps ?? 'Aguardando sinal do GPS...', 'info');
      return;
    }
    mapRef.current?.seguir(posicao);
  }

  function concluirParada(id: number) {
    setRoteiro((prev) => {
      if (!prev) return prev;
      const idx = prev.paradas.findIndex((p) => p.id === id);
      if (idx < 0) return prev;
      const concluidas = new Set(prev.concluidas);
      concluidas.add(id);
      let atual = prev.atual;
      if (idx === prev.atual) {
        atual = prev.paradas.findIndex((p, i) => i > prev.atual && !concluidas.has(p.id));
        if (atual < 0) atual = prev.paradas.length;
      }
      return { ...prev, concluidas, atual };
    });
  }

  function aplicarPatch(id: number, patch: Partial<Defeito>) {
    setDefeitos((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
    setSelecionado((prev) => (prev?.id === id ? { ...prev, ...patch } : prev));
    // Finalizou uma parada do roteiro: o roteiro avança.
    if (patch.status && STATUS_FECHADOS.includes(patch.status)) concluirParada(id);
  }

  function substituir(defeito: Defeito) {
    setDefeitos((prev) => prev.map((d) => (d.id === defeito.id ? defeito : d)));
    setSelecionado(defeito);
  }

  async function abrir(defeito: Defeito, focar = false) {
    setSelecionado(defeito);
    if (focar) {
      mapRef.current?.animarPara({
        latitude: defeito.latitude,
        longitude: defeito.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });
    }
    try {
      const detalhe = await api.detalharDefeito(defeito.id);
      // O detalhe não traz `sla_vencido`; preserva o da listagem.
      setSelecionado({ ...detalhe, sla_vencido: defeito.sla_vencido });
    } catch {
      // Mantém o resumo da listagem.
    }
  }

  // ---------------------------------------------------------------- seleção

  function alternarSelecao(id: number) {
    setSelecao((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size >= MAX_PARADAS) {
        addToast(`No máximo ${MAX_PARADAS} paradas por rota.`, 'info');
        return prev;
      } else {
        next.add(id);
      }
      return next;
    });
    setModoSelecao(true);
  }

  /**
   * Rota automática: seleciona sozinho os chamados abertos em tela dentro
   * do raio (mais perto primeiro, até MAX_PARADAS) e abre o modo de rota.
   */
  function montarRotaNoRaio(raio: number) {
    if (!posicao) {
      addToast(erroGps ?? 'Aguardando sinal do GPS...', 'info');
      return;
    }
    const dentro = abertosPorDistancia.filter((i) => raio === 0 || i.distancia <= raio);
    const escolhidos = dentro.slice(0, MAX_PARADAS);
    if (dentro.length > MAX_PARADAS) {
      addToast(`Muitos chamados: a rota fica com os ${MAX_PARADAS} mais próximos.`, 'info');
    }
    setRaioRota(raio);
    setSelecao(new Set(escolhidos.map((i) => i.defeito.id)));
    setModoSelecao(true);
    setPainelAberto(true);
    if (escolhidos.length > 0) enquadrarPontos(escolhidos.map((i) => i.defeito));
  }

  function sairDaSelecao() {
    setModoSelecao(false);
    setSelecao(new Set());
  }

  // ---------------------------------------------------------------- roteiro

  async function criarRota() {
    if (!posicao) {
      addToast(erroGps ?? 'Aguardando sinal do GPS...', 'info');
      return;
    }
    const escolhidas = defeitos.filter((d) => selecao.has(d.id));
    if (escolhidas.length === 0) return;
    setCriandoRota(true);
    try {
      const origem = { latitude: posicao.latitude, longitude: posicao.longitude };
      const temPrioritarias = escolhidas.some((d) => d.sla_vencido);
      const ordemLocal = () =>
        ordenarParadas(
          origem,
          escolhidas.map((d) => ({ ...d, prioritario: !!d.sla_vencido })),
        );

      // Ordem: OSRM (ruas) quando não há prioridade a respeitar; senão,
      // ordena localmente (prioritárias primeiro) e pede ao OSRM só o traçado.
      let paradas: Defeito[];
      let geometria: { latitude: number; longitude: number }[];
      let distanciaM: number;
      let duracaoS: number | null;
      let fonte: Roteiro['fonte'];
      try {
        if (!temPrioritarias) {
          const r = await tripOsrm(origem, escolhidas);
          paradas = r.ordem.map((i) => escolhidas[i]);
          geometria = r.geometria;
          distanciaM = r.distanciaM;
          duracaoS = r.duracaoS;
        } else {
          paradas = ordemLocal().paradas;
          const r = await routeOsrm([origem, ...paradas]);
          geometria = r.geometria;
          distanciaM = r.distanciaM;
          duracaoS = r.duracaoS;
        }
        fonte = 'ruas';
      } catch {
        // OSRM fora do ar / sem rede: linha reta, ordem local.
        const local = ordemLocal();
        paradas = local.paradas;
        geometria = [
          origem,
          ...paradas.map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
        ];
        distanciaM = local.distanciaM;
        duracaoS = null;
        fonte = 'reta';
      }

      // Assume em lote o que ainda está na fila, para ninguém mais pegar.
      const semAtendente = paradas.filter(
        (p) => !p.atendente_id && !STATUS_FECHADOS.includes(p.status),
      );
      if (semAtendente.length > 0) {
        const resultados = await Promise.allSettled(
          semAtendente.map((p) => api.atenderDefeito(p.id)),
        );
        const ok = new Set<number>();
        resultados.forEach((r, i) => {
          if (r.status === 'fulfilled') ok.add(semAtendente[i].id);
        });
        if (ok.size > 0) {
          setDefeitos((prev) =>
            prev.map((d) =>
              ok.has(d.id)
                ? { ...d, status: 'vinculado_sem_resposta', atendente_id: user?.id ?? null }
                : d,
            ),
          );
        }
        const falhas = semAtendente.length - ok.size;
        if (falhas > 0) addToast(`${falhas} chamado(s) já assumidos por outro operador.`, 'info');
      }

      setRoteiro({ paradas, atual: 0, concluidas: new Set(), distanciaM, duracaoS, fonte });
      setTracado({
        key: 'roteiro',
        coordenadas: geometria,
        cor: colors.gold500,
        largura: 5,
        tracejada: fonte === 'reta',
      });
      sairDaSelecao();
      setSelecionado(null);
      setPainelAberto(true);
      enquadrarPontos(paradas);
      if (fonte === 'reta') addToast('Sem rota por ruas agora; traçado em linha reta.', 'info');
    } finally {
      setCriandoRota(false);
    }
  }

  function pularParada() {
    if (!roteiro) return;
    const atual = roteiro.paradas[roteiro.atual];
    if (atual) concluirParada(atual.id);
  }

  function encerrarRoteiro() {
    setRoteiro(null);
    setTracado(null);
  }

  const rodape = insets.bottom + Spacing[4];

  const mapaVisivel = !bloqueio && !(carregando && defeitos.length === 0);
  if (mapaVisivel && !inicial) {
    const caixa = caixaDosPontos(comPosicaoSePerto(lista.map((i) => i.defeito)));
    setInicial(
      caixa
        ? { regiao: regiaoDaCaixa(caixa), enquadrado: true }
        : { regiao: REGIAO_PADRAO, enquadrado: false },
    );
  }
  const regiaoInicial = inicial?.regiao ?? REGIAO_PADRAO;

  if (bloqueio || (carregando && defeitos.length === 0)) {
    return (
      <View
        style={[styles.container, { backgroundColor: colors.bgPrimary, paddingTop: insets.top }]}>
        {bloqueio ? (
          <View style={styles.bloqueio}>
            <Ionicons name="business-outline" size={40} color={colors.textMuted} />
            <Text style={[styles.bloqueioTitulo, { color: colors.textPrimary }]}>
              Sem município de operação
            </Text>
            <Text style={[styles.bloqueioTexto, { color: colors.textSecondary }]}>
              Você só opera chamados da cidade a que está vinculado. Peça a um administrador para
              vincular seu usuário a um município. Como cidadão, você pode reportar em qualquer
              lugar pela aba Mapa.
            </Text>
            <Text style={[styles.bloqueioTexto, { color: colors.textMuted }]}>{bloqueio}</Text>
          </View>
        ) : (
          <LoadingState label="Carregando a fila..." />
        )}
      </View>
    );
  }

  const alturaPainel = roteiro ? 300 : painelAberto ? 260 : 76;

  return (
    <View style={[styles.container, { backgroundColor: colors.bgPrimary, paddingTop: insets.top }]}>
      <View style={styles.mapaWrapper}>
        <MapSurface
          ref={mapRef}
          regiaoInicial={regiaoInicial}
          circulos={circulos}
          marcadores={marcadores}
          linhas={tracado ? [tracado] : []}
          usuario={posicao}
          direcao={bussola ?? posicao?.heading ?? null}
          onLongPressMapa={() => {}}
          onPressMarcador={(key) => {
            const d = defeitos.find((x) => String(x.id) === key);
            if (!d) return;
            if (modoSelecao) alternarSelecao(d.id);
            else abrir(d);
          }}
          onArrastar={() => {}}
          onPronto={() => setMapaPronto(true)}
          escuro={theme === 'dark'}
        />

        {/* Lateral direita: meus/todos, rota, enquadrar e voltar para mim. */}
        <View style={[styles.lateral, { bottom: rodape + alturaPainel }]}>
          {!roteiro && !modoSelecao && meus.length > 0 ? (
            <Pressable
              onPress={() => {
                setVerTodos((v) => !v);
                setSelecionado(null);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: soOsMeus }}
              accessibilityLabel={
                soOsMeus ? 'Ver todos os chamados da cidade' : 'Ver só os meus atendimentos'
              }
              style={[
                styles.botaoRedondo,
                {
                  backgroundColor: soOsMeus ? colors.gold500 : colors.bgSurface,
                  borderColor: soOsMeus ? colors.gold500 : colors.borderDefault,
                },
              ]}>
              <Ionicons
                name={soOsMeus ? 'person' : 'people'}
                size={18}
                color={soOsMeus ? colors.textInverse : colors.textSecondary}
              />
            </Pressable>
          ) : null}
          {!roteiro ? (
            <Pressable
              onPress={() => (modoSelecao ? sairDaSelecao() : montarRotaNoRaio(raioRota))}
              accessibilityRole="button"
              accessibilityLabel={modoSelecao ? 'Cancelar rota' : 'Montar rota automática'}
              style={[
                styles.botaoRedondo,
                {
                  backgroundColor: modoSelecao ? colors.gold500 : colors.bgSurface,
                  borderColor: modoSelecao ? colors.gold500 : colors.borderDefault,
                },
              ]}>
              <Ionicons
                name={modoSelecao ? 'close' : 'git-branch'}
                size={18}
                color={modoSelecao ? colors.textInverse : colors.textSecondary}
              />
            </Pressable>
          ) : null}
          <Pressable
            onPress={enquadrar}
            accessibilityRole="button"
            accessibilityLabel="Enquadrar todos os chamados"
            style={[
              styles.botaoRedondo,
              { backgroundColor: colors.bgSurface, borderColor: colors.borderDefault },
            ]}>
            <Ionicons name="scan" size={18} color={colors.textSecondary} />
          </Pressable>
          <Pressable
            onPress={recentrar}
            accessibilityRole="button"
            accessibilityLabel="Recentralizar na minha posição"
            style={[
              styles.botaoRedondo,
              { backgroundColor: colors.bgSurface, borderColor: colors.borderDefault },
            ]}>
            <Ionicons name="locate" size={18} color={colors.gold500} />
          </Pressable>
        </View>

        {MOSTRAR_JOYSTICK ? <GpsJoystick posicaoReal={posicao} /> : null}

        {/* Painel inferior: roteiro ativo ou a fila em lista. */}
        <View style={[styles.rodape, { bottom: rodape }]} pointerEvents="box-none">
          {roteiro && paradasAtuais ? (
            <RoteiroPanel
              roteiro={{ ...roteiro, paradas: paradasAtuais }}
              icones={iconePorCategoria}
              origem={posicao}
              onAbrir={(d) => abrir(d, true)}
              onPular={pularParada}
              onFechar={encerrarRoteiro}
            />
          ) : (
            <View
              style={[
                styles.painel,
                {
                  backgroundColor: colors.bgSurface,
                  borderColor: modoSelecao ? colors.gold500 : colors.borderDefault,
                },
              ]}>
              <Pressable
                onPress={() => setPainelAberto((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={painelAberto ? 'Recolher lista' : 'Expandir lista'}
                style={styles.painelCabecalho}>
                <Ionicons
                  name={modoSelecao ? 'git-branch' : 'construct'}
                  size={16}
                  color={colors.gold500}
                />
                <View style={styles.painelTitulos}>
                  <Text
                    style={[styles.painelTitulo, { color: colors.textPrimary }]}
                    numberOfLines={1}>
                    {modoSelecao
                      ? `Rota · ${selecao.size} parada${selecao.size === 1 ? '' : 's'}`
                      : soOsMeus
                        ? 'Meus atendimentos'
                        : `Chamados abertos${
                            municipioOp ? ` · ${municipioOp.nome}/${municipioOp.uf_sigla}` : ''
                          }`}
                  </Text>
                  <Text style={[styles.painelSubtitulo, { color: colors.textMuted }]}>
                    {modoSelecao
                      ? `Abertos num raio de ${rotuloRaio(raioRota).toLowerCase()} · desmarque o que não for atender`
                      : `${lista.length === 1 ? '1 chamado' : `${lista.length} chamados`}${
                          posicao ? ' · mais perto primeiro' : ' · mais antigo primeiro'
                        }`}
                  </Text>
                </View>
                <Ionicons
                  name={painelAberto ? 'chevron-down' : 'chevron-up'}
                  size={20}
                  color={colors.textSecondary}
                />
              </Pressable>

              {modoSelecao ? (
                <View style={styles.selecaoAcoes}>
                  <View style={styles.raios}>
                    {contagemPorRaio.map(({ raio, total }) => {
                      const ativo = raio === raioRota;
                      return (
                        <Pressable
                          key={raio}
                          onPress={() => montarRotaNoRaio(raio)}
                          accessibilityRole="button"
                          accessibilityState={{ selected: ativo }}
                          style={[
                            styles.raioChip,
                            {
                              borderColor: ativo ? colors.gold500 : colors.borderDefault,
                              backgroundColor: ativo ? colors.goldMuted : 'transparent',
                            },
                          ]}>
                          <Text
                            style={[
                              styles.raioTexto,
                              {
                                color: ativo ? colors.gold500 : colors.textSecondary,
                                fontWeight: ativo ? FontWeight.bold : FontWeight.regular,
                              },
                            ]}>
                            {rotuloRaio(raio)} · {total}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Button
                    block
                    size="sm"
                    onPress={criarRota}
                    loading={criandoRota}
                    disabled={selecao.size === 0}
                    icon={<Ionicons name="navigate" size={14} color={colors.textInverse} />}>
                    {selecao.size === 0
                      ? 'Nenhum chamado no raio'
                      : `Traçar rota · ${selecao.size} parada${selecao.size === 1 ? '' : 's'}`}
                  </Button>
                </View>
              ) : null}

              {painelAberto ? (
                <ScrollView
                  style={styles.painelCorpo}
                  contentContainerStyle={styles.painelConteudo}>
                  {lista.length === 0 ? (
                    <Text style={[styles.vazio, { color: colors.textMuted }]}>
                      Nenhum chamado aberto na cidade.
                    </Text>
                  ) : (
                    lista.map(({ defeito, distancia, icone }) => {
                      const slaVencido =
                        !!defeito.sla_vencido && !STATUS_FECHADOS.includes(defeito.status);
                      const marcado = selecao.has(defeito.id);
                      const deOutro =
                        !!defeito.atendente_id && String(defeito.atendente_id) !== meuId;
                      return (
                        <Pressable
                          key={String(defeito.id)}
                          onPress={() =>
                            modoSelecao ? alternarSelecao(defeito.id) : abrir(defeito, true)
                          }
                          onLongPress={() => alternarSelecao(defeito.id)}
                          accessibilityRole="button"
                          accessibilityState={{ selected: marcado }}
                          style={({ pressed }) => [
                            styles.item,
                            {
                              borderColor:
                                (modoSelecao && marcado) || selecionado?.id === defeito.id
                                  ? colors.gold500
                                  : 'transparent',
                              opacity: pressed ? 0.6 : 1,
                            },
                          ]}>
                          {modoSelecao ? (
                            <Ionicons
                              name={marcado ? 'checkbox' : 'square-outline'}
                              size={18}
                              color={marcado ? colors.gold500 : colors.textMuted}
                            />
                          ) : null}
                          <Text style={styles.itemIcone}>{icone ?? '📋'}</Text>
                          <View style={styles.itemTexto}>
                            <Text
                              style={[styles.itemTitulo, { color: colors.textPrimary }]}
                              numberOfLines={1}>
                              {defeito.categoria_nome ?? defeito.categoria ?? defeito.titulo}
                              {defeito.rua ? ` · ${defeito.rua}` : ''}
                            </Text>
                            <View style={styles.itemLinha}>
                              <StatusBadge
                                status={defeito.status}
                                concluidoEm={concluidoEm(defeito)}
                                compact
                              />
                              <Text style={[styles.itemMeta, { color: colors.textMuted }]}>
                                {diasDesde(defeito.criado_em)}
                                {Number.isFinite(distancia)
                                  ? ` · ${formatarDistancia(distancia)}`
                                  : ''}
                              </Text>
                              {deOutro ? (
                                <View style={styles.sla}>
                                  <Ionicons
                                    name="person-circle-outline"
                                    size={11}
                                    color={colors.textMuted}
                                  />
                                  <Text style={[styles.itemMeta, { color: colors.textMuted }]}>
                                    outro operador
                                  </Text>
                                </View>
                              ) : null}
                              {slaVencido ? (
                                <View style={styles.sla}>
                                  <Ionicons name="alarm" size={11} color={colors.error} />
                                  <Text style={[styles.itemMeta, { color: colors.error }]}>
                                    SLA
                                  </Text>
                                </View>
                              ) : null}
                            </View>
                          </View>
                          {!modoSelecao ? (
                            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                          ) : null}
                        </Pressable>
                      );
                    })
                  )}
                </ScrollView>
              ) : null}
            </View>
          )}
        </View>
      </View>

      <OperacaoSheet
        key={selecionado?.id}
        defeito={selecionado}
        onClose={() => setSelecionado(null)}
        onPatch={aplicarPatch}
        onReplace={substituir}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  mapaWrapper: {
    flex: 1,
  },
  // Os panes do Leaflet (web) usam z-index 400; sem isso os overlays somem.
  lateral: {
    position: 'absolute',
    zIndex: 1000,
    right: Spacing[4],
    gap: Spacing[2],
  },
  botaoRedondo: {
    width: 44,
    height: 44,
    borderWidth: 1,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  rodape: {
    position: 'absolute',
    zIndex: 1000,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing[4],
  },
  painel: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingVertical: Spacing[2],
    gap: Spacing[2],
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  painelCabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    paddingHorizontal: Spacing[3],
  },
  painelTitulos: {
    flex: 1,
  },
  painelTitulo: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
  },
  painelSubtitulo: {
    fontSize: FontSize.xs,
  },
  selecaoAcoes: {
    gap: Spacing[2],
    paddingHorizontal: Spacing[3],
  },
  raios: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[1] + 2,
  },
  raioChip: {
    paddingHorizontal: Spacing[2] + 2,
    paddingVertical: Spacing[1] + 1,
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  raioTexto: {
    fontSize: FontSize.xs,
  },
  painelCorpo: {
    maxHeight: 200,
  },
  painelConteudo: {
    paddingHorizontal: Spacing[2],
    gap: 2,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    paddingHorizontal: Spacing[2],
    paddingVertical: Spacing[1] + 2,
    borderWidth: 1,
    borderRadius: Radius.md,
  },
  itemIcone: {
    fontSize: 20,
  },
  itemTexto: {
    flex: 1,
    gap: 3,
  },
  itemTitulo: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  itemLinha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    flexWrap: 'wrap',
  },
  itemMeta: {
    fontSize: FontSize.xs,
  },
  sla: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  vazio: {
    fontSize: FontSize.sm,
    padding: Spacing[2],
  },
  bloqueio: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[3],
    padding: Spacing[6],
  },
  bloqueioTitulo: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    textAlign: 'center',
  },
  bloqueioTexto: {
    fontSize: FontSize.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
});
