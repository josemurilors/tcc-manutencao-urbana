/**
 * Faixa de estado offline da operação e a folha com as ações não enviadas.
 *
 * Aparece quando a tela mostra o cache (sem rede) ou quando há ações na fila.
 * O operador vê o que ainda não chegou ao servidor e pode forçar o envio,
 * tentar de novo um item recusado ou descartá-lo — nada some em silêncio.
 */

import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { AppText } from '@/components/ui/text';
import { corDoTom, Layout, Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import { useToast } from '@/context/toast-context';

import type { SyncOperacao } from './use-sync-operacao';

function hora(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

type Props = {
  sync: SyncOperacao;
  /** ISO de quando o cache exibido foi salvo; null = dados ao vivo. */
  cacheDe: string | null;
};

export function FaixaOffline({ sync, cacheDe }: Props) {
  const colors = useColors();
  const toast = useToast();
  const [aberta, setAberta] = useState(false);
  const { pendentes, falhas } = sync;

  if (!cacheDe && pendentes === 0 && falhas === 0) return null;

  const tom = falhas > 0 ? 'danger' : cacheDe ? 'warning' : 'info';
  const cor = corDoTom(colors, tom);
  const partes = [
    cacheDe ? `Offline · fila de ${hora(cacheDe)}` : null,
    pendentes > 0 ? `${pendentes} ${pendentes === 1 ? 'ação aguardando' : 'ações aguardando'} envio` : null,
    falhas > 0 ? `${falhas} com erro` : null,
  ].filter(Boolean);

  return (
    <>
      <Pressable
        onPress={() => setAberta(true)}
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

      <BottomSheet
        visible={aberta}
        onClose={() => setAberta(false)}
        title="Pendências de envio"
        description={
          cacheDe
            ? `Sem conexão. A fila mostrada é de ${hora(cacheDe)}; o que você registrar vai quando a rede voltar.`
            : 'Ações registradas sem rede. Elas são enviadas sozinhas, na ordem em que foram feitas.'
        }
        footer={
          <Button
            block
            style={styles.flex}
            loading={sync.sincronizando}
            disabled={pendentes === 0}
            onPress={() => {
              sync.sincronizar(true).catch((err) => {
                toast.error(err instanceof Error ? err.message : 'Não foi possível enviar agora.');
              });
            }}
            icon={<Ionicons name="cloud-upload" size={16} color={colors.onPrimary} />}>
            Enviar agora
          </Button>
        }>
        {sync.acoes.length === 0 ? (
          <AppText variant="bodySm" tone="secondary">
            Nenhuma ação esperando envio.
          </AppText>
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
    </>
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
});
