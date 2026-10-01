/**
 * Blocos de leitura da ficha de atendimento: as fotos do chamado (um bloco
 * só, do cidadão, antes e depois, com GPS e autor) e o histórico com as
 * notas internas da equipe.
 *
 * Os dois vêm de rotas próprias e carregam sozinhos; falha em um não derruba
 * a ficha — mostra o erro ali mesmo, com "Tentar de novo".
 */

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { fonteDaImagem, ImageViewer } from '@/components/ui/image-viewer';
import { Skeleton } from '@/components/ui/skeleton';
import { AppText } from '@/components/ui/text';
import { Radius, Spacing, type Tom } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import { apiOperacao } from '@/services/api-operacao';
import type { DefeitoEvento } from '@/types';
import type { ChamadoDetalhe } from '@/types/cidadao';
import type { AnexoChamado, ChamadoFila } from '@/types/operacao';
import { formatarDataHora, parseImagensExtra } from '@/utils/format';

const ROTULO_ANEXO: Record<AnexoChamado['tipo'], string> = {
  cidadao: 'Do cidadão',
  antes: 'Antes',
  depois: 'Depois',
};

const TOM_ANEXO: Record<AnexoChamado['tipo'], Tom> = {
  cidadao: 'neutral',
  antes: 'warning',
  depois: 'success',
};

function useCarga<T>(carregar: () => Promise<T>, versao: number) {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let vivo = true;
    carregar()
      .then((d) => {
        if (!vivo) return;
        setDados(d);
        setErro(null);
      })
      .catch((err) => {
        if (vivo) setErro(err instanceof Error ? err.message : 'Não foi possível carregar.');
      });
    return () => {
      vivo = false;
    };
  }, [carregar, versao, tentativa]);

  const tentarDeNovo = useCallback(() => {
    setErro(null);
    setTentativa((t) => t + 1);
  }, []);

  return { dados, erro, tentarDeNovo };
}

function Erro({ mensagem, onRetry }: { mensagem: string; onRetry: () => void }) {
  const colors = useColors();
  return (
    <View style={styles.erro} accessibilityLiveRegion="polite">
      <Ionicons name="alert-circle" size={16} color={colors.danger} />
      <AppText variant="caption" tone="danger" style={styles.flex}>
        {mensagem}
      </AppText>
      <Button size="xs" variant="secondary" onPress={onRetry}>
        Tentar de novo
      </Button>
    </View>
  );
}

/** Uma foto do bloco, já com o que a equipe precisa ler sem ampliar. */
type FotoFicha = {
  chave: string;
  uri: string;
  tipo: AnexoChamado['tipo'];
  /** `ponto` = local informado no reporte (a foto original não tem GPS próprio). */
  gps: 'foto' | 'ponto' | null;
  autor: string | null;
  quando: string | null;
};

function absoluta(uri: string | null | undefined) {
  return uri ? fonteDaImagem(uri).uri : null;
}

/**
 * Junta a foto do reporte (campos do detalhe) com os anexos. Fotos antigas,
 * de antes dos anexos, só entram quando não há anexo do mesmo tipo — o
 * backend ainda grava uma cópia em `imagens_extra`/`foto_resolucao` e elas
 * apareceriam duas vezes.
 */
function montarFotos(c: ChamadoFila, anexos: AnexoChamado[]): FotoFicha[] {
  const d = c as ChamadoFila & Partial<ChamadoDetalhe>;
  const fotos: FotoFicha[] = [];
  const original = absoluta(d.imagem_thumbnail ?? d.imagem_url);
  if (original) {
    fotos.push({
      chave: 'original',
      uri: original,
      tipo: 'cidadao',
      gps: 'ponto',
      autor: d.autor_nome ?? null,
      quando: d.criado_em ?? null,
    });
  }
  if (!anexos.some((a) => a.tipo === 'cidadao')) {
    parseImagensExtra(d.imagens_extra).forEach((uri, i) =>
      fotos.push({ chave: `extra-${i}`, uri, tipo: 'cidadao', gps: null, autor: d.autor_nome ?? null, quando: null }),
    );
  }
  const ordenados = [...anexos].sort((a, b) => a.criado_em.localeCompare(b.criado_em));
  for (const a of ordenados) {
    fotos.push({
      chave: `anexo-${a.id}`,
      uri: absoluta(a.url) ?? a.url,
      tipo: a.tipo,
      gps: a.latitude != null && a.longitude != null ? 'foto' : null,
      autor: a.autor_nome || null,
      quando: a.criado_em,
    });
  }
  const resolucao = absoluta(d.foto_resolucao_url);
  if (resolucao && !anexos.some((a) => a.tipo === 'depois')) {
    fotos.push({ chave: 'resolucao', uri: resolucao, tipo: 'depois', gps: null, autor: null, quando: d.resolvido_em ?? null });
  }
  return fotos;
}

function rotuloGps(gps: FotoFicha['gps']) {
  if (gps === 'foto') return 'com GPS';
  if (gps === 'ponto') return 'no ponto do reporte';
  return 'sem GPS';
}

/**
 * Bloco único de fotos da ficha. `versao` muda quando a ficha registra uma
 * foto nova (antes/depois) e os anexos recarregam.
 */
export function FotosChamado({ chamado, versao }: { chamado: ChamadoFila; versao: number }) {
  const colors = useColors();
  const id = chamado.id;
  const carregar = useCallback(() => apiOperacao.anexos(id), [id]);
  const { dados, erro, tentarDeNovo } = useCarga(carregar, versao);
  const [aberta, setAberta] = useState<string | null>(null);

  const fotos = montarFotos(chamado, dados ?? []);

  return (
    <View style={styles.bloco}>
      {erro ? <Erro mensagem={`Fotos da equipe: ${erro}`} onRetry={tentarDeNovo} /> : null}
      {!dados && !erro ? (
        <Skeleton height={140} />
      ) : fotos.length === 0 ? (
        <AppText variant="caption" tone="muted">
          Nenhuma foto ainda. Registre o antes e o depois com a câmera: a foto vai com o local do GPS.
        </AppText>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.fotos}>
          {fotos.map((f) => {
            const rotulo = ROTULO_ANEXO[f.tipo];
            const meta = [f.autor, f.quando ? formatarDataHora(f.quando) : null].filter(Boolean).join(' · ');
            return (
              <Pressable
                key={f.chave}
                onPress={() => setAberta(f.uri)}
                accessibilityRole="imagebutton"
                accessibilityLabel={`Foto ${rotulo}, ${rotuloGps(f.gps)}${meta ? `, ${meta}` : ''}. Toque para ampliar`}
                style={styles.foto}>
                <Image
                  source={fonteDaImagem(f.uri)}
                  style={[styles.miniatura, { backgroundColor: colors.surfaceSunken }]}
                  contentFit="cover"
                  transition={150}
                />
                <Badge
                  label={rotulo}
                  tone={TOM_ANEXO[f.tipo]}
                  icon={f.gps === 'foto' ? 'location' : f.gps === 'ponto' ? 'pin-outline' : 'location-outline'}
                />
                <AppText variant="caption" tone={f.gps ? 'secondary' : 'warning'} numberOfLines={1}>
                  {rotuloGps(f.gps)}
                </AppText>
                {f.autor ? (
                  <AppText variant="caption" tone="secondary" numberOfLines={1}>
                    {f.autor}
                  </AppText>
                ) : null}
                {f.quando ? (
                  <AppText variant="caption" tone="muted" numberOfLines={1}>
                    {formatarDataHora(f.quando)}
                  </AppText>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      )}
      {/* Anexo de chamado restrito exige o token: o visualizador o manda para a nossa API. */}
      <ImageViewer uri={aberta} onClose={() => setAberta(null)} />
    </View>
  );
}

const ICONE_EVENTO: Record<string, keyof typeof Ionicons.glyphMap> = {
  status: 'swap-horizontal',
  atribuido: 'person-add',
  nota_interna: 'lock-closed',
  resposta_publica: 'chatbubble',
  anexo: 'camera',
  sla: 'time',
  prioridade: 'flag',
  reaberto: 'refresh',
  criado: 'add-circle',
};

/** Histórico do chamado com as notas internas destacadas (só a equipe as recebe). */
export function HistoricoChamado({ id, versao }: { id: ChamadoFila['id']; versao: number }) {
  const colors = useColors();
  const carregar = useCallback(() => apiOperacao.eventos(id), [id]);
  const { dados, erro, tentarDeNovo } = useCarga<DefeitoEvento[]>(carregar, versao);

  if (erro) return <Erro mensagem={`Histórico: ${erro}`} onRetry={tentarDeNovo} />;
  if (!dados) return <Skeleton height={64} />;
  if (dados.length === 0) {
    return (
      <AppText variant="caption" tone="muted">
        Sem registros ainda.
      </AppText>
    );
  }

  // Mais recente primeiro: no campo, o que importa é o último recado.
  const eventos = [...dados].sort((a, b) => b.criado_em.localeCompare(a.criado_em)).slice(0, 20);
  return (
    <View style={styles.eventos}>
      {eventos.map((e) => {
        const interno = !e.publico;
        const titulo =
          e.tipo === 'nota_interna'
            ? 'Nota interna'
            : e.tipo === 'resposta_publica'
              ? 'Resposta ao cidadão'
              : e.para_status_rotulo
                ? `Status: ${e.para_status_rotulo}`
                : e.tipo.replace(/_/g, ' ');
        return (
          <View
            key={e.id}
            style={[
              styles.evento,
              { borderColor: interno ? colors.warning : colors.border, backgroundColor: interno ? colors.warningSubtle : 'transparent' },
            ]}>
            <Ionicons
              name={ICONE_EVENTO[e.tipo] ?? 'ellipse-outline'}
              size={16}
              color={interno ? colors.warning : colors.textSecondary}
            />
            <View style={styles.flex}>
              <AppText variant="caption" weight="600">
                {titulo}
                {interno ? ' · só equipe' : ''}
              </AppText>
              {e.texto ? <AppText variant="bodySm">{e.texto}</AppText> : null}
              <AppText variant="caption" tone="muted">
                {[e.autor_nome, formatarDataHora(e.criado_em)].filter(Boolean).join(' · ')}
              </AppText>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  bloco: {
    gap: Spacing[2],
  },
  erro: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
  fotos: {
    gap: Spacing[3],
  },
  foto: {
    width: 128,
    gap: Spacing[1],
  },
  miniatura: {
    width: 128,
    height: 104,
    borderRadius: Radius.md,
  },
  eventos: {
    gap: Spacing[2],
  },
  evento: {
    flexDirection: 'row',
    gap: Spacing[2],
    padding: Spacing[2],
    borderWidth: 1,
    borderRadius: Radius.md,
  },
});
