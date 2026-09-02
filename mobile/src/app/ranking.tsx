/**
 * Ranking de contribuição — quem mais pontua reportando e confirmando
 * problemas. Dois escopos à vista: a cidade (a de onde o usuário está, ou
 * qualquer outra pelo campo de busca) e o Brasil inteiro; e três recortes de
 * período (tudo, 30 dias, 7 dias). A linha do próprio usuário é destacada e,
 * fora do top, repete no rodapé com a posição real.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card, EmptyState, LoadingState } from '@/components/ui/screen';
import { SubScreen } from '@/components/ui/sub-screen';
import { ControlHeight, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useColors } from '@/context/theme-context';
import { gpsSimulado } from '@/dev/gps-simulado';
import { api } from '@/services/api';
import type { Municipio, PeriodoRanking, Ranking, RankingEntry } from '@/types';

/** Medalhas do pódio; do 4º em diante o número fica na cor do texto. */
const CORES_PODIO = ['#D4AF37', '#9EA7B3', '#B87752'];

const PERIODOS: { valor: PeriodoRanking; rotulo: string }[] = [
  { valor: 'tudo', rotulo: 'Tudo' },
  { valor: 'mes', rotulo: '30 dias' },
  { valor: 'semana', rotulo: '7 dias' },
];

type Modo = 'cidade' | 'geral';
type Cidade = Pick<Municipio, 'codigo' | 'nome' | 'uf_sigla'>;

async function ondeEstou(): Promise<{ lat: number; lng: number } | null> {
  // GPS simulado do painel de dev (inerte em produção), como no mapa.
  const simulado = gpsSimulado.get();
  if (simulado.ativo && simulado.posicao) {
    return { lat: simulado.posicao.latitude, lng: simulado.posicao.longitude };
  }
  try {
    const permissao = await Location.requestForegroundPermissionsAsync();
    if (!permissao.granted) return null;
    const pos =
      (await Location.getLastKnownPositionAsync()) ??
      (await Location.getCurrentPositionAsync({}));
    return pos ? { lat: pos.coords.latitude, lng: pos.coords.longitude } : null;
  } catch {
    return null;
  }
}

/** Minúsculas e sem acentos, para a busca achar "sao paulo". */
function normalizar(texto: string) {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export default function RankingScreen() {
  const colors = useColors();
  const { user, isAuthenticated } = useAuth();

  const [dados, setDados] = useState<Ranking | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [tentativa, setTentativa] = useState(0);
  const [modo, setModo] = useState<Modo>('cidade');
  const [periodo, setPeriodo] = useState<PeriodoRanking>('tudo');
  // null = a cidade de onde o usuário está (GPS ou cadastro).
  const [cidadeEscolhida, setCidadeEscolhida] = useState<Cidade | null>(null);

  // Busca de cidade no próprio campo: a lista completa vem uma vez, o filtro é local.
  const [editando, setEditando] = useState(false);
  const [busca, setBusca] = useState('');
  const [municipios, setMunicipios] = useState<Municipio[] | null>(null);

  useEffect(() => {
    let cancelado = false;
    const pedido: Promise<Ranking | null> =
      modo === 'geral'
        ? api.ranking({ geral: true, periodo })
        : cidadeEscolhida
          ? api.ranking({ municipio: cidadeEscolhida.codigo, periodo })
          : ondeEstou().then((ponto) => {
              if (ponto) return api.ranking({ ...ponto, periodo });
              if (user?.municipio_id)
                return api.ranking({ municipio: user.municipio_id, periodo });
              return null;
            });
    pedido
      .then((resultado) => {
        if (cancelado) return;
        if (resultado) {
          setDados(resultado);
          setErro('');
        } else {
          setErro('Permita a localização ou pesquise uma cidade acima.');
        }
      })
      .catch((err) => {
        if (!cancelado)
          setErro(err instanceof Error ? err.message : 'Erro ao carregar o ranking.');
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [user, tentativa, modo, cidadeEscolhida, periodo]);

  function recarregar(mudanca: () => void) {
    setCarregando(true);
    mudanca();
  }

  function comecarBusca() {
    setEditando(true);
    setBusca('');
    if (municipios === null) {
      api
        .listMunicipios()
        .then(setMunicipios)
        .catch(() => setMunicipios([]));
    }
  }

  function escolherCidade(cidade: Cidade) {
    setEditando(false);
    setBusca('');
    recarregar(() => setCidadeEscolhida(cidade));
  }

  const termo = normalizar(busca.trim());
  const sugestoes =
    editando && termo.length >= 2 && municipios
      ? municipios.filter((m) => normalizar(m.nome).includes(termo)).slice(0, 12)
      : [];

  const meuId = isAuthenticated && user ? String(user.id) : null;
  const euNoTop = !!meuId && !!dados?.ranking.some((r) => r.usuario_id === meuId);
  const cidadeAtual = cidadeEscolhida ?? (modo === 'cidade' ? dados?.municipio : null);
  const nomeCidade = cidadeAtual ? `${cidadeAtual.nome} - ${cidadeAtual.uf_sigla}` : '';

  function linha(item: RankingEntry) {
    const sou = item.usuario_id === meuId;
    const corPodio = CORES_PODIO[item.posicao - 1];
    return (
      <View
        key={item.usuario_id}
        style={[styles.linha, sou && { backgroundColor: colors.goldMuted }]}>
        <View
          style={[styles.posicao, { backgroundColor: corPodio ?? colors.bgElevated }]}>
          <Text
            style={[
              styles.posicaoTexto,
              { color: corPodio ? '#1A1A1A' : colors.textSecondary },
            ]}>
            {item.posicao}
          </Text>
        </View>
        <View style={styles.nomeArea}>
          <Text
            style={[styles.nome, { color: sou ? colors.gold500 : colors.textPrimary }]}
            numberOfLines={1}>
            {sou ? 'Você' : item.nome}
          </Text>
          <Text style={[styles.meta, { color: colors.textMuted }]}>
            Nível {item.nivel} · {item.titulo}
          </Text>
        </View>
        <Text style={[styles.xp, { color: sou ? colors.gold500 : colors.textSecondary }]}>
          {item.xp} XP
        </Text>
      </View>
    );
  }

  return (
    <SubScreen title="Ranking" fallback="/(tabs)/mapa">
      <Card>
        {/* Escopo: cidade ou Brasil, lado a lado. */}
        <View style={[styles.segmentos, { borderColor: colors.borderDefault }]}>
          {(
            [
              { valor: 'cidade', rotulo: 'Cidade', icone: 'location' },
              { valor: 'geral', rotulo: 'Brasil', icone: 'earth' },
            ] as { valor: Modo; rotulo: string; icone: 'location' | 'earth' }[]
          ).map((s) => {
            const ativo = modo === s.valor;
            return (
              <Pressable
                key={s.valor}
                onPress={() => {
                  if (!ativo) recarregar(() => setModo(s.valor));
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: ativo }}
                style={[
                  styles.segmento,
                  { backgroundColor: ativo ? colors.gold500 : 'transparent' },
                ]}>
                <Ionicons
                  name={s.icone}
                  size={14}
                  color={ativo ? colors.textInverse : colors.textSecondary}
                />
                <Text
                  style={[
                    styles.segmentoTexto,
                    { color: ativo ? colors.textInverse : colors.textSecondary },
                  ]}>
                  {s.rotulo}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Campo de busca: mostra a cidade atual e, ao tocar, vira pesquisa. */}
        {modo === 'cidade' ? (
          <View>
            <View
              style={[
                styles.busca,
                {
                  backgroundColor: colors.bgInput,
                  borderColor: editando ? colors.gold500 : colors.borderDefault,
                },
              ]}>
              <Ionicons name="search" size={16} color={colors.textMuted} />
              {/* Sem fechar no blur: no web o toque na sugestão tira o foco
                  do campo antes do clique chegar, e a lista sumiria. */}
              <TextInput
                value={editando ? busca : nomeCidade}
                onChangeText={setBusca}
                onFocus={comecarBusca}
                onSubmitEditing={() => {
                  if (sugestoes[0]) escolherCidade(sugestoes[0]);
                }}
                returnKeyType="search"
                placeholder={carregando && !editando ? 'Localizando…' : 'Pesquisar cidade'}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.buscaInput, { color: colors.textPrimary }]}
              />
              {editando ? (
                <Pressable
                  onPress={() => {
                    setEditando(false);
                    setBusca('');
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Cancelar pesquisa"
                  hitSlop={8}>
                  <Ionicons name="close" size={16} color={colors.textMuted} />
                </Pressable>
              ) : cidadeEscolhida ? (
                <Pressable
                  onPress={() => recarregar(() => setCidadeEscolhida(null))}
                  accessibilityRole="button"
                  accessibilityLabel="Voltar para a cidade onde estou"
                  hitSlop={8}>
                  <Ionicons name="locate" size={16} color={colors.gold500} />
                </Pressable>
              ) : null}
            </View>

            {editando && termo.length >= 2 ? (
              <View style={styles.sugestoes}>
                {municipios === null ? (
                  <Text style={[styles.meta, { color: colors.textMuted }]}>
                    Carregando cidades…
                  </Text>
                ) : sugestoes.length === 0 ? (
                  <Text style={[styles.meta, { color: colors.textMuted }]}>
                    Nenhuma cidade encontrada.
                  </Text>
                ) : (
                  sugestoes.map((m) => (
                    <Pressable
                      key={m.codigo}
                      onPress={() => escolherCidade(m)}
                      accessibilityRole="button"
                      style={styles.sugestao}>
                      <Ionicons name="location-outline" size={15} color={colors.textMuted} />
                      <Text style={[styles.sugestaoTexto, { color: colors.textPrimary }]}>
                        {m.nome} - {m.uf_sigla}
                      </Text>
                    </Pressable>
                  ))
                )}
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={styles.periodoLinha}>
          <View style={styles.periodos}>
            {PERIODOS.map((p) => {
              const ativo = periodo === p.valor;
              return (
                <Pressable
                  key={p.valor}
                  onPress={() => {
                    if (!ativo) recarregar(() => setPeriodo(p.valor));
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: ativo }}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: ativo ? colors.gold500 : 'transparent',
                      borderColor: ativo ? colors.gold500 : colors.borderDefault,
                    },
                  ]}>
                  <Text
                    style={[
                      styles.chipTexto,
                      { color: ativo ? colors.textInverse : colors.textSecondary },
                    ]}>
                    {p.rotulo}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {dados && !carregando ? (
            <Text style={[styles.meta, { color: colors.textMuted }]}>
              {dados.total_participantes}{' '}
              {dados.total_participantes === 1 ? 'participante' : 'participantes'}
            </Text>
          ) : null}
        </View>
      </Card>

      {carregando ? (
        <LoadingState />
      ) : erro ? (
        <Card>
          <Text style={[styles.meta, { color: colors.textSecondary }]}>{erro}</Text>
          <Button
            size="sm"
            onPress={() => {
              setCarregando(true);
              setTentativa((t) => t + 1);
            }}>
            Tentar de novo
          </Button>
        </Card>
      ) : !dados || dados.ranking.length === 0 ? (
        <EmptyState label="Ninguém pontuou por aqui ainda. Reporte um problema e abra o placar!" />
      ) : (
        <>
          <Card style={styles.lista}>{dados.ranking.map(linha)}</Card>
          {dados.eu && !euNoTop ? (
            <Card style={{ borderColor: colors.gold500 }}>{linha(dados.eu)}</Card>
          ) : null}
        </>
      )}
    </SubScreen>
  );
}

const styles = StyleSheet.create({
  segmentos: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: Radius.full,
    padding: 3,
  },
  segmento: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[1] + 2,
    paddingVertical: Spacing[2],
    borderRadius: Radius.full,
  },
  segmentoTexto: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
  },
  busca: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    height: ControlHeight,
    paddingHorizontal: Spacing[3],
    borderWidth: 1,
    borderRadius: Radius.md,
  },
  buscaInput: {
    flex: 1,
    height: '100%',
    fontSize: FontSize.sm,
  },
  sugestoes: {
    paddingTop: Spacing[1],
  },
  sugestao: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    paddingVertical: Spacing[2],
  },
  sugestaoTexto: {
    fontSize: FontSize.sm,
  },
  periodoLinha: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing[2],
  },
  periodos: {
    flexDirection: 'row',
    gap: Spacing[2],
  },
  chip: {
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[1] + 1,
  },
  chipTexto: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.medium,
  },
  lista: {
    gap: 0,
    paddingVertical: Spacing[1],
  },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    paddingVertical: Spacing[2],
    paddingHorizontal: Spacing[2],
    borderRadius: Radius.md,
  },
  posicao: {
    width: 28,
    height: 28,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  posicaoTexto: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
  },
  nomeArea: {
    flex: 1,
    gap: 1,
  },
  nome: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
  },
  meta: {
    fontSize: FontSize.xs,
  },
  xp: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
});
