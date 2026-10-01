/**
 * Blocos de leitura da ficha de atendimento: evidências (antes/depois, com
 * GPS) e o histórico com as notas internas da equipe.
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
import { ImageViewer } from '@/components/ui/image-viewer';
import { Skeleton } from '@/components/ui/skeleton';
import { AppText } from '@/components/ui/text';
import { Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import { apiOperacao } from '@/services/api-operacao';
import type { DefeitoEvento } from '@/types';
import type { AnexoChamado, IdChamado } from '@/types/operacao';
import { formatarDataHora } from '@/utils/format';

const ROTULO_ANEXO: Record<AnexoChamado['tipo'], string> = {
  cidadao: 'Do cidadão',
  antes: 'Antes',
  depois: 'Depois',
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

/** Fotos de evidência. `versao` muda quando a ficha registra uma nova. */
export function EvidenciasChamado({ id, versao }: { id: IdChamado; versao: number }) {
  const colors = useColors();
  const carregar = useCallback(() => apiOperacao.anexos(id), [id]);
  const { dados, erro, tentarDeNovo } = useCarga(carregar, versao);
  const [aberta, setAberta] = useState<string | null>(null);

  if (erro) return <Erro mensagem={`Evidências: ${erro}`} onRetry={tentarDeNovo} />;
  if (!dados) return <Skeleton height={96} />;
  if (dados.length === 0) {
    return (
      <AppText variant="caption" tone="muted">
        Nenhuma foto de evidência ainda.
      </AppText>
    );
  }

  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.fotos}>
        {dados.map((a) => {
          const fonte = apiOperacao.fonteDoAnexo(a);
          return (
            <Pressable
              key={a.id}
              onPress={() => setAberta(fonte.uri)}
              accessibilityRole="imagebutton"
              accessibilityLabel={`Foto ${ROTULO_ANEXO[a.tipo]}, ${formatarDataHora(a.criado_em)}${
                a.latitude != null ? ', com localização' : ', sem localização'
              }. Toque para ampliar`}
              style={styles.foto}>
              <Image source={fonte} style={[styles.miniatura, { backgroundColor: colors.surfaceSunken }]} contentFit="cover" />
              <Badge
                label={ROTULO_ANEXO[a.tipo]}
                tone={a.tipo === 'depois' ? 'success' : a.tipo === 'antes' ? 'warning' : 'neutral'}
                icon={a.latitude != null ? 'location' : 'location-outline'}
              />
              <AppText variant="caption" tone="muted" numberOfLines={1}>
                {formatarDataHora(a.criado_em)}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>
      {/* O visualizador não manda o token: amplia os anexos de chamado público, que a
          rota de imagem serve sem login (contrato §7.1). */}
      <ImageViewer uri={aberta} onClose={() => setAberta(null)} />
    </>
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
export function HistoricoChamado({ id, versao }: { id: IdChamado; versao: number }) {
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
  erro: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
  fotos: {
    gap: Spacing[3],
  },
  foto: {
    width: 120,
    gap: Spacing[1],
  },
  miniatura: {
    width: 120,
    height: 96,
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
