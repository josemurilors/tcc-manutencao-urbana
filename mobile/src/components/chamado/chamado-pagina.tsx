/**
 * Página do chamado em tela cheia — destino do deep link
 * (`/chamado/<id>`), da consulta por protocolo e do "Acompanhar" depois de
 * reportar. Mostra o mesmo corpo do sheet, com espaço para avaliar e reabrir.
 *
 * Funciona sem login (o detalhe é público, com nome do autor mascarado):
 * quem recebe o link pelo WhatsApp vê o andamento e é convidado a entrar
 * para apoiar.
 */

import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DefectDetailBody } from '@/components/defect-detail';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { StateView, type StateKind } from '@/components/ui/state-view';
import { AppText } from '@/components/ui/text';
import { Layout, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useColors } from '@/context/theme-context';
import { useToast } from '@/context/toast-context';
import { api } from '@/services/api';
import { ErroHttp } from '@/services/api-cidadao';
import type { Defeito, TipoSinalizacao } from '@/types';
import type { ChamadoDetalhe } from '@/types/cidadao';

import { AcoesCidadao, useCompartilharChamado } from './acoes-cidadao';
import { AvaliacaoChamado } from './avaliacao';
import { ReabrirChamado } from './reabrir';

type Estado =
  | { tipo: 'ok'; defeito: ChamadoDetalhe }
  | { tipo: 'falha'; kind: Exclude<StateKind, 'loading'>; mensagem: string };

/** Separa "não existe" de "sem rede" de "erro do servidor" para a mensagem certa. */
function classificarErro(err: unknown): { kind: 'empty' | 'error' | 'offline'; mensagem: string } {
  const msg = err instanceof Error ? err.message : String(err);
  if (err instanceof ErroHttp && err.status === 404) return { kind: 'empty', mensagem: msg };
  if (/network request failed|failed to fetch|networkerror/i.test(msg)) {
    return { kind: 'offline', mensagem: msg };
  }
  if (/não encontrad|not found|no defeito matches/i.test(msg)) {
    return { kind: 'empty', mensagem: msg };
  }
  return { kind: 'error', mensagem: msg };
}

type Props = {
  /** Busca o chamado (por id ou por protocolo). */
  carregar: () => Promise<ChamadoDetalhe>;
  /** Muda quando o alvo muda (id/protocolo), para recarregar. */
  chave: string;
};

export function ChamadoPagina({ carregar, chave }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const compartilhar = useCompartilharChamado();
  const { isAuthenticated } = useAuth();

  // Resultado guardado com o alvo (id/protocolo + tentativa) que o produziu:
  // trocar de alvo mostra "carregando" sem zerar estado dentro do efeito.
  const [resultado, setResultado] = useState<{ alvo: string; estado: Estado } | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [atualizando, setAtualizando] = useState(false);
  const [apoiado, setApoiado] = useState(false);
  const [sinalizacao, setSinalizacao] = useState<TipoSinalizacao | null>(null);
  const alvo = `${chave}|${tentativa}`;
  // A rota recria `carregar` a cada render; o efeito lê a versão atual pela ref.
  const carregarRef = useRef(carregar);
  useEffect(() => {
    carregarRef.current = carregar;
  });

  const buscar = useCallback(
    async (alvoBusca: string, cancelado: () => boolean = () => false) => {
      try {
        const defeito = await carregarRef.current();
        if (cancelado()) return;
        setResultado({ alvo: alvoBusca, estado: { tipo: 'ok', defeito } });
        if (!isAuthenticated) return;
        // Estado pessoal (apoiei/sinalizei) é complemento: se falhar, o
        // chamado continua na tela e o botão só pode estar desatualizado.
        const [apoios, sinais] = await Promise.allSettled([api.apoiei(), api.sinalizei()]);
        if (cancelado()) return;
        const id = String(defeito.id);
        if (apoios.status === 'fulfilled') setApoiado(apoios.value.ids.map(String).includes(id));
        if (sinais.status === 'fulfilled') {
          setSinalizacao((sinais.value.sinalizacoes as Record<string, TipoSinalizacao>)[id] ?? null);
        }
        if (apoios.status === 'rejected' || sinais.status === 'rejected') {
          toast.info('Não foi possível conferir seus apoios neste chamado.');
        }
      } catch (err) {
        if (cancelado()) return;
        const { kind, mensagem } = classificarErro(err);
        setResultado({ alvo: alvoBusca, estado: { tipo: 'falha', kind, mensagem } });
      }
    },
    [isAuthenticated, toast],
  );

  useEffect(() => {
    let cancelado = false;
    buscar(alvo, () => cancelado);
    return () => {
      cancelado = true;
    };
  }, [alvo, buscar]);

  async function atualizar() {
    setAtualizando(true);
    await buscar(alvo);
    setAtualizando(false);
  }

  const estado: Estado | { tipo: 'carregando' } =
    resultado && resultado.alvo === alvo ? resultado.estado : { tipo: 'carregando' };

  function voltar() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/mapa');
  }

  const defeito = estado.tipo === 'ok' ? estado.defeito : null;

  function substituir(d: Defeito) {
    setResultado({ alvo, estado: { tipo: 'ok', defeito: d as ChamadoDetalhe } });
  }

  function aplicarPatch(_id: number, patch: Partial<Defeito>) {
    setResultado((r) =>
      r && r.estado.tipo === 'ok'
        ? { alvo: r.alvo, estado: { tipo: 'ok', defeito: { ...r.estado.defeito, ...patch } } }
        : r,
    );
  }

  return (
    <View style={[styles.tela, { backgroundColor: colors.bg }]}>
      <View
        style={[
          styles.cabecalho,
          { paddingTop: insets.top + Spacing[1], borderBottomColor: colors.border },
        ]}>
        <IconButton icon="arrow-back" accessibilityLabel="Voltar" onPress={voltar} />
        <View style={styles.titulo}>
          <AppText variant="title" numberOfLines={1} accessibilityRole="header">
            Chamado
          </AppText>
          {defeito?.protocolo ? (
            <AppText variant="caption" tone="muted" selectable>
              Protocolo {defeito.protocolo}
            </AppText>
          ) : null}
        </View>
        {defeito ? (
          <IconButton
            icon="share-social-outline"
            accessibilityLabel="Compartilhar chamado"
            onPress={() => compartilhar(defeito)}
          />
        ) : null}
      </View>

      {estado.tipo === 'carregando' ? (
        <StateView kind="loading" title="Carregando chamado" skeleton={3} style={styles.estado} />
      ) : estado.tipo === 'falha' ? (
        estado.kind === 'empty' ? (
          <StateView
            kind="empty"
            icon="search"
            title="Chamado não encontrado"
            description="Confira o link ou o número do protocolo. Chamados removidos por moderação não aparecem."
            action={{ label: 'Consultar protocolo', onPress: () => router.replace('/protocolo') }}
          />
        ) : (
          <StateView kind={estado.kind} description={estado.kind === 'error' ? estado.mensagem : undefined} onRetry={() => setTentativa((n) => n + 1)} />
        )
      ) : defeito ? (
        <ScrollView
          contentContainerStyle={[styles.conteudo, { paddingBottom: insets.bottom + Spacing[10] }]}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={atualizando} onRefresh={atualizar} />}>
          <DefectDetailBody
            defeito={defeito}
            rotuloApoios="apoios"
            aposAndamento={
              defeito.eh_autor ? (
                <>
                  <AvaliacaoChamado key={`av-${defeito.avaliado_em ?? ''}`} defeito={defeito} onAtualizado={substituir} />
                  <ReabrirChamado defeito={defeito} onAtualizado={substituir} />
                </>
              ) : null
            }>
            <AcoesCidadao
              defeito={defeito}
              modo="pagina"
              apoiado={apoiado}
              sinalizacao={sinalizacao}
              onPatch={aplicarPatch}
              onReplace={substituir}
              onApoioToggle={(_id, a) => setApoiado(a)}
              onSinalizacaoChange={(_id, t) => setSinalizacao(t)}
              onRemove={voltar}
            />
          </DefectDetailBody>

          <View style={styles.rodape}>
            <Button
              variant="secondary"
              block
              onPress={() =>
                router.navigate({ pathname: '/(tabs)/mapa', params: { abrir: String(defeito.id) } })
              }
              accessibilityHint="Abre o mapa centralizado neste chamado">
              Ver no mapa
            </Button>
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
  cabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[1],
    paddingHorizontal: Spacing[2],
    paddingBottom: Spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: Layout.minTouch,
  },
  titulo: {
    flex: 1,
  },
  conteudo: {
    padding: Layout.gutter,
    gap: Spacing[4],
  },
  estado: {
    padding: Layout.gutter,
  },
  rodape: {
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
});
