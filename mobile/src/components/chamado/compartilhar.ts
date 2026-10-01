/**
 * Compartilhar um chamado (WhatsApp, e-mail...). O texto leva protocolo e
 * link público — com o protocolo, quem recebe consulta mesmo sem o app.
 *
 * No web, `Share` do RN usa `navigator.share`, que muitos navegadores de
 * desktop não têm; aí o link vai para a área de transferência.
 */

import { Platform, Share } from 'react-native';

import { rotuloCidadao } from '@/constants/status';
import { linkPublicoDoChamado } from '@/services/api-cidadao';
import type { Defeito } from '@/types';
import { totalApoios } from '@/utils/format';

export type ResultadoCompartilhar = 'compartilhado' | 'copiado' | 'cancelado';

export function textoDoChamado(d: Defeito) {
  const categoria = d.categoria || d.categoria_nome || d.titulo;
  const onde = [d.rua, d.bairro].filter(Boolean).join(', ');
  const apoios = totalApoios(d);
  const partes = [
    `${categoria}${onde ? ` em ${onde}` : ''} — ${rotuloCidadao(d.status)}.`,
    d.protocolo ? `Protocolo ${d.protocolo}.` : '',
    apoios > 0 ? `${apoios} ${apoios === 1 ? 'pessoa confirmou' : 'pessoas confirmaram'}.` : '',
    `Acompanhe e apoie: ${linkPublicoDoChamado(d.id)}`,
  ];
  return partes.filter(Boolean).join(' ');
}

export async function compartilharChamado(d: Defeito): Promise<ResultadoCompartilhar> {
  const mensagem = textoDoChamado(d);
  const link = linkPublicoDoChamado(d.id);

  if (Platform.OS === 'web') {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    if (nav?.share) {
      try {
        await nav.share({ title: 'Chamado na prefeitura', text: mensagem, url: link });
        return 'compartilhado';
      } catch (err) {
        // Fechar a folha de compartilhar não é erro.
        if (err instanceof Error && err.name === 'AbortError') return 'cancelado';
        throw err;
      }
    }
    if (nav?.clipboard) {
      await nav.clipboard.writeText(mensagem);
      return 'copiado';
    }
    throw new Error('Este navegador não permite compartilhar. Copie o endereço da página.');
  }

  const res = await Share.share(
    // No iOS a `url` vira anexo separado do texto; no Android só a mensagem conta.
    Platform.OS === 'ios' ? { message: mensagem, url: link } : { message: mensagem, title: 'Chamado' },
    { dialogTitle: 'Compartilhar chamado' },
  );
  return res.action === Share.dismissedAction ? 'cancelado' : 'compartilhado';
}
