/**
 * `/transparencia/<codigo IBGE>` — portal público de transparência do
 * município. Abre sem login e é feito para ser compartilhado: o link vai no
 * site da prefeitura, na imprensa e na apresentação comercial (B2G).
 *
 * Dados de `GET /transparencia/<codigo>/` (contrato v3 §7.5, cache de 10 min
 * no backend). Em telas largas (≥ 900 px) as seções viram grade de duas
 * colunas, com largura máxima para não esticar no monitor.
 */

import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import Head from 'expo-router/head';
import { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConviteApp } from '@/components/transparencia/convite-app';
import {
  CabecalhoPortal,
  DadosAbertos,
  DesempenhoCategorias,
  GraficoMensal,
  KpisPortal,
  Open311,
  UltimosResolvidos,
} from '@/components/transparencia/secoes';
import { IconButton } from '@/components/ui/icon-button';
import { StateView } from '@/components/ui/state-view';
import { AppText } from '@/components/ui/text';
import { Layout, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import { useToast } from '@/context/toast-context';
import { ErroHttp } from '@/services/api-cidadao';
import { buscarPortal, compartilharPortal } from '@/services/api-transparencia';
import type { PortalTransparencia } from '@/types/transparencia';

const LARGURA_MAXIMA = 1120;
const LARGURA_GRADE = 900;

type Estado =
  | { tipo: 'ok'; dados: PortalTransparencia }
  | { tipo: 'falha'; kind: 'empty' | 'error' | 'offline'; mensagem: string };

function classificar(err: unknown): Extract<Estado, { tipo: 'falha' }> {
  const mensagem = err instanceof Error ? err.message : String(err);
  if (err instanceof ErroHttp && err.status === 404) return { tipo: 'falha', kind: 'empty', mensagem };
  if (/network request failed|failed to fetch|networkerror/i.test(mensagem)) {
    return { tipo: 'falha', kind: 'offline', mensagem };
  }
  return { tipo: 'falha', kind: 'error', mensagem };
}

export default function PortalTransparenciaScreen() {
  const { codigo: bruto } = useLocalSearchParams<{ codigo: string }>();
  const codigo = String(bruto ?? '').trim();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const largo = width >= LARGURA_GRADE;

  // Resultado guardado com o alvo (código + tentativa) que o produziu: trocar
  // de cidade ou tentar de novo mostra "carregando" sem zerar dentro do efeito.
  const [tentativa, setTentativa] = useState(0);
  const [resultado, setResultado] = useState<{ alvo: string; estado: Estado } | null>(null);
  const [atualizando, setAtualizando] = useState(false);
  const alvo = `${codigo}#${tentativa}`;

  useEffect(() => {
    let cancelado = false;
    buscarPortal(codigo)
      .then((dados) => {
        if (!cancelado) setResultado({ alvo, estado: { tipo: 'ok', dados } });
      })
      .catch((err: unknown) => {
        if (!cancelado) setResultado({ alvo, estado: classificar(err) });
      });
    return () => {
      cancelado = true;
    };
  }, [alvo, codigo]);

  async function atualizar() {
    setAtualizando(true);
    try {
      const dados = await buscarPortal(codigo);
      setResultado({ alvo, estado: { tipo: 'ok', dados } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível atualizar.');
    } finally {
      setAtualizando(false);
    }
  }

  const estado = resultado?.alvo === alvo ? resultado.estado : null;
  const dados = estado?.tipo === 'ok' ? estado.dados : null;
  const nomeCidade = dados ? `${dados.municipio.nome}/${dados.municipio.uf_sigla}` : '';

  function voltar() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/mapa');
  }

  async function compartilhar() {
    if (!dados) return;
    try {
      const r = await compartilharPortal(codigo, nomeCidade);
      if (r === 'copiado') toast.success('Link do portal copiado.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível compartilhar.');
    }
  }

  const k = dados?.kpis_90d;
  const descricao = k
    ? `${nomeCidade}: ${k.recebidos} problemas recebidos e ${k.resolvidos} resolvidos nos últimos 90 dias. Dados abertos e sem informação pessoal.`
    : 'Indicadores públicos de zeladoria urbana do município.';

  return (
    <View style={[styles.tela, { backgroundColor: colors.bg }]}>
      <Head>
        <title>{dados ? `Transparência · ${nomeCidade} · CIU` : 'Portal de transparência · CIU'}</title>
        <meta name="description" content={descricao} />
        <meta property="og:title" content={dados ? `Transparência · ${nomeCidade}` : 'Portal de transparência'} />
        <meta property="og:description" content={descricao} />
      </Head>

      <View
        style={[
          styles.barra,
          { paddingTop: insets.top + Spacing[1], borderBottomColor: colors.border, backgroundColor: colors.surface },
        ]}>
        <View style={styles.barraInterna}>
          <IconButton
            icon={router.canGoBack() ? 'arrow-back' : 'map-outline'}
            accessibilityLabel={router.canGoBack() ? 'Voltar' : 'Ir para o mapa'}
            onPress={voltar}
          />
          <AppText variant="label" numberOfLines={1} style={styles.flex}>
            CIU · Transparência{nomeCidade ? ` · ${nomeCidade}` : ''}
          </AppText>
          {dados ? (
            <IconButton
              icon="share-social-outline"
              accessibilityLabel="Compartilhar o portal"
              onPress={compartilhar}
            />
          ) : null}
        </View>
      </View>

      {!codigo ? (
        <StateView
          kind="empty"
          icon="search"
          title="Município não informado"
          description="O endereço do portal termina com o código IBGE da cidade."
          style={styles.estado}
        />
      ) : !estado ? (
        <StateView kind="loading" title="Carregando indicadores" skeleton={3} style={styles.estado} />
      ) : estado.tipo === 'falha' ? (
        estado.kind === 'empty' ? (
          <StateView
            kind="empty"
            icon="search"
            title="Município não encontrado"
            description="Confira o link. O portal usa o código IBGE da cidade (7 dígitos)."
            action={{ label: 'Ir para o mapa', onPress: () => router.replace('/(tabs)/mapa') }}
            style={styles.estado}
          />
        ) : (
          <StateView
            kind={estado.kind}
            description={estado.kind === 'error' ? estado.mensagem : undefined}
            onRetry={() => setTentativa((n) => n + 1)}
            style={styles.estado}
          />
        )
      ) : dados ? (
        <ScrollView
          contentContainerStyle={[styles.rolagem, { paddingBottom: insets.bottom + Spacing[10] }]}
          refreshControl={<RefreshControl refreshing={atualizando} onRefresh={atualizar} />}>
          <View style={styles.conteudo}>
            <CabecalhoPortal dados={dados} />
            <KpisPortal kpis={dados.kpis_90d} />

            <View style={largo ? styles.grade : styles.coluna}>
              <View style={largo ? styles.celula : null}>
                <GraficoMensal serie={dados.serie_mensal} />
              </View>
              <View style={largo ? styles.celula : null}>
                <DesempenhoCategorias categorias={dados.por_categoria} />
              </View>
            </View>

            <View style={largo ? styles.grade : styles.coluna}>
              <View style={largo ? styles.celula : null}>
                <UltimosResolvidos itens={dados.ultimos_resolvidos} />
              </View>
              <View style={[styles.coluna, largo ? styles.celula : null]}>
                <DadosAbertos codigo={codigo} />
                <Open311 codigo={codigo} />
              </View>
            </View>

            <ConviteApp
              titulo="Viu um problema na rua?"
              texto={`Registre pelo CIU em menos de um minuto, com foto e localização, e acompanhe até a prefeitura de ${dados.municipio.nome} resolver.`}
            />

            <View style={styles.rodape}>
              <Ionicons name="lock-closed-outline" size={14} color={colors.textMuted} />
              <AppText variant="caption" tone="muted" style={styles.flex}>
                Página pública, sem dados pessoais (LGPD). Chamados restritos entram nas contagens,
                mas não nas listas nem nos dados abertos; os removidos pela moderação ficam de fora.
              </AppText>
            </View>
          </View>
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tela: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  barra: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: Spacing[1],
    paddingHorizontal: Spacing[2],
  },
  barraInterna: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[1],
    width: '100%',
    maxWidth: LARGURA_MAXIMA,
    alignSelf: 'center',
    minHeight: Layout.minTouch,
  },
  estado: {
    padding: Layout.gutter,
  },
  rolagem: {
    paddingHorizontal: Layout.gutter,
    paddingTop: Spacing[6],
  },
  conteudo: {
    width: '100%',
    maxWidth: LARGURA_MAXIMA,
    alignSelf: 'center',
    gap: Layout.sectionGap,
  },
  coluna: {
    gap: Layout.sectionGap,
  },
  grade: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Layout.sectionGap,
  },
  celula: {
    flex: 1,
    minWidth: 0,
  },
  rodape: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing[2],
  },
});
