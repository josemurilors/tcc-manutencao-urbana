/**
 * Mapa em modo de navegação — mistura de Waze (reportar onde se está) com
 * Pokémon Go (ver o que há ao redor e "capturar" confirmando no local).
 *
 * Tudo parte do GPS, que fica ligado enquanto a aba está aberta
 * (`useLocalizacao`):
 * - a câmera segue o usuário com zoom de rua; arrastar o mapa sai do modo
 *   "seguir" e o FAB vira "Recentralizar" até a câmera voltar ao usuário;
 * - o FAB redondo "Reportar" (centro inferior, só enquanto seguindo) abre o
 *   chamado na posição atual — sem tocar no mapa; o toque longo ainda
 *   permite posicionar em outro ponto, e a busca de endereço leva o mapa
 *   até um lugar com "Reportar aqui";
 * - o mapa busca os chamados da área visível (`/defeitos/area/`) com os
 *   filtros da folha "Camadas" (situação e tipos). Cada célula da grade
 *   mostra poucos pinos; a que tem mais vira uma bolha com a contagem real
 *   (toque aproxima) — ver `utils/rarear.ts`;
 * - dentro de `RAIO_CONFIRMACAO_M` o pino ganha anel dourado e o detalhe
 *   libera "Confirmar no local";
 * - visitantes veem os mesmos pinos e bolhas (sem o nome de quem reportou) e
 *   são convidados a entrar quando tentam reportar;
 * - o botão do canto superior direito abre a **visão do município**: enquadra
 *   a cidade onde a pessoa está, mostra os chamados abertos dela e o painel
 *   "Transparência da cidade" (desempenho da prefeitura + rankings).
 *
 * Trocas em relação ao web: Leaflet -> react-native-maps; `leaflet.heat` ->
 * células de densidade (`utils/heatmap.ts`), ligadas pela folha "Camadas".
 */

import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SinoNotificacoes } from '@/components/app-header';
import { DefectSheet } from '@/components/defect-sheet';
import { MapSurface } from '@/components/map-surface';
import type {
  CirculoMapa,
  ClusterMapa,
  MapSurfaceHandle,
  MarcadorMapa,
  Regiao,
} from '@/components/map-surface.types';
import { BuscaEndereco } from '@/components/mapa/busca-endereco';
import { CamadasSheet } from '@/components/mapa/camadas-sheet';
import { DestinoCard } from '@/components/mapa/destino-card';
import { DicasMapa } from '@/components/mapa/dicas-mapa';
import { LegendaMapa } from '@/components/mapa/legenda-mapa';
import {
  filtrosAtivos,
  useDicasVistas,
  useFiltrosMapa,
  useLegendaAberta,
} from '@/components/mapa/preferencias-mapa';
import { MunicipioPanel } from '@/components/municipio-panel';
import { RAIO_CONFIRMACAO_M } from '@/constants/proximidade';
import {
  getStatusColor,
  normalizarStatus,
  rotuloCidadao,
  statusAberto,
} from '@/constants/status';
import { FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useColors, useTheme } from '@/context/theme-context';
import { useToast } from '@/context/toast-context';
import { GpsJoystick } from '@/dev/gps-joystick';
import { useLocalizacao } from '@/hooks/use-localizacao';
import { api } from '@/services/api';
import { areaDoMapa, categoriasDoMapa } from '@/services/api-mapa';
import { useProgresso } from '@/services/progresso';
import { lerUltimaPosicao, ultimaPosicaoEmCache, type Ponto } from '@/services/ultima-posicao';
import type { AreaDoMapa, Defeito, TipoSinalizacao, VisaoMunicipio } from '@/types';
import type { CategoriaMapa, ResultadoEndereco } from '@/types/mapa';
import { concluidoEm } from '@/utils/format';
import {
  caixaDosPontos,
  DELTA_NAVEGACAO,
  distanciaAte,
  regiaoDaCaixa,
  regiaoEmTorno,
  REGIAO_PADRAO,
} from '@/utils/geo';
import {
  agruparParaHeatmap,
  corDoPeso,
  raioDoPeso,
  raioNaCelula,
  type HeatCell,
} from '@/utils/heatmap';
import {
  agruparEmClusters,
  caixaComFolga,
  celulaDaCaixa,
  celulasDe,
  rarear,
  regiaoDentroDaCaixa,
  type Caixa,
} from '@/utils/rarear';

type ItemProximo = {
  defeito: Defeito;
  distancia: number;
  icone?: string;
  emAlcance: boolean;
};

/** Joystick de GPS só no desktop em desenvolvimento (no celular há GPS de verdade). */
const MOSTRAR_JOYSTICK = __DEV__ && Platform.OS === 'web';
/** Quanto o mapa espera o GPS antes de abrir no enquadramento padrão. */
const ESPERA_GPS_MS = 3000;
/** Espera a câmera assentar antes de buscar a área (zoom com pinça dispara vários eventos). */
const ESPERA_BUSCA_MS = 300;
/** Menor enquadramento ao aproximar uma bolha ou ir a um endereço (~zoom 17). */
const DELTA_MINIMO = 0.004;

function nomeDaCategoria(d: Defeito) {
  return d.categoria ?? d.categoria_nome ?? '';
}

/** Enquadramento de um resultado da busca: a caixa do geocoder, sem passar de rua nem de cidade. */
function regiaoDoEndereco(r: ResultadoEndereco): Regiao {
  const vao = r.caixa
    ? Math.max(r.caixa.max_lat - r.caixa.min_lat, r.caixa.max_lng - r.caixa.min_lng) * 1.2
    : 0;
  const delta = Math.min(Math.max(vao, DELTA_MINIMO), 0.2);
  return { latitude: r.latitude, longitude: r.longitude, latitudeDelta: delta, longitudeDelta: delta };
}

export default function MapaScreen() {
  const colors = useColors();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const addToast = useToast();
  const { user, isAuthenticated } = useAuth();
  const { posicao, bussola, permitido, erro: erroGps, tentarNovamente } = useLocalizacao();
  // `?abrir=<id>`: o formulário de novo chamado manda para cá quando o backend
  // apontou um duplicado — abre o existente para a pessoa confirmar.
  // `?lat=&lng=`: enquadra um ponto (ex.: "Ver no mapa" dos focos do painel),
  // com a camada de calor do jeito que a pessoa deixou.
  const { abrir, lat: latParam, lng: lngParam } = useLocalSearchParams<{
    abrir?: string;
    lat?: string;
    lng?: string;
  }>();

  const mapRef = useRef<MapSurfaceHandle>(null);
  const [defeitos, setDefeitos] = useState<Defeito[]>([]);
  const [categorias, setCategorias] = useState<CategoriaMapa[]>([]);
  const [estadoCategorias, setEstadoCategorias] = useState<'carregando' | 'erro' | 'pronto'>(
    'carregando',
  );
  // Contagem real por quadrante (bolhas e calor usam isto, não os pinos já
  // cortados) e o lado do quadrante em graus.
  const [celulas, setCelulas] = useState<AreaDoMapa['celulas']>([]);
  const [celulaGraus, setCelulaGraus] = useState(0);
  const [erroArea, setErroArea] = useState<string | null>(null);
  // Região visível atual; `null` até a câmera se mexer pela primeira vez.
  const [regiao, setRegiao] = useState<Regiao | null>(null);
  const [seguindo, setSeguindo] = useState(true);
  // O mapa nativo ignora `seguir` antes de `onMapReady`; o efeito abaixo
  // depende disto para centralizar assim que ele estiver pronto.
  const [mapaPronto, setMapaPronto] = useState(false);
  const [selecionado, setSelecionado] = useState<Defeito | null>(null);
  // Visão do município: substitui a navegação por raio pela cidade inteira.
  const [visao, setVisao] = useState<VisaoMunicipio | null>(null);
  const [carregandoVisao, setCarregandoVisao] = useState(false);
  const [apoiei, setApoiei] = useState<Set<number>>(new Set());
  const [sinalizei, setSinalizei] = useState<Map<number, TipoSinalizacao>>(new Map());
  // Endereço escolhido na busca: alfinete + cartão "Reportar aqui".
  const [destino, setDestino] = useState<ResultadoEndereco | null>(null);
  const [camadasAbertas, setCamadasAbertas] = useState(false);
  const { filtros, setFiltros, carregado: filtrosCarregados } = useFiltrosMapa();
  const [legendaAberta, setLegendaAberta] = useLegendaAberta();
  const [dicasVistas, setDicasVistas] = useDicasVistas();
  // Nível/EXP no cartão da conta; as ações que dão XP recarregam o store.
  const progresso = useProgresso(isAuthenticated);

  // O mapa não é preso a município nenhum: qualquer cidade do país vale. Ele
  // só é montado quando sabe onde o usuário está, para não nascer num
  // enquadramento genérico e voar até ele: na posição do GPS ou, enquanto o
  // GPS não responde, na última posição guardada. Sem nenhuma das duas
  // (primeiro uso com GPS negado, com erro ou lento), cai em `REGIAO_PADRAO`
  // e segue o GPS quando ele chegar.
  const [ultima, setUltima] = useState<Ponto | null | undefined>(ultimaPosicaoEmCache);
  useEffect(() => {
    if (ultima !== undefined) return;
    let cancelado = false;
    lerUltimaPosicao().then((p) => {
      if (!cancelado) setUltima(p);
    });
    return () => {
      cancelado = true;
    };
  }, [ultima]);
  const [esperouGps, setEsperouGps] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setEsperouGps(true), ESPERA_GPS_MS);
    return () => clearTimeout(id);
  }, []);
  const [regiaoInicial, setRegiaoInicial] = useState<Regiao | null>(null);
  if (!regiaoInicial) {
    const alvo = posicao ?? ultima;
    if (alvo) {
      setRegiaoInicial(regiaoEmTorno(alvo.latitude, alvo.longitude, DELTA_NAVEGACAO));
    } else if (esperouGps || (ultima === null && (permitido === false || erroGps))) {
      setRegiaoInicial(REGIAO_PADRAO);
    }
  }
  // Foco pedido antes de o mapa existir (ex.: "Ver no mapa" chega enquanto o
  // GPS ainda responde); aplicado quando o mapa ficar pronto.
  const focoPendenteRef = useRef<Regiao | null>(null);
  useEffect(() => {
    if (!mapaPronto || !focoPendenteRef.current) return;
    mapRef.current?.animarPara(focoPendenteRef.current);
    focoPendenteRef.current = null;
  }, [mapaPronto]);

  const iconePorCategoria = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const c of categorias) if (c.icone) mapa.set(c.nome, c.icone);
    return mapa;
  }, [categorias]);
  const idPorCategoria = useMemo(
    () => new Map(categorias.map((c) => [c.nome.toLocaleLowerCase('pt-BR'), c.id])),
    [categorias],
  );

  // A posição só entra na busca para liberar restritos por perto; ler por ref
  // evita uma busca nova a cada atualização do GPS. Os filtros, idem: a troca
  // de filtro força a busca pelo efeito próprio, mais abaixo.
  const posicaoRef = useRef(posicao);
  posicaoRef.current = posicao;
  const filtrosRef = useRef(filtros);
  filtrosRef.current = filtros;
  const buscadaRef = useRef<{ caixa: Caixa; celula: number } | null>(null);
  const buscaSeqRef = useRef(0);

  /**
   * Busca os chamados da área visível. Pula quando a tela ainda cabe na
   * caixa da última busca e o zoom (tamanho do quadrante) não mudou.
   */
  const carregarArea = useCallback(async (r: Regiao, forcar = false) => {
    const caixa = caixaComFolga(r);
    const celula = celulaDaCaixa(caixa);
    const anterior = buscadaRef.current;
    if (
      !forcar &&
      anterior &&
      anterior.celula === celula &&
      regiaoDentroDaCaixa(r, anterior.caixa)
    ) {
      return;
    }
    const seq = ++buscaSeqRef.current;
    try {
      const area = await areaDoMapa(caixa, posicaoRef.current, filtrosRef.current);
      if (seq !== buscaSeqRef.current) return;
      buscadaRef.current = { caixa, celula };
      setDefeitos(area.defeitos);
      setCelulas(area.celulas ?? []);
      setCelulaGraus(area.celula_graus);
      setErroArea(null);
    } catch (err) {
      if (seq !== buscaSeqRef.current) return;
      // Os pinos antigos ficam (melhor que um mapa vazio); o aviso no rodapé
      // diz que estão desatualizados e oferece tentar de novo.
      setErroArea(err instanceof Error ? err.message : 'Sem conexão.');
    }
  }, []);

  const regiaoAtual = regiao ?? regiaoInicial;
  const regiaoAtualRef = useRef(regiaoAtual);
  regiaoAtualRef.current = regiaoAtual;

  useEffect(() => {
    if (!regiaoAtual || !filtrosCarregados) return;
    const id = setTimeout(() => carregarArea(regiaoAtual), ESPERA_BUSCA_MS);
    return () => clearTimeout(id);
  }, [regiaoAtual, carregarArea, filtrosCarregados]);

  // Filtro novo invalida a caixa já buscada. A primeira leitura (filtros
  // vindos do disco) não conta: a busca inicial já sai com eles.
  const chaveFiltro = `${filtros.situacao}|${filtros.categorias.join(',')}`;
  const chaveFiltroRef = useRef<string | null>(null);
  useEffect(() => {
    if (!filtrosCarregados) return;
    const anterior = chaveFiltroRef.current;
    chaveFiltroRef.current = chaveFiltro;
    if (anterior === null || anterior === chaveFiltro) return;
    if (regiaoAtualRef.current) carregarArea(regiaoAtualRef.current, true);
  }, [chaveFiltro, filtrosCarregados, carregarArea]);

  // Recarrega ao voltar do formulário de novo chamado.
  const filtrosCarregadosRef = useRef(filtrosCarregados);
  filtrosCarregadosRef.current = filtrosCarregados;
  useFocusEffect(
    useCallback(() => {
      if (regiaoAtualRef.current && filtrosCarregadosRef.current) {
        carregarArea(regiaoAtualRef.current, true);
      }
    }, [carregarArea]),
  );

  // `tentativaCategorias` sobe no "Tentar de novo" da folha e refaz a busca.
  const [tentativaCategorias, setTentativaCategorias] = useState(0);
  useEffect(() => {
    let cancelado = false;
    categoriasDoMapa()
      .then((lista) => {
        if (cancelado) return;
        setCategorias(lista);
        setEstadoCategorias('pronto');
      })
      .catch((err: unknown) => {
        if (cancelado) return;
        // Sem categorias o mapa só perde os emojis e o filtro por tipo; a
        // folha "Camadas" mostra o erro com "Tentar de novo".
        console.warn('[mapa] categorias indisponíveis', err);
        setEstadoCategorias('erro');
      });
    return () => {
      cancelado = true;
    };
  }, [tentativaCategorias]);

  function recarregarCategorias() {
    setEstadoCategorias('carregando');
    setTentativaCategorias((n) => n + 1);
  }

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelado = false;
    // Apoios e sinalizações só marcam os botões do detalhe como "já feito";
    // sem eles o detalhe ainda funciona (o backend recusa a repetição).
    api
      .apoiei()
      .then((r) => {
        if (!cancelado) setApoiei(new Set(r.ids));
      })
      .catch((err) => console.warn('[mapa] apoios do usuário indisponíveis', err));
    api
      .sinalizei()
      .then((r) => {
        if (!cancelado) {
          // Ids são UUIDs (strings) em runtime, como em `apoiei`.
          setSinalizei(new Map(Object.entries(r.sinalizacoes) as unknown as [number, TipoSinalizacao][]));
        }
      })
      .catch((err) => console.warn('[mapa] sinalizações do usuário indisponíveis', err));
    return () => {
      cancelado = true;
    };
  }, [isAuthenticated]);

  /** Seleciona um chamado carregado à parte e centraliza nele, saindo do "seguir". */
  const focarDefeito = useCallback((d: Defeito) => {
    setSelecionado(d);
    if (d.latitude == null || d.longitude == null) return;
    setSeguindo(false);
    const foco = {
      latitude: d.latitude,
      longitude: d.longitude,
      latitudeDelta: 0.005,
      longitudeDelta: 0.005,
    };
    if (mapRef.current) mapRef.current.animarPara(foco);
    else focoPendenteRef.current = foco;
  }, []);

  /** Abre um chamado pelo id (últimos resolvidos do painel da cidade). */
  async function abrirPorId(id: string) {
    try {
      focarDefeito(await api.detalharDefeito(id as unknown as number));
    } catch (err) {
      addToast.error(err instanceof Error ? err.message : 'Não foi possível abrir o chamado.');
    }
  }

  // A busca não é cancelada quando o parâmetro some: limpar `?abrir=` (abaixo)
  // re-renderiza na hora e, com um "cancelado" no cleanup, o detalhe que
  // chegasse depois era descartado — "Ver no mapa" não abria nada. O pedido
  // mais recente vence (`abrirSeqRef`).
  const abrirSeqRef = useRef(0);
  useEffect(() => {
    if (!abrir) return;
    const seq = ++abrirSeqRef.current;
    // Vindo de fora (ex.: "Ver no mapa" em Meus chamados), centraliza no
    // ponto em vez de continuar seguindo o GPS.
    api
      .detalharDefeito(abrir as unknown as number)
      .then((d) => {
        if (seq === abrirSeqRef.current) focarDefeito(d);
      })
      .catch((err: unknown) => {
        if (seq === abrirSeqRef.current) {
          addToast.error(err instanceof Error ? err.message : 'Não foi possível abrir o chamado.');
        }
      });
    router.setParams({ abrir: undefined });
  }, [abrir, focarDefeito, addToast]);

  const pontoPedido =
    latParam != null &&
    lngParam != null &&
    Number.isFinite(Number(latParam)) &&
    Number.isFinite(Number(lngParam))
      ? { latitude: Number(latParam), longitude: Number(lngParam) }
      : null;
  const chavePonto = pontoPedido ? `${pontoPedido.latitude},${pontoPedido.longitude}` : null;
  // Sair do "seguir" no render (não no efeito): o GPS não pode puxar a câmera
  // de volta antes de ela chegar ao ponto pedido.
  const [pontoTratado, setPontoTratado] = useState<string | null>(null);
  if (chavePonto !== pontoTratado) {
    setPontoTratado(chavePonto);
    if (chavePonto) {
      setSeguindo(false);
      setSelecionado(null);
    }
  }
  useEffect(() => {
    if (!chavePonto) return;
    const [latitude, longitude] = chavePonto.split(',').map(Number);
    const foco = { latitude, longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 };
    if (mapRef.current) mapRef.current.animarPara(foco);
    else focoPendenteRef.current = foco;
    router.setParams({ lat: undefined, lng: undefined });
  }, [chavePonto]);

  // Câmera de navegação: acompanha cada atualização do GPS enquanto "seguindo".
  // A posição do usuário manda; o município é só o enquadramento de fallback.
  useEffect(() => {
    if (!mapaPronto || !seguindo || !posicao) return;
    mapRef.current?.seguir(posicao);
  }, [mapaPronto, seguindo, posicao]);

  /**
   * Filtro no cliente, além do enviado ao backend: cobre o backend que
   * ainda não conhece `situacao`/`categorias` e a visão do município (que
   * vem inteira). Rejeitados ("não procede") nunca viram pino.
   */
  const passaNoFiltro = useCallback(
    (d: Defeito, considerarSituacao: boolean) => {
      const status = normalizarStatus(d.status);
      if (status === 'rejeitado') return false;
      if (considerarSituacao) {
        if (filtros.situacao === 'abertos' && !statusAberto(status)) return false;
        if (filtros.situacao === 'resolvidos' && status !== 'concluido') return false;
      }
      if (filtros.categorias.length > 0) {
        const id =
          d.categoria_id ?? idPorCategoria.get(nomeDaCategoria(d).toLocaleLowerCase('pt-BR'));
        if (id == null || !filtros.categorias.includes(id)) return false;
      }
      return true;
    },
    [filtros.situacao, filtros.categorias, idPorCategoria],
  );

  const filtrados = useMemo(
    () => defeitos.filter((d) => passaNoFiltro(d, true)),
    [defeitos, passaNoFiltro],
  );
  // Se o filtro do cliente cortou algo, o backend não aplicou o filtro e as
  // contagens de `celulas` incluem o que não deveria aparecer: bolhas e calor
  // passam a contar só os pinos recebidos.
  const contagemDoBackendValida = filtrados.length === defeitos.length;

  /** Chamados da área visível, mais perto primeiro (sem GPS, na ordem do backend). */
  const proximos = useMemo<ItemProximo[]>(() => {
    if (!posicao) {
      return filtrados.map((defeito) => ({
        defeito,
        distancia: Number.POSITIVE_INFINITY,
        icone: iconePorCategoria.get(nomeDaCategoria(defeito)),
        emAlcance: false,
      }));
    }
    return filtrados
      .map((defeito) => {
        const distancia = distanciaAte(defeito, posicao.latitude, posicao.longitude);
        return {
          defeito,
          distancia,
          icone: iconePorCategoria.get(nomeDaCategoria(defeito)),
          emAlcance: distancia <= RAIO_CONFIRMACAO_M && statusAberto(defeito.status),
        };
      })
      .sort((a, b) => a.distancia - b.distancia);
  }, [filtrados, posicao, iconePorCategoria]);

  // Na visão do município a lista vem inteira (só abertos): filtra por tipo
  // e calcula as células aqui, no zoom atual.
  const visaoFiltrada = useMemo(
    () => (visao ? visao.defeitos.filter((d) => passaNoFiltro(d, false)) : []),
    [visao, passaNoFiltro],
  );
  const celulaVisao = regiaoAtual ? celulaDaCaixa(caixaComFolga(regiaoAtual)) : 0;

  /**
   * O que está no mapa: pinos (a área visível ou, na visão do município, a
   * cidade rareada pelo zoom atual) e as bolhas das células que não couberam.
   * O selecionado e os que estão no alcance nunca somem dentro de uma bolha.
   */
  const { visiveis, clusters } = useMemo(() => {
    const idSelecionado = selecionado?.id;
    let itens: ItemProximo[];
    let contagens: AreaDoMapa['celulas'];
    let celula: number;
    if (visao) {
      const lista = regiaoAtual ? rarear(visaoFiltrada, regiaoAtual) : visaoFiltrada;
      itens = lista.map((defeito) => ({
        defeito,
        distancia: posicao
          ? distanciaAte(defeito, posicao.latitude, posicao.longitude)
          : Number.POSITIVE_INFINITY,
        icone: iconePorCategoria.get(nomeDaCategoria(defeito)),
        emAlcance: false,
      }));
      contagens = celulasDe(visaoFiltrada, celulaVisao);
      celula = celulaVisao;
    } else {
      itens = proximos;
      contagens = contagemDoBackendValida ? celulas : [];
      celula = celulaGraus;
    }
    const agrupado = agruparEmClusters(
      itens.map((i) => ({ ...i, latitude: i.defeito.latitude, longitude: i.defeito.longitude })),
      contagens,
      celula,
      (i) => i.emAlcance || i.defeito.id === idSelecionado,
    );
    return {
      visiveis: agrupado.pinos,
      clusters: agrupado.clusters.map<ClusterMapa>((c) => ({
        key: c.key,
        coordenada: { latitude: c.latitude, longitude: c.longitude },
        total: c.total,
      })),
    };
  }, [
    visao,
    visaoFiltrada,
    regiaoAtual,
    celulaVisao,
    posicao,
    iconePorCategoria,
    proximos,
    contagemDoBackendValida,
    celulas,
    celulaGraus,
    selecionado?.id,
  ]);

  // Calor com a contagem real: na visão do município a lista já é completa;
  // na navegação, os quadrantes do backend (os pinos vêm cortados).
  const usarCelulasNoCalor = !visao && contagemDoBackendValida;
  const celulasCalor = useMemo<HeatCell[]>(() => {
    if (!filtros.calor) return [];
    if (visao) return agruparParaHeatmap(visaoFiltrada);
    if (!usarCelulasNoCalor) return agruparParaHeatmap(filtrados);
    return celulas.map((c) => ({
      key: `area-${c.latitude.toFixed(5)}:${c.longitude.toFixed(5)}`,
      latitude: c.latitude,
      longitude: c.longitude,
      peso: c.total,
    }));
  }, [filtros.calor, visao, visaoFiltrada, usarCelulasNoCalor, filtrados, celulas]);
  const pesoMaximo = useMemo(
    () => celulasCalor.reduce((max, c) => Math.max(max, c.peso), 1),
    [celulasCalor],
  );

  const circulos = useMemo<CirculoMapa[]>(() => {
    const lista: CirculoMapa[] = [];
    // Na visão do município o raio ao redor da pessoa só polui.
    if (posicao && !visao && isAuthenticated) {
      lista.push({
        key: 'raio-confirmacao',
        centro: { latitude: posicao.latitude, longitude: posicao.longitude },
        raio: RAIO_CONFIRMACAO_M,
        corPreenchimento: 'rgba(212,175,55,0.10)',
        corBorda: '#D4AF37',
        larguraBorda: 2,
      });
    }
    for (const celula of celulasCalor) {
      lista.push({
        key: `calor-${celula.key}`,
        centro: { latitude: celula.latitude, longitude: celula.longitude },
        raio: usarCelulasNoCalor
          ? raioNaCelula(celula.peso, pesoMaximo, celulaGraus)
          : raioDoPeso(celula.peso, pesoMaximo),
        corPreenchimento: corDoPeso(celula.peso, pesoMaximo),
      });
    }
    return lista;
  }, [posicao, isAuthenticated, celulasCalor, pesoMaximo, usarCelulasNoCalor, celulaGraus, visao]);

  const marcadores = useMemo<MarcadorMapa[]>(
    () =>
      visiveis.map(({ defeito, icone, emAlcance, distancia }) => {
        const resolvido = normalizarStatus(defeito.status) === 'concluido';
        const perto = Number.isFinite(distancia) ? `, a ${Math.round(distancia)} metros` : '';
        return {
          key: String(defeito.id),
          coordenada: { latitude: defeito.latitude, longitude: defeito.longitude },
          cor: getStatusColor(defeito.status, concluidoEm(defeito)),
          icone,
          emAlcance,
          resolvido,
          selecionado: selecionado?.id === defeito.id,
          rotuloAcessivel: `${nomeDaCategoria(defeito) || defeito.titulo}, ${rotuloCidadao(defeito.status)}${perto}${emAlcance ? ', perto o bastante para confirmar' : ''}`,
        };
      }),
    [visiveis, selecionado?.id],
  );

  /** Liga a visão do município: enquadra a cidade e carrega abertos + ranking. */
  async function abrirVisaoMunicipio() {
    if (!posicao) {
      addToast(erroGps ?? 'Aguardando sinal do GPS...', 'info');
      return;
    }
    setCarregandoVisao(true);
    try {
      const dados = await api.visaoMunicipio(posicao.latitude, posicao.longitude);
      setVisao(dados);
      setSeguindo(false);
      setSelecionado(null);
      setDestino(null);
      // Enquadra só onde há chamados (mais a pessoa, para dar contexto);
      // o município inteiro só quando não há nenhum aberto — em cidades
      // gigantes o zoom-out total deixaria os pinos invisíveis.
      const caixa = caixaDosPontos([...dados.defeitos, posicao]);
      mapRef.current?.animarPara(
        regiaoDaCaixa(dados.defeitos.length > 0 && caixa ? caixa : dados.municipio),
      );
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Não foi possível carregar a cidade.', 'error');
    } finally {
      setCarregandoVisao(false);
    }
  }

  function fecharVisaoMunicipio() {
    setVisao(null);
    setSelecionado(null);
    recentrar();
  }

  function pedirLogin(mensagem: string) {
    addToast.info(mensagem, {
      action: { label: 'Entrar', onPress: () => router.push('/login') },
    });
  }

  function abrirNovoChamado(coordinate: { latitude: number; longitude: number }) {
    // Em qual cidade o ponto caiu é o backend que resolve (PostGIS) e grava
    // no chamado — o app não precisa saber de município.
    router.push({
      pathname: '/novo',
      params: { lat: String(coordinate.latitude), lng: String(coordinate.longitude) },
    });
  }

  /** Waze: reporta onde o usuário está agora. Sem sessão, leva ao login. */
  function reportarAqui() {
    if (!isAuthenticated) {
      addToast('Entre para abrir um chamado.', 'info');
      router.push('/login');
      return;
    }
    if (!posicao) {
      addToast(erroGps ?? 'Aguardando sinal do GPS...', 'error');
      return;
    }
    abrirNovoChamado({ latitude: posicao.latitude, longitude: posicao.longitude });
  }

  function reportarNoDestino() {
    if (!destino) return;
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
    abrirNovoChamado({ latitude: destino.latitude, longitude: destino.longitude });
  }

  function irParaEndereco(r: ResultadoEndereco) {
    setDestino(r);
    setSeguindo(false);
    setSelecionado(null);
    mapRef.current?.animarPara(regiaoDoEndereco(r));
  }

  function recentrar() {
    if (!posicao) {
      if (permitido === false) tentarNovamente();
      addToast(erroGps ?? 'Aguardando sinal do GPS...', 'info');
      return;
    }
    setDestino(null);
    setSeguindo(true);
    mapRef.current?.seguir(posicao);
  }

  /** Bolha: aproxima duas potências de zoom em torno dela, o que abre os pinos. */
  function aproximarCluster(key: string) {
    const cluster = clusters.find((c) => c.key === key);
    if (!cluster || !regiaoAtual) return;
    setSeguindo(false);
    mapRef.current?.animarPara({
      ...cluster.coordenada,
      latitudeDelta: Math.max(regiaoAtual.latitudeDelta / 4, DELTA_MINIMO / 2),
      longitudeDelta: Math.max(regiaoAtual.longitudeDelta / 4, DELTA_MINIMO / 2),
    });
  }

  function aplicarPatch(id: number, patch: Partial<Defeito>) {
    setDefeitos((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
    setSelecionado((prev) => (prev?.id === id ? { ...prev, ...patch } : prev));
  }

  function substituir(defeito: Defeito) {
    setDefeitos((prev) => prev.map((d) => (d.id === defeito.id ? defeito : d)));
    setSelecionado(defeito);
  }

  function remover(id: number) {
    setDefeitos((prev) => prev.filter((d) => d.id !== id));
    setSelecionado((prev) => (prev?.id === id ? null : prev));
  }

  function alternarApoio(id: number, apoiado: boolean) {
    setApoiei((prev) => {
      const next = new Set(prev);
      if (apoiado) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function alterarSinalizacao(id: number, tipo: TipoSinalizacao | null) {
    setSinalizei((prev) => {
      const next = new Map(prev);
      if (tipo) next.set(id, tipo);
      else next.delete(id);
      return next;
    });
  }

  async function abrirDetalhe(defeito: Defeito) {
    setSelecionado(defeito);
    try {
      const completo = await api.detalharDefeito(defeito.id);
      // Tocou em outro pino (ou fechou) antes de o detalhe chegar: não troca.
      setSelecionado((atual) => (atual?.id === defeito.id ? completo : atual));
    } catch (err) {
      // Mantém os dados resumidos da listagem: dá para ver e agir, só sem
      // a foto e o histórico completos.
      console.warn('[mapa] detalhe do chamado indisponível', err);
    }
  }

  // Visitante não vê quem reportou (nem mascarado): o mapa é público, a
  // autoria é dado pessoal. O backend já mascara; aqui some de vez.
  const selecionadoExibido = useMemo(
    () =>
      selecionado && !isAuthenticated
        ? { ...selecionado, autor_nome: undefined, usuario: null }
        : selecionado,
    [selecionado, isAuthenticated],
  );

  const distanciaSelecionado =
    selecionado && posicao ? distanciaAte(selecionado, posicao.latitude, posicao.longitude) : null;

  const rodape = insets.bottom + Spacing[4];
  const nFiltros = filtrosAtivos(filtros);
  // Dicas só depois do mapa na tela (senão apontam para nada) e fora da
  // visão da cidade, que tem o próprio painel no rodapé.
  const mostrarDicas = dicasVistas === false && mapaPronto && !visao;

  return (
    <View style={[styles.container, { backgroundColor: colors.bgPrimary, paddingTop: insets.top }]}>
      <View style={styles.mapaWrapper}>
        {regiaoInicial ? (
          <MapSurface
            ref={mapRef}
            regiaoInicial={regiaoInicial}
            circulos={circulos}
            marcadores={marcadores}
            clusters={clusters}
            destino={destino}
            usuario={posicao}
            direcao={bussola ?? posicao?.heading ?? null}
            onLongPressMapa={(c) => {
              if (isAuthenticated) abrirNovoChamado(c);
              else pedirLogin('Entre na sua conta para reportar um problema neste ponto.');
            }}
            onPressMarcador={(key) => {
              const item = visiveis.find((p) => String(p.defeito.id) === key);
              if (item) {
                setSeguindo(false);
                abrirDetalhe(item.defeito);
              }
            }}
            onPressCluster={aproximarCluster}
            onArrastar={() => setSeguindo(false)}
            onRegiaoMudou={setRegiao}
            onPronto={() => setMapaPronto(true)}
            escuro={theme === 'dark'}
          />
        ) : (
          <View style={styles.esperandoGps}>
            <ActivityIndicator color={colors.gold500} />
            <Text style={[styles.esperandoGpsTexto, { color: colors.textMuted }]}>
              Obtendo sua localização...
            </Text>
          </View>
        )}

        {/* Topo, no meio: busca de endereço. Fica acima da legenda (z-index)
            porque a lista de resultados desce sobre ela. */}
        <View style={styles.topoBusca} pointerEvents="box-none">
          <BuscaEndereco perto={posicao} onEscolher={irParaEndereco} />
        </View>

        {/* Canto superior esquerdo: cartão da conta — avatar e, logado, o
            nível/EXP no mesmo cartão — e a legenda logo abaixo. */}
        <View style={styles.topoEsquerda} pointerEvents="box-none">
          <Pressable
            onPress={() => router.push('/conta')}
            accessibilityRole="button"
            accessibilityLabel={
              isAuthenticated && progresso
                ? `Abrir menu da conta. Nível ${progresso.nivel}, ${progresso.xp} pontos de experiência`
                : 'Abrir menu da conta'
            }
            style={styles.contaCartao}>
            <View
              style={[
                styles.contaAvatar,
                { backgroundColor: colors.bgSurface, borderColor: colors.borderDefault },
              ]}>
              {isAuthenticated && user?.nome ? (
                <Text style={[styles.contaInicial, { color: colors.textPrimary }]}>
                  {user.nome.charAt(0).toUpperCase()}
                </Text>
              ) : (
                <Ionicons name="person" size={18} color={colors.textSecondary} />
              )}
            </View>
            {isAuthenticated && progresso ? (
              <>
                <View
                  style={[
                    styles.xpBarra,
                    { backgroundColor: colors.bgSurface, borderColor: colors.borderDefault },
                  ]}>
                  <View
                    style={[
                      styles.xpBarraCheia,
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
                <Text style={[styles.xpNivel, { color: colors.textPrimary }]}>
                  Nv {progresso.nivel}
                </Text>
              </>
            ) : null}
          </Pressable>
          {legendaAberta !== null ? (
            <View style={styles.legenda}>
              <LegendaMapa
                aberta={legendaAberta}
                onAlternar={() => setLegendaAberta(!legendaAberta)}
                situacao={visao ? 'abertos' : filtros.situacao}
                calor={filtros.calor}
                mostrarAlcance={isAuthenticated && !visao}
              />
            </View>
          ) : null}
        </View>

        {/* Canto superior direito: notificações (logado), visão do
            município, ranking e camadas. */}
        <View style={styles.topoDireita}>
          <SinoNotificacoes floating />
          <Pressable
            onPress={visao ? fecharVisaoMunicipio : abrirVisaoMunicipio}
            disabled={carregandoVisao}
            accessibilityRole="button"
            accessibilityLabel={
              visao ? 'Voltar para a navegação' : 'Ver a cidade inteira e a transparência da prefeitura'
            }
            accessibilityState={{ busy: carregandoVisao, selected: !!visao }}
            style={[
              styles.botaoRedondo,
              {
                backgroundColor: visao ? colors.gold500 : colors.bgSurface,
                borderColor: visao ? colors.gold500 : colors.borderDefault,
                opacity: carregandoVisao ? 0.6 : 1,
              },
            ]}>
            {carregandoVisao ? (
              <ActivityIndicator size="small" color={colors.textSecondary} />
            ) : (
              <Ionicons
                name={visao ? 'contract' : 'expand'}
                size={18}
                color={visao ? colors.textInverse : colors.textSecondary}
              />
            )}
          </Pressable>
          <Pressable
            onPress={() =>
              // Com a visão do município aberta, o ranking já abre nessa cidade.
              router.push(
                visao
                  ? {
                      pathname: '/ranking',
                      params: {
                        municipio: visao.municipio.codigo,
                        nome: visao.municipio.nome,
                        uf: visao.municipio.uf_sigla,
                      },
                    }
                  : '/ranking',
              )
            }
            accessibilityRole="button"
            accessibilityLabel="Ranking do município"
            style={[
              styles.botaoRedondo,
              { backgroundColor: colors.bgSurface, borderColor: colors.borderDefault },
            ]}>
            <Ionicons name="trophy" size={17} color={colors.gold500} />
          </Pressable>
          <Pressable
            onPress={() => setCamadasAbertas(true)}
            accessibilityRole="button"
            accessibilityLabel={
              nFiltros > 0
                ? `Camadas e filtros do mapa, ${nFiltros} ${nFiltros === 1 ? 'ativo' : 'ativos'}`
                : 'Camadas e filtros do mapa'
            }
            style={[
              styles.botaoRedondo,
              {
                backgroundColor: colors.bgSurface,
                borderColor: nFiltros > 0 ? colors.primary : colors.borderDefault,
              },
            ]}>
            <Ionicons name="layers" size={18} color={colors.textSecondary} />
            {nFiltros > 0 ? (
              <View
                style={[styles.selo, { backgroundColor: colors.primary, borderColor: colors.bgSurface }]}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants">
                <Text style={[styles.seloTexto, { color: colors.onPrimary }]}>{nFiltros}</Text>
              </View>
            ) : null}
          </Pressable>
        </View>

        {MOSTRAR_JOYSTICK ? <GpsJoystick posicaoReal={posicao} /> : null}

        <View style={[styles.rodape, { bottom: rodape }]} pointerEvents="box-none">
          {/* Avisos que pedem ação ficam aqui, perto do polegar. */}
          {permitido === false || erroGps ? (
            <View style={styles.fabLinha} pointerEvents="box-none">
              <Pressable
                onPress={tentarNovamente}
                accessibilityRole="button"
                style={[styles.pill, { backgroundColor: colors.bgElevated, borderColor: colors.error }]}>
                <Ionicons name="warning" size={14} color={colors.error} />
                <Text style={[styles.pillTexto, { color: colors.error }]}>
                  {erroGps ?? 'Localização indisponível'} · tocar para tentar de novo
                </Text>
              </Pressable>
            </View>
          ) : null}
          {erroArea && !visao ? (
            <View style={styles.fabLinha} pointerEvents="box-none">
              <Pressable
                onPress={() => regiaoAtual && carregarArea(regiaoAtual, true)}
                accessibilityRole="button"
                accessibilityLabel="Não foi possível atualizar os chamados do mapa. Tocar para tentar de novo"
                style={[styles.pill, { backgroundColor: colors.bgElevated, borderColor: colors.warning }]}>
                <Ionicons name="cloud-offline" size={14} color={colors.warning} />
                <Text style={[styles.pillTexto, { color: colors.textPrimary }]}>
                  Chamados desatualizados · tocar para tentar de novo
                </Text>
              </Pressable>
            </View>
          ) : null}

          {visao ? (
            <View style={styles.fabLinha} pointerEvents="box-none">
              <MunicipioPanel
                visao={visao}
                icones={iconePorCategoria}
                onSelecionar={(d) => {
                  abrirDetalhe(d);
                  mapRef.current?.animarPara({
                    latitude: d.latitude,
                    longitude: d.longitude,
                    latitudeDelta: 0.01,
                    longitudeDelta: 0.01,
                  });
                }}
                onAbrirChamado={abrirPorId}
                onFechar={fecharVisaoMunicipio}
              />
            </View>
          ) : (
            <>
              {mostrarDicas ? (
                <View style={styles.fabLinha} pointerEvents="box-none">
                  <DicasMapa logado={isAuthenticated} onConcluir={() => setDicasVistas(true)} />
                </View>
              ) : destino ? (
                <View style={styles.fabLinha} pointerEvents="box-none">
                  <DestinoCard
                    destino={destino}
                    logado={isAuthenticated}
                    onReportar={reportarNoDestino}
                    onFechar={() => setDestino(null)}
                  />
                </View>
              ) : null}
              <View style={styles.fabLinha} pointerEvents="box-none">
                {seguindo ? (
                  <Pressable
                    onPress={reportarAqui}
                    accessibilityRole="button"
                    accessibilityLabel={
                      isAuthenticated ? 'Reportar chamado na minha posição' : 'Entrar para reportar'
                    }
                    style={[
                      styles.fab,
                      {
                        backgroundColor:
                          posicao || !isAuthenticated ? colors.gold500 : colors.bgElevated,
                        borderColor:
                          posicao || !isAuthenticated ? colors.gold500 : colors.borderDefault,
                      },
                    ]}>
                    <Ionicons
                      name="megaphone"
                      size={20}
                      color={posicao || !isAuthenticated ? colors.textInverse : colors.textMuted}
                    />
                    <Text
                      style={[
                        styles.fabTexto,
                        {
                          color:
                            posicao || !isAuthenticated ? colors.textInverse : colors.textMuted,
                        },
                      ]}>
                      Reportar
                    </Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={recentrar}
                    accessibilityRole="button"
                    accessibilityLabel="Recentralizar na minha posição"
                    style={[
                      styles.fab,
                      { backgroundColor: colors.bgSurface, borderColor: colors.borderDefault },
                    ]}>
                    <Ionicons name="locate" size={20} color={colors.gold500} />
                    <Text style={[styles.fabTexto, { color: colors.textPrimary }]}>
                      Recentralizar
                    </Text>
                  </Pressable>
                )}
              </View>
            </>
          )}
        </View>
      </View>

      <CamadasSheet
        visible={camadasAbertas}
        onClose={() => setCamadasAbertas(false)}
        filtros={filtros}
        onChange={setFiltros}
        categorias={categorias}
        estadoCategorias={estadoCategorias}
        onRecarregarCategorias={recarregarCategorias}
        visaoCidade={!!visao}
      />

      <DefectSheet
        key={selecionado?.id}
        defeito={selecionadoExibido}
        apoiado={selecionado ? apoiei.has(selecionado.id) : false}
        distanciaM={distanciaSelecionado}
        onClose={() => setSelecionado(null)}
        onPatch={aplicarPatch}
        onReplace={substituir}
        onApoioToggle={alternarApoio}
        sinalizacao={selecionado ? (sinalizei.get(selecionado.id) ?? null) : null}
        onSinalizacaoChange={alterarSinalizacao}
        onRemove={remover}
      />
    </View>
  );
}

/** Coluna lateral (44) + margens: a busca ocupa o meio entre as duas. */
const LATERAL = Spacing[4] + 44 + Spacing[2];

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  mapaWrapper: {
    flex: 1,
  },
  esperandoGps: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[2],
  },
  esperandoGpsTexto: {
    fontSize: FontSize.sm,
  },
  // Os panes do Leaflet (web) usam z-index 400; sem isso os overlays somem.
  topoBusca: {
    position: 'absolute',
    zIndex: 1003,
    top: Spacing[3],
    left: LATERAL,
    right: LATERAL,
  },
  topoDireita: {
    position: 'absolute',
    zIndex: 1001,
    top: Spacing[3],
    right: Spacing[4],
    alignItems: 'center',
    gap: Spacing[2],
  },
  topoEsquerda: {
    position: 'absolute',
    zIndex: 1002,
    top: Spacing[3],
    left: Spacing[4],
    alignItems: 'flex-start',
  },
  legenda: {
    marginTop: Spacing[3],
  },
  // Como no rascunho: o círculo do avatar "apoiado" na barra de EXP, com o
  // nível logo abaixo — tudo um único toque.
  contaCartao: {
    alignItems: 'center',
    width: 44,
  },
  contaAvatar: {
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
  // Centralização exata da letra: o line-height ocupa o miolo do círculo
  // (44 - 2 de borda), senão a baseline da fonte empurra a letra do centro.
  contaInicial: {
    width: '100%',
    height: 42,
    lineHeight: 42,
    textAlign: 'center',
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
  },
  xpNivel: {
    fontSize: 12,
    fontWeight: FontWeight.semibold,
    lineHeight: 14,
    marginTop: 2,
    textShadowColor: 'rgba(0, 0, 0, 0.6)',
    textShadowRadius: 3,
  },
  xpBarra: {
    width: 44,
    height: 5,
    marginTop: 3,
    borderWidth: 1,
    borderRadius: Radius.full,
    overflow: 'hidden',
  },
  xpBarraCheia: {
    height: '100%',
    borderRadius: Radius.full,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: Spacing[1] + 2,
    minHeight: 44,
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
    borderWidth: 1,
    borderRadius: Radius.full,
    maxWidth: '100%',
  },
  pillTexto: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.medium,
    flexShrink: 1,
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
  // Quantos filtros fogem do padrão, no canto do botão de camadas.
  selo: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 4,
    borderRadius: Radius.full,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seloTexto: {
    fontSize: 11,
    lineHeight: 13,
    fontWeight: FontWeight.bold,
  },
  rodape: {
    position: 'absolute',
    zIndex: 1000,
    left: 0,
    right: 0,
    gap: Spacing[2],
  },
  fabLinha: {
    paddingHorizontal: Spacing[4],
  },
  fab: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[2],
    height: 56,
    paddingHorizontal: Spacing[5],
    borderWidth: 1,
    borderRadius: Radius.full,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  fabTexto: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
  },
});
