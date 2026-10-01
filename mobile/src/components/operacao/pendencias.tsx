/**
 * Pendências da fila de ações offline da operação.
 *
 * - `FaixaOffline`: faixa no topo da aba Operação quando a tela mostra o cache
 *   (sem rede) ou há ações na fila.
 * - `IndicadorOperacaoGlobal`: pílula flutuante, montada no layout raiz, que
 *   mostra as mesmas pendências nas outras telas (mapa, painel, conta) — a
 *   fila drena em qualquer tela, e quem está fora da aba precisa ver que algo
 *   ainda não chegou ao servidor.
 * - `PendenciasOperacaoSheet`: a folha (uma só, no layout raiz) com o que
 *   ainda não chegou: forçar o envio, tentar de novo um item recusado ou
 *   descartá-lo — nada some em silêncio.
 */

import { Ionicons } from '@expo/vector-icons';
import { usePathname } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StateView } from '@/components/ui/state-view';
import { AppText } from '@/components/ui/text';
import { corDoTom, Elevation, Layout, Radius, Spacing } from '@/constants/theme';
import { useOfflineSyncContext, useSyncOperacao } from '@/context/offline-sync-context';
import { useColors } from '@/context/theme-context';
import { useToast } from '@/context/toast-context';

function hora(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function resumoDaFila(pendentes: number, falhas: number) {
  return [
    pendentes > 0 ? `${pendentes} ${pendentes === 1 ? 'ação aguardando' : 'ações aguardando'} envio` : null,
    falhas > 0 ? `${falhas} com erro` : null,
  ].filter((p): p is string => !!p);
}

type Props = {
  /** ISO de quando o cache exibido foi salvo; null = dados ao vivo. */
  cacheDe: string | null;
  /** Com cache: o recorte exibido não é o que foi salvo (`useFila().cacheAviso`). */
  aviso?: string | null;
};

export function FaixaOffline({ cacheDe, aviso }: Props) {
  const colors = useColors();
  const { pendentes, falhas, abrirPainel } = useSyncOperacao();

  if (!cacheDe && pendentes === 0 && falhas === 0) return null;

  const tom = falhas > 0 ? 'danger' : cacheDe ? 'warning' : 'info';
  const cor = corDoTom(colors, tom);
  const partes = [
    ...(cacheDe ? [`Offline · fila de ${hora(cacheDe)}`] : []),
    ...(cacheDe && aviso ? [aviso] : []),
    ...resumoDaFila(pendentes, falhas),
  ];

  return (
    <Pressable
      onPress={abrirPainel}
      accessibilityRole="button"
      accessibilityLabel={`${partes.join(', ')}. Ver pendências`}
      style={({ pressed }) => [
        styles.faixa,
        { backgroundColor: pressed ? colors.surfacePressed : cor.bg, borderColor: cor.border },
      ]}>
      <Ionicons
        name={falhas > 0 ? 'alert-circle' : cacheDe ? 'cloud-offline' : 'cloud-upload'}
        size={18}
        color={cor.fg}
      />
      <AppText variant="caption" weight="600" style={[styles.flex, { color: cor.fg }]}>
        {partes.join(' · ')}
      </AppText>
      <Ionicons name="chevron-forward" size={16} color={cor.fg} />
    </Pressable>
  );
}

/**
 * Pílula flutuante + folha, para o layout raiz. Na aba Operação a pílula
 * some (a `FaixaOffline` já mostra o mesmo); com a pílula da fila do cidadão
 * também na tela, desce uma linha para as duas não se sobreporem.
 */
export function IndicadorOperacaoGlobal() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const sync = useSyncOperacao();
  const cidadao = useOfflineSyncContext();

  if (!sync.ativo) return null;

  const visivel = pathname !== '/operacao' && (sync.pendentes > 0 || sync.falhas > 0);
  const abaixoDaOutra = cidadao.pendentes > 0 || cidadao.falhas > 0;
  const cor = corDoTom(colors, sync.falhas > 0 ? 'danger' : 'primary');
  const texto =
    sync.falhas > 0
      ? `Operação: ${sync.falhas} não ${sync.falhas === 1 ? 'enviada' : 'enviadas'}`
      : `Operação: ${sync.pendentes} na fila`;

  return (
    <>
      {visivel ? (
        <View
          pointerEvents="box-none"
          style={[styles.flutuante, { top: insets.top + Spacing[1] + (abaixoDaOutra ? 40 : 0) }]}>
          <Pressable
            onPress={sync.abrirPainel}
            accessibilityRole="button"
            accessibilityLabel={`Operação: ${resumoDaFila(sync.pendentes, sync.falhas).join(', ')}. Toque para ver.`}
            accessibilityState={{ busy: sync.sincronizando }}
            hitSlop={{ top: 6, bottom: 6 }}
            style={({ pressed }) => [
              styles.pilula,
              Elevation.md,
              { backgroundColor: colors.surfaceRaised, borderColor: cor.border, opacity: pressed ? 0.85 : 1 },
            ]}>
            {sync.sincronizando ? (
              <ActivityIndicator size="small" color={cor.fg} />
            ) : (
              <Ionicons name={sync.falhas > 0 ? 'alert-circle' : 'construct'} size={16} color={cor.fg} />
            )}
            <AppText variant="caption" weight="600" inControl style={{ color: cor.fg }}>
              {texto}
            </AppText>
          </Pressable>
        </View>
      ) : null}
      <PendenciasOperacaoSheet />
    </>
  );
}

export function PendenciasOperacaoSheet() {
  const colors = useColors();
  const toast = useToast();
  const sync = useSyncOperacao();

  return (
    <BottomSheet
      visible={sync.painelAberto}
      onClose={sync.fecharPainel}
      title="Pendências de envio"
      description={
        sync.online
          ? 'Ações da operação registradas sem rede. Elas são enviadas sozinhas, na ordem em que foram feitas.'
          : 'Sem conexão. O que você registrar vai sozinho, na ordem em que foi feito, quando a rede voltar.'
      }
      footer={
        sync.pendentes > 0 ? (
          <Button
            block
            style={styles.flex}
            loading={sync.sincronizando}
            onPress={() => {
              sync.sincronizar(true).catch((err) => {
                toast.error(err instanceof Error ? err.message : 'Não foi possível enviar agora.');
              });
            }}
            icon={<Ionicons name="cloud-upload" size={16} color={colors.onPrimary} />}>
            Enviar agora
          </Button>
        ) : null
      }>
      {sync.acoes.length === 0 ? (
        <StateView
          kind="empty"
          icon="checkmark-done-outline"
          title="Tudo enviado"
          description="Nenhuma ação da operação esperando envio."
        />
      ) : (
        sync.acoes.map((a) => (
          <Card key={a.id} padding={Spacing[3]}>
            <View style={styles.linha}>
              <Ionicons
                name={a.status === 'falhou' ? 'alert-circle' : 'time'}
                size={18}
                color={a.status === 'falhou' ? colors.danger : colors.info}
              />
              <View style={styles.flex}>
                <AppText variant="label">{a.rotulo}</AppText>
                <AppText variant="caption" tone="muted">
                  {a.status === 'falhou' ? 'Não enviada' : 'Aguardando rede'} · registrada às {hora(a.criado_em)}
                </AppText>
                {a.erro && a.status === 'falhou' ? (
                  <AppText variant="caption" tone="danger">
                    {a.erro}
                  </AppText>
                ) : null}
              </View>
            </View>
            {a.status === 'falhou' ? (
              <View style={styles.acoes}>
                <Button size="sm" variant="secondary" onPress={() => sync.tentarDeNovo(a.id)}>
                  Tentar de novo
                </Button>
                <Button size="sm" variant="danger" onPress={() => sync.descartar(a.id)}>
                  Descartar
                </Button>
              </View>
            ) : null}
          </Card>
        ))
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  faixa: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    minHeight: Layout.minTouch,
    marginHorizontal: Layout.gutter,
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
    borderWidth: 1,
    borderRadius: Radius.md,
  },
  flex: {
    flex: 1,
  },
  linha: {
    flexDirection: 'row',
    gap: Spacing[2],
    alignItems: 'flex-start',
  },
  acoes: {
    flexDirection: 'row',
    gap: Spacing[2],
  },
  flutuante: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 9000,
  },
  pilula: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[1.5],
    minHeight: 32,
    paddingHorizontal: Spacing[3],
    borderWidth: 1,
    borderRadius: Radius.full,
  },
});
