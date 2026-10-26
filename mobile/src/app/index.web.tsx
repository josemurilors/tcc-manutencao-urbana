/**
 * Página de início do site (só web — o app instalado abre no `index.tsx`).
 * Porte da landing do antigo frontend: o mapa real da cidade com os chamados
 * abertos é o destaque, com os números ao vivo, a consulta por protocolo e o
 * "como funciona". Usa a cidade de quem está vendo quando a localização é
 * liberada; sem ela (ou fora de um município atendido), Criciúma.
 */

import 'leaflet/dist/leaflet.css';

import '@/components/map-surface.web.css';

import { Ionicons } from '@expo/vector-icons';
import { Link, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { CircleMarker, MapContainer, TileLayer, useMap } from 'react-leaflet';
import { Image, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { useBreakpoint } from '@/components/ui/responsive';
import { AppText } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useTheme } from '@/context/theme-context';
import { api } from '@/services/api';
import { normalizarProtocolo } from '@/services/api-cidadao';
import type { VisaoMunicipio } from '@/types';

const CENTRO: [number, number] = [-28.67, -49.38];
const TILES = process.env.EXPO_PUBLIC_TILES_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATRIBUICAO =
  process.env.EXPO_PUBLIC_TILES_ATTRIB ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const LARGURA_MAX = 1180;
const LARGURA_CARTAO = 480;

const PASSOS = [
  { titulo: 'Marque e fotografe', desc: 'Toque no ponto do mapa onde está o problema e anexe uma foto.' },
  { titulo: 'A triagem é automática', desc: 'O sistema identifica o tipo de problema e envia à secretaria responsável.' },
  { titulo: 'Acompanhe até resolver', desc: 'Você recebe um protocolo e é avisado a cada mudança de status.' },
];

/** Enquadra a cidade; no computador o cartão cobre a esquerda, então ela vai para a direita. */
function Enquadrar({ municipio, folgaEsquerda }: { municipio?: VisaoMunicipio['municipio']; folgaEsquerda: number }) {
  const map = useMap();
  useEffect(() => {
    if (!municipio?.min_lat) return;
    map.fitBounds(
      [[municipio.min_lat, municipio.min_lng], [municipio.max_lat, municipio.max_lng]],
      { animate: false, paddingTopLeft: [folgaEsquerda, 0] },
    );
  }, [map, municipio, folgaEsquerda]);
  return null;
}

function ConsultaProtocolo() {
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  // Reaproveita a tela pública de protocolo do app em vez de repetir o resultado aqui.
  function consultar() {
    const protocolo = normalizarProtocolo(texto);
    if (!protocolo) {
      setErro('Digite o número completo, com o ano. Ex.: 2026-000123');
      return;
    }
    router.push({ pathname: '/protocolo/[protocolo]', params: { protocolo } });
  }

  return (
    <View style={{ gap: Spacing[2] }}>
      <TextField
        label="Já fez um chamado? Consulte pelo protocolo"
        value={texto}
        onChangeText={(t) => {
          setTexto(t);
          if (erro) setErro(null);
        }}
        placeholder="2026-000123"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        onSubmitEditing={consultar}
        invalid={!!erro}
        hint={erro ?? undefined}
      />
      <Button variant="ghost" icon={<Ionicons name="search" size={16} />} onPress={consultar}>
        Consultar
      </Button>
    </View>
  );
}

export default function Inicio() {
  const { theme, colors } = useTheme();
  const { isAuthenticated } = useAuth();
  const { desktop, tablet } = useBreakpoint();
  const largo = desktop || tablet;
  const [resumo, setResumo] = useState<VisaoMunicipio | null>(null);

  useEffect(() => {
    let cancelado = false;
    const carregar = (lat: number, lng: number) =>
      api.visaoMunicipio(lat, lng).then((r) => { if (!cancelado) setResumo(r); }).catch(() => {});
    carregar(...CENTRO);
    // Localização recusada ou fora de um município atendido (404) mantém o centro padrão.
    navigator.geolocation?.getCurrentPosition(
      ({ coords }) => carregar(coords.latitude, coords.longitude),
      () => {},
      { timeout: 10000, maximumAge: 300000 },
    );
    return () => { cancelado = true; };
  }, []);

  const pontos = (resumo?.defeitos ?? []).filter((d) => d.latitude && d.longitude);
  const maisReportados = (resumo?.tipos ?? []).slice(0, 3);
  const entrar = () => router.push(isAuthenticated ? '/mapa' : '/login');
  const bordas = { borderColor: colors.border };

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.pagina}>
      <View style={[styles.topo, bordas, { backgroundColor: colors.surfaceRaised }]}>
        <View style={styles.marca}>
          <Image source={{ uri: '/icon.svg' }} style={[styles.logo, { borderColor: colors.icon }]} accessibilityIgnoresInvertColors />
          <View style={styles.flex}>
            <AppText variant="label" numberOfLines={1}>Central de Inteligência Urbana</AppText>
            {largo && <AppText variant="caption" tone="muted">Chamados para serviços públicos</AppText>}
          </View>
        </View>
        <Button size="sm" onPress={entrar}>{isAuthenticated ? 'Abrir o mapa' : 'Entrar'}</Button>
      </View>

      {/* O mapa real da cidade é o destaque: mostra o produto em vez de descrevê-lo. */}
      <View style={[styles.destaque, { minHeight: largo ? 640 : 560 }]}>
        <View style={StyleSheet.absoluteFill} aria-hidden>
          <MapContainer
            center={CENTRO}
            zoom={12}
            style={{ height: '100%', width: '100%', background: colors.bg }}
            zoomControl={false}
            dragging={false}
            scrollWheelZoom={false}
            doubleClickZoom={false}
            touchZoom={false}
            keyboard={false}
            boxZoom={false}
            attributionControl>
            <TileLayer url={TILES} attribution={ATRIBUICAO} className={theme === 'dark' ? 'tiles-escuro' : undefined} noWrap />
            <Enquadrar municipio={resumo?.municipio} folgaEsquerda={largo ? LARGURA_CARTAO + 60 : 0} />
            {pontos.map((d) => {
              const cor = colors.status[d.status as keyof typeof colors.status]?.fg ?? colors.primary;
              return (
                <CircleMarker key={d.id} center={[d.latitude, d.longitude]} radius={5} interactive={false}
                  pathOptions={{ color: cor, weight: 1, fillOpacity: 0.75 }} />
              );
            })}
          </MapContainer>
        </View>

        <View style={[styles.faixa, { paddingVertical: largo ? Spacing[16] : Spacing[8] }]} pointerEvents="box-none">
          <View style={[styles.cartao, bordas, { backgroundColor: colors.bg, maxWidth: LARGURA_CARTAO }]}>
            <AppText variant="display" accessibilityRole="header" style={largo ? styles.tituloLargo : undefined}>
              Viu um problema na rua? Avise a prefeitura.
            </AppText>
            <AppText variant="body" tone="secondary">
              Buraco, poste apagado, vazamento ou lixo acumulado: marque no mapa, mande uma foto e
              acompanhe até ser resolvido.
            </AppText>
            <View style={[styles.acoes, { flexDirection: largo ? 'row' : 'column' }]}>
              <Button onPress={entrar} block={!largo}>Reportar um problema</Button>
              <Button variant="secondary" onPress={() => router.push('/mapa')} block={!largo}>Ver o mapa</Button>
            </View>
            <ConsultaProtocolo />
          </View>
        </View>
      </View>

      {resumo && (
        <View style={[styles.numeros, bordas, { backgroundColor: colors.surface }]}>
          <View style={[styles.largura, { flexDirection: largo ? 'row' : 'column', gap: Spacing[3], alignItems: largo ? 'baseline' : 'flex-start' }]}>
            {resumo.total_abertos > 0 ? (
              <AppText variant="title">
                <AppText variant="display" tone="brand">{resumo.total_abertos}</AppText>
                {' '}{resumo.total_abertos === 1 ? 'chamado aberto' : 'chamados abertos'} em {resumo.municipio?.nome} agora
              </AppText>
            ) : (
              <AppText variant="title">
                Nenhum chamado aberto em {resumo.municipio?.nome} agora. Viu algo? Seja o primeiro a avisar.
              </AppText>
            )}
            {maisReportados.length > 0 && (
              <AppText variant="bodySm" tone="secondary">
                Mais reportados: {maisReportados.map((t) => `${t.categoria} (${t.total})`).join(', ')}
              </AppText>
            )}
          </View>
        </View>
      )}

      <View style={[styles.largura, styles.secao]}>
        <AppText variant="headline" accessibilityRole="header">Como funciona</AppText>
        <View style={{ flexDirection: largo ? 'row' : 'column', gap: Spacing[8] }}>
          {PASSOS.map((p, i) => (
            <View key={p.titulo} style={styles.passo}>
              <AppText variant="display" tone="brand" aria-hidden>{i + 1}</AppText>
              <View style={styles.flex}>
                <AppText variant="title">{p.titulo}</AppText>
                <AppText variant="bodySm" tone="secondary">{p.desc}</AppText>
              </View>
            </View>
          ))}
        </View>
      </View>

      <View style={[styles.rodape, bordas]}>
        <AppText variant="caption" tone="muted">Central de Inteligência Urbana</AppText>
        <View style={styles.links}>
          <Link href="/privacidade"><AppText variant="caption" tone="muted">Privacidade</AppText></Link>
          <Link href="/termos"><AppText variant="caption" tone="muted">Termos de uso</AppText></Link>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pagina: { flexGrow: 1 },
  topo: {
    height: 56,
    paddingHorizontal: Spacing[5],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
  },
  marca: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing[2], marginRight: Spacing[3] },
  logo: { width: 28, height: 28, borderWidth: 1, borderRadius: Radius.sm },
  destaque: { position: 'relative', overflow: 'hidden' },
  faixa: { width: '100%', maxWidth: LARGURA_MAX, alignSelf: 'center', paddingHorizontal: Spacing[5] },
  cartao: { borderWidth: 1, borderRadius: Radius.lg, padding: Spacing[6], gap: Spacing[5], opacity: 0.96 },
  tituloLargo: { fontSize: 42, lineHeight: 46 },
  acoes: { gap: Spacing[3] },
  numeros: { paddingVertical: Spacing[8], paddingHorizontal: Spacing[5], borderTopWidth: 1, borderBottomWidth: 1 },
  largura: { width: '100%', maxWidth: LARGURA_MAX, alignSelf: 'center' },
  secao: { paddingVertical: Spacing[16], paddingHorizontal: Spacing[5], gap: Spacing[8] },
  passo: { flex: 1, flexDirection: 'row', gap: Spacing[4] },
  flex: { flex: 1, gap: Spacing[1] },
  rodape: {
    marginTop: 'auto',
    paddingVertical: Spacing[5],
    paddingHorizontal: Spacing[5],
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
  },
  links: { flexDirection: 'row', gap: Spacing[4] },
});
