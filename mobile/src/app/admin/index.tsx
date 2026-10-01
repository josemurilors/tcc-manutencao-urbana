/**
 * Administração do município — hub com um cartão por área e um contador que
 * diz se há algo a fazer ("3 sinalizados", "12 pessoas").
 *
 * Cada contador carrega sozinho (`allSettled`): se um endpoint ainda não
 * existe ou falha, só aquele cartão mostra "—" e o resto do hub funciona.
 * Quem vê o quê segue o contrato v3 (seção 7.6): leitura para gestor+,
 * auditoria só para o administrador.
 */

import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GestaoShell } from '@/components/gestao/gestao-shell';
import { NIVEL, ROTULO_PAPEL, usePapel } from '@/components/gestao/papeis';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { AppText } from '@/components/ui/text';
import { Layout, Spacing, type Tom } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useColors } from '@/context/theme-context';
import { apiGestao } from '@/services/api-gestao';
import type { Papel } from '@/types/gestao';

type Contador = { valor: string; detalhe?: string; tom?: Tom } | 'carregando' | 'erro';

type Area = {
  chave: string;
  titulo: string;
  descricao: string;
  icone: keyof typeof Ionicons.glyphMap;
  rota: string;
  minimo: Papel;
};

const AREAS: Area[] = [
  {
    chave: 'equipe',
    titulo: 'Equipe',
    descricao: 'Quem trabalha no app, com que papel. Convide e revogue acessos.',
    icone: 'people',
    rota: '/admin/equipe',
    minimo: 'gestor',
  },
  {
    chave: 'secretarias',
    titulo: 'Secretarias e equipes',
    descricao: 'Órgãos responsáveis e as equipes de campo de cada um.',
    icone: 'business',
    rota: '/admin/secretarias',
    minimo: 'gestor',
  },
  {
    chave: 'categorias',
    titulo: 'Categorias e prazos',
    descricao: 'Prazo de atendimento, prioridade, secretaria e checklist por tipo de problema.',
    icone: 'pricetags',
    rota: '/admin/categorias',
    minimo: 'gestor',
  },
  {
    chave: 'moderacao',
    titulo: 'Moderação',
    descricao: 'Chamados sinalizados pela comunidade e cidadãos com advertências.',
    icone: 'shield-half',
    rota: '/admin/moderacao',
    minimo: 'gestor',
  },
  {
    chave: 'municipio',
    titulo: 'Configuração do município',
    descricao: 'Identidade, contato da prefeitura e regras de atendimento.',
    icone: 'settings',
    rota: '/admin/municipio',
    minimo: 'gestor',
  },
  {
    chave: 'auditoria',
    titulo: 'Auditoria',
    descricao: 'Quem alterou o quê e quando, para prestação de contas.',
    icone: 'document-text',
    rota: '/admin/auditoria',
    minimo: 'admin_municipal',
  },
];

function plural(n: number, um: string, varios: string) {
  return `${n} ${n === 1 ? um : varios}`;
}

/** Busca os contadores das áreas que o papel vê; falha de um não derruba os outros. */
async function buscarContadores(nivel: number): Promise<Record<string, Contador>> {
  const pode = (minimo: Papel) => nivel >= NIVEL[minimo];
  const tarefas: Record<string, () => Promise<Exclude<Contador, 'carregando' | 'erro'>>> = {
    equipe: async () => {
      const p = await apiGestao.membros({ page: 1 });
      return { valor: plural(p.count, 'pessoa', 'pessoas') };
    },
    secretarias: async () => {
      const [s, e] = await Promise.all([apiGestao.secretarias(), apiGestao.equipes()]);
      return {
        valor: plural(s.filter((x) => x.ativo).length, 'secretaria', 'secretarias'),
        detalhe: plural(e.filter((x) => x.ativo).length, 'equipe', 'equipes'),
      };
    },
    categorias: async () => {
      const c = await apiGestao.categorias();
      const ativas = c.filter((x) => x.ativo).length;
      const semPrazo = c.filter((x) => x.ativo && !x.prazo_sla_dias).length;
      return {
        valor: plural(ativas, 'ativa', 'ativas'),
        detalhe: semPrazo ? plural(semPrazo, 'sem prazo', 'sem prazo') : undefined,
        tom: semPrazo ? 'warning' : undefined,
      };
    },
    moderacao: async () => {
      const m = await apiGestao.moderacao();
      const pendentes = m.contagens.sinalizados;
      return {
        valor: pendentes ? plural(pendentes, 'sinalizado', 'sinalizados') : 'Fila vazia',
        detalhe: m.contagens.suspensos
          ? plural(m.contagens.suspensos, 'cidadão suspenso', 'cidadãos suspensos')
          : m.usuarios.length
            ? plural(m.usuarios.length, 'cidadão com advertência', 'cidadãos com advertência')
            : undefined,
        tom: pendentes ? 'warning' : 'success',
      };
    },
    municipio: async () => {
      // O que falta configurar é o que interessa no hub: sem contato, o
      // cidadão não tem a quem recorrer fora do app.
      const c = await apiGestao.municipio();
      const semContato = !c.email_contato && !c.telefone;
      return {
        valor: semContato ? 'Falta o contato' : 'Configurado',
        detalhe: c.parametros?.exigir_foto_conclusao === false ? 'Foto ao concluir opcional' : undefined,
        tom: semContato ? 'warning' : 'success',
      };
    },
    auditoria: async () => {
      const p = await apiGestao.auditoria({ page: 1 });
      return { valor: plural(p.count, 'registro', 'registros') };
    },
  };

  const visiveis = AREAS.filter((a) => pode(a.minimo));
  const resultados = await Promise.allSettled(visiveis.map((a) => tarefas[a.chave]()));
  return Object.fromEntries(
    visiveis.map((a, i) => {
      const r = resultados[i];
      if (r.status === 'rejected') {
        // Contador é acessório: falhou, o cartão segue clicável e a
        // própria tela mostra o erro com "Tentar de novo".
        console.warn(`[admin] contador de ${a.chave} falhou:`, r.reason);
        return [a.chave, 'erro' as const];
      }
      return [a.chave, r.value];
    }),
  );
}

export default function AdminHubScreen() {
  const { user } = useAuth();
  const { papel, nivel } = usePapel();
  const insets = useSafeAreaInsets();
  const [contadores, setContadores] = useState<Record<string, Contador>>({});
  const [atualizando, setAtualizando] = useState(false);
  const [versao, setVersao] = useState(0);

  // Sem "zerar" antes de buscar: cartão sem contador já aparece carregando,
  // e ao puxar para atualizar os números antigos ficam até os novos chegarem.
  useEffect(() => {
    let cancelado = false;
    buscarContadores(nivel).then((novos) => {
      if (cancelado) return;
      setContadores(novos);
      setAtualizando(false);
    });
    return () => {
      cancelado = true;
    };
  }, [nivel, versao]);

  function atualizar() {
    setAtualizando(true);
    setVersao((v) => v + 1);
  }

  const municipio = user?.municipio?.nome
    ? `${user.municipio.nome} - ${user.municipio.uf_sigla}`
    : 'Seu município';

  return (
    <GestaoShell title="Administração" subtitle={municipio} minimo="gestor">
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + Spacing[16] }]}
        refreshControl={<RefreshControl refreshing={atualizando} onRefresh={atualizar} />}>
        <AppText variant="bodySm" tone="secondary">
          Você está como {ROTULO_PAPEL[papel]}.{' '}
          {nivel >= NIVEL.admin_municipal
            ? 'Pode ver e alterar todas as áreas.'
            : 'Pode consultar estas áreas e moderar; alterações de cadastro ficam com o administrador.'}
        </AppText>
        <View style={styles.grade}>
          {AREAS.filter((a) => nivel >= NIVEL[a.minimo]).map((a) => (
            <CartaoArea key={a.chave} area={a} contador={contadores[a.chave] ?? 'carregando'} />
          ))}
        </View>
      </ScrollView>
    </GestaoShell>
  );
}

function CartaoArea({ area, contador }: { area: Area; contador: Contador }) {
  const colors = useColors();
  const resumo =
    contador === 'carregando'
      ? 'carregando'
      : contador === 'erro'
        ? 'contador indisponível'
        : [contador.valor, contador.detalhe].filter(Boolean).join(', ');

  return (
    <Card
      onPress={() => router.push(area.rota as Href)}
      accessibilityLabel={`${area.titulo}: ${resumo}. ${area.descricao}`}
      accessibilityHint="Abre a área"
      style={styles.cartao}>
      <View style={styles.topo}>
        <View style={[styles.icone, { backgroundColor: colors.primarySubtle }]}>
          <Ionicons name={area.icone} size={22} color={colors.primaryText} />
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </View>
      <AppText variant="label">{area.titulo}</AppText>
      {contador === 'carregando' ? (
        <AppText variant="caption" tone="muted">
          Carregando…
        </AppText>
      ) : contador === 'erro' ? (
        <AppText variant="caption" tone="muted">
          —
        </AppText>
      ) : (
        <View style={styles.contadores}>
          <Badge label={contador.valor} tone={contador.tom ?? 'neutral'} icon={null} />
          {contador.detalhe ? (
            <AppText variant="caption" tone="secondary">
              {contador.detalhe}
            </AppText>
          ) : null}
        </View>
      )}
      <AppText variant="caption" tone="muted" numberOfLines={3}>
        {area.descricao}
      </AppText>
    </Card>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: Layout.gutter,
    gap: Spacing[4],
  },
  grade: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[3],
  },
  cartao: {
    flexGrow: 1,
    // Duas colunas no celular; com fonte grande os textos quebram em vez
    // de estourar, porque a altura é mínima e não fixa.
    flexBasis: '45%',
    minHeight: 160,
  },
  topo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  icone: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contadores: {
    gap: Spacing[1],
  },
});
