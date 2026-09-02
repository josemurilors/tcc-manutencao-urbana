/**
 * Detalhe do chamado para o **cidadão** (mapa e lista).
 *
 * Só o que uma pessoa comum faz: apoiar (ou "confirmar no local", quando a
 * tela informa a distância), anexar uma foto e sinalizar que o problema "já
 * foi resolvido" ou "não existe" — para quando o operador consertou e não
 * baixou o chamado, ou quando ninguém acha o problema no local. O backend
 * decide o efeito (`regras.py`): o autor fecha/apaga o próprio chamado na
 * hora; terceiros precisam de quórum. Atender, responder e finalizar
 * são trabalho de operador e vivem em `operacao-sheet.tsx` — mesmo um admin
 * navegando por aqui não vê essas ações, para o mapa do cidadão não virar
 * painel de operação.
 */

import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { DefectDetail, detailStyles } from '@/components/defect-detail';
import { Button } from '@/components/ui/button';
import { RAIO_CONFIRMACAO_M } from '@/constants/proximidade';
import { STATUS_FECHADOS } from '@/constants/status';
import { FontSize, FontWeight, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useColors } from '@/context/theme-context';
import { useToast } from '@/context/toast-context';
import { api } from '@/services/api';
import { recarregarProgresso } from '@/services/progresso';
import type { Defeito, PickedImage, TipoSinalizacao } from '@/types';
import { totalApoios } from '@/utils/format';
import { formatarDistancia } from '@/utils/geo';
import { escolherDaGaleria, ImagemMuitoGrandeError } from '@/utils/image';

type Props = {
  defeito: Defeito | null;
  apoiado: boolean;
  onClose: () => void;
  /** Aplica uma alteração parcial na lista do pai. */
  onPatch: (id: number, patch: Partial<Defeito>) => void;
  /** Substitui o chamado pelo objeto recarregado do backend. */
  onReplace: (defeito: Defeito) => void;
  onApoioToggle: (id: number, apoiado: boolean) => void;
  /** Sinalização do usuário logado neste chamado (`null` = nenhuma). */
  sinalizacao?: TipoSinalizacao | null;
  onSinalizacaoChange?: (id: number, tipo: TipoSinalizacao | null) => void;
  /** O chamado deixou de existir (apagado como "não existe"): tira da lista e fecha. */
  onRemove?: (id: number) => void;
  /**
   * Distância do usuário até o chamado, em metros. Quando informada (tela do
   * mapa), o "Apoiar" vira "Confirmar no local", liberado só dentro de
   * `RAIO_CONFIRMACAO_M` — o usuário atesta que a demanda existe estando lá.
   * `null` = GPS indisponível; `undefined` = contexto sem GPS (lista).
   */
  distanciaM?: number | null;
};

export function DefectSheet({
  defeito,
  apoiado,
  onClose,
  onPatch,
  onReplace,
  onApoioToggle,
  sinalizacao = null,
  onSinalizacaoChange,
  onRemove,
  distanciaM,
}: Props) {
  const colors = useColors();
  const addToast = useToast();
  const { user, isAuthenticated } = useAuth();

  const [acaoEmCurso, setAcaoEmCurso] = useState<string | null>(null);

  if (!defeito) return null;

  const aberto = !STATUS_FECHADOS.includes(defeito.status) && defeito.status !== 'rejeitado';

  // Modo "confirmar no local": só quando a tela informa a distância.
  const modoConfirmacao = distanciaM !== undefined;
  const aoAlcance = typeof distanciaM === 'number' && distanciaM <= RAIO_CONFIRMACAO_M;
  const podeConfirmar = !modoConfirmacao || apoiado || aoAlcance;
  const rotuloConfirmar = !modoConfirmacao
    ? apoiado
      ? 'Apoiado'
      : 'Apoiar'
    : apoiado
      ? 'Confirmado'
      : aoAlcance
        ? 'Confirmar no local'
        : distanciaM === null
          ? 'Sem GPS'
          : `Aproxime-se · ${formatarDistancia(distanciaM)}`;

  async function comAcao(chave: string, fn: () => Promise<void>) {
    setAcaoEmCurso(chave);
    try {
      await fn();
    } catch (err) {
      const mensagem = err instanceof Error ? err.message : 'Erro inesperado';
      addToast('Erro: ' + mensagem, 'error');
    } finally {
      setAcaoEmCurso(null);
    }
  }

  function handleApoiar() {
    const id = defeito!.id;
    return comAcao('apoiar', async () => {
      const res = await api.apoiarDefeito(id);
      onApoioToggle(id, res.apoiado);
      const atual = totalApoios(defeito!);
      onPatch(id, {
        total_apoios: res.apoiado ? atual + 1 : Math.max(0, atual - 1),
      });
      // Confirmar chamado de outra pessoa rende XP (o próprio, não).
      const deOutro =
        !defeito!.usuario || String(defeito!.usuario.id) !== String(user?.id ?? '');
      const xp = res.apoiado && deOutro ? ' +6 XP' : '';
      recarregarProgresso();
      addToast(
        modoConfirmacao
          ? res.apoiado
            ? `Demanda confirmada no local!${xp}`
            : 'Confirmação removida.'
          : res.apoiado
            ? `Apoio registrado!${xp}`
            : 'Apoio removido.',
      );
    });
  }

  function handleSinalizar(tipo: TipoSinalizacao) {
    const id = defeito!.id;
    return comAcao('sinalizar:' + tipo, async () => {
      const res = await api.sinalizarDefeito(id, tipo);
      onSinalizacaoChange?.(id, res.tipo);
      // Fechar/apagar o próprio chamado mexe no XP (bônus ou perda).
      if (res.resultado) recarregarProgresso();

      if (res.resultado === 'inexistente') {
        addToast('Chamado removido. Obrigado por avisar!');
        onRemove?.(id);
        onClose();
        return;
      }
      if (res.resultado === 'concluido' && res.defeito) {
        onReplace(res.defeito);
        addToast('Chamado marcado como resolvido. Obrigado!');
        return;
      }

      if (res.defeito) onReplace(res.defeito);
      else onPatch(id, { sinalizacoes: res.sinalizacoes });
      addToast(
        res.tipo === null
          ? 'Sinalização removida.'
          : res.tipo === 'resolvido'
            ? 'Obrigado! Avisamos que já foi resolvido.'
            : 'Obrigado! Avisamos que o problema não existe.',
      );
    });
  }

  function handleAnexar() {
    const id = defeito!.id;
    return comAcao('anexar', async () => {
      let imagem: PickedImage | null = null;
      try {
        imagem = await escolherDaGaleria();
      } catch (err) {
        if (err instanceof ImagemMuitoGrandeError) {
          addToast(err.message, 'error');
          return;
        }
        throw err;
      }
      if (!imagem) return;
      await api.anexarImagem(id, imagem);
      addToast('Imagem anexada!');
      onReplace(await api.detalharDefeito(id));
    });
  }

  return (
    <DefectDetail
      defeito={defeito}
      onClose={onClose}
      rotuloApoios={modoConfirmacao ? 'confirmacoes' : 'apoios'}>
      {isAuthenticated ? (
        <>
          <Button
            variant={modoConfirmacao && aoAlcance && !apoiado ? 'primary' : 'secondary'}
            size="sm"
            onPress={handleApoiar}
            disabled={!podeConfirmar}
            loading={acaoEmCurso === 'apoiar'}
            icon={
              <Ionicons
                name={
                  modoConfirmacao
                    ? apoiado
                      ? 'checkmark-circle'
                      : aoAlcance
                        ? 'checkmark-circle-outline'
                        : 'walk'
                    : apoiado
                      ? 'thumbs-up'
                      : 'thumbs-up-outline'
                }
                size={14}
                color={
                  modoConfirmacao && aoAlcance && !apoiado
                    ? colors.textInverse
                    : podeConfirmar
                      ? colors.gold500
                      : colors.textMuted
                }
              />
            }
            style={{ borderColor: podeConfirmar ? colors.gold500 : colors.borderDefault }}>
            {rotuloConfirmar}
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onPress={handleAnexar}
            loading={acaoEmCurso === 'anexar'}
            icon={<Ionicons name="image" size={14} color={colors.textSecondary} />}>
            Anexar
          </Button>

          {aberto ? (
            <View style={styles.sinalizar}>
              <Text style={[styles.sinalizarTitulo, { color: colors.textMuted }]}>
                Esse problema ainda existe?
              </Text>
              <View style={detailStyles.acoes}>
                <Button
                  variant={sinalizacao === 'resolvido' ? 'primary' : 'secondary'}
                  size="sm"
                  onPress={() => handleSinalizar('resolvido')}
                  loading={acaoEmCurso === 'sinalizar:resolvido'}
                  accessibilityLabel="Sinalizar que já foi resolvido"
                  icon={
                    <Ionicons
                      name={
                        sinalizacao === 'resolvido'
                          ? 'checkmark-done-circle'
                          : 'checkmark-done-circle-outline'
                      }
                      size={14}
                      color={sinalizacao === 'resolvido' ? colors.textInverse : colors.textSecondary}
                    />
                  }>
                  Já foi resolvido
                </Button>
                <Button
                  variant={sinalizacao === 'nao_existe' ? 'primary' : 'secondary'}
                  size="sm"
                  onPress={() => handleSinalizar('nao_existe')}
                  loading={acaoEmCurso === 'sinalizar:nao_existe'}
                  accessibilityLabel="Sinalizar que o problema não existe"
                  icon={
                    <Ionicons
                      name={sinalizacao === 'nao_existe' ? 'close-circle' : 'close-circle-outline'}
                      size={14}
                      color={sinalizacao === 'nao_existe' ? colors.textInverse : colors.textSecondary}
                    />
                  }>
                  Não existe
                </Button>
              </View>
            </View>
          ) : null}
        </>
      ) : (
        <Text style={[detailStyles.aviso, { color: colors.textMuted }]}>
          Faça login para apoiar, anexar imagens ou sinalizar que já foi resolvido.
        </Text>
      )}
    </DefectDetail>
  );
}

const styles = StyleSheet.create({
  sinalizar: {
    width: '100%',
    gap: Spacing[2],
    marginTop: Spacing[2],
  },
  sinalizarTitulo: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },
});
