/**
 * Fotos do chamado com "antes e depois" quando a equipe registrou a
 * conclusão. O antes/depois é a prova de serviço que o cidadão (e o gestor
 * na demo) quer ver.
 *
 * Fonte: `GET /operacao/chamados/<id>/anexos/`. Essa rota é da equipe e só
 * abre ao público quando o chamado é público; quando nega (403/404) ou o
 * backend ainda não a tem, as fotos vêm dos campos do próprio detalhe
 * (`imagem_thumbnail`, `imagens_extra`, `foto_resolucao_url`) — nada some,
 * só fica sem a separação fina de "antes" da equipe.
 */

import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ImageViewer } from '@/components/ui/image-viewer';
import { AppText } from '@/components/ui/text';
import { Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import { apiCidadao } from '@/services/api-cidadao';
import { getTokenSync } from '@/services/storage';
import type { AnexoChamado, ChamadoDetalhe, FotosChamado } from '@/types/cidadao';
import { parseImagensExtra } from '@/utils/format';

function unicos(lista: (string | null | undefined)[]) {
  return [...new Set(lista.filter((u): u is string => !!u))];
}

function fotosDoDetalhe(d: ChamadoDetalhe): FotosChamado {
  return {
    antes: unicos([d.imagem_thumbnail, ...parseImagensExtra(d.imagens_extra)]),
    depois: unicos([d.foto_resolucao_url]),
    origem: 'detalhe',
  };
}

export function useFotosDoChamado(d: ChamadoDetalhe): FotosChamado {
  // Anexos guardados com a chave do chamado a que pertencem: trocar de
  // chamado volta às fotos do detalhe sem precisar zerar estado no efeito.
  const [anexos, setAnexos] = useState<{ chave: string; lista: AnexoChamado[] } | null>(null);
  const chave = `${d.id}|${d.status}|${d.foto_resolucao_url ? 1 : 0}|${d.imagem_thumbnail ? 1 : 0}`;
  const id = d.id;

  useEffect(() => {
    let cancelado = false;
    apiCidadao
      .anexos(id)
      .then((lista) => {
        if (!cancelado) setAnexos({ chave, lista });
      })
      .catch(() => {
        // Esperado para quem não é da equipe em chamado não público: as fotos
        // do detalhe (já na tela) são a versão pública. Ver cabeçalho.
      });
    return () => {
      cancelado = true;
    };
  }, [chave, id]);

  const base = fotosDoDetalhe(d);
  if (!anexos || anexos.chave !== chave) return base;
  return {
    antes: unicos([...base.antes, ...anexos.lista.filter((a) => a.tipo !== 'depois').map((a) => a.url)]),
    depois: unicos([...base.depois, ...anexos.lista.filter((a) => a.tipo === 'depois').map((a) => a.url)]),
    origem: 'anexos',
  };
}

/** Fonte de imagem com o token quando a URL é da nossa API (anexos protegidos). */
function fonte(uri: string) {
  const token = getTokenSync();
  if (!token || uri.startsWith('data:')) return { uri };
  return { uri, headers: { Authorization: `Bearer ${token}` } };
}

function Foto({
  uri,
  rotulo,
  altura,
  onAbrir,
}: {
  uri: string;
  rotulo: string;
  altura: number;
  onAbrir: (uri: string) => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={() => onAbrir(uri)}
      accessibilityRole="imagebutton"
      accessibilityLabel={`${rotulo}. Toque para ampliar`}
      style={[styles.foto, { height: altura, backgroundColor: colors.surfaceSunken }]}>
      <Image source={fonte(uri)} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
    </Pressable>
  );
}

export function FotosDoChamado({ defeito }: { defeito: ChamadoDetalhe }) {
  const colors = useColors();
  const fotos = useFotosDoChamado(defeito);
  const [aberta, setAberta] = useState<string | null>(null);

  if (fotos.antes.length === 0 && fotos.depois.length === 0) return null;

  const temDepois = fotos.depois.length > 0;
  const extrasAntes = fotos.antes.slice(1);
  const extrasDepois = fotos.depois.slice(1);

  return (
    <View style={styles.container}>
      {temDepois ? (
        <View style={styles.par}>
          <View style={styles.coluna}>
            <AppText variant="caption" tone="muted" weight="600">
              ANTES
            </AppText>
            {fotos.antes[0] ? (
              <Foto uri={fotos.antes[0]} rotulo="Foto de antes" altura={150} onAbrir={setAberta} />
            ) : (
              <View style={[styles.semFoto, { borderColor: colors.border }]}>
                <AppText variant="caption" tone="muted">
                  Sem foto
                </AppText>
              </View>
            )}
          </View>
          <View style={styles.coluna}>
            <AppText variant="caption" tone="success" weight="600">
              DEPOIS
            </AppText>
            <Foto uri={fotos.depois[0]} rotulo="Foto depois do serviço" altura={150} onAbrir={setAberta} />
          </View>
        </View>
      ) : fotos.antes[0] ? (
        <Foto uri={fotos.antes[0]} rotulo="Foto do problema" altura={190} onAbrir={setAberta} />
      ) : null}

      {extrasAntes.length + extrasDepois.length > 0 ? (
        <View style={styles.miniaturas}>
          {[...extrasAntes, ...extrasDepois].map((uri, i) => (
            <View key={uri} style={styles.miniatura}>
              <Foto
                uri={uri}
                rotulo={i < extrasAntes.length ? `Foto adicional ${i + 1}` : 'Foto do serviço'}
                altura={72}
                onAbrir={setAberta}
              />
            </View>
          ))}
        </View>
      ) : null}

      <ImageViewer uri={aberta} onClose={() => setAberta(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing[2],
  },
  par: {
    flexDirection: 'row',
    gap: Spacing[2],
  },
  coluna: {
    flex: 1,
    gap: Spacing[1],
  },
  foto: {
    width: '100%',
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  semFoto: {
    height: 150,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniaturas: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
  },
  miniatura: {
    width: 72,
  },
});
