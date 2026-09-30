/**
 * Meus chamados — tudo que o usuário reportou: quando abriu, situação,
 * endereço e apoios. O toque abre o detalhe completo (fotos, histórico e as
 * ações de autor — inclusive "já foi resolvido"/"não existe"); "Ver no mapa"
 * pula para o mapa já centralizado no ponto.
 */

import { Ionicons } from '@expo/vector-icons';
import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DefectSheet } from '@/components/defect-sheet';
import { Card, EmptyState, LoadingState } from '@/components/ui/screen';
import { StatusBadge } from '@/components/ui/status-badge';
import { SubScreen } from '@/components/ui/sub-screen';
import { STATUS_FECHADOS } from '@/constants/status';
import { FontSize, FontWeight, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useColors } from '@/context/theme-context';
import { api } from '@/services/api';
import type { Defeito, TipoSinalizacao } from '@/types';
import { concluidoEm, formatarData, totalApoios } from '@/utils/format';

export default function MeusChamadosScreen() {
  const colors = useColors();
  const { isAuthenticated } = useAuth();

  const [defeitos, setDefeitos] = useState<Defeito[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [selecionado, setSelecionado] = useState<Defeito | null>(null);
  const [apoiei, setApoiei] = useState<Set<number>>(new Set());
  const [sinalizei, setSinalizei] = useState<Map<number, TipoSinalizacao>>(new Map());

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelado = false;
    Promise.all([api.meusDefeitos(), api.apoiei(), api.sinalizei()])
      .then(([meus, apoios, sinais]) => {
        if (cancelado) return;
        setDefeitos(meus);
        setApoiei(new Set(apoios.ids));
        // Ids são UUIDs (strings) em runtime, como em `apoiei`.
        setSinalizei(new Map(Object.entries(sinais.sinalizacoes) as unknown as [number, TipoSinalizacao][]));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [isAuthenticated]);

  if (!isAuthenticated) {
    return <Redirect href="/(tabs)/conta" />;
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
      substituir(await api.detalharDefeito(defeito.id));
    } catch {
      // O resumo da listagem já está na tela; o detalhe completo é bônus.
    }
  }

  function verNoMapa(id: number) {
    router.push({ pathname: '/(tabs)/mapa', params: { abrir: String(id) } });
  }

  return (
    <SubScreen title="Meus chamados" fallback="/(tabs)/conta">
      {carregando ? (
        <LoadingState />
      ) : defeitos.length === 0 ? (
        <EmptyState label="Você ainda não abriu nenhum chamado." />
      ) : (
        defeitos.map((d) => {
          const fechado = STATUS_FECHADOS.includes(d.status);
          const local = [d.categoria_nome || d.categoria, d.rua, d.bairro]
            .filter(Boolean)
            .join(' · ');
          const apoios = totalApoios(d);
          // "Ver no mapa" fica fora da área que abre os detalhes: no web, cada
          // Pressable com role de botão vira <button>, e botão não pode conter botão.
          return (
            <Card key={d.id}>
              <Pressable
                onPress={() => abrirDetalhe(d)}
                accessibilityRole="button"
                accessibilityLabel={`Detalhes do chamado ${d.titulo}`}
                style={styles.detalhes}>
                <View style={styles.linhaTopo}>
                  <StatusBadge status={d.status} concluidoEm={concluidoEm(d)} />
                  <Text style={[styles.meta, { color: colors.textMuted }]}>
                    {formatarData(d.criado_em)}
                  </Text>
                </View>

                <Text style={[styles.titulo, { color: colors.textPrimary }]} numberOfLines={2}>
                  {d.titulo}
                </Text>

                {local ? (
                  <Text style={[styles.meta, { color: colors.textMuted }]} numberOfLines={1}>
                    {local}
                  </Text>
                ) : null}

                {fechado && d.atendido_em ? (
                  <View style={styles.linha}>
                    <Ionicons name="checkmark-circle" size={13} color={colors.success} />
                    <Text style={[styles.meta, { color: colors.success }]}>
                      Resolvido em {formatarData(d.atendido_em)}
                    </Text>
                  </View>
                ) : null}
              </Pressable>

              <View style={styles.rodape}>
                {apoios > 0 ? (
                  <View style={styles.linha}>
                    <Ionicons name="thumbs-up" size={12} color={colors.textMuted} />
                    <Text style={[styles.meta, { color: colors.textMuted }]}>
                      {apoios} {apoios === 1 ? 'apoio' : 'apoios'}
                    </Text>
                  </View>
                ) : (
                  <View />
                )}
                <Pressable
                  onPress={() => verNoMapa(d.id)}
                  accessibilityRole="button"
                  accessibilityLabel="Ver no mapa"
                  hitSlop={8}
                  style={styles.verNoMapa}>
                  <Ionicons name="map" size={14} color={colors.gold500} />
                  <Text style={[styles.verNoMapaTexto, { color: colors.gold500 }]}>
                    Ver no mapa
                  </Text>
                </Pressable>
              </View>
            </Card>
          );
        })
      )}

      <DefectSheet
        key={selecionado?.id}
        defeito={selecionado}
        apoiado={selecionado ? apoiei.has(selecionado.id) : false}
        onClose={() => setSelecionado(null)}
        onPatch={aplicarPatch}
        onReplace={substituir}
        onApoioToggle={alternarApoio}
        sinalizacao={selecionado ? (sinalizei.get(selecionado.id) ?? null) : null}
        onSinalizacaoChange={alterarSinalizacao}
        onRemove={remover}
      />
    </SubScreen>
  );
}

const styles = StyleSheet.create({
  detalhes: {
    gap: Spacing[2],
  },
  linhaTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing[2],
  },
  titulo: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  meta: {
    fontSize: FontSize.xs,
  },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[1],
  },
  rodape: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing[1],
  },
  verNoMapa: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[1],
    paddingVertical: Spacing[1],
  },
  verNoMapaTexto: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.medium,
  },
});
