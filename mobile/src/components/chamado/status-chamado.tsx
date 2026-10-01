/**
 * Selo de status do chamado com cor do tema, ícone e rótulo do público certo
 * (cidadão lê "Recebido"; a equipe lê "Novo"). Substitui o `StatusBadge`
 * antigo (só ponto colorido, texto de 11 px) nas telas do cidadão.
 */

import { Badge } from '@/components/ui/badge';
import { rotuloCidadao, rotuloOperacao } from '@/constants/status';
import { corDoStatus } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import { iconeDoStatus } from '@/utils/timeline';

type Props = {
  status: string;
  visao?: 'cidadao' | 'operacao';
  size?: 'sm' | 'md';
};

export function StatusChamado({ status, visao = 'cidadao', size = 'sm' }: Props) {
  const colors = useColors();
  const rotulo = visao === 'operacao' ? rotuloOperacao(status) : rotuloCidadao(status);
  return (
    <Badge
      color={corDoStatus(colors, status)}
      icon={iconeDoStatus(status)}
      label={rotulo}
      size={size}
    />
  );
}
