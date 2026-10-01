/**
 * Novo chamado — reporte rápido, estilo Waze, sem virar formulário.
 *
 * Ordem pensada para cortar duplicado e chamado mal localizado:
 * 1. onde: mapinha para ajuste fino do ponto + endereço visível e editável;
 * 2. "já reportado por perto?" (`GET /defeitos/proximos/`) com "É este? Apoiar";
 * 3. o quê: grade de categorias;
 * 4. foto obrigatória pela câmera (galeria não entra: tem que ser do local, na
 *    hora) e detalhes opcionais;
 * 5. confirmação com protocolo, órgão responsável, prazo e "Acompanhar".
 *
 * A posição inicial vem do mapa (GPS ou toque longo) por parâmetro.
 */

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCompartilharChamado } from '@/components/chamado/acoes-cidadao';
import { AjusteLocal, distanciaDaOrigem } from '@/components/chamado/ajuste-local';
import { ConfirmacaoEnvio } from '@/components/chamado/confirmacao-envio';
import { DuplicadosProximos, type EstadoProximos } from '@/components/chamado/duplicados-proximos';
import { Button } from '@/components/ui/button';
import { StateView } from '@/components/ui/state-view';
import { AppText } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { RAIO_DUPLICADO_M } from '@/constants/proximidade';
import { statusAberto } from '@/constants/status';
import { Layout, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useColors } from '@/context/theme-context';
import { useToast } from '@/context/toast-context';
import { convidarParaPushAposReporte } from '@/hooks/use-push';
import { api, DefeitoDuplicadoError } from '@/services/api';
import { apiCidadao } from '@/services/api-cidadao';
import { recarregarProgresso } from '@/services/progresso';
import type { Categoria, Defeito, PickedImage } from '@/types';
import type { ChamadoProximo } from '@/types/cidadao';
import { formatarDistancia, type LatLng } from '@/utils/geo';
import { ImagemMuitoGrandeError, tirarFoto } from '@/utils/image';

/** Fallback quando a API de categorias não responde (mesmos nomes do backend). */
const CATEGORIAS_PADRAO: Categoria[] = [
  { nome: 'Buraco', icone: '🕳️' },
  { nome: 'Iluminação', icone: '💡' },
  { nome: 'Semáforo', icone: '🚦' },
  { nome: 'Árvore Caída', icone: '🌳' },
  { nome: 'Entulho', icone: '🗑️' },
  { nome: 'Calçada Danificada', icone: '🚶' },
  { nome: 'Outro', icone: '📋' },
];

/** Até onde o ponto pode ser arrastado a partir de onde a pessoa está. */
const LIMITE_AJUSTE_M = 50;
const MAX_DESCRICAO = 280;
/** Espera o dedo parar de arrastar o mapa antes de geocodificar e buscar duplicados. */
const ESPERA_MS = 600;

type Endereco = { rua: string; bairro: string };

/**
 * Raio de duplicado da prefeitura do ponto, que o `GET /defeitos/proximos/`
 * manda em cada item (`raio_duplicado_m`); backend antigo: a constante.
 */
function raioDuplicado(c: ChamadoProximo) {
  const raio = (c as ChamadoProximo & { raio_duplicado_m?: number }).raio_duplicado_m;
  return typeof raio === 'number' && raio > 0 ? raio : RAIO_DUPLICADO_M;
}
type Geocodificacao = 'buscando' | 'ok' | 'falhou';
type Resultado =
  | { tipo: 'enviado'; defeito: Defeito }
  | { tipo: 'offline'; mensagem: string };

export default function NovoChamadoScreen() {
  const colors = useColors();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const compartilhar = useCompartilharChamado();
  const { isAuthenticated } = useAuth();
  const { lat, lng } = useLocalSearchParams<{ lat?: string; lng?: string }>();

  const latitude = Number(lat);
  const longitude = Number(lng);
  const coordenadaValida = Number.isFinite(latitude) && Number.isFinite(longitude);
  const origem = useMemo<LatLng>(() => ({ latitude, longitude }), [latitude, longitude]);

  const [ponto, setPonto] = useState<LatLng>(origem);
  // O ponto "assentado" (depois do arrasto) é o que dispara geocodificação e busca.
  const [pontoEstavel, setPontoEstavel] = useState<LatLng>(origem);
  const [rolagemLivre, setRolagemLivre] = useState(true);

  const [categorias, setCategorias] = useState<Categoria[]>(CATEGORIAS_PADRAO);
  const [categoria, setCategoria] = useState<string | null>(null);
  const [imagem, setImagem] = useState<PickedImage | null>(null);
  const [descricao, setDescricao] = useState('');
  const [endereco, setEndereco] = useState<Endereco>({ rua: '', bairro: '' });
  // Resultados assíncronos guardados com a chave (ponto) que os produziu: um
  // ponto novo lê como "buscando" sem zerar estado dentro do efeito.
  const [resGeo, setResGeo] = useState<{ chave: string; status: Geocodificacao } | null>(null);
  const [resProximos, setResProximos] = useState<{ chave: string; estado: EstadoProximos } | null>(null);
  const [tentativaProximos, setTentativaProximos] = useState(0);
  const [apoiando, setApoiando] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  // Depois que a pessoa digita, o endereço é dela (ref: só a geocodificação lê).
  const enderecoEditadoRef = useRef(false);

  useEffect(() => {
    let cancelado = false;
    api
      .listCategorias()
      .then((lista) => {
        if (!cancelado && lista.length) setCategorias(lista);
      })
      .catch((err: unknown) => {
        // A grade padrão tem as mesmas categorias do backend: dá para seguir.
        if (!cancelado) {
          toast.warning('Usando a lista padrão de problemas (sem conexão com o servidor).');
        }
        console.warn('[novo] categorias', err);
      });
    return () => {
      cancelado = true;
    };
  }, [toast]);

  // Assenta o ponto depois que o arrasto para.
  useEffect(() => {
    const t = setTimeout(() => setPontoEstavel(ponto), ESPERA_MS);
    return () => clearTimeout(t);
  }, [ponto]);

  const chaveGeo = `${pontoEstavel.latitude},${pontoEstavel.longitude}`;
  const chaveProximos = `${chaveGeo}|${tentativaProximos}`;

  useEffect(() => {
    if (!coordenadaValida) return;
    let cancelado = false;
    apiCidadao
      // Sem ?raio=: o backend busca no raio de duplicado da prefeitura do ponto.
      .proximos(pontoEstavel.latitude, pontoEstavel.longitude)
      .then((itens) => {
        if (!cancelado) setResProximos({ chave: chaveProximos, estado: { tipo: 'ok', itens } });
      })
      .catch((err: unknown) => {
        if (cancelado) return;
        setResProximos({
          chave: chaveProximos,
          estado: { tipo: 'erro', mensagem: err instanceof Error ? err.message : String(err) },
        });
      });
    return () => {
      cancelado = true;
    };
  }, [coordenadaValida, pontoEstavel, chaveProximos]);

  useEffect(() => {
    if (!coordenadaValida) return;
    let cancelado = false;
    Location.reverseGeocodeAsync(pontoEstavel)
      .then(([e]) => {
        if (cancelado) return;
        if (!e) {
          setResGeo({ chave: chaveGeo, status: 'falhou' });
          return;
        }
        setResGeo({ chave: chaveGeo, status: 'ok' });
        // O arrasto não sobrescreve o que a pessoa digitou.
        if (enderecoEditadoRef.current) return;
        const rua = [e.street ?? e.name ?? '', e.streetNumber ?? ''].filter(Boolean).join(', ');
        setEndereco({ rua, bairro: e.district ?? e.subregion ?? '' });
      })
      .catch((err: unknown) => {
        // Comum no web (sem chave de geocodificação) e sem rede: o campo fica
        // para a pessoa digitar, e o aviso abaixo dele explica.
        if (!cancelado) setResGeo({ chave: chaveGeo, status: 'falhou' });
        console.warn('[novo] reverseGeocode', err);
      });
    return () => {
      cancelado = true;
    };
  }, [coordenadaValida, pontoEstavel, chaveGeo]);

  const geocodificacao: Geocodificacao = resGeo?.chave === chaveGeo ? resGeo.status : 'buscando';
  // Ao mover o ponto, a lista anterior fica na tela até a nova chegar.
  const proximos: EstadoProximos =
    resProximos && (resProximos.chave === chaveProximos || resProximos.estado.tipo === 'ok')
      ? resProximos.estado
      : { tipo: 'carregando' };

  const iconeDe = useCallback(
    (nome: string) =>
      categorias.find((c) => c.nome.toLowerCase() === nome.toLowerCase())?.icone ?? '📋',
    [categorias],
  );

  const itensProximos = proximos.tipo === 'ok' ? proximos.itens : [];
  // Mesma categoria, aberto e colado no ponto: o backend recusaria (409).
  const duplicadoCerto = categoria
    ? itensProximos.find(
        (c) =>
          statusAberto(c.status) &&
          c.categoria.toLowerCase() === categoria.toLowerCase() &&
          c.distancia_m <= raioDuplicado(c),
      )
    : undefined;
  const foraDoLimite = distanciaDaOrigem(origem, ponto) > LIMITE_AJUSTE_M;

  async function fotografar() {
    try {
      const foto = await tirarFoto();
      if (foto) setImagem(foto);
    } catch (err) {
      if (err instanceof ImagemMuitoGrandeError) toast.error(err.message);
      else toast.error('Não foi possível usar a câmera. Confira a permissão nas configurações.');
    }
  }

  /** Apoia um chamado já existente em vez de abrir outro, e leva para ele. */
  async function apoiarExistente(c: ChamadoProximo) {
    const id = String(c.id);
    setApoiando(id);
    try {
      const res = await api.apoiarDefeito(id as unknown as number);
      if (!res.apoiado) {
        // O endpoint alterna; se já apoiava, desfaz o "desapoiar".
        await api.apoiarDefeito(id as unknown as number);
        toast.info('Você já apoiava este chamado. Veja como ele está.');
      } else {
        toast.success('Apoio registrado! Você vai acompanhar este chamado.');
        recarregarProgresso();
      }
      router.replace({ pathname: '/chamado/[id]', params: { id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível apoiar o chamado.');
    } finally {
      setApoiando(null);
    }
  }

  async function enviar() {
    if (duplicadoCerto) {
      await apoiarExistente(duplicadoCerto);
      return;
    }
    if (!categoria) {
      toast.warning('Escolha o tipo de problema.');
      return;
    }
    if (foraDoLimite) {
      toast.warning(`Aproxime o ponto até ${LIMITE_AJUSTE_M} m de onde você está.`);
      return;
    }
    if (!imagem) {
      toast.warning('Tire uma foto do problema para abrir o chamado.');
      return;
    }
    setEnviando(true);
    try {
      const r = await api.createDefeito({
        titulo: categoria,
        descricao: descricao.trim(),
        categoria,
        rua: endereco.rua.trim(),
        bairro: endereco.bairro.trim(),
        latitude: ponto.latitude,
        longitude: ponto.longitude,
        imagem,
      });
      if ('offline' in r) {
        setResultado({ tipo: 'offline', mensagem: r.message });
      } else {
        recarregarProgresso();
        toast.success('Chamado enviado! +10 XP');
        setResultado({ tipo: 'enviado', defeito: r });
      }
      // Hora certa de pedir o push: a pessoa quer saber o que acontece com o
      // que acabou de abrir. Pergunta uma vez por aparelho; falhar não importa.
      convidarParaPushAposReporte().catch((err: unknown) => console.warn('[novo] push', err));
    } catch (err) {
      if (err instanceof DefeitoDuplicadoError && err.defeitoExistenteId) {
        // O backend achou um igual que a busca não pegou: leva para ele.
        toast.info(err.message);
        router.replace({ pathname: '/chamado/[id]', params: { id: err.defeitoExistenteId } });
        return;
      }
      toast.error(err instanceof Error ? err.message : 'Não foi possível enviar o chamado.');
    } finally {
      setEnviando(false);
    }
  }

  // Link direto (ou sessão que caiu no meio): sem conta não há como enviar,
  // e descobrir isso só no botão final, depois da foto, frustra.
  if (!isAuthenticated && !resultado) {
    return (
      <View style={[styles.container, { backgroundColor: colors.bg }]}>
        <StateView
          kind="empty"
          icon="person-circle-outline"
          title="Entre para reportar"
          description="Os chamados ficam ligados à sua conta para você acompanhar o andamento e receber a resposta da prefeitura."
          action={{ label: 'Entrar', onPress: () => router.push('/login') }}
        />
      </View>
    );
  }

  if (!coordenadaValida) {
    return (
      <View style={[styles.container, { backgroundColor: colors.bg }]}>
        <StateView
          kind="empty"
          icon="location-outline"
          title="Sem posição para o chamado"
          description="Volte ao mapa e toque em Reportar, ou segure o dedo no ponto do problema."
          action={{ label: 'Voltar ao mapa', onPress: () => router.back() }}
        />
      </View>
    );
  }

  if (resultado) {
    return (
      <View style={[styles.container, { backgroundColor: colors.bg }]}>
        <Stack.Screen options={{ title: resultado.tipo === 'enviado' ? 'Chamado enviado' : 'Chamado salvo' }} />
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + Spacing[6] }]}>
          {resultado.tipo === 'enviado' ? (
            <ConfirmacaoEnvio
              tipo="enviado"
              defeito={resultado.defeito}
              onAcompanhar={() =>
                router.replace({ pathname: '/chamado/[id]', params: { id: String(resultado.defeito.id) } })
              }
              onCompartilhar={() => compartilhar(resultado.defeito)}
              onVoltar={() => router.back()}
            />
          ) : (
            <ConfirmacaoEnvio tipo="offline" mensagem={resultado.mensagem} onVoltar={() => router.back()} />
          )}
        </ScrollView>
      </View>
    );
  }

  const rotuloEnviar = duplicadoCerto
    ? `Apoiar o ${duplicadoCerto.categoria} já aberto a ${formatarDistancia(duplicadoCerto.distancia_m)}`
    : !categoria
      ? 'Escolha o tipo de problema'
      : !imagem
        ? 'Tire a foto para enviar'
        : foraDoLimite
          ? 'Aproxime o ponto para enviar'
          : `Enviar chamado de ${categoria}`;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        scrollEnabled={rolagemLivre}
        keyboardShouldPersistTaps="handled">
        <Secao numero={1} titulo="Onde está o problema?">
          <AjusteLocal
            origem={origem}
            ponto={ponto}
            onChange={setPonto}
            limiteM={LIMITE_AJUSTE_M}
            onInteragindo={(ativo) => setRolagemLivre(!ativo)}
          />
          <View style={styles.endereco}>
            <TextField
              label="Rua e número"
              value={endereco.rua}
              onChangeText={(rua) => {
                enderecoEditadoRef.current = true;
                setEndereco((e) => ({ ...e, rua }));
              }}
              placeholder={geocodificacao === 'buscando' ? 'Buscando endereço...' : 'Ex.: Rua das Flores, 120'}
              accessibilityLabel="Rua e número"
              containerStyle={styles.campoRua}
            />
            <TextField
              label="Bairro"
              value={endereco.bairro}
              onChangeText={(bairro) => {
                enderecoEditadoRef.current = true;
                setEndereco((e) => ({ ...e, bairro }));
              }}
              placeholder="Bairro"
              accessibilityLabel="Bairro"
              containerStyle={styles.campoBairro}
            />
          </View>
          <AppText variant="caption" tone="muted">
            {geocodificacao === 'falhou' && !endereco.rua
              ? 'Não encontramos o endereço automaticamente. Se souber, digite — ajuda a equipe a chegar.'
              : 'Confira o endereço. Um ponto de referência ajuda a equipe (use os detalhes abaixo).'}
          </AppText>
        </Secao>

        <DuplicadosProximos
          estado={proximos}
          categoria={categoria}
          iconeDe={iconeDe}
          apoiando={apoiando}
          onApoiar={apoiarExistente}
          onVer={(c) => router.push({ pathname: '/chamado/[id]', params: { id: String(c.id) } })}
          onTentarDeNovo={() => setTentativaProximos((n) => n + 1)}
        />

        <Secao numero={2} titulo="O que você está vendo?">
          <View style={styles.grade} accessibilityRole="radiogroup" accessibilityLabel="Tipo de problema">
            {categorias.map((c) => {
              const ativo = categoria === c.nome;
              const jaAberto = itensProximos.some(
                (p) => statusAberto(p.status) && p.categoria.toLowerCase() === c.nome.toLowerCase(),
              );
              return (
                <Pressable
                  key={c.nome}
                  onPress={() => setCategoria(c.nome)}
                  accessibilityRole="radio"
                  accessibilityLabel={`${c.nome}${jaAberto ? ', já há um chamado deste tipo por perto' : ''}`}
                  accessibilityState={{ selected: ativo, checked: ativo }}
                  style={({ pressed }) => [
                    styles.opcao,
                    {
                      backgroundColor: ativo ? colors.primarySubtle : pressed ? colors.surfacePressed : colors.surface,
                      borderColor: ativo ? colors.primary : colors.border,
                      borderWidth: ativo ? 2 : 1,
                    },
                  ]}>
                  <AppText style={styles.opcaoIcone}>{c.icone ?? '📋'}</AppText>
                  {jaAberto ? (
                    <View style={[styles.selo, { backgroundColor: colors.warning }]}>
                      <Ionicons name="people" size={12} color={colors.onWarning} />
                    </View>
                  ) : null}
                  <AppText
                    variant="caption"
                    weight={ativo ? '700' : '500'}
                    tone={ativo ? 'brand' : 'secondary'}
                    align="center"
                    numberOfLines={2}>
                    {c.nome}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        </Secao>

        <Secao numero={3} titulo="Foto do problema">
          {imagem ? (
            <View style={styles.fotoLinha}>
              <Image
                source={{ uri: imagem.uri }}
                style={styles.miniatura}
                contentFit="cover"
                accessibilityLabel="Foto tirada do problema"
              />
              <Button
                variant="secondary"
                size="sm"
                onPress={() => setImagem(null)}
                icon={<Ionicons name="camera-reverse-outline" size={16} color={colors.textPrimary} />}>
                Tirar outra
              </Button>
            </View>
          ) : (
            <Button
              block
              variant="secondary"
              onPress={fotografar}
              icon={<Ionicons name="camera" size={18} color={colors.textPrimary} />}>
              Tirar foto (obrigatória)
            </Button>
          )}
          <View style={styles.dica}>
            <Ionicons name="shield-checkmark-outline" size={16} color={colors.textSecondary} />
            <AppText variant="caption" tone="secondary" style={styles.flex}>
              Enquadre só o problema. Evite rostos e placas de carro: a foto fica pública.
            </AppText>
          </View>
        </Secao>

        <Secao numero={4} titulo="Detalhes (opcional)">
          <TextField
            value={descricao}
            onChangeText={(t) => setDescricao(t.slice(0, MAX_DESCRICAO))}
            placeholder="Ex.: buraco grande perto do ponto de ônibus, já tem carro desviando pela contramão"
            multiline
            maxLength={MAX_DESCRICAO}
            accessibilityLabel="Detalhes do problema, opcional"
            hint={`${descricao.length}/${MAX_DESCRICAO} · referência, tamanho, risco`}
          />
        </Secao>
      </ScrollView>

      <View
        style={[
          styles.rodape,
          {
            backgroundColor: colors.surfaceRaised,
            borderTopColor: colors.border,
            paddingBottom: insets.bottom + Spacing[3],
          },
        ]}>
        {duplicadoCerto ? (
          <AppText variant="caption" tone="secondary" align="center">
            Já existe um chamado igual aqui. Apoiar faz ele andar mais rápido.
          </AppText>
        ) : null}
        <Button
          block
          onPress={enviar}
          loading={enviando || (!!duplicadoCerto && apoiando === String(duplicadoCerto.id))}
          disabled={!duplicadoCerto && (!categoria || !imagem || foraDoLimite)}>
          {rotuloEnviar}
        </Button>
      </View>
    </View>
  );
}

function Secao({ numero, titulo, children }: { numero: number; titulo: string; children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={styles.secao}>
      <View style={styles.secaoCabecalho}>
        <View style={[styles.numero, { backgroundColor: colors.primarySubtle, borderColor: colors.primary }]}>
          <AppText variant="caption" weight="700" tone="brand">
            {numero}
          </AppText>
        </View>
        <AppText variant="title" accessibilityRole="header">
          {titulo}
        </AppText>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    padding: Layout.gutter,
    gap: Spacing[6],
    // No desktop (Expo web) o formulário não estica pela tela inteira.
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  secao: {
    gap: Spacing[3],
  },
  secaoCabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
  numero: {
    width: 24,
    height: 24,
    borderRadius: Radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  endereco: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
  },
  campoRua: {
    flexGrow: 2,
    flexBasis: 200,
  },
  campoBairro: {
    flexGrow: 1,
    flexBasis: 120,
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
    borderRadius: Radius.md,
  },
  opcaoIcone: {
    fontSize: 34,
    lineHeight: 42,
  },
  selo: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
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
  dica: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[1.5],
  },
  flex: {
    flex: 1,
  },
  rodape: {
    width: '100%',
    paddingHorizontal: Layout.gutter,
    paddingTop: Spacing[3],
    borderTopWidth: 1,
    gap: Spacing[2],
  },
});
