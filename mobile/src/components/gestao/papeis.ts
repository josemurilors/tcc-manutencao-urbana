/**
 * Papéis da equipe municipal no app (contrato v3, seção 3): rótulo, o que
 * cada um pode fazer e o nível para comparar ("gestor ou mais").
 *
 * Espelha `core/permissoes.py::nivel`. O app só usa isto para decidir o que
 * MOSTRAR; quem decide o que pode é o backend (403 continua tratado).
 */

import { useEffect, useMemo } from 'react';

import type { Tom } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { apiGestao } from '@/services/api-gestao';
import type { User } from '@/types';
import type { Papel, PapelEquipe } from '@/types/gestao';

export const NIVEL: Record<Papel, number> = {
  cidadao: 0,
  operador: 1,
  gestor: 2,
  admin_municipal: 3,
  super_admin: 4,
};

export const ROTULO_PAPEL: Record<Papel, string> = {
  cidadao: 'Cidadão',
  operador: 'Operador',
  gestor: 'Gestor',
  admin_municipal: 'Administrador',
  super_admin: 'Plataforma',
};

/** Explicação curta, mostrada ao escolher o papel de alguém. */
export const DESCRICAO_PAPEL: Record<PapelEquipe, string> = {
  operador: 'Atende a fila: assume chamados, muda o andamento e registra evidências.',
  gestor:
    'Tudo do operador, mais rejeitar e reabrir, distribuir para equipes, alterar prazos, ver o painel e moderar.',
  admin_municipal:
    'Tudo do gestor, mais gerenciar a equipe, secretarias, categorias e a configuração do município.',
};

export const TOM_PAPEL: Record<Papel, Tom> = {
  cidadao: 'neutral',
  operador: 'info',
  gestor: 'primary',
  admin_municipal: 'success',
  super_admin: 'warning',
};

export const PAPEIS_EQUIPE: PapelEquipe[] = ['operador', 'gestor', 'admin_municipal'];

export function ehPapel(valor: unknown): valor is Papel {
  return typeof valor === 'string' && valor in NIVEL;
}

/**
 * Papel do usuário logado. Contas gravadas antes do contrato v3 só têm a flag
 * `admin`: nesse caso assume o MENOR papel de equipe (operador) — melhor
 * esconder uma área até o perfil revalidar do que mostrar e tomar 403.
 */
export function papelDe(user: User | null | undefined): Papel {
  if (!user) return 'cidadao';
  if (ehPapel(user.papel)) return user.papel;
  if (user.super_admin) return 'super_admin';
  if (user.admin) return 'operador';
  return 'cidadao';
}

export function nivelDe(papel: Papel) {
  return NIVEL[papel] ?? 0;
}

// Revalidação do perfil: o papel guardado no aparelho envelhece (quem perdeu
// o acesso continuava vendo Operação até sair e entrar). Uma ida ao perfil por
// sessão do app, no máximo a cada 5 minutos, é barata e resolve.
const INTERVALO_REVALIDACAO_MS = 5 * 60 * 1000;
let ultimaRevalidacao = 0;

/**
 * Papel atual + nível, com revalidação do perfil em segundo plano. Chamar de
 * um ponto sempre montado (o layout das abas) basta para o app inteiro.
 */
export function usePapel() {
  const { user, isAuthenticated, updateUser } = useAuth();
  const papel = papelDe(isAuthenticated ? user : null);

  useEffect(() => {
    if (!isAuthenticated) return;
    const agora = Date.now();
    if (agora - ultimaRevalidacao < INTERVALO_REVALIDACAO_MS) return;
    ultimaRevalidacao = agora;
    apiGestao
      .perfil()
      .then((perfil) => {
        if (!perfil) return;
        return updateUser({
          papel: perfil.papel,
          admin: perfil.admin,
          super_admin: perfil.super_admin,
          municipio_id: perfil.municipio_id ?? null,
        });
      })
      .catch((err: unknown) => {
        // Sem rede ou sessão caindo: fica o papel guardado e tenta de novo
        // na próxima montagem. Não é erro de tela, mas não pode sumir calado.
        ultimaRevalidacao = 0;
        console.warn('[papel] revalidação do perfil falhou:', err);
      });
  }, [isAuthenticated, updateUser]);

  return useMemo(
    () => ({
      papel,
      nivel: nivelDe(papel),
      ehEquipe: nivelDe(papel) >= NIVEL.operador,
      ehGestor: nivelDe(papel) >= NIVEL.gestor,
      ehAdmin: nivelDe(papel) >= NIVEL.admin_municipal,
    }),
    [papel],
  );
}
