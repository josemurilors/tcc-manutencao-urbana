/**
 * Indicador da fila offline.
 *
 * - `SyncIndicator`: pílula "N na fila" / "N falharam" / "Offline". Tocar abre
 *   a folha da fila.
 * - `SyncIndicatorGlobal`: a pílula flutuando no topo, montada no layout raiz,
 *   para a fila ser visível em qualquer tela (só aparece com itens na fila).
 * - `FilaOfflineSheet`: lista o que está aguardando envio, com "Tentar de novo"
 *   e "Descartar" (com confirmação) por item.
 */

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge } from '@/components/ui/badge';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StateView } from '@/components/ui/state-view';
import { AppText } from '@/components/ui/text';
import { corDoTom, Elevation, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useColors } from '@/context/theme-context';
import { useOfflineSync } from '@/hooks/use-offline-sync';
import type { PendingDefeito } from '@/services/offline-queue';
import { formatarDataHora } from '@/utils/format';

export function SyncIndicator({ floating }: { floating?: boolean }) {
  const colors = useColors();
  const { pendentes, falhas, online, sincronizando, abrirPainel } = useOfflineSync();

  if (online && pendentes === 0 && falhas === 0) return null;

  // Prioridade: falha (pede ação) > offline > fila aguardando.
  const tom = falhas > 0 ? 'danger' : !online ? 'warning' : 'primary';
  const cor = corDoTom(colors, tom);
  const icone: keyof typeof Ionicons.glyphMap =
    falhas > 0 ? 'alert-circle' : !online ? 'cloud-offline' : 'cloud-upload';
  const texto =
    falhas > 0
      ? `${falhas} não ${falhas === 1 ? 'enviado' : 'enviados'}`
      : !online
        ? pendentes > 0
          ? `Offline · ${pendentes} na fila`
          : 'Offline'
        : `${pendentes} na fila`;
  const rotulo =
    falhas > 0
      ? `${falhas} ${falhas === 1 ? 'chamado não pôde' : 'chamados não puderam'} ser enviados. Toque para ver.`
      : !online
        ? `Sem conexão. ${pendentes} ${pendentes === 1 ? 'chamado salvo' : 'chamados salvos'} no aparelho.`
        : `${pendentes} ${pendentes === 1 ? 'chamado aguardando' : 'chamados aguardando'} envio. Toque para ver.`;

  return (
    <Pressable
      onPress={abrirPainel}
      accessibilityRole="button"
      accessibilityLabel={rotulo}
      accessibilityState={{ busy: sincronizando }}
      hitSlop={{ top: 6, bottom: 6 }}
      style={({ pressed }) => [
        styles.pilula,
        floating && Elevation.md,
        {
          backgroundColor: floating ? colors.surfaceRaised : cor.bg,
          borderColor: cor.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}>
      {sincronizando ? (
        <ActivityIndicator size="small" color={cor.fg} />
      ) : (
        <Ionicons name={icone} size={16} color={cor.fg} />
      )}
      <AppText variant="caption" weight="600" inControl style={{ color: cor.fg }}>
        {texto}
      </AppText>
    </Pressable>
  );
}

/** Pílula flutuante + folha da fila, para o layout raiz. */
export function SyncIndicatorGlobal() {
  const insets = useSafeAreaInsets();
  const { isAuthenticated } = useAuth();
  const { pendentes, falhas } = useOfflineSync();

  if (!isAuthenticated) return null;

  return (
    <>
      {pendentes > 0 || falhas > 0 ? (
        <View pointerEvents="box-none" style={[styles.flutuante, { top: insets.top + Spacing[1] }]}>
          <SyncIndicator floating />
        </View>
      ) : null}
      <FilaOfflineSheet />
    </>
  );
}

export function FilaOfflineSheet() {
  const { itens, online, sincronizando, sincronizar, painelAberto, fecharPainel } = useOfflineSync();

  return (
    <BottomSheet
      visible={painelAberto}
      onClose={fecharPainel}
      title="Aguardando envio"
      description={
        online
          ? 'Chamados salvos no aparelho. Enviamos sozinhos assim que possível.'
          : 'Você está sem conexão. Enviamos sozinhos quando a internet voltar.'
      }
      footer={
        itens.some((i) => (i.status ?? 'pendente') === 'pendente') ? (
          <Button
            block
            loading={sincronizando}
            disabled={!online}
            onPress={() => sincronizar({ forcar: true })}
            style={styles.botaoRodape}>
            Enviar agora
          </Button>
        ) : null
      }>
      {itens.length === 0 ? (
        <StateView
          kind="empty"
          icon="checkmark-done-outline"
          title="Tudo enviado"
          description="Nenhum chamado aguardando na fila."
        />
      ) : (
        itens.map((item) => <ItemDaFila key={item.id} item={item} />)
      )}
    </BottomSheet>
  );
}

function ItemDaFila({ item }: { item: PendingDefeito }) {
  const colors = useColors();
  const { tentarDeNovo, descartar, fecharPainel } = useOfflineSync();
  const [confirmando, setConfirmando] = useState(false);
  const falhou = item.status === 'falhou';
  // Recusado como duplicado: reenviar daria o mesmo 409; o útil é ver o que já existe.
  const existente = falhou ? item.defeito_existente_id : null;
  const titulo = item.titulo || item.categoria || 'Chamado';

  return (
    <Card padding={Spacing[3]}>
      <View style={styles.itemLinha}>
        {item.imagem ? (
          <Image
            source={{ uri: item.imagem.uri }}
            style={[styles.miniatura, { backgroundColor: colors.bgSubtle }]}
            contentFit="cover"
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View style={[styles.miniatura, styles.semFoto, { backgroundColor: colors.bgSubtle }]}>
            <Ionicons name="image-outline" size={22} color={colors.textMuted} />
          </View>
        )}
        <View style={styles.itemTextos}>
          <AppText variant="body" weight="600" numberOfLines={2}>
            {titulo}
          </AppText>
          <AppText variant="caption" tone="muted">
            Salvo em {formatarDataHora(item.criado_em)}
          </AppText>
          <Badge
            tone={falhou ? 'danger' : 'warning'}
            icon={falhou ? 'alert-circle' : 'time'}
            label={falhou ? 'Não enviado' : 'Na fila'}
          />
        </View>
      </View>
      {item.erro ? (
        <AppText variant="bodySm" tone={falhou ? 'danger' : 'secondary'}>
          {item.erro}
        </AppText>
      ) : null}
      <View style={styles.acoes}>
        {confirmando ? (
          <>
            <Button size="sm" variant="ghost" onPress={() => setConfirmando(false)}>
              Manter
            </Button>
            <Button
              size="sm"
              variant="danger"
              onPress={() => descartar(item.id)}
              accessibilityLabel={`Confirmar descarte de ${titulo}`}>
              Descartar de vez
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant="ghost"
              onPress={() => setConfirmando(true)}
              accessibilityLabel={`Descartar ${titulo}`}>
              Descartar
            </Button>
            {existente ? (
              <Button
                size="sm"
                variant="secondary"
                onPress={() => {
                  fecharPainel();
                  router.push({ pathname: '/chamado/[id]', params: { id: existente } });
                }}
                accessibilityLabel={`Ver o chamado que já existe no lugar de ${titulo}`}>
                Ver chamado
              </Button>
            ) : falhou ? (
              <Button
                size="sm"
                variant="secondary"
                onPress={() => tentarDeNovo(item.id)}
                accessibilityLabel={`Tentar enviar ${titulo} de novo`}>
                Tentar de novo
              </Button>
            ) : null}
          </>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  pilula: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: Spacing[1.5],
    minHeight: 32,
    paddingHorizontal: Spacing[3],
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  flutuante: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 9000,
  },
  botaoRodape: {
    flex: 1,
  },
  itemLinha: {
    flexDirection: 'row',
    gap: Spacing[3],
  },
  miniatura: {
    width: 64,
    height: 64,
    borderRadius: Radius.md,
  },
  semFoto: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemTextos: {
    flex: 1,
    gap: Spacing[1],
  },
  acoes: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing[2],
  },
});
