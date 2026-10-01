/**
 * Auditoria (contrato v3, 7.6 `auditoria/`): trilha do que a equipe mudou no
 * sistema, para prestação de contas (TCE, ouvidoria, LAI).
 *
 * Cada linha vira uma frase ("Ana alterou o SLA de Buraco para 5 dias"),
 * montada em `components/gestao/auditoria-texto.ts`. Filtra por família de
 * ação, período e pessoa — tocar num registro mostra o antes → depois e
 * oferece "ver só as ações de Ana". O botão do topo exporta em CSV o que os
 * filtros mostram (`?formato=csv`), para anexar a um processo ou planilha.
 * Só administrador do município.
 */

import { useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ACOES_AUDITORIA,
  detalheDaAuditoria,
  fraseDaAuditoria,
  iconeDaAuditoria,
  mudancasDaAuditoria,
  rotuloDaAcao,
} from '@/components/gestao/auditoria-texto';
import { mensagemDeErro } from '@/components/gestao/confirmar';
import { EstadoCarga } from '@/components/gestao/estado-carga';
import { GestaoShell } from '@/components/gestao/gestao-shell';
import { useListaPaginada } from '@/components/gestao/use-lista-paginada';
import { Badge } from '@/components/ui/badge';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { FilterChips } from '@/components/ui/chips';
import { ListItem } from '@/components/ui/list-item';
import { Select } from '@/components/ui/select';
import { StateView } from '@/components/ui/state-view';
import { AppText } from '@/components/ui/text';
import { Layout, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import { useToast } from '@/context/toast-context';
import { apiGestao } from '@/services/api-gestao';
import type { RegistroAuditoria } from '@/types/gestao';
import { formatarDataHora } from '@/utils/format';

type Periodo = 'tudo' | '7' | '30' | '90';

const PERIODOS: { value: Periodo; label: string }[] = [
  { value: 'tudo', label: 'Tudo' },
  { value: '7', label: '7 dias' },
  { value: '30', label: '30 dias' },
  { value: '90', label: '90 dias' },
];

/** AAAA-MM-DD local de `dias` atrás (o backend filtra por dia no fuso da prefeitura). */
function inicioDoPeriodo(periodo: Periodo) {
  if (periodo === 'tudo') return undefined;
  const d = new Date();
  d.setDate(d.getDate() - Number(periodo) + 1);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export default function AuditoriaScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const [acao, setAcao] = useState('');
  const [periodo, setPeriodo] = useState<Periodo>('tudo');
  const [pessoa, setPessoa] = useState<{ id: string; nome: string } | null>(null);
  const [aberto, setAberto] = useState<RegistroAuditoria | null>(null);
  const [exportando, setExportando] = useState(false);
  const toast = useToast();

  const inicio = inicioDoPeriodo(periodo);
  const lista = useListaPaginada<RegistroAuditoria>(
    (page) =>
      apiGestao.auditoria({ acao: acao || undefined, usuario_id: pessoa?.id, inicio, page }),
    `${acao}|${pessoa?.id ?? ''}|${inicio ?? ''}`,
  );

  const filtrando = !!acao || !!pessoa || periodo !== 'tudo';

  async function exportar() {
    if (exportando) return;
    setExportando(true);
    const aviso = toast.info('Gerando o CSV da auditoria…');
    try {
      await apiGestao.exportarAuditoria({ acao: acao || undefined, usuario_id: pessoa?.id, inicio });
      toast.dismiss(aviso);
      toast.success(filtrando ? 'CSV exportado com os filtros atuais' : 'CSV exportado');
    } catch (err) {
      toast.dismiss(aviso);
      toast.error(`Não foi possível exportar: ${mensagemDeErro(err)}`);
    } finally {
      setExportando(false);
    }
  }

  return (
    <GestaoShell
      title="Auditoria"
      subtitle={lista.estado === 'pronto' ? `${lista.total} registros` : undefined}
      minimo="admin_municipal"
      acao={{
        icon: exportando ? 'hourglass-outline' : 'download-outline',
        label: filtrando ? 'Exportar CSV com os filtros atuais' : 'Exportar CSV',
        onPress: exportar,
      }}>
      <View style={styles.filtros}>
        <Select
          label="Ação"
          title="Filtrar por ação"
          options={ACOES_AUDITORIA}
          value={acao}
          onChange={setAcao}
        />
        {/* Os chips já têm o recuo lateral próprio: sangra até a borda. */}
        <View style={styles.sangria}>
          <FilterChips
            options={PERIODOS}
            value={periodo}
            onChange={setPeriodo}
            accessibilityLabel="Período"
          />
        </View>
        {pessoa ? (
          <View style={styles.pessoa}>
            <Badge label={`Só ações de ${pessoa.nome}`} tone="primary" icon="person" />
            <Button
              size="xs"
              variant="ghost"
              onPress={() => setPessoa(null)}
              accessibilityLabel={`Remover filtro de ${pessoa.nome}`}>
              Limpar
            </Button>
          </View>
        ) : null}
      </View>

      {lista.estado !== 'pronto' ? (
        <EstadoCarga
          estado={lista.estado}
          erro={lista.erro}
          onRetry={lista.recarregar}
          oQue="a auditoria"
        />
      ) : (
        <FlatList
          data={lista.itens}
          keyExtractor={(r) => String(r.id)}
          contentContainerStyle={[styles.lista, { paddingBottom: insets.bottom + Spacing[16] }]}
          onEndReached={lista.carregarMais}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl refreshing={lista.atualizando} onRefresh={lista.atualizar} />
          }
          ListEmptyComponent={
            <StateView
              kind="empty"
              icon="document-text-outline"
              title={filtrando ? 'Nenhum registro com estes filtros' : 'Nenhum registro ainda'}
              description={
                filtrando
                  ? 'Tente outra ação, um período maior ou remova o filtro de pessoa.'
                  : 'Alterações de equipe, categorias, configuração e moderação aparecem aqui.'
              }
              action={
                filtrando
                  ? {
                      label: 'Limpar filtros',
                      onPress: () => {
                        setAcao('');
                        setPeriodo('tudo');
                        setPessoa(null);
                      },
                    }
                  : undefined
              }
            />
          }
          ListFooterComponent={
            lista.carregandoMais ? (
              <ActivityIndicator
                color={colors.primaryText}
                style={styles.rodape}
                accessibilityLabel="Carregando mais registros"
              />
            ) : null
          }
          renderItem={({ item }) => {
            const detalhe = detalheDaAuditoria(item);
            return (
              <ListItem
                title={fraseDaAuditoria(item)}
                subtitle={detalhe || undefined}
                meta={formatarDataHora(item.criado_em)}
                leading={iconeDaAuditoria(item.acao)}
                onPress={() => setAberto(item)}
                accessibilityHint="Mostra os detalhes do registro"
              />
            );
          }}
        />
      )}

      <DetalheSheet
        registro={aberto}
        onFechar={() => setAberto(null)}
        onFiltrarPessoa={(p) => {
          setPessoa(p);
          setAberto(null);
        }}
      />
    </GestaoShell>
  );
}

function DetalheSheet({
  registro: r,
  onFechar,
  onFiltrarPessoa,
}: {
  registro: RegistroAuditoria | null;
  onFechar: () => void;
  onFiltrarPessoa: (p: { id: string; nome: string }) => void;
}) {
  if (!r) return null;
  const detalhe = detalheDaAuditoria(r);
  const mudancas = mudancasDaAuditoria(r);
  const acaoRotulo = rotuloDaAcao(r.acao);
  const linhas: [string, string][] = [
    ['Quando', formatarDataHora(r.criado_em)],
    ['Quem', r.usuario_nome || 'Sistema'],
    ['Ação', acaoRotulo],
  ];
  if (r.alvo_tipo && r.alvo_tipo !== 'municipio') {
    linhas.push(['Alvo', `${r.alvo_tipo.replace(/_/g, ' ')}${r.alvo_id ? ` #${r.alvo_id}` : ''}`]);
  }
  if (r.ip) linhas.push(['Endereço IP', r.ip]);

  return (
    <BottomSheet
      visible={!!r}
      onClose={onFechar}
      title="Registro de auditoria"
      footer={
        r.usuario_id && r.usuario_nome ? (
          <Button
            variant="secondary"
            onPress={() => onFiltrarPessoa({ id: String(r.usuario_id), nome: r.usuario_nome! })}
            style={styles.flex}>
            {`Ver só ações de ${r.usuario_nome}`}
          </Button>
        ) : (
          <Button variant="secondary" onPress={onFechar} style={styles.flex}>
            Fechar
          </Button>
        )
      }>
      <AppText variant="body">{fraseDaAuditoria(r)}</AppText>
      {detalhe ? (
        <AppText variant="bodySm" tone="secondary">
          {detalhe}
        </AppText>
      ) : null}
      <View style={styles.tabela}>
        {linhas.map(([rotulo, valor]) => (
          <View key={rotulo} style={styles.linha} accessible accessibilityLabel={`${rotulo}: ${valor}`}>
            <AppText variant="caption" tone="muted" style={styles.rotulo}>
              {rotulo}
            </AppText>
            <AppText variant="bodySm" style={styles.flex}>
              {valor}
            </AppText>
          </View>
        ))}
      </View>
      {mudancas.length ? (
        <View style={styles.tabela}>
          <AppText variant="label" accessibilityRole="header">
            O que mudou
          </AppText>
          {mudancas.map((m) => (
            <View
              key={m.campo}
              style={styles.linha}
              accessible
              accessibilityLabel={`${m.campo}: de ${m.antes} para ${m.depois}`}>
              <AppText variant="caption" tone="muted" style={styles.rotulo}>
                {m.campo}
              </AppText>
              <AppText variant="bodySm" style={styles.flex}>
                {m.antes} → {m.depois}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  filtros: {
    paddingHorizontal: Layout.gutter,
    paddingBottom: Spacing[3],
    gap: Spacing[2],
  },
  sangria: {
    marginHorizontal: -Layout.gutter,
  },
  pessoa: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
  lista: {
    paddingHorizontal: Layout.gutter,
    gap: Spacing[1],
    flexGrow: 1,
  },
  rodape: {
    paddingVertical: Spacing[4],
  },
  tabela: {
    gap: Spacing[2],
  },
  linha: {
    flexDirection: 'row',
    gap: Spacing[3],
  },
  rotulo: {
    width: 96,
  },
  flex: {
    flex: 1,
  },
});
