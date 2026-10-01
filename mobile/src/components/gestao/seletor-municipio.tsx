/**
 * Seletor de município das telas de gestão, só para o super_admin (a
 * plataforma atende várias prefeituras). A escolha vale para toda a área de
 * administração (`municipio-gestao.ts`); sem escolha, vale o município do
 * próprio usuário, se ele tiver um.
 */

import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { SearchableSelect } from '@/components/ui/searchable-select';
import { AppText } from '@/components/ui/text';
import { Layout, Spacing } from '@/constants/theme';
import { api } from '@/services/api';

import { escolherMunicipioGestao, useMunicipioGestao, type MunicipioEscolhido } from './municipio-gestao';

// A lista (~5.500 municípios) não muda durante o uso: busca uma vez por sessão.
let cache: MunicipioEscolhido[] | null = null;

function useMunicipios() {
  const [lista, setLista] = useState<MunicipioEscolhido[] | null>(cache);
  const [falhou, setFalhou] = useState(false);
  useEffect(() => {
    if (cache) return;
    let cancelado = false;
    api.listMunicipios().then(
      (m) => {
        cache = m.map((x) => ({ codigo: String(x.codigo), nome: x.nome, uf_sigla: x.uf_sigla }));
        if (!cancelado) setLista(cache);
      },
      (err: unknown) => {
        console.warn('[gestao] lista de municípios falhou:', err);
        if (!cancelado) setFalhou(true);
      },
    );
    return () => {
      cancelado = true;
    };
  }, []);
  return { lista, falhou };
}

type Props = {
  /** Município do próprio usuário (o padrão enquanto nada foi escolhido). */
  padrao?: string | null;
};

export function SeletorMunicipio({ padrao }: Props) {
  const escolhido = useMunicipioGestao();
  const { lista, falhou } = useMunicipios();

  const opcoes = useMemo(
    () => (lista ?? []).map((m) => ({ value: m.codigo, label: m.nome, group: m.uf_sigla })),
    [lista],
  );

  return (
    <View style={styles.caixa}>
      <SearchableSelect
        label="Município gerido"
        options={opcoes}
        value={escolhido?.codigo ?? padrao ?? null}
        placeholder={lista ? 'Escolha o município' : 'Carregando municípios…'}
        onChange={(codigo) => {
          const m = lista?.find((x) => x.codigo === codigo);
          if (m) escolherMunicipioGestao(m);
        }}
      />
      {falhou ? (
        <AppText variant="caption" tone="warning">
          Não foi possível carregar a lista de municípios. Volte e abra a tela de novo.
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  caixa: {
    paddingHorizontal: Layout.gutter,
    paddingBottom: Spacing[2],
    gap: Spacing[1],
  },
});
