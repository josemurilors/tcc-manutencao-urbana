/**
 * Ações do cidadão sobre um chamado, compartilhadas pelo sheet do mapa/lista
 * (`defect-sheet.tsx`) e pela página `/chamado/[id]`.
 *
 * Só o que uma pessoa comum faz: apoiar (ou "confirmar no local", quando a
 * tela informa a distância), anexar foto (autor), sinalizar "já foi
 * resolvido"/"não existe" e compartilhar. O backend decide o efeito
 * (`regras.py`). Avaliar e reabrir pedem texto: no sheet viram atalho para a
 * página do chamado, onde há espaço e teclado sem brigar com o modal.
 */

import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { AppText } from '@/components/ui/text';
import { RAIO_CONFIRMACAO_M } from '@/constants/proximidade';
import { statusFechado } from '@/constants/status';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useColors } from '@/context/theme-context';
import { useToast } from '@/context/toast-context';
import { api } from '@/services/api';
import { recarregarProgresso } from '@/services/progresso';
import type { Defeito, PickedImage, TipoSinalizacao } from '@/types';
import type { ChamadoDetalhe } from '@/types/cidadao';
import { totalApoios } from '@/utils/format';
import { formatarDistancia } from '@/utils/geo';
import { escolherDaGaleria, ImagemMuitoGrandeError } from '@/utils/image';

import { aguardaAvaliacao } from './avaliacao';
import { compartilharChamado } from './compartilhar';
import { podeReabrir } from './reabrir';

export type AcoesCidadaoProps = {
  defeito: Defeito;
  apoiado: boolean;
  /** `sheet` (mapa/lista) ou `pagina` (/chamado/[id]). */
  modo: 'sheet' | 'pagina';
  onPatch: (id: number, patch: Partial<Defeito>) => void;
  onReplace: (defeito: Defeito) => void;
  onApoioToggle: (id: number, apoiado: boolean) => void;
  sinalizacao?: TipoSinalizacao | null;
  onSinalizacaoChange?: (id: number, tipo: TipoSinalizacao | null) => void;
  /** O chamado deixou de existir (apagado como "não existe"). */
  onRemove?: (id: number) => void;
  /** Fecha o contêiner (sheet) — chamado ao remover ou ao ir para a página. */
  onClose?: () => void;
  /**
   * Distância até o chamado, em metros. Informada (mapa), o "Apoiar" vira
   * "Confirmar no local", liberado só dentro de `RAIO_CONFIRMACAO_M`.
   * `null` = GPS indisponível; `undefined` = contexto sem GPS (lista).
   */
  distanciaM?: number | null;
};

/** Compartilha e avisa o resultado num toast. */
export function useCompartilharChamado() {
  const toast = useToast();
  return async (d: Defeito) => {
    try {
      const r = await compartilharChamado(d);
      if (r === 'copiado') toast.success('Texto e link copiados. É só colar onde quiser.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível compartilhar.');
    }
  };
}

export function AcoesCidadao({
  defeito,
  apoiado,
  modo,
  onPatch,
  onReplace,
  onApoioToggle,
  sinalizacao = null,
  onSinalizacaoChange,
  onRemove,
  onClose,
  distanciaM,
}: AcoesCidadaoProps) {
  const colors = useColors();
  const addToast = useToast();
  const compartilhar = useCompartilharChamado();
  const { isAuthenticated } = useAuth();
  const [acaoEmCurso, setAcaoEmCurso] = useState<string | null>(null);

  const aberto = !statusFechado(defeito.status);
  const detalhe = defeito as ChamadoDetalhe;

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
      addToast.error(err instanceof Error ? err.message : 'Erro inesperado');
    } finally {
      setAcaoEmCurso(null);
    }
  }

  function handleApoiar() {
    const id = defeito.id;
    return comAcao('apoiar', async () => {
      const res = await api.apoiarDefeito(id);
      onApoioToggle(id, res.apoiado);
      const atual = totalApoios(defeito);
      onPatch(id, { total_apoios: res.apoiado ? atual + 1 : Math.max(0, atual - 1) });
      // Confirmar chamado de outra pessoa rende XP (o próprio, não).
      const xp = res.apoiado && !defeito.eh_autor ? ' +6 XP' : '';
      recarregarProgresso();
      addToast.success(
        modoConfirmacao
          ? res.apoiado
            ? `Problema confirmado no local!${xp}`
            : 'Confirmação removida.'
          : res.apoiado
            ? `Apoio registrado!${xp}`
            : 'Apoio removido.',
      );
    });
  }

  function handleSinalizar(tipo: TipoSinalizacao) {
    const id = defeito.id;
    return comAcao('sinalizar:' + tipo, async () => {
      const res = await api.sinalizarDefeito(id, tipo);
      onSinalizacaoChange?.(id, res.tipo);
      // Fechar/apagar o próprio chamado mexe no XP (bônus ou perda).
      if (res.resultado) recarregarProgresso();

      if (res.resultado === 'inexistente') {
        addToast.success('Chamado removido. Obrigado por avisar!');
        onRemove?.(id);
        onClose?.();
        return;
      }
      if (res.resultado === 'concluido' && res.defeito) {
        onReplace(res.defeito);
        addToast.success('Chamado marcado como resolvido. Obrigado!');
        return;
      }

      if (res.defeito) onReplace(res.defeito);
      else onPatch(id, { sinalizacoes: res.sinalizacoes });
      addToast.info(
        res.tipo === null
          ? 'Sinalização removida.'
          : res.tipo === 'resolvido'
            ? 'Obrigado! Avisamos que já foi resolvido.'
            : 'Obrigado! Avisamos que o problema não existe.',
      );
    });
  }

  function handleAnexar() {
    const id = defeito.id;
    return comAcao('anexar', async () => {
      let imagem: PickedImage | null = null;
      try {
        imagem = await escolherDaGaleria();
      } catch (err) {
        if (err instanceof ImagemMuitoGrandeError) {
          addToast.error(err.message);
          return;
        }
        throw err;
      }
      if (!imagem) return;
      await api.anexarImagem(id, imagem);
      addToast.success('Imagem anexada!');
      onReplace(await api.detalharDefeito(id));
    });
  }

  function abrirPagina() {
    onClose?.();
    router.push({ pathname: '/chamado/[id]', params: { id: String(defeito.id) } });
  }

  const botaoCompartilhar = (
    <Button
      variant="secondary"
      size="sm"
      onPress={() => compartilhar(defeito)}
      icon={<Ionicons name="share-social-outline" size={16} color={colors.textPrimary} />}>
      Compartilhar
    </Button>
  );

  if (!isAuthenticated) {
    return (
      <View style={styles.coluna}>
        <AppText variant="bodySm" tone="muted">
          Entre para apoiar, sinalizar ou acompanhar seus chamados.
        </AppText>
        <View style={styles.linha}>
          <Button size="sm" onPress={() => router.push('/login')}>
            Entrar
          </Button>
          {botaoCompartilhar}
          {modo === 'sheet' ? (
            <Button size="sm" variant="ghost" onPress={abrirPagina}>
              Ver página do chamado
            </Button>
          ) : null}
        </View>
      </View>
    );
  }

  const ctaAutor =
    modo === 'sheet' && (aguardaAvaliacao(detalhe) || podeReabrir(detalhe)) ? (
      <Button
        size="sm"
        variant={aguardaAvaliacao(detalhe) ? 'primary' : 'secondary'}
        onPress={abrirPagina}
        icon={
          <Ionicons
            name={aguardaAvaliacao(detalhe) ? 'star' : 'refresh'}
            size={16}
            color={aguardaAvaliacao(detalhe) ? colors.onPrimary : colors.textPrimary}
          />
        }>
        {aguardaAvaliacao(detalhe) ? 'Avaliar atendimento' : 'Reabrir ou avaliar'}
      </Button>
    ) : null;

  return (
    <View style={styles.coluna}>
      <View style={styles.linha}>
        {ctaAutor}
        {aberto ? (
          <Button
            variant={modoConfirmacao && aoAlcance && !apoiado ? 'primary' : 'secondary'}
            size="sm"
            onPress={handleApoiar}
            disabled={!podeConfirmar}
            loading={acaoEmCurso === 'apoiar'}
            accessibilityHint={
              modoConfirmacao ? 'Confirma que o problema existe, estando no local' : 'Mostra à prefeitura que isto também afeta você'
            }
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
                size={16}
                color={modoConfirmacao && aoAlcance && !apoiado ? colors.onPrimary : colors.textPrimary}
              />
            }>
            {rotuloConfirmar}
          </Button>
        ) : null}

        {/* Foto extra só do autor; a equipe anexa pela tela de operação. */}
        {defeito.eh_autor && aberto ? (
          <Button
            variant="secondary"
            size="sm"
            onPress={handleAnexar}
            loading={acaoEmCurso === 'anexar'}
            icon={<Ionicons name="image-outline" size={16} color={colors.textPrimary} />}>
            Anexar foto
          </Button>
        ) : null}

        {modo === 'sheet' ? botaoCompartilhar : null}
        {modo === 'sheet' ? (
          <Button
            size="sm"
            variant="ghost"
            onPress={abrirPagina}
            icon={<Ionicons name="open-outline" size={16} color={colors.textSecondary} />}>
            Ver página
          </Button>
        ) : null}
      </View>

      {aberto ? (
        <View style={styles.coluna}>
          <AppText variant="caption" tone="muted" weight="600">
            Esse problema ainda existe?
          </AppText>
          <View style={styles.linha}>
            <Button
              variant={sinalizacao === 'resolvido' ? 'primary' : 'secondary'}
              size="sm"
              onPress={() => handleSinalizar('resolvido')}
              loading={acaoEmCurso === 'sinalizar:resolvido'}
              accessibilityLabel="Avisar que já foi resolvido"
              icon={
                <Ionicons
                  name={sinalizacao === 'resolvido' ? 'checkmark-done-circle' : 'checkmark-done-circle-outline'}
                  size={16}
                  color={sinalizacao === 'resolvido' ? colors.onPrimary : colors.textPrimary}
                />
              }>
              Já foi resolvido
            </Button>
            <Button
              variant={sinalizacao === 'nao_existe' ? 'primary' : 'secondary'}
              size="sm"
              onPress={() => handleSinalizar('nao_existe')}
              loading={acaoEmCurso === 'sinalizar:nao_existe'}
              accessibilityLabel="Avisar que o problema não existe"
              icon={
                <Ionicons
                  name={sinalizacao === 'nao_existe' ? 'close-circle' : 'close-circle-outline'}
                  size={16}
                  color={sinalizacao === 'nao_existe' ? colors.onPrimary : colors.textPrimary}
                />
              }>
              Não existe
            </Button>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  coluna: {
    width: '100%',
    gap: Spacing[2],
  },
  linha: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
  },
});
