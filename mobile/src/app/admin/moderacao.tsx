/**
 * Moderação (contrato v3, 7.6 `moderacao/`): a prefeitura revisa o que a
 * comunidade sinalizou em vez de deixar o chamado sumir sozinho.
 *
 * - Sinalizados: chamados com marcações de "não existe"/"já resolvido".
 *   Ações: abrir no mapa, remover (com motivo, vira soft delete).
 * - Removidos: o que saiu do ar; dá para restaurar.
 * - Cidadãos: quem tem advertência (strike) válida ou está suspenso;
 *   suspender por N dias ou reativar. O cidadão recebe aviso nos dois casos.
 *
 * Gestor ou mais. Toda ação pede confirmação e o motivo vai para a auditoria.
 */

import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AcaoSheet } from '@/components/gestao/acao-sheet';
import { confirmar, mensagemDeErro } from '@/components/gestao/confirmar';
import { EstadoCarga } from '@/components/gestao/estado-carga';
import { GestaoShell } from '@/components/gestao/gestao-shell';
import { useDados } from '@/components/gestao/use-dados';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StateView } from '@/components/ui/state-view';
import { AppText } from '@/components/ui/text';
import { rotuloOperacao } from '@/constants/status';
import { Layout, Spacing } from '@/constants/theme';
import { useToast } from '@/context/toast-context';
import { apiGestao } from '@/services/api-gestao';
import type { ChamadoModeracao, FilaModeracao, UsuarioModeracao } from '@/types/gestao';
import { formatarData } from '@/utils/format';

type Aba = 'sinalizados' | 'removidos' | 'usuarios';

type AcaoPendente =
  | { tipo: 'remover'; chamado: ChamadoModeracao }
  | { tipo: 'restaurar'; chamado: ChamadoModeracao }
  | { tipo: 'suspender'; usuario: UsuarioModeracao }
  | null;

const DIAS_SUSPENSAO_PADRAO = 7;

/** Origem da remoção (`removido_motivo`) → selo. */
const ORIGEM_REMOCAO: Record<string, string> = {
  comunidade: 'Removido pela comunidade',
  autor: 'Excluído pelo autor',
  moderacao: 'Removido pela prefeitura',
};

function suspensoAte(u: UsuarioModeracao) {
  return u.suspenso_ate && new Date(u.suspenso_ate) > new Date() ? u.suspenso_ate : null;
}

function plural(n: number, um: string, varios: string) {
  return `${n} ${n === 1 ? um : varios}`;
}

const FILA_VAZIA: FilaModeracao = {
  sinalizados: [],
  removidos: [],
  usuarios: [],
  contagens: { sinalizados: 0, removidos: 0, suspensos: 0, em_quarentena: 0 },
};

export default function ModeracaoScreen() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [aba, setAba] = useState<Aba>('sinalizados');
  const [acao, setAcao] = useState<AcaoPendente>(null);
  const [reativando, setReativando] = useState<string | null>(null);
  const dados = useDados(apiGestao.moderacao);
  // O backend já ordena os sinalizados (mais "não existe" primeiro).
  const fila: FilaModeracao = dados.dados ?? FILA_VAZIA;

  function tirarDaLista(chave: 'sinalizados' | 'removidos', id: string) {
    dados.setDados((prev) =>
      prev
        ? {
            ...prev,
            [chave]: prev[chave].filter((x) => x.id !== id),
            contagens: { ...prev.contagens, [chave]: Math.max(0, prev.contagens[chave] - 1) },
          }
        : prev,
    );
  }

  function trocarUsuario(id: string, mudanca: Partial<UsuarioModeracao>) {
    dados.setDados((prev) => {
      if (!prev) return prev;
      const usuarios = prev.usuarios.map((x) => (x.id === id ? { ...x, ...mudanca } : x));
      return {
        ...prev,
        usuarios,
        contagens: { ...prev.contagens, suspensos: usuarios.filter((u) => suspensoAte(u)).length },
      };
    });
  }

  function abrirChamado(c: ChamadoModeracao) {
    // O detalhe do chamado vive na folha do mapa (mesmo caminho de "Meus chamados").
    router.push({ pathname: '/(tabs)/mapa', params: { abrir: String(c.id) } });
  }

  async function reativar(u: UsuarioModeracao) {
    const ok = await confirmar({
      titulo: `Reativar ${u.nome}?`,
      mensagem: 'A suspensão termina agora e a pessoa volta a reportar, apoiar e sinalizar.',
      confirmar: 'Reativar',
    });
    if (!ok) return;
    setReativando(u.id);
    try {
      await apiGestao.reativarUsuario(u.id);
      trocarUsuario(u.id, { suspenso_ate: null, suspenso: false });
      toast.success(`${u.nome} reativado e avisado`);
    } catch (err) {
      toast.error(`Não foi possível reativar: ${mensagemDeErro(err)}`);
    } finally {
      setReativando(null);
    }
  }

  async function executar({ motivo, dias }: { motivo: string; dias: number }) {
    if (!acao) return false;
    try {
      if (acao.tipo === 'remover') {
        const r = await apiGestao.removerChamado(acao.chamado.id, motivo);
        tirarDaLista('sinalizados', acao.chamado.id);
        dados.setDados((prev) =>
          prev
            ? {
                ...prev,
                removidos: [
                  {
                    ...acao.chamado,
                    removido_em: r?.removido_em ?? new Date().toISOString(),
                    removido_motivo: r?.removido_motivo ?? 'moderacao',
                    removido_texto: r?.removido_texto ?? motivo,
                  },
                  ...prev.removidos,
                ],
                contagens: { ...prev.contagens, removidos: prev.contagens.removidos + 1 },
              }
            : prev,
        );
        toast.success('Chamado removido e autor avisado. Dá para restaurar na aba Removidos.');
      } else if (acao.tipo === 'restaurar') {
        const r = await apiGestao.restaurarChamado(acao.chamado.id, motivo);
        tirarDaLista('removidos', acao.chamado.id);
        toast.success(
          r?.strike_retirado
            ? 'Chamado restaurado e advertência do autor retirada'
            : 'Chamado restaurado e de volta ao mapa',
        );
      } else {
        const r = await apiGestao.suspenderUsuario(acao.usuario.id, dias, motivo);
        trocarUsuario(acao.usuario.id, {
          suspenso_ate: r?.suspenso_ate ?? new Date(Date.now() + dias * 86_400_000).toISOString(),
          suspenso: true,
        });
        toast.success(
          `${acao.usuario.nome} suspenso por ${dias === 1 ? '1 dia' : `${dias} dias`} e avisado`,
        );
      }
      return true;
    } catch (err) {
      toast.error(`Não foi possível concluir: ${mensagemDeErro(err)}`);
      return false;
    }
  }

  const refresh = <RefreshControl refreshing={dados.atualizando} onRefresh={dados.atualizar} />;
  const conteudo = [styles.lista, { paddingBottom: insets.bottom + Spacing[16] }];

  return (
    <GestaoShell title="Moderação" minimo="gestor">
      <View style={styles.abas}>
        <SegmentedControl
          options={[
            {
              value: 'sinalizados',
              label: `Sinalizados${dados.dados ? ` (${fila.contagens.sinalizados})` : ''}`,
            },
            { value: 'removidos', label: 'Removidos' },
            {
              value: 'usuarios',
              label: `Cidadãos${dados.dados && fila.usuarios.length ? ` (${fila.usuarios.length})` : ''}`,
            },
          ]}
          value={aba}
          onChange={setAba}
          accessibilityLabel="Fila de moderação"
        />
      </View>

      {dados.estado !== 'pronto' ? (
        <EstadoCarga
          estado={dados.estado}
          erro={dados.erro}
          onRetry={dados.recarregar}
          oQue="a fila de moderação"
        />
      ) : aba === 'usuarios' ? (
        <FlatList
          data={fila.usuarios}
          keyExtractor={(u) => String(u.id)}
          contentContainerStyle={conteudo}
          refreshControl={refresh}
          ListEmptyComponent={
            <StateView
              kind="empty"
              icon="happy-outline"
              title="Nenhum cidadão com advertência"
              description="Quem teve chamado removido pela comunidade como inexistente, ou está suspenso, aparece aqui."
            />
          }
          renderItem={({ item }) => (
            <CartaoUsuario
              usuario={item}
              reativando={reativando === item.id}
              onSuspender={() => setAcao({ tipo: 'suspender', usuario: item })}
              onReativar={() => reativar(item)}
            />
          )}
        />
      ) : (
        <FlatList
          data={aba === 'sinalizados' ? fila.sinalizados : fila.removidos}
          ListHeaderComponent={
            aba === 'removidos' && fila.contagens.removidos > fila.removidos.length ? (
              <AppText variant="caption" tone="muted">
                Mostrando os {fila.removidos.length} mais recentes de {fila.contagens.removidos}.
              </AppText>
            ) : aba === 'sinalizados' && fila.contagens.sinalizados > fila.sinalizados.length ? (
              <AppText variant="caption" tone="muted">
                Mostrando {fila.sinalizados.length} de {fila.contagens.sinalizados}, os mais
                sinalizados primeiro.
              </AppText>
            ) : null
          }
          keyExtractor={(c) => String(c.id)}
          contentContainerStyle={conteudo}
          refreshControl={refresh}
          ListEmptyComponent={
            aba === 'sinalizados' ? (
              <StateView
                kind="empty"
                icon="checkmark-done-outline"
                title="Nada para revisar"
                description="Quando cidadãos marcarem um chamado como inexistente ou já resolvido, ele aparece aqui."
              />
            ) : (
              <StateView
                kind="empty"
                icon="trash-outline"
                title="Nenhum chamado removido"
                description="Chamados removidos pela comunidade ou pela prefeitura aparecem aqui e podem ser restaurados."
              />
            )
          }
          renderItem={({ item }) => (
            <CartaoChamado
              chamado={item}
              removido={aba === 'removidos'}
              onAbrir={() => abrirChamado(item)}
              onRemover={() => setAcao({ tipo: 'remover', chamado: item })}
              onRestaurar={() => setAcao({ tipo: 'restaurar', chamado: item })}
            />
          )}
        />
      )}

      {acao ? (
        <AcaoSheet
          key={acao.tipo === 'suspender' ? `u-${acao.usuario.id}` : `${acao.tipo}-${acao.chamado.id}`}
          visivel
          onFechar={() => setAcao(null)}
          titulo={
            acao.tipo === 'remover'
              ? 'Remover chamado?'
              : acao.tipo === 'restaurar'
                ? 'Restaurar chamado?'
                : `Suspender ${acao.tipo === 'suspender' ? acao.usuario.nome : ''}?`
          }
          descricao={
            acao.tipo === 'remover'
              ? `"${acao.chamado.titulo}" sai do mapa e das listas, mas fica no histórico. Dá para restaurar depois.`
              : acao.tipo === 'restaurar'
                ? `"${acao.chamado.titulo}" volta ao mapa com o status que tinha.`
                : 'Durante a suspensão a pessoa não reporta, apoia nem sinaliza. Ela continua vendo o mapa.'
          }
          confirmar={
            acao.tipo === 'remover' ? 'Remover' : acao.tipo === 'restaurar' ? 'Restaurar' : 'Suspender'
          }
          destrutivo={acao.tipo !== 'restaurar'}
          pedirDias={acao.tipo === 'suspender' ? DIAS_SUSPENSAO_PADRAO : undefined}
          onConfirmar={executar}
        />
      ) : null}
    </GestaoShell>
  );
}

function CartaoChamado({
  chamado: c,
  removido,
  onAbrir,
  onRemover,
  onRestaurar,
}: {
  chamado: ChamadoModeracao;
  removido: boolean;
  onAbrir: () => void;
  onRemover: () => void;
  onRestaurar: () => void;
}) {
  const naoExiste = c.total_nao_existe ?? 0;
  const resolvido = c.total_resolvido ?? 0;
  const apoios = c.total_apoios ?? 0;
  const local = [c.categoria, c.rua || c.bairro].filter(Boolean).join(' · ');
  return (
    <Card>
      <View style={styles.cabecalho}>
        <AppText variant="label" style={styles.flex} numberOfLines={2}>
          {c.titulo}
        </AppText>
        {c.protocolo ? (
          <AppText variant="caption" tone="muted">
            {c.protocolo}
          </AppText>
        ) : null}
      </View>
      {local ? (
        <AppText variant="bodySm" tone="secondary">
          {local}
        </AppText>
      ) : null}
      <View style={styles.selos}>
        {removido ? (
          <Badge
            label={ORIGEM_REMOCAO[c.removido_motivo ?? ''] ?? 'Removido'}
            tone="neutral"
            icon="trash"
          />
        ) : (
          <>
            {naoExiste ? (
              <Badge
                label={`${naoExiste} ${naoExiste === 1 ? 'diz' : 'dizem'} que não existe`}
                tone="danger"
                icon="eye-off"
              />
            ) : null}
            {resolvido ? (
              <Badge
                label={`${resolvido} ${resolvido === 1 ? 'diz' : 'dizem'} que já foi resolvido`}
                tone="warning"
                icon="checkmark-circle"
              />
            ) : null}
            {apoios ? (
              <Badge label={plural(apoios, 'apoio', 'apoios')} tone="neutral" icon="people" />
            ) : null}
            {c.status ? <Badge label={rotuloOperacao(c.status)} tone="info" icon="ellipse" /> : null}
          </>
        )}
      </View>
      {removido && c.removido_texto && c.removido_texto !== c.removido_motivo ? (
        <AppText variant="bodySm" tone="secondary">
          Motivo: {c.removido_texto}
        </AppText>
      ) : null}
      <AppText variant="caption" tone="muted">
        {[
          c.autor_nome ? `Por ${c.autor_nome}` : null,
          c.criado_em ? `aberto em ${formatarData(c.criado_em)}` : null,
          removido && c.removido_em ? `removido em ${formatarData(c.removido_em)}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </AppText>
      <View style={styles.acoes}>
        {removido ? (
          <Button size="sm" onPress={onRestaurar} accessibilityLabel={`Restaurar ${c.titulo}`}>
            Restaurar
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              variant="secondary"
              onPress={onAbrir}
              accessibilityLabel={`Abrir ${c.titulo} no mapa`}>
              Abrir chamado
            </Button>
            <Button
              size="sm"
              variant="danger"
              onPress={onRemover}
              accessibilityLabel={`Remover ${c.titulo}`}>
              Remover
            </Button>
          </>
        )}
      </View>
    </Card>
  );
}

function CartaoUsuario({
  usuario: u,
  reativando,
  onSuspender,
  onReativar,
}: {
  usuario: UsuarioModeracao;
  reativando: boolean;
  onSuspender: () => void;
  onReativar: () => void;
}) {
  const ate = suspensoAte(u);
  return (
    <Card>
      <View style={styles.cabecalho}>
        <AppText variant="label" style={styles.flex} numberOfLines={1}>
          {u.nome}
        </AppText>
        {u.strikes_ativos ? (
          <Badge
            label={plural(u.strikes_ativos, 'advertência', 'advertências')}
            tone={u.em_quarentena ? 'danger' : 'warning'}
            icon="warning"
          />
        ) : null}
      </View>
      {u.chamados_removidos ? (
        <AppText variant="bodySm" tone="secondary">
          {plural(u.chamados_removidos, 'chamado removido', 'chamados removidos')} neste município
        </AppText>
      ) : null}
      <View style={styles.selos}>
        {ate ? (
          <Badge label={`Suspenso até ${formatarData(ate)}`} tone="danger" icon="ban" />
        ) : (
          <Badge label="Ativo" tone="success" />
        )}
        {u.em_quarentena ? (
          <Badge label="Em quarentena: novos chamados restritos" tone="warning" icon="hourglass" />
        ) : null}
      </View>
      <View style={styles.acoes}>
        {ate ? (
          <Button
            size="sm"
            variant="secondary"
            onPress={onReativar}
            loading={reativando}
            accessibilityLabel={`Reativar ${u.nome}`}>
            Reativar
          </Button>
        ) : (
          <Button
            size="sm"
            variant="danger"
            onPress={onSuspender}
            accessibilityLabel={`Suspender ${u.nome}`}>
            Suspender
          </Button>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  abas: {
    paddingHorizontal: Layout.gutter,
    paddingBottom: Spacing[3],
  },
  lista: {
    paddingHorizontal: Layout.gutter,
    gap: Spacing[3],
    flexGrow: 1,
  },
  cabecalho: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing[2],
  },
  flex: {
    flex: 1,
  },
  selos: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[1],
  },
  acoes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: Spacing[2],
    marginTop: Spacing[1],
  },
});
