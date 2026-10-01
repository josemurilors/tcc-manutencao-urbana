/**
 * Nota interna (só a equipe vê) ou resposta pública ao cidadão.
 *
 * As duas são texto livre, mas com pesos diferentes: a resposta vira aviso
 * para quem reportou, por isso tem respostas prontas e um lembrete de
 * linguagem simples; a nota é o "recado" entre turnos e equipes.
 */

import { useState } from 'react';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { useToast } from '@/context/toast-context';
import { executarOuEnfileirar } from '@/services/operacao-offline';
import type { ChamadoFila, RespostaPadrao } from '@/types/operacao';

import { RespostasPadraoChips } from './campos';
import { identificador } from './regras';

export type ModoTexto = 'nota' | 'resposta';

type Props = {
  chamado: ChamadoFila;
  modo: ModoTexto | null;
  respostas: RespostaPadrao[];
  onClose: () => void;
  /** Texto enviado (ou guardado offline). */
  onFeito: (modo: ModoTexto, texto: string, offline: boolean) => void;
};

export function TextoSheet({ chamado, modo, respostas, onClose, onFeito }: Props) {
  if (!modo) return null;
  return (
    <Formulario
      key={`${chamado.id}-${modo}`}
      chamado={chamado}
      modo={modo}
      respostas={respostas}
      onClose={onClose}
      onFeito={onFeito}
    />
  );
}

function Formulario({ chamado, modo, respostas, onClose, onFeito }: Props & { modo: ModoTexto }) {
  const toast = useToast();
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const nota = modo === 'nota';
  const valido = texto.trim().length >= 3;

  async function enviar() {
    if (!valido) return;
    setEnviando(true);
    try {
      const r = await executarOuEnfileirar(
        { tipo: modo, defeito_id: chamado.id, texto: texto.trim() },
        `${nota ? 'Nota interna' : 'Resposta ao cidadão'} · ${identificador(chamado)}`,
      );
      if (r.offline) toast.warning('Sem conexão: o texto será enviado quando a rede voltar.');
      else toast.success(nota ? 'Nota registrada.' : 'Resposta enviada ao cidadão.');
      onFeito(modo, texto.trim(), r.offline);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível enviar.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <BottomSheet
      visible
      onClose={onClose}
      title={nota ? 'Nota interna' : 'Responder ao cidadão'}
      description={
        nota
          ? 'Visível só para a equipe da prefeitura.'
          : 'Quem reportou recebe um aviso. Use linguagem simples e diga o que vai acontecer.'
      }
      footer={
        <>
          <Button variant="secondary" onPress={onClose}>
            Cancelar
          </Button>
          <Button block style={{ flex: 1 }} onPress={enviar} loading={enviando} disabled={!valido}>
            {nota ? 'Salvar nota' : 'Enviar resposta'}
          </Button>
        </>
      }>
      <TextField
        value={texto}
        onChangeText={setTexto}
        multiline
        autoFocus
        accessibilityLabel={nota ? 'Texto da nota interna' : 'Texto da resposta'}
        placeholder={
          nota ? 'Ex.: precisa de caminhão com cesto; voltar na terça.' : 'Ex.: a equipe vai ao local nesta semana.'
        }
      />
      {!nota ? (
        <RespostasPadraoChips respostas={respostas} categoriaId={chamado.categoria_id} onEscolher={setTexto} />
      ) : null}
    </BottomSheet>
  );
}
