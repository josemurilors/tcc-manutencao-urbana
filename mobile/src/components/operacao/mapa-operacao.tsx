/**
 * Visão de mapa da operação: os chamados da fila em pinos e o roteiro do dia.
 *
 * **Rota inteligente**: o botão de rota junta os chamados da fila num raio ao
 * redor do servidor (com contagem por opção); "Traçar rota" ordena as paradas
 * partindo da posição atual — pelo OSRM (ruas) quando ele responde, senão em
 * linha reta (`utils/rota.ts`). Vencidos e os que vencem em 24 h formam um
 * bloco à frente. Chamados com outra pessoa ficam de fora. Montar o roteiro
 * não assume nada: assumir é na ficha, parada a parada.
 */

import { Ionicons } from '@expo/vector-icons';
import { useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { MapSurface } from '@/components/map-surface';
import type { CirculoMapa, LinhaMapa, MapSurfaceHandle, MarcadorMapa, Regiao } from '@/components/map-surface.types';
import { RoteiroPanel, type Roteiro } from '@/components/roteiro-panel';
import { Button } from '@/components/ui/button';
import { FilterChips } from '@/components/ui/chips';
import { IconButton } from '@/components/ui/icon-button';
import { AppText } from '@/components/ui/text';
import { getStatusColor, statusAberto } from '@/constants/status';
import { Elevation, Layout, Radius, Spacing } from '@/constants/theme';
import { useTheme, useColors } from '@/context/theme-context';
import { useToast } from '@/context/toast-context';
import { GpsJoystick } from '@/dev/gps-joystick';
import type { Posicao } from '@/hooks/use-localizacao';
import { routeOsrm, tripOsrm } from '@/services/osrm';
import { hojeLocal, type MotivoPulo } from '@/services/operacao-offline';
import type { ChamadoFila } from '@/types/operacao';
import { caixaDosPontos, haversineDistance, regiaoDaCaixa, REGIAO_PADRAO } from '@/utils/geo';
import { ordenarParadas } from '@/utils/rota';

import { nomeCategoria, venceEm24h } from './regras';

const MOSTRAR_JOYSTICK = __DEV__ && Platform.OS === 'web';

/** Raios da rota automática, em metros; 0 = toda a fila carregada. */
const RAIOS_ROTA_M = [500, 1000, 2000, 5000, 0] as const;
/** Acima disso o 2-opt e o OSRM ficam lentos/recusam. */
const MAX_PARADAS = 25;
/** O servidor só entra no enquadramento se estiver perto dos chamados. */
const PERTO_PARA_ENQUADRAR_M = 5000;

function rotuloRaio(raio: number) {
  if (raio === 0) return 'Todos';
  return raio >= 1000 ? `${raio / 1000} km` : `${raio} m`;
}

type Ponto = { latitude: number; longitude: number };

function comPosicaoSePerto(pontos: Ponto[], posicao: Ponto | null) {
  if (!posicao) return pontos;
  const perto =
    pontos.length === 0 ||
    pontos.some(
      (p) => haversineDistance(p.latitude, p.longitude, posicao.latitude, posicao.longitude) <= PERTO_PARA_ENQUADRAR_M,
    );
  return perto ? [...pontos, posicao] : pontos;
}

function regiaoDosPontos(pontos: Ponto[], posicao: Ponto | null): Regiao | null {
  const caixa = caixaDosPontos(comPosicaoSePerto(pontos, posicao));
  return caixa ? regiaoDaCaixa(caixa) : null;
}

type Props = {
  itens: ChamadoFila[];
  roteiro: Roteiro | null;
  icones: Map<string, string>;
  posicao: Posicao | null;
  bussola: number | null;
  erroGps: string | null;
  permitidoGps: boolean | null;
  tentarGps: () => void;
  meuId: string | null;
  selecionadoId: string | null;
  pendentes: Set<string>;
  /** Altura do que fica embaixo (barra de abas). */
  rodape: number;
  onAbrir: (c: ChamadoFila) => void;
  onRoteiro: (r: Roteiro) => void;
  onPular: (motivo: MotivoPulo) => void;
  onEncerrar: () => void;
};

export function MapaOperacao({
  itens,
  roteiro,
  icones,
  posicao,
  bussola,
  erroGps,
  permitidoGps,
  tentarGps,
  meuId,
  selecionadoId,
  pendentes,
  rodape,
  onAbrir,
  onRoteiro,
  onPular,
  onEncerrar,
}: Props) {
  const colors = useColors();
  const { theme } = useTheme();
  const toast = useToast();
  const mapRef = useRef<MapSurfaceHandle>(null);

  // Região em que o mapa nasce: já enquadrando a fila (ou o roteiro).
  const [inicial] = useState<Regiao>(
    () => regiaoDosPontos(roteiro?.paradas ?? itens, posicao) ?? REGIAO_PADRAO,
  );
  const [modoRota, setModoRota] = useState(false);
  const [raio, setRaio] = useState<number>(1000);
  const [selecao, setSelecao] = useState<Set<string>>(new Set());
  const [criando, setCriando] = useState(false);

  /** Abertos sem outra pessoa atendendo, mais perto primeiro (base da rota). */
  const candidatos = useMemo(() => {
    const livres = itens.filter(
      (c) => statusAberto(c.status) && (c.atendente_id == null || String(c.atendente_id) === meuId),
    );
    const comDistancia = livres.map((c) => ({
      c,
      d: posicao ? haversineDistance(c.latitude, c.longitude, posicao.latitude, posicao.longitude) : Infinity,
    }));
    return comDistancia.sort((a, b) => a.d - b.d);
  }, [itens, meuId, posicao]);

  const contagem = useMemo(
    () => RAIOS_ROTA_M.map((r) => ({ r, total: candidatos.filter((x) => r === 0 || x.d <= r).length })),
    [candidatos],
  );

  const marcadores = useMemo<MarcadorMapa[]>(() => {
    if (roteiro) {
      const feitas = new Set(roteiro.concluidas);
      return roteiro.paradas.map((c, i) => ({
        key: String(c.id),
        coordenada: { latitude: c.latitude, longitude: c.longitude },
        cor: feitas.has(String(c.id)) ? colors.textDisabled : getStatusColor(c.status),
        icone: icones.get(nomeCategoria(c)),
        rotulo: String(i + 1),
        selecionado: i === roteiro.atual,
      }));
    }
    return itens.map((c) => ({
      key: String(c.id),
      coordenada: { latitude: c.latitude, longitude: c.longitude },
      cor: getStatusColor(c.status),
      icone: icones.get(nomeCategoria(c)),
      emAlcance: modoRota && selecao.has(String(c.id)),
      selecionado: selecionadoId === String(c.id),
    }));
  }, [roteiro, itens, icones, modoRota, selecao, selecionadoId, colors.textDisabled]);

  const circulos = useMemo<CirculoMapa[]>(() => {
    if (!modoRota || !posicao || raio === 0) return [];
    return [
      {
        key: 'raio-rota',
        centro: { latitude: posicao.latitude, longitude: posicao.longitude },
        raio,
        corPreenchimento: 'rgba(212,175,55,0.08)',
        corBorda: 'rgba(212,175,55,0.6)',
        larguraBorda: 1,
      },
    ];
  }, [modoRota, posicao, raio]);

  const linhas = useMemo<LinhaMapa[]>(
    () =>
      roteiro && roteiro.geometria.length > 1
        ? [
            {
              key: 'roteiro',
              coordenadas: roteiro.geometria,
              cor: colors.primary,
              largura: 5,
              tracejada: roteiro.fonte === 'reta',
            },
          ]
        : [],
    [roteiro, colors.primary],
  );

  function enquadrar(pontos: Ponto[] = roteiro?.paradas ?? itens) {
    const regiao = regiaoDosPontos(pontos, posicao);
    if (regiao) mapRef.current?.animarPara(regiao);
    else toast.info('Nenhum chamado para enquadrar.');
  }

  function recentrar() {
    if (!posicao) {
      if (permitidoGps === false) tentarGps();
      toast.info(erroGps ?? 'Aguardando sinal do GPS...');
      return;
    }
    mapRef.current?.seguir(posicao);
  }

  function selecionarNoRaio(r: number) {
    if (!posicao) {
      toast.info(erroGps ?? 'Aguardando sinal do GPS para montar a rota...');
      return;
    }
    const dentro = candidatos.filter((x) => r === 0 || x.d <= r);
    if (dentro.length > MAX_PARADAS) toast.info(`Muitos chamados: a rota fica com os ${MAX_PARADAS} mais próximos.`);
    const escolhidos = dentro.slice(0, MAX_PARADAS);
    setRaio(r);
    setSelecao(new Set(escolhidos.map((x) => String(x.c.id))));
    setModoRota(true);
    if (escolhidos.length > 0) enquadrar(escolhidos.map((x) => x.c));
  }

  function alternar(id: string) {
    setSelecao((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size >= MAX_PARADAS) {
        toast.info(`No máximo ${MAX_PARADAS} paradas por rota.`);
        return prev;
      } else next.add(id);
      return next;
    });
  }

  async function tracar() {
    if (!posicao) {
      toast.info(erroGps ?? 'Aguardando sinal do GPS...');
      return;
    }
    const escolhidas = itens.filter((c) => selecao.has(String(c.id)));
    if (escolhidas.length === 0) return;
    setCriando(true);
    const origem = { latitude: posicao.latitude, longitude: posicao.longitude };
    // Vencidos e os que vencem hoje vão à frente; o score desempata dentro do bloco.
    const prioritaria = (c: ChamadoFila) => !!c.sla_vencido || venceEm24h(c);
    const porScore = [...escolhidas].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const ordemLocal = () =>
      ordenarParadas(
        origem,
        porScore.map((c) => ({ ...c, prioritario: prioritaria(c) })),
      );

    let paradas: ChamadoFila[];
    let geometria: Ponto[];
    let distanciaM: number;
    let duracaoS: number | null;
    let fonte: Roteiro['fonte'];
    try {
      if (!escolhidas.some(prioritaria)) {
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
    } catch (err) {
      // OSRM fora do ar, sem rede ou não configurado: linha reta, ordem local.
      if (__DEV__) console.warn('[rota] OSRM indisponível', err);
      const local = ordemLocal();
      paradas = local.paradas;
      geometria = [origem, ...paradas.map((p) => ({ latitude: p.latitude, longitude: p.longitude }))];
      distanciaM = local.distanciaM;
      duracaoS = null;
      fonte = 'reta';
    } finally {
      setCriando(false);
    }

    onRoteiro({
      usuario_id: meuId,
      data: hojeLocal(),
      paradas,
      atual: 0,
      concluidas: [],
      puladas: {},
      geometria,
      distanciaM,
      duracaoS,
      fonte,
    });
    setModoRota(false);
    setSelecao(new Set());
    enquadrar(paradas);
    if (fonte === 'reta') toast.info('Sem rota por ruas agora; traçado em linha reta.');
  }

  return (
    <View style={styles.raiz}>
      <MapSurface
        ref={mapRef}
        regiaoInicial={inicial}
        circulos={circulos}
        marcadores={marcadores}
        linhas={linhas}
        usuario={posicao}
        direcao={bussola ?? posicao?.heading ?? null}
        onLongPressMapa={() => {}}
        onPressMarcador={(key) => {
          const c = (roteiro?.paradas ?? itens).find((x) => String(x.id) === key);
          if (!c) return;
          if (modoRota) alternar(key);
          else onAbrir(c);
        }}
        onArrastar={() => {}}
        escuro={theme === 'dark'}
      />

      <View style={[styles.lateral, { bottom: rodape + (roteiro ? 320 : modoRota ? 168 : 72) }]}>
        {!roteiro ? (
          <IconButton
            icon={modoRota ? 'close' : 'git-branch'}
            accessibilityLabel={modoRota ? 'Cancelar montagem da rota' : 'Montar roteiro do dia'}
            variant={modoRota ? 'primary' : 'surface'}
            floating
            onPress={() => (modoRota ? setModoRota(false) : selecionarNoRaio(raio))}
          />
        ) : null}
        <IconButton icon="scan" accessibilityLabel="Enquadrar os chamados" variant="surface" floating onPress={() => enquadrar()} />
        <IconButton icon="locate" accessibilityLabel="Ir para a minha posição" variant="surface" floating onPress={recentrar} />
      </View>

      {MOSTRAR_JOYSTICK ? <GpsJoystick posicaoReal={posicao} /> : null}

      <View style={[styles.rodape, { bottom: rodape }]} pointerEvents="box-none">
        {roteiro ? (
          <RoteiroPanel
            roteiro={roteiro}
            icones={icones}
            origem={posicao}
            pendentes={pendentes}
            onAbrir={onAbrir}
            onPular={onPular}
            onFechar={onEncerrar}
          />
        ) : modoRota ? (
          <View style={[styles.painel, Elevation.md, { backgroundColor: colors.surface, borderColor: colors.primary }]}>
            <AppText variant="label">
              Roteiro · {selecao.size} parada{selecao.size === 1 ? '' : 's'}
            </AppText>
            <AppText variant="caption" tone="secondary">
              Chamados da fila num raio de {rotuloRaio(raio).toLowerCase()}. Toque num pino para tirar ou pôr.
            </AppText>
            <FilterChips
              options={contagem.map(({ r, total }) => ({ value: String(r), label: `${rotuloRaio(r)} · ${total}` }))}
              value={String(raio)}
              onChange={(v) => selecionarNoRaio(Number(v))}
              accessibilityLabel="Raio da rota"
            />
            <Button
              block
              onPress={tracar}
              loading={criando}
              disabled={selecao.size === 0}
              icon={<Ionicons name="navigate" size={16} color={colors.onPrimary} />}>
              {selecao.size === 0 ? 'Nenhum chamado no raio' : `Traçar rota · ${selecao.size}`}
            </Button>
          </View>
        ) : (
          <View style={[styles.dica, Elevation.sm, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Ionicons name="information-circle" size={18} color={colors.textSecondary} />
            <AppText variant="caption" tone="secondary" style={styles.flex}>
              {itens.length} chamado{itens.length === 1 ? '' : 's'} da fila no mapa. Toque num pino para abrir a ficha
              ou monte o roteiro do dia.
            </AppText>
          </View>
        )}
      </View>
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
  // Os panes do Leaflet (web) usam z-index 400; sem isso os overlays somem.
  lateral: {
    position: 'absolute',
    zIndex: 1000,
    right: Layout.gutter,
    gap: Spacing[2],
  },
  rodape: {
    position: 'absolute',
    zIndex: 1000,
    left: 0,
    right: 0,
    paddingHorizontal: Layout.gutter,
  },
  painel: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing[3],
    gap: Spacing[2],
  },
  dica: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing[3],
  },
});
