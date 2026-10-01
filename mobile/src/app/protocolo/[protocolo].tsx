/**
 * `/protocolo/<AAAA-NNNNNN>` — chamado aberto pelo número de protocolo
 * (consulta pública, como no 156 da prefeitura).
 */

import { useLocalSearchParams } from 'expo-router';

import { ChamadoPagina } from '@/components/chamado/chamado-pagina';
import { apiCidadao, normalizarProtocolo } from '@/services/api-cidadao';

export default function ProtocoloScreen() {
  const { protocolo } = useLocalSearchParams<{ protocolo: string }>();
  const bruto = String(protocolo ?? '');
  // Aceita o protocolo como veio no link mesmo que fuja do formato.
  const alvo = normalizarProtocolo(bruto) ?? bruto;
  return <ChamadoPagina chave={`protocolo:${alvo}`} carregar={() => apiCidadao.porProtocolo(alvo)} />;
}
