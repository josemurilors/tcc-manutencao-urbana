/**
 * `/chamado/<id>` — página pública do chamado. Destino do link compartilhado
 * (https://tcc.josemurilors.com.br/chamado/<id>, `ciu://chamado/<id>`) e do
 * "Acompanhar" depois de reportar.
 */

import { useLocalSearchParams } from 'expo-router';

import { ChamadoPagina } from '@/components/chamado/chamado-pagina';
import { apiCidadao } from '@/services/api-cidadao';

export default function ChamadoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const alvo = String(id ?? '');
  return <ChamadoPagina chave={`id:${alvo}`} carregar={() => apiCidadao.detalhe(alvo)} />;
}
