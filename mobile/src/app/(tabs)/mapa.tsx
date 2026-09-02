/**
 * Mapa em modo de navegação — mistura de Waze (reportar onde se está) com
 * Pokémon Go (ver o que há ao redor e "capturar" confirmando no local).
 *
 * Tudo parte do GPS, que fica ligado enquanto a aba está aberta
 * (`useLocalizacao`):
 * - a câmera segue o usuário com zoom de rua; arrastar o mapa sai do modo
 *   "seguir" e o FAB vira "Recentralizar" até a câmera voltar ao usuário;
 * - o FAB redondo "Reportar" (centro inferior, só enquanto seguindo) abre o
 *   chamado na posição atual —
 *   sem tocar no mapa;
 *   toque longo ainda permite posicionar em outro ponto;
 * - as pendências são filtradas por um raio ao redor do usuário e listadas na
 *   bandeja inferior ordenadas por distância;
 * - dentro de `RAIO_CONFIRMACAO_M` o pino ganha anel dourado e o detalhe
 *   libera "Confirmar no local";
 * - o botão do canto superior direito abre a **visão do município**: enquadra a
 *   cidade onde a pessoa está, mostra todos os chamados abertos dela e um
 *   painel com rankings (tipos, mais antigos, mais confirmados).
 *
 * Trocas em relação ao web: Leaflet -> react-native-maps; `leaflet.heat` ->
 * células de densidade (`utils/heatmap.ts`); máscara do município via `holes`.
 */

import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DefectSheet } from '@/components/defect-sheet';
import { MunicipioPanel } from '@/components/municipio-panel';
import { MapSurface } from '@/components/map-surface';
import type {
  CirculoMapa,
  MapSurfaceHandle,
  MarcadorMapa,
  Regiao,
} from '@/components/map-surface.types';
import { RAIO_BUSCA_PADRAO_M, RAIO_CONFIRMACAO_M } from '@/constants/proximidade';
import { getStatusColor, STATUS_ABERTOS } from '@/constants/status';
import { FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useColors, useTheme } from '@/context/theme-context';
import { useToast } from '@/context/toast-context';
import { GpsJoystick } from '@/dev/gps-joystick';
import { useLocalizacao } from '@/hooks/use-localizacao';
import { api } from '@/services/api';
import { useProgresso } from '@/services/progresso';
import type { Categoria, Defeito, TipoSinalizacao, VisaoMunicipio } from '@/types';
import { concluidoEm } from '@/utils/format';
import { caixaDosPontos, distanciaAte, regiaoDaCaixa, REGIAO_PADRAO } from '@/utils/geo';
import { agruparParaHeatmap, corDoPeso, raioDoPeso } from '@/utils/heatmap';

type ItemProximo = {
  defeito: Defeito;
  distancia: number;
  icone?: string;
  emAlcance: boolean;
};

/** Joystick de GPS só no desktop em desenvolvimento (no celular há GPS de verdade). */
const MOSTRAR_JOYSTICK = __DEV__ && Platform.OS === 'web';

export default function MapaScreen() {
  const colors = useColors();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const addToast = useToast();
  const { user, isAuthenticated } = useAuth();
  const { posicao, bussola, permitido, erro: erroGps, tentarNovamente } = useLocalizacao();
  // `?abrir=<id>`: o formulário de novo chamado manda para cá quando o backend
  // apontou um duplicado — abre o existente para a pessoa confirmar.
  const { abrir } = useLocalSearchParams<{ abrir?: string }>();

  const mapRef = useRef<MapSurfaceHandle>(null);
  const [defeitos, setDefeitos] = useState<Defeito[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  // Sem menu de filtros: o mapa mostra sempre as pendências no raio padrão.
  const raio = RAIO_BUSCA_PADRAO_M;
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
  // Nível/EXP no cartão da conta; as ações que dão XP recarregam o store.
  const progresso = useProgresso(isAuthenticated);

  // O mapa não é preso a município nenhum: qualquer cidade do país vale. Ele
  // abre num enquadramento neutro e pula para o GPS assim que houver posição.
  const regiaoInicial: Regiao = REGIAO_PADRAO;

  const iconePorCategoria = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const c of categorias) if (c.icone) mapa.set(c.nome, c.icone);
    return mapa;
  }, [categorias]);

  const carregarDefeitos = useCallback(async () => {
    try {
      setDefeitos(await api.listDefeitos());
    } catch {
      // Sem rede o mapa apenas fica sem marcadores.
    }
  }, []);

  // Recarrega ao voltar do formulário de novo chamado.
  useFocusEffect(
    useCallback(() => {
      carregarDefeitos();
    }, [carregarDefeitos]),
  );

  useEffect(() => {
    api
      .listCategorias()
      .then(setCategorias)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelado = false;
    api
      .apoiei()
      .then((r) => {
        if (!cancelado) setApoiei(new Set(r.ids));
      })
      .catch(() => {});
    api
      .sinalizei()
      .then((r) => {
        if (!cancelado) {
          // Ids são UUIDs (strings) em runtime, como em `apoiei`.
          setSinalizei(new Map(Object.entries(r.sinalizacoes) as unknown as [number, TipoSinalizacao][]));
        }
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!abrir) return;
    let cancelado = false;
    api
      .detalharDefeito(abrir as unknown as number)
      .then((d) => {
        if (cancelado) return;
        setSelecionado(d);
        // Vindo de fora (ex.: "Ver no mapa" em Meus chamados), centraliza no
        // ponto em vez de continuar seguindo o GPS.
        if (d.latitude != null && d.longitude != null) {
          setSeguindo(false);
          mapRef.current?.animarPara({
            latitude: d.latitude,
            longitude: d.longitude,
            latitudeDelta: 0.005,
            longitudeDelta: 0.005,
          });
        }
      })
      .catch(() => {});
    router.setParams({ abrir: undefined });
    return () => {
      cancelado = true;
    };
  }, [abrir]);

  // Câmera de navegação: acompanha cada atualização do GPS enquanto "seguindo".
  // A posição do usuário manda; o município é só o enquadramento de fallback.
  useEffect(() => {
    if (!mapaPronto || !seguindo || !posicao) return;
    mapRef.current?.seguir(posicao);
  }, [mapaPronto, seguindo, posicao]);

  const filtrados = useMemo(
    () => defeitos.filter((d) => STATUS_ABERTOS.includes(d.status)),
    [defeitos],
  );

  /** Chamados dentro do raio, mais perto primeiro. Sem GPS, cai na lista inteira. */
  const proximos = useMemo<ItemProximo[]>(() => {
    if (!posicao) {
      return filtrados.map((defeito) => ({
        defeito,
        distancia: Number.POSITIVE_INFINITY,
        icone: iconePorCategoria.get(defeito.categoria ?? defeito.categoria_nome ?? ''),
        emAlcance: false,
      }));
    }
    return filtrados
      .map((defeito) => {
        const distancia = distanciaAte(defeito, posicao.latitude, posicao.longitude);
        return {
          defeito,
          distancia,
          icone: iconePorCategoria.get(defeito.categoria ?? defeito.categoria_nome ?? ''),
          emAlcance: distancia <= RAIO_CONFIRMACAO_M && STATUS_ABERTOS.includes(defeito.status),
        };
      })
      .filter((item) => item.distancia <= raio)
      .sort((a, b) => a.distancia - b.distancia);
  }, [filtrados, posicao, raio, iconePorCategoria]);

  /** O que está no mapa: a cidade inteira (visão do município) ou o raio ao redor. */
  const visiveis = useMemo<ItemProximo[]>(() => {
    if (!visao) return proximos;
    return visao.defeitos.map((defeito) => ({
      defeito,
      distancia: posicao
        ? distanciaAte(defeito, posicao.latitude, posicao.longitude)
        : Number.POSITIVE_INFINITY,
      icone: iconePorCategoria.get(defeito.categoria ?? defeito.categoria_nome ?? ''),
      emAlcance: false,
    }));
  }, [visao, proximos, posicao, iconePorCategoria]);

  const celulasCalor = useMemo(
    () => agruparParaHeatmap(visiveis.map((p) => p.defeito)),
    [visiveis],
  );
  const pesoMaximo = useMemo(
    () => celulasCalor.reduce((max, c) => Math.max(max, c.peso), 1),
    [celulasCalor],
  );

  // Visitantes só veem o agregado; marcadores individuais exigem login.
  const mostrarCalor = !isAuthenticated;

  const circulos = useMemo<CirculoMapa[]>(() => {
    const lista: CirculoMapa[] = [];
    // Na visão do município os raios ao redor da pessoa só poluem.
    if (posicao && !visao) {
      const centro = { latitude: posicao.latitude, longitude: posicao.longitude };
      lista.push({
        key: 'raio-busca',
        centro,
        raio,
        corPreenchimento: 'rgba(59,130,246,0.05)',
        corBorda: 'rgba(59,130,246,0.35)',
        larguraBorda: 1,
      });
      if (isAuthenticated) {
        lista.push({
          key: 'raio-confirmacao',
          centro,
          raio: RAIO_CONFIRMACAO_M,
          corPreenchimento: 'rgba(212,175,55,0.10)',
          corBorda: '#D4AF37',
          larguraBorda: 2,
        });
      }
    }
    if (mostrarCalor) {
      for (const celula of celulasCalor) {
        lista.push({
          key: celula.key,
          centro: { latitude: celula.latitude, longitude: celula.longitude },
          raio: raioDoPeso(celula.peso, pesoMaximo),
          corPreenchimento: corDoPeso(celula.peso, pesoMaximo),
        });
      }
    }
    return lista;
  }, [posicao, raio, isAuthenticated, mostrarCalor, celulasCalor, pesoMaximo, visao]);

  const marcadores = useMemo<MarcadorMapa[]>(
    () =>
      mostrarCalor
        ? []
        : visiveis.map(({ defeito, icone, emAlcance }) => ({
            key: String(defeito.id),
            coordenada: { latitude: defeito.latitude, longitude: defeito.longitude },
            cor: getStatusColor(defeito.status, concluidoEm(defeito)),
            icone,
            emAlcance,
            selecionado: selecionado?.id === defeito.id,
          })),
    [mostrarCalor, visiveis, selecionado?.id],
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

  function recentrar() {
    if (!posicao) {
      if (permitido === false) tentarNovamente();
      addToast(erroGps ?? 'Aguardando sinal do GPS...', 'info');
      return;
    }
    setSeguindo(true);
    mapRef.current?.seguir(posicao);
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
      setSelecionado(await api.detalharDefeito(defeito.id));
    } catch {
      // Mantém os dados resumidos da listagem.
    }
  }

  const distanciaSelecionado =
    selecionado && posicao ? distanciaAte(selecionado, posicao.latitude, posicao.longitude) : null;

  const rodape = insets.bottom + Spacing[4];

  return (
    <View style={[styles.container, { backgroundColor: colors.bgPrimary, paddingTop: insets.top }]}>
      <View style={styles.mapaWrapper}>
        <MapSurface
          ref={mapRef}
          regiaoInicial={regiaoInicial}
          circulos={circulos}
          marcadores={marcadores}
          usuario={posicao}
          direcao={bussola ?? posicao?.heading ?? null}
          onLongPressMapa={(c) => {
            if (isAuthenticated) abrirNovoChamado(c);
          }}
          onPressMarcador={(key) => {
            const item = visiveis.find((p) => String(p.defeito.id) === key);
            if (item) {
              setSeguindo(false);
              abrirDetalhe(item.defeito);
            }
          }}
          onArrastar={() => setSeguindo(false)}
          onPronto={() => setMapaPronto(true)}
          escuro={theme === 'dark'}
        />

        {/* Só o erro de GPS aparece no topo: é a única forma de tentar de novo. */}
        {permitido === false || erroGps ? (
          <View style={styles.topo} pointerEvents="box-none">
            <Pressable
              onPress={tentarNovamente}
              accessibilityRole="button"
              style={[
                styles.pill,
                { backgroundColor: colors.bgElevated, borderColor: colors.error },
              ]}>
              <Ionicons name="warning" size={13} color={colors.error} />
              <Text style={[styles.pillTexto, { color: colors.error }]}>
                {erroGps ?? 'Localização indisponível'} · tocar para tentar de novo
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/* Canto superior esquerdo: cartão da conta — avatar e, logado, o
            nível/EXP no mesmo cartão. */}
        <View style={styles.topoEsquerda}>
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
        </View>

        {/* Canto superior direito: visão do município e ranking de cidadãos. */}
        <View style={styles.topoDireita}>
          <Pressable
            onPress={visao ? fecharVisaoMunicipio : abrirVisaoMunicipio}
            disabled={carregandoVisao}
            accessibilityRole="button"
            accessibilityLabel={visao ? 'Voltar para a navegação' : 'Ver a cidade inteira'}
            style={[
              styles.botaoRedondo,
              {
                backgroundColor: visao ? colors.gold500 : colors.bgSurface,
                borderColor: visao ? colors.gold500 : colors.borderDefault,
                opacity: carregandoVisao ? 0.6 : 1,
              },
            ]}>
            <Ionicons
              name={visao ? 'contract' : 'expand'}
              size={18}
              color={visao ? colors.textInverse : colors.textSecondary}
            />
          </Pressable>
          <Pressable
            onPress={() => router.push('/ranking')}
            accessibilityRole="button"
            accessibilityLabel="Ranking do município"
            style={[
              styles.botaoRedondo,
              { backgroundColor: colors.bgSurface, borderColor: colors.borderDefault },
            ]}>
            <Ionicons name="trophy" size={17} color={colors.gold500} />
          </Pressable>
        </View>

        {MOSTRAR_JOYSTICK ? <GpsJoystick posicaoReal={posicao} /> : null}

        <View style={[styles.rodape, { bottom: rodape }]} pointerEvents="box-none">
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
                onFechar={fecharVisaoMunicipio}
              />
            </View>
          ) : (
            <View style={styles.fabLinha} pointerEvents="box-none">
              {seguindo ? (
                <Pressable
                  onPress={reportarAqui}
                  accessibilityRole="button"
                  accessibilityLabel="Reportar chamado na minha posição"
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
                        color: posicao || !isAuthenticated ? colors.textInverse : colors.textMuted,
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
          )}
        </View>
      </View>

      <DefectSheet
        key={selecionado?.id}
        defeito={selecionado}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  mapaWrapper: {
    flex: 1,
  },
  // Os panes do Leaflet (web) usam z-index 400; sem isso os overlays somem.
  topo: {
    position: 'absolute',
    zIndex: 1000,
    top: Spacing[3],
    left: Spacing[4],
    right: Spacing[4],
    alignItems: 'center',
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
    zIndex: 1001,
    top: Spacing[3],
    left: Spacing[4],
    alignItems: 'flex-start',
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
    fontSize: 10,
    fontWeight: FontWeight.semibold,
    lineHeight: 12,
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
    gap: Spacing[1] + 2,
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
