/**
 * Categorias e prazos (contrato v3, 7.6 `categorias/`): para cada tipo de
 * problema, o prazo de atendimento (SLA), a prioridade inicial, a secretaria
 * responsável, se o município atende aquele tipo e o checklist que o
 * operador cumpre ao concluir.
 *
 * O catálogo de categorias é global; aqui o município só sobrepõe as regras
 * (`categoria_municipio`). Gestor consulta; o administrador altera.
 */

import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { confirmar, mensagemDeErro } from '@/components/gestao/confirmar';
import { EstadoCarga } from '@/components/gestao/estado-carga';
import { GestaoShell } from '@/components/gestao/gestao-shell';
import { usePapel } from '@/components/gestao/papeis';
import { SwitchRow } from '@/components/gestao/switch-row';
import { useDados } from '@/components/gestao/use-dados';
import { Badge } from '@/components/ui/badge';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select } from '@/components/ui/select';
import { StateView } from '@/components/ui/state-view';
import { TextField } from '@/components/ui/text-field';
import { AppText } from '@/components/ui/text';
import { Layout, Spacing, type Tom } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import { useToast } from '@/context/toast-context';
import { apiGestao } from '@/services/api-gestao';
import type { CategoriaGestao, Prioridade, Secretaria } from '@/types/gestao';

const PRIORIDADES: { value: Prioridade; label: string; tom: Tom }[] = [
  { value: 'baixa', label: 'Baixa', tom: 'neutral' },
  { value: 'media', label: 'Média', tom: 'info' },
  { value: 'alta', label: 'Alta', tom: 'warning' },
  { value: 'urgente', label: 'Urgente', tom: 'danger' },
];

const ROTULO_PRIORIDADE = Object.fromEntries(PRIORIDADES.map((p) => [p.value, p])) as Record<
  Prioridade,
  (typeof PRIORIDADES)[number]
>;

const MAX_ITENS_CHECKLIST = 15;

function textoPrazo(dias: number | null) {
  if (!dias) return 'Sem prazo';
  return dias === 1 ? '1 dia' : `${dias} dias`;
}

export default function CategoriasScreen() {
  const insets = useSafeAreaInsets();
  const { ehAdmin } = usePapel();
  const [editando, setEditando] = useState<CategoriaGestao | null>(null);

  const dados = useDados(() =>
    Promise.all([
      apiGestao.categorias(),
      // Secretarias só servem para o nome e o seletor: se falharem, a lista
      // de categorias ainda aparece.
      apiGestao.secretarias().catch((err: unknown) => {
        console.warn('[categorias] secretarias indisponíveis:', err);
        return [] as Secretaria[];
      }),
    ]),
  );
  const categorias = useMemo(
    () =>
      [...(dados.dados?.[0] ?? [])].sort(
        (a, b) => Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome, 'pt-BR'),
      ),
    [dados.dados],
  );
  const secretarias = useMemo(() => dados.dados?.[1] ?? [], [dados.dados]);
  const nomeSecretaria = useMemo(
    () => new Map(secretarias.map((s) => [s.id, s.sigla || s.nome])),
    [secretarias],
  );

  function atualizarItem(nova: CategoriaGestao) {
    dados.setDados((prev) =>
      prev
        ? [prev[0].map((c) => (c.categoria_id === nova.categoria_id ? nova : c)), prev[1]]
        : prev,
    );
  }

  return (
    <GestaoShell
      title="Categorias e prazos"
      subtitle={ehAdmin ? 'Toque numa categoria para alterar' : 'Somente consulta'}
      minimo="gestor">
      {dados.estado !== 'pronto' ? (
        <EstadoCarga
          estado={dados.estado}
          erro={dados.erro}
          onRetry={dados.recarregar}
          oQue="as categorias"
        />
      ) : (
        <FlatList
          data={categorias}
          keyExtractor={(c) => String(c.categoria_id)}
          contentContainerStyle={[styles.lista, { paddingBottom: insets.bottom + Spacing[16] }]}
          refreshControl={
            <RefreshControl refreshing={dados.atualizando} onRefresh={dados.atualizar} />
          }
          ListEmptyComponent={
            <StateView
              kind="empty"
              icon="pricetags-outline"
              title="Nenhuma categoria"
              description="O catálogo de categorias ainda não foi carregado para o município."
            />
          }
          renderItem={({ item }) => (
            <LinhaCategoria
              categoria={item}
              secretaria={
                item.secretaria_nome ||
                (item.secretaria_id ? nomeSecretaria.get(item.secretaria_id) : undefined)
              }
              onPress={() => setEditando(item)}
            />
          )}
        />
      )}

      {editando ? (
        // `key` por categoria: o formulário nasce com os valores dela.
        <CategoriaSheet
          key={editando.categoria_id}
          categoria={editando}
          secretarias={secretarias}
          podeEditar={ehAdmin}
          onFechar={() => setEditando(null)}
          onSalvo={atualizarItem}
        />
      ) : null}
    </GestaoShell>
  );
}

function LinhaCategoria({
  categoria: c,
  secretaria,
  onPress,
}: {
  categoria: CategoriaGestao;
  secretaria?: string;
  onPress: () => void;
}) {
  const prioridade = c.prioridade ? ROTULO_PRIORIDADE[c.prioridade] : null;
  const resumo = [
    c.nome,
    c.ativo ? 'ativa' : 'desativada',
    `prazo ${textoPrazo(c.prazo_sla_dias)}`,
    prioridade ? `prioridade ${prioridade.label}` : null,
    secretaria ? `secretaria ${secretaria}` : 'sem secretaria',
    c.checklist?.length ? `${c.checklist.length} itens no checklist` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Card onPress={onPress} accessibilityLabel={resumo} accessibilityHint="Abre os detalhes">
      <View style={styles.cabecalho}>
        <AppText variant="label" style={styles.flex} numberOfLines={2}>
          {c.nome}
        </AppText>
        {c.ativo ? null : <Badge label="Desativada" tone="neutral" icon="pause-circle" />}
      </View>
      <View style={styles.selos}>
        <Badge
          label={textoPrazo(c.prazo_sla_dias)}
          tone={c.prazo_sla_dias ? 'primary' : 'warning'}
          icon="time"
        />
        {prioridade ? <Badge label={prioridade.label} tone={prioridade.tom} icon="flag" /> : null}
        {c.checklist?.length ? (
          <Badge label={`${c.checklist.length} no checklist`} tone="neutral" icon="checkbox" />
        ) : null}
      </View>
      <AppText variant="caption" tone="muted">
        {secretaria ? `Secretaria: ${secretaria}` : 'Sem secretaria responsável'}
      </AppText>
    </Card>
  );
}

function CategoriaSheet({
  categoria,
  secretarias,
  podeEditar,
  onFechar,
  onSalvo,
}: {
  categoria: CategoriaGestao;
  secretarias: Secretaria[];
  podeEditar: boolean;
  onFechar: () => void;
  onSalvo: (c: CategoriaGestao) => void;
}) {
  const colors = useColors();
  const toast = useToast();
  const [ativo, setAtivo] = useState(categoria.ativo);
  const [prazo, setPrazo] = useState(
    categoria.prazo_sla_dias ? String(categoria.prazo_sla_dias) : '',
  );
  const [prioridade, setPrioridade] = useState<Prioridade>(categoria.prioridade ?? 'media');
  const [secretariaId, setSecretariaId] = useState(
    categoria.secretaria_id ? String(categoria.secretaria_id) : '',
  );
  const [checklist, setChecklist] = useState<string[]>(categoria.checklist ?? []);
  const [novoItem, setNovoItem] = useState('');
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const opcoesSecretaria = useMemo(
    () => [
      { value: '', label: 'Nenhuma' },
      ...secretarias
        .filter((s) => s.ativo || String(s.id) === secretariaId)
        .map((s) => ({ value: String(s.id), label: s.nome })),
    ],
    [secretarias, secretariaId],
  );

  const prazoNum = Number.parseInt(prazo, 10);
  const prazoOk = Number.isFinite(prazoNum) && prazoNum >= 1 && prazoNum <= 365;

  function adicionarItem() {
    const t = novoItem.trim();
    if (!t) return;
    if (checklist.some((i) => i.toLowerCase() === t.toLowerCase())) {
      toast.warning('Este item já está no checklist');
      return;
    }
    setChecklist((prev) => [...prev, t].slice(0, MAX_ITENS_CHECKLIST));
    setNovoItem('');
  }

  function moverItem(i: number, delta: -1 | 1) {
    setChecklist((prev) => {
      const j = i + delta;
      if (j < 0 || j >= prev.length) return prev;
      const novo = [...prev];
      [novo[i], novo[j]] = [novo[j], novo[i]];
      return novo;
    });
  }

  async function salvar() {
    setTentou(true);
    if (!prazoOk) return;
    const mudancas: string[] = [];
    if (prazoNum !== categoria.prazo_sla_dias) mudancas.push(`prazo: ${textoPrazo(prazoNum)}`);
    if (prioridade !== categoria.prioridade)
      mudancas.push(`prioridade: ${ROTULO_PRIORIDADE[prioridade].label}`);
    if (ativo !== categoria.ativo) mudancas.push(ativo ? 'volta a ser atendida' : 'deixa de ser atendida');
    if ((secretariaId ? Number(secretariaId) : null) !== (categoria.secretaria_id ?? null))
      mudancas.push('secretaria responsável');
    if (JSON.stringify(checklist) !== JSON.stringify(categoria.checklist ?? []))
      mudancas.push(`checklist com ${checklist.length} itens`);
    if (!mudancas.length) {
      onFechar();
      return;
    }
    const ok = await confirmar({
      titulo: `Salvar ${categoria.nome}?`,
      mensagem: `Mudanças: ${mudancas.join('; ')}.${
        !ativo && categoria.ativo
          ? ' Cidadãos deixam de ver esta categoria ao reportar; chamados já abertos continuam.'
          : ''
      } A alteração fica registrada na auditoria.`,
      confirmar: 'Salvar',
    });
    if (!ok) return;

    setSalvando(true);
    const corpo = {
      ativo,
      prazo_sla_dias: prazoNum,
      prioridade,
      secretaria_id: secretariaId ? Number(secretariaId) : null,
      checklist,
    };
    try {
      const nova = await apiGestao.salvarCategoria(categoria.categoria_id, corpo);
      onSalvo(nova && typeof nova === 'object' && 'categoria_id' in nova ? nova : { ...categoria, ...corpo });
      toast.success(`${categoria.nome} atualizada`);
      onFechar();
    } catch (err) {
      toast.error(`Não foi possível salvar: ${mensagemDeErro(err)}`);
    } finally {
      setSalvando(false);
    }
  }

  const so = !podeEditar;

  return (
    <BottomSheet
      visible
      onClose={onFechar}
      title={categoria.nome}
      description={so ? 'Somente o administrador do município altera estas regras.' : undefined}
      footer={
        so ? (
          <Button variant="secondary" onPress={onFechar} style={styles.flex}>
            Fechar
          </Button>
        ) : (
          <>
            <Button variant="secondary" onPress={onFechar} style={styles.flex}>
              Cancelar
            </Button>
            <Button onPress={salvar} loading={salvando} style={styles.flex}>
              Salvar
            </Button>
          </>
        )
      }>
      <SwitchRow
        label="Atendida no município"
        descricao="Desligada, a categoria some da tela de reportar do cidadão."
        valor={ativo}
        onChange={setAtivo}
        disabled={so}
      />
      <TextField
        label="Prazo de atendimento (dias)"
        value={prazo}
        onChangeText={(t) => setPrazo(t.replace(/\D/g, ''))}
        keyboardType="number-pad"
        maxLength={3}
        editable={!so}
        invalid={tentou && !prazoOk}
        hint={
          tentou && !prazoOk
            ? 'Informe de 1 a 365 dias.'
            : 'Conta a partir do registro do chamado. Vencido, ele sobe na fila da operação.'
        }
        accessibilityLabel="Prazo de atendimento em dias"
      />
      <View style={styles.campo}>
        <AppText variant="caption" tone="muted">
          PRIORIDADE INICIAL
        </AppText>
        <SegmentedControl
          options={PRIORIDADES.map((p) => ({ value: p.value, label: p.label }))}
          value={prioridade}
          onChange={(v) => !so && setPrioridade(v)}
          accessibilityLabel="Prioridade inicial"
        />
      </View>
      {so ? (
        <TextField
          label="Secretaria responsável"
          value={opcoesSecretaria.find((o) => o.value === secretariaId)?.label ?? 'Nenhuma'}
          editable={false}
        />
      ) : (
        <Select
          label="Secretaria responsável"
          title="Secretaria responsável"
          options={opcoesSecretaria}
          value={secretariaId}
          onChange={setSecretariaId}
        />
      )}

      <View style={styles.campo}>
        <AppText variant="label" accessibilityRole="header">
          Checklist de conclusão
        </AppText>
        <AppText variant="bodySm" tone="secondary">
          O que o operador confirma antes de concluir (ex.: &quot;Área sinalizada&quot;, &quot;Foto
          do depois&quot;).
        </AppText>
        {checklist.length === 0 ? (
          <AppText variant="bodySm" tone="muted">
            Nenhum item.
          </AppText>
        ) : (
          checklist.map((item, i) => (
            <View
              key={`${i}-${item}`}
              style={[styles.item, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Ionicons name="checkbox-outline" size={18} color={colors.textSecondary} />
              <AppText variant="bodySm" style={styles.flex}>
                {item}
              </AppText>
              {so ? null : (
                <>
                  <IconButton
                    icon="arrow-up"
                    size="sm"
                    accessibilityLabel={`Subir "${item}"`}
                    onPress={() => moverItem(i, -1)}
                    disabled={i === 0}
                  />
                  <IconButton
                    icon="trash-outline"
                    size="sm"
                    accessibilityLabel={`Remover "${item}"`}
                    onPress={() => setChecklist((prev) => prev.filter((_, j) => j !== i))}
                  />
                </>
              )}
            </View>
          ))
        )}
        {so || checklist.length >= MAX_ITENS_CHECKLIST ? null : (
          <View style={styles.novoItem}>
            <TextField
              value={novoItem}
              onChangeText={setNovoItem}
              placeholder="Novo item"
              accessibilityLabel="Novo item do checklist"
              onSubmitEditing={adicionarItem}
              returnKeyType="done"
              maxLength={80}
              containerStyle={styles.flex}
            />
            <Button
              variant="secondary"
              onPress={adicionarItem}
              disabled={!novoItem.trim()}
              accessibilityLabel="Adicionar item ao checklist">
              Adicionar
            </Button>
          </View>
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  lista: {
    paddingHorizontal: Layout.gutter,
    gap: Spacing[2],
    flexGrow: 1,
  },
  cabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
  selos: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[1],
  },
  flex: {
    flex: 1,
  },
  campo: {
    gap: Spacing[2],
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    paddingLeft: Spacing[3],
    borderWidth: 1,
    borderRadius: 8,
    minHeight: 44,
  },
  novoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
});
