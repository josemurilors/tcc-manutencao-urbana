/**
 * Novo chamado — reporte rápido, estilo Waze.
 *
 * Nada de formulário: a pessoa escolhe o tipo de problema numa grade de
 * opções, tira uma foto (obrigatória, só pela câmera — galeria não entra, a
 * foto tem que ser do local, na hora) e envia. A posição vem da tela do mapa
 * (GPS ou toque longo). O título é o nome da categoria; rua e bairro são
 * preenchidos em segundo plano por geocodificação reversa, sem campo na tela.
 */

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { RAIO_DUPLICADO_M } from '@/constants/proximidade';
import { STATUS_ABERTOS } from '@/constants/status';
import { FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useColors } from '@/context/theme-context';
import { useToast } from '@/context/toast-context';
import { api, DefeitoDuplicadoError } from '@/services/api';
import { recarregarProgresso } from '@/services/progresso';
import type { Categoria, Defeito, PickedImage } from '@/types';
import { distanciaAte, formatarDistancia } from '@/utils/geo';
import { ImagemMuitoGrandeError, tirarFoto } from '@/utils/image';

/** Fallback quando a API de categorias não responde (mesmos nomes do backend). */
const CATEGORIAS_PADRAO: Categoria[] = [
  { nome: 'Buraco', icone: '🕳️' },
  { nome: 'Iluminação', icone: '💡' },
  { nome: 'Árvore Caída', icone: '🌳' },
  { nome: 'Entulho', icone: '🗑️' },
  { nome: 'Calçada Danificada', icone: '🚶' },
  { nome: 'Outro', icone: '📋' },
];

export default function NovoChamadoScreen() {
  const colors = useColors();
  const addToast = useToast();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const { lat, lng } = useLocalSearchParams<{ lat?: string; lng?: string }>();

  const latitude = Number(lat);
  const longitude = Number(lng);
  const coordenadaValida = Number.isFinite(latitude) && Number.isFinite(longitude);

  const [categorias, setCategorias] = useState<Categoria[]>(CATEGORIAS_PADRAO);
  const [categoria, setCategoria] = useState<string | null>(null);
  const [imagem, setImagem] = useState<PickedImage | null>(null);
  const [enviando, setEnviando] = useState(false);
  // Chamados abertos a poucos metros: o backend recusaria a mesma categoria,
  // então a tela mostra antes e oferece confirmar o existente.
  const [existentes, setExistentes] = useState<(Defeito & { distancia: number })[]>([]);
  // Endereço resolvido em segundo plano; vai junto no envio se já estiver pronto.
  const endereco = useRef({ rua: '', bairro: '' });

  useEffect(() => {
    api
      .listCategorias()
      .then((lista) => {
        if (lista.length) setCategorias(lista);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!coordenadaValida) return;
    let cancelado = false;
    api
      .listDefeitos()
      .then((lista) => {
        if (cancelado) return;
        setExistentes(
          lista
            .filter((d) => STATUS_ABERTOS.includes(d.status))
            .map((d) => ({ ...d, distancia: distanciaAte(d, latitude, longitude) }))
            .filter((d) => d.distancia <= RAIO_DUPLICADO_M)
            .sort((a, b) => a.distancia - b.distancia),
        );
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, [coordenadaValida, latitude, longitude]);

  useEffect(() => {
    if (!coordenadaValida) return;
    let cancelado = false;
    Location.reverseGeocodeAsync({ latitude, longitude })
      .then(([e]) => {
        if (cancelado || !e) return;
        endereco.current = {
          rua: e.street ?? e.name ?? '',
          bairro: e.district ?? e.subregion ?? '',
        };
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, [coordenadaValida, latitude, longitude]);

  async function fotografar() {
    try {
      const foto = await tirarFoto();
      if (foto) setImagem(foto);
    } catch (err) {
      if (err instanceof ImagemMuitoGrandeError) addToast(err.message, 'error');
      else addToast('Não foi possível usar a câmera.', 'error');
    }
  }

  function nomeCategoria(d: Defeito) {
    return d.categoria ?? d.categoria_nome ?? '';
  }

  const existenteDaCategoria = categoria
    ? existentes.find((d) => nomeCategoria(d).toLowerCase() === categoria.toLowerCase())
    : undefined;

  /** Confirma (apoia) um chamado já existente em vez de criar outro. */
  async function confirmarExistente(d: Defeito) {
    setEnviando(true);
    try {
      const res = await api.apoiarDefeito(d.id);
      if (!res.apoiado) {
        // O endpoint alterna; se já tinha confirmado, desfaz o "desconfirmar".
        await api.apoiarDefeito(d.id);
        addToast('Você já tinha confirmado este chamado.', 'info');
      } else {
        // Confirmar chamado de outra pessoa rende XP (o próprio, não).
        const deOutro = !d.usuario || String(d.usuario.id) !== String(user?.id ?? '');
        addToast(deOutro ? 'Chamado confirmado! +6 XP' : 'Chamado confirmado!');
        recarregarProgresso();
      }
      router.back();
    } catch (err) {
      addToast('Erro: ' + (err instanceof Error ? err.message : 'Erro ao confirmar'), 'error');
    } finally {
      setEnviando(false);
    }
  }

  async function handleSubmit() {
    if (existenteDaCategoria) {
      await confirmarExistente(existenteDaCategoria);
      return;
    }
    if (!categoria) {
      addToast('Escolha o tipo de problema.', 'error');
      return;
    }
    if (!coordenadaValida) {
      addToast('Sem posição para o chamado.', 'error');
      return;
    }
    if (!imagem) {
      addToast('Tire uma foto do problema para abrir o chamado.', 'error');
      return;
    }
    setEnviando(true);
    try {
      const resultado = await api.createDefeito({
        titulo: categoria,
        descricao: '',
        categoria,
        rua: endereco.current.rua,
        bairro: endereco.current.bairro,
        latitude,
        longitude,
        imagem,
      });
      if ('offline' in resultado) addToast(resultado.message, 'info');
      else {
        addToast('Chamado enviado! +10 XP');
        recarregarProgresso();
      }
      router.back();
    } catch (err) {
      if (err instanceof DefeitoDuplicadoError) {
        // Volta ao mapa já com o chamado existente aberto para confirmar.
        addToast(err.message, 'info');
        // `navigate` volta para a aba já montada (sem remontar o mapa nem
        // perder o modo "seguir"); só atualiza o parâmetro.
        router.navigate({
          pathname: '/(tabs)/mapa',
          params: { abrir: err.defeitoExistenteId },
        });
        return;
      }
      addToast('Erro: ' + (err instanceof Error ? err.message : 'Erro ao criar chamado'), 'error');
    } finally {
      setEnviando(false);
    }
  }

  if (!coordenadaValida) {
    return (
      <View style={[styles.container, styles.centro, { backgroundColor: colors.bgPrimary }]}>
        <Text style={[styles.aviso, { color: colors.textMuted }]}>
          Volte ao mapa e use “Reportar aqui”.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bgPrimary }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {existentes.length > 0 ? (
          <View
            style={[
              styles.existentes,
              { backgroundColor: colors.goldMuted, borderColor: colors.gold500 },
            ]}>
            <View style={styles.existentesCabecalho}>
              <Ionicons name="alert-circle" size={16} color={colors.gold500} />
              <Text style={[styles.existentesTitulo, { color: colors.gold500 }]}>
                Já reportado aqui
              </Text>
            </View>
            <Text style={[styles.existentesTexto, { color: colors.textSecondary }]}>
              Se for o mesmo problema, confirme em vez de abrir outro chamado.
            </Text>
            {existentes.map((d) => {
              const icone = categorias.find((c) => c.nome === nomeCategoria(d))?.icone ?? '📋';
              return (
                <View key={String(d.id)} style={styles.existenteLinha}>
                  <Text style={styles.existenteIcone}>{icone}</Text>
                  <View style={styles.existenteTexto}>
                    <Text
                      style={[styles.existenteNome, { color: colors.textPrimary }]}
                      numberOfLines={1}>
                      {nomeCategoria(d) || d.titulo}
                    </Text>
                    <Text style={[styles.existenteMeta, { color: colors.textMuted }]}>
                      a {formatarDistancia(d.distancia)}
                    </Text>
                  </View>
                  <Button size="sm" onPress={() => confirmarExistente(d)} disabled={enviando}>
                    Confirmar
                  </Button>
                </View>
              );
            })}
          </View>
        ) : null}

        <Text style={[styles.pergunta, { color: colors.textPrimary }]}>O que você está vendo?</Text>

        <View style={styles.grade}>
          {categorias.map((c) => {
            const ativo = categoria === c.nome;
            return (
              <Pressable
                key={c.nome}
                onPress={() => setCategoria(c.nome)}
                accessibilityRole="button"
                accessibilityState={{ selected: ativo }}
                style={[
                  styles.opcao,
                  {
                    backgroundColor: ativo ? colors.goldMuted : colors.bgSurface,
                    borderColor: ativo ? colors.gold500 : colors.borderDefault,
                  },
                ]}>
                <Text style={styles.opcaoIcone}>{c.icone ?? '📋'}</Text>
                {existentes.some((d) => nomeCategoria(d).toLowerCase() === c.nome.toLowerCase()) ? (
                  <View style={[styles.badge, { backgroundColor: colors.gold500 }]}>
                    <Ionicons name="checkmark" size={10} color={colors.textInverse} />
                  </View>
                ) : null}
                <Text
                  style={[
                    styles.opcaoNome,
                    {
                      color: ativo ? colors.gold500 : colors.textSecondary,
                      fontWeight: ativo ? FontWeight.bold : FontWeight.medium,
                    },
                  ]}
                  numberOfLines={2}>
                  {c.nome}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.secao, { color: colors.textMuted }]}>Foto do problema</Text>
        {imagem ? (
          <View style={styles.fotoLinha}>
            <Image source={{ uri: imagem.uri }} style={styles.miniatura} contentFit="cover" />
            <Pressable
              onPress={() => setImagem(null)}
              accessibilityRole="button"
              accessibilityLabel="Tirar outra foto"
              style={[styles.remover, { borderColor: colors.borderDefault }]}>
              <Ionicons name="camera-reverse-outline" size={16} color={colors.textSecondary} />
              <Text style={[styles.removerTexto, { color: colors.textSecondary }]}>
                Tirar outra
              </Text>
            </Pressable>
          </View>
        ) : (
          <Button
            block
            variant="secondary"
            onPress={fotografar}
            icon={<Ionicons name="camera" size={16} color={colors.textPrimary} />}>
            Tirar foto (obrigatória)
          </Button>
        )}
      </ScrollView>

      <View
        style={[
          styles.rodape,
          {
            backgroundColor: colors.bgElevated,
            borderTopColor: colors.borderDefault,
            paddingBottom: insets.bottom + Spacing[3],
          },
        ]}>
        <Button
          block
          onPress={handleSubmit}
          loading={enviando}
          disabled={!categoria || (!existenteDaCategoria && !imagem)}>
          {!categoria
            ? 'Escolha uma opção'
            : existenteDaCategoria
              ? `Confirmar ${categoria} já reportado`
              : imagem
                ? `Reportar ${categoria}`
                : 'Tire a foto para reportar'}
        </Button>
        {enviando ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centro: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing[6],
  },
  scroll: {
    padding: Spacing[5],
    gap: Spacing[4],
    // No desktop (Expo web) a grade não estica pela tela inteira.
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  pergunta: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.semibold,
  },
  grade: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[3],
  },
  opcao: {
    // Três por linha em telas de celular.
    width: '30%',
    flexGrow: 1,
    maxWidth: 160,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[2],
    padding: Spacing[2],
    borderWidth: 1,
    borderRadius: Radius.md,
  },
  opcaoIcone: {
    fontSize: 34,
  },
  badge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 18,
    height: 18,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  existentes: {
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing[3],
    gap: Spacing[2],
  },
  existentesCabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
  existentesTitulo: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
  },
  existentesTexto: {
    fontSize: FontSize.xs,
  },
  existenteLinha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    paddingTop: Spacing[1],
  },
  existenteIcone: {
    fontSize: 22,
  },
  existenteTexto: {
    flex: 1,
  },
  existenteNome: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  existenteMeta: {
    fontSize: FontSize.xs,
  },
  opcaoNome: {
    fontSize: FontSize.xs,
    textAlign: 'center',
  },
  secao: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: Spacing[2],
  },
  fotoLinha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
  },
  miniatura: {
    width: 96,
    height: 96,
    borderRadius: Radius.md,
  },
  remover: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[1] + 2,
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
    borderWidth: 1,
  },
  removerTexto: {
    fontSize: FontSize.xs,
  },
  rodape: {
    width: '100%',
    padding: Spacing[4],
    borderTopWidth: 1,
    gap: Spacing[2],
    alignItems: 'center',
  },
  aviso: {
    fontSize: FontSize.sm,
  },
});
