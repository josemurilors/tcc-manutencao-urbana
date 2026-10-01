/**
 * Ficha de atendimento do chamado para a **equipe da prefeitura** (aba Operação).
 *
 * Mostra o mesmo conteúdo do detalhe do cidadão (`DefectDetail`) mais o que a
 * operação precisa: SLA restante, score, sinalizações, quem atende, evidências
 * antes/depois, notas internas — e as ações conforme papel e status, sempre
 * pelas rotas dedicadas de `api/v1/operacao/` (contrato v3 §7.1):
 *
 * - todos da equipe: assumir/devolver, triar, programar, iniciar, concluir
 *   (checklist + foto do depois com GPS + resposta), foto do antes, nota
 *   interna, resposta ao cidadão, Ordem de Serviço;
 * - gestor+: atribuir a equipe/servidor, prazo (SLA), prioridade, rejeitar
 *   (motivo obrigatório; duplicado aponta o original) e reabrir.
 *
 * Toda ação passa pela fila offline: sem rede, o efeito aparece na hora com o
 * selo "envio pendente" e é reenviado depois.
 */

import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { DefectDetail } from '@/components/defect-detail';
import { AtribuirSheet, PrioridadeSheet, SlaSheet } from '@/components/operacao/gestao-sheets';
import {
  ehGestor,
  identificador,
  PRIORIDADES,
  sinalizado,
  slaDe,
  souAtendente,
  tomDoScore,
  transicoesPermitidas,
  VERBO_TRANSICAO,
} from '@/components/operacao/regras';
import { EvidenciasChamado } from '@/components/operacao/registros-chamado';
import { TextoSheet, type ModoTexto } from '@/components/operacao/texto-sheet';
import { TransicaoSheet, type ResultadoTransicao } from '@/components/operacao/transicao-sheet';
import type { Catalogos } from '@/components/operacao/use-catalogos';
import { capturarEvidencia } from '@/components/operacao/evidencia';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AppText } from '@/components/ui/text';
import { statusFechado } from '@/constants/status';
import { corDoTom, Radius, Spacing, type Tom } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useColors } from '@/context/theme-context';
import { useToast } from '@/context/toast-context';
import { API_URL } from '@/services/api';
import { apiOperacao } from '@/services/api-operacao';
import { executarOuEnfileirar, type AcaoOperacao } from '@/services/operacao-offline';
import type { Defeito } from '@/types';
import type { ChamadoFila, DadosAtribuicao } from '@/types/operacao';
import { descreverSinalizacoes } from '@/utils/format';
import { ImagemMuitoGrandeError } from '@/utils/image';
import { navegarGoogleMaps } from '@/utils/navegacao';

type Props = {
  chamado: ChamadoFila | null;
  catalogos: Catalogos;
  /** Há ação deste chamado esperando rede. */
  pendente: boolean;
  /** Posição do servidor, origem da navegação externa. */
  origem?: { latitude: number; longitude: number } | null;
  onClose: () => void;
  /** Novo estado do chamado (resposta do servidor ou patch otimista). */
  onAtualizado: (id: ChamadoFila['id'], patch: Partial<ChamadoFila>) => void;
};

type Folha = 'atribuir' | 'sla' | 'prioridade' | null;

export function OperacaoSheet(props: Props) {
  if (!props.chamado) return null;
  // `key`: trocar de chamado zera folhas e formulários abertos.
  return <Ficha key={String(props.chamado.id)} {...props} chamado={props.chamado} />;
}

function Ficha({ chamado, catalogos, pendente, origem, onClose, onAtualizado }: Props & { chamado: ChamadoFila }) {
  const colors = useColors();
  const toast = useToast();
  const { user } = useAuth();

  const [detalhe, setDetalhe] = useState<Defeito | null>(null);
  const [erroDetalhe, setErroDetalhe] = useState<string | null>(null);
  const [para, setPara] = useState<string | null>(null);
  const [modoTexto, setModoTexto] = useState<ModoTexto | null>(null);
  const [folha, setFolha] = useState<Folha>(null);
  const [emCurso, setEmCurso] = useState<string | null>(null);
  // Muda quando a ficha registra algo: evidências e histórico recarregam.
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    let vivo = true;
    apiOperacao
      .detalhe(chamado.id)
      .then((d) => vivo && setDetalhe(d))
      .catch((err) => {
        // Sem o detalhe, a ficha segue com os dados da fila (sem descrição/fotos).
        if (vivo) setErroDetalhe(err instanceof Error ? err.message : 'Detalhe indisponível');
      });
    return () => {
      vivo = false;
    };
  }, [chamado.id]);

  // A fila é a fonte mais nova (recebe as respostas das ações); o detalhe
  // completa descrição e fotos.
  const c: ChamadoFila = { ...(detalhe ?? {}), ...chamado };
  const fotoCidadao = c.imagem_thumbnail ?? (c.imagem_url?.startsWith('/') ? `${API_URL}${c.imagem_url}` : c.imagem_url);

  const gestor = ehGestor(user);
  const meuId = user?.id != null ? String(user.id) : null;
  const fechado = statusFechado(c.status);
  const comigo = souAtendente(c, user);
  const temAtendente = c.atendente_id != null || !!c.tem_atendente;
  const destinos = transicoesPermitidas(c.status, user);
  const fluxo = destinos.filter((d) => d !== 'rejeitado' && d !== 'pendente');
  const sla = !fechado ? slaDe(c) : null;
  const sinais = !fechado && sinalizado(c) ? descreverSinalizacoes(c) : null;
  const prioridade = PRIORIDADES.find((p) => p.value === c.prioridade)?.label;

  function aposServidor(resposta: unknown) {
    if (resposta && typeof resposta === 'object' && 'id' in resposta) {
      const patch = { ...(resposta as Partial<ChamadoFila>) };
      // O detalhe das ações não sabe onde o servidor está: sem isso o cartão
      // perderia a distância calculada pela fila.
      if (patch.distancia_m == null) delete patch.distancia_m;
      onAtualizado(c.id, patch);
    }
  }

  /**
   * Registro que não muda o chamado no servidor (nota, foto): marca a
   * atividade para o histórico do detalhe recarregar e mostrar o item novo.
   */
  function registrouAlgo() {
    setVersao((v) => v + 1);
    onAtualizado(c.id, { atualizado_em: new Date().toISOString() });
  }

  /** Executa uma ação simples (sem formulário) pela fila offline. */
  async function agir(chave: string, acao: AcaoOperacao, rotulo: string, otimista: Partial<ChamadoFila>, ok: string) {
    setEmCurso(chave);
    try {
      const r = await executarOuEnfileirar(acao, `${rotulo} · ${identificador(c)}`);
      if (r.offline) {
        toast.warning('Sem conexão: guardado para enviar quando a rede voltar.');
        onAtualizado(c.id, otimista);
      } else {
        toast.success(ok);
        if (r.resposta && typeof r.resposta === 'object' && 'id' in r.resposta) aposServidor(r.resposta);
        else onAtualizado(c.id, otimista);
      }
      registrouAlgo();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível concluir a ação.');
    } finally {
      setEmCurso(null);
    }
  }

  function assumir() {
    if (!meuId) return;
    agir(
      'assumir',
      { tipo: 'atribuir', defeito_id: c.id, dados: { atendente_id: meuId } },
      'Assumir',
      { atendente_id: meuId, atendente_nome: user?.nome ?? null, tem_atendente: true },
      'Chamado assumido. Ele aparece em "Meus".',
    );
  }

  function liberar() {
    agir(
      'liberar',
      { tipo: 'liberar', defeito_id: c.id },
      'Devolver à fila',
      { atendente_id: null, atendente_nome: null, tem_atendente: false },
      'Chamado devolvido à fila.',
    );
  }

  function atribuir(dados: DadosAtribuicao, rotulo: string) {
    setFolha(null);
    agir(
      'atribuir',
      { tipo: 'atribuir', defeito_id: c.id, dados },
      `Atribuir a ${rotulo}`,
      {
        equipe_id: dados.equipe_id ?? null,
        atendente_id: dados.atendente_id ?? null,
        tem_atendente: !!dados.atendente_id,
        atendente_nome: dados.atendente_id ? rotulo : null,
      },
      `Atribuído a ${rotulo}.`,
    );
  }

  async function fotoAntes() {
    setEmCurso('antes');
    try {
      const e = await capturarEvidencia();
      if (!e) return;
      const r = await executarOuEnfileirar(
        { tipo: 'evidencia', defeito_id: c.id, evidencia: 'antes', foto: e.foto, local: e.local },
        `Foto do antes · ${identificador(c)}`,
      );
      if (r.offline) toast.warning('Sem conexão: a foto será enviada quando a rede voltar.');
      else toast.success(e.local ? 'Foto do antes registrada com o local.' : 'Foto registrada (sem GPS).');
      registrouAlgo();
    } catch (err) {
      toast.error(
        err instanceof ImagemMuitoGrandeError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Não foi possível registrar a foto.',
      );
    } finally {
      setEmCurso(null);
    }
  }

  async function gerencial(chave: 'sla' | 'prioridade', fn: () => Promise<ChamadoFila>, ok: string) {
    setEmCurso(chave);
    try {
      aposServidor(await fn());
      toast.success(ok);
      setFolha(null);
      setVersao((v) => v + 1);
    } catch (err) {
      // Decisão de gestor não vai para a fila offline: precisa da resposta
      // na hora (o prazo recalcula o SLA de todos que olham a fila).
      toast.error(err instanceof Error ? err.message : 'Não foi possível salvar.');
    } finally {
      setEmCurso(null);
    }
  }

  async function gerarOS() {
    setEmCurso('os');
    try {
      await apiOperacao.ordemServico(c.id, c.protocolo);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível gerar a Ordem de Serviço.');
    } finally {
      setEmCurso(null);
    }
  }

  function aposTransicao(r: ResultadoTransicao) {
    setPara(null);
    if (r.chamado) aposServidor(r.chamado);
    else onAtualizado(c.id, { status: r.para, atualizado_em: new Date().toISOString() });
    setVersao((v) => v + 1);
  }

  const destaque = (
    <View style={styles.faixas}>
      <View style={styles.selos}>
        <Badge label={identificador(c)} icon="pricetag" />
        {sla ? <Badge label={sla.texto} tone={sla.tom} icon={sla.icone} /> : null}
        {c.score != null ? (
          <Badge label={`Prioridade ${Math.round(c.score)}`} tone={tomDoScore(c.score)} icon="flame" />
        ) : null}
        {prioridade ? <Badge label={prioridade} tone="neutral" icon="flag" /> : null}
        {pendente ? <Badge label="Envio pendente" tone="info" icon="cloud-upload" /> : null}
      </View>
      {sinais ? <Faixa tom="warning" icone="flag" texto={`Precisa verificação: ${sinais}`} /> : null}
      {!fechado ? (
        <Faixa
          tom={comigo ? 'primary' : 'neutral'}
          icone={comigo ? 'person' : temAtendente ? 'person-outline' : 'person-add-outline'}
          texto={
            comigo
              ? 'Você está atendendo este chamado'
              : temAtendente
                ? `Com ${c.atendente_nome ?? 'outro servidor'}${c.equipe_nome ? ` · equipe ${c.equipe_nome}` : ''}`
                : c.equipe_nome
                  ? `Na fila da equipe ${c.equipe_nome}, sem responsável`
                  : 'Ninguém assumiu ainda'
          }
        />
      ) : null}
      {erroDetalhe ? <Faixa tom="neutral" icone="information-circle" texto="Descrição e fotos indisponíveis agora." /> : null}
      {/* As ações do dia a dia ficam no topo: no campo, ninguém rola o histórico para achar "Concluir". */}
      {!fechado ? (
        <Grupo titulo="Atendimento">
          {/* Operador não toma chamado de outra pessoa (403 no backend); gestor reatribui. */}
          {!comigo && (!temAtendente || gestor) ? (
            <Button
              size="sm"
              variant={temAtendente ? 'secondary' : 'primary'}
              onPress={assumir}
              loading={emCurso === 'assumir'}
              accessibilityHint={temAtendente ? 'Passa o chamado de outra pessoa para você' : undefined}
              icon={
                <Ionicons
                  name="hand-left"
                  size={16}
                  color={temAtendente ? colors.textPrimary : colors.onPrimary}
                />
              }>
              Assumir
            </Button>
          ) : null}
          {temAtendente && (comigo || gestor) ? (
            <Button
              size="sm"
              variant="ghost"
              onPress={liberar}
              loading={emCurso === 'liberar'}
              icon={<Ionicons name="arrow-undo" size={16} color={colors.textSecondary} />}>
              Devolver à fila
            </Button>
          ) : null}
          {fluxo.map((d) => {
            const v = VERBO_TRANSICAO[d];
            const principal = d === 'concluido';
            return (
              <Button
                key={d}
                size="sm"
                variant={principal ? 'primary' : 'secondary'}
                onPress={() => setPara(d)}
                icon={
                  <Ionicons
                    name={v.icone as keyof typeof Ionicons.glyphMap}
                    size={16}
                    color={principal ? colors.onPrimary : colors.textPrimary}
                  />
                }>
                {v.rotulo}
              </Button>
            );
          })}
        </Grupo>
      ) : null}
    </View>
  );

  return (
    <DefectDetail
      defeito={{ ...c, imagem_thumbnail: fotoCidadao ?? null }}
      onClose={onClose}
      rotuloApoios="apoios"
      visao="operacao"
      destaque={destaque}>
      <View style={styles.corpo}>
        <Grupo titulo="Registro">
          {!fechado ? (
            <Button
              size="sm"
              variant="secondary"
              onPress={fotoAntes}
              loading={emCurso === 'antes'}
              icon={<Ionicons name="camera" size={16} color={colors.textPrimary} />}>
              Foto do antes
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            onPress={() => setModoTexto('resposta')}
            icon={<Ionicons name="chatbubble" size={16} color={colors.textPrimary} />}>
            Responder ao cidadão
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onPress={() => setModoTexto('nota')}
            icon={<Ionicons name="lock-closed" size={16} color={colors.textPrimary} />}>
            Nota interna
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onPress={() => navegarGoogleMaps(c, origem)}
            icon={<Ionicons name="navigate" size={16} color={colors.textSecondary} />}>
            Navegar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onPress={gerarOS}
            loading={emCurso === 'os'}
            icon={<Ionicons name="document-text" size={16} color={colors.textSecondary} />}>
            Ordem de Serviço
          </Button>
        </Grupo>

        {gestor ? (
          <Grupo titulo="Gestão">
            {!fechado ? (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  onPress={() => setFolha('atribuir')}
                  loading={emCurso === 'atribuir'}
                  icon={<Ionicons name="people" size={16} color={colors.textPrimary} />}>
                  Atribuir
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onPress={() => setFolha('sla')}
                  icon={<Ionicons name="time" size={16} color={colors.textPrimary} />}>
                  Prazo (SLA)
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onPress={() => setFolha('prioridade')}
                  icon={<Ionicons name="flag" size={16} color={colors.textPrimary} />}>
                  Prioridade
                </Button>
              </>
            ) : null}
            {destinos.includes('rejeitado') ? (
              <Button
                size="sm"
                variant="danger"
                onPress={() => setPara('rejeitado')}
                icon={<Ionicons name="close-circle" size={16} color={colors.danger} />}>
                Rejeitar
              </Button>
            ) : null}
            {destinos.includes('pendente') ? (
              <Button
                size="sm"
                variant="secondary"
                onPress={() => setPara('pendente')}
                icon={<Ionicons name="refresh" size={16} color={colors.textPrimary} />}>
                Reabrir
              </Button>
            ) : null}
          </Grupo>
        ) : null}

        <Grupo titulo="Evidências da equipe (com GPS)" bloco>
          <EvidenciasChamado id={c.id} versao={versao} />
        </Grupo>

      </View>

      <TransicaoSheet
        chamado={c}
        para={para}
        respostas={catalogos.respostas}
        onClose={() => setPara(null)}
        onFeito={aposTransicao}
      />
      <TextoSheet
        chamado={c}
        modo={modoTexto}
        respostas={catalogos.respostas}
        onClose={() => setModoTexto(null)}
        onFeito={(modo, texto, offline) => {
          setModoTexto(null);
          registrouAlgo();
          if (modo === 'resposta' && !offline) onAtualizado(c.id, { resposta_publica: texto });
        }}
      />
      <AtribuirSheet
        visible={folha === 'atribuir'}
        equipes={catalogos.equipes}
        enviando={emCurso === 'atribuir'}
        onClose={() => setFolha(null)}
        onEscolher={atribuir}
        onRecarregar={catalogos.recarregar}
      />
      {folha === 'sla' ? (
        <SlaSheet
          visible
          prazoAtualDias={c.prazo_sla_dias}
          enviando={emCurso === 'sla'}
          onClose={() => setFolha(null)}
          onSalvar={(dias, motivo) =>
            gerencial('sla', () => apiOperacao.sla(c.id, dias, motivo), `Prazo alterado para ${dias} dias.`)
          }
        />
      ) : null}
      {folha === 'prioridade' ? (
        <PrioridadeSheet
          visible
          atual={c.prioridade}
          enviando={emCurso === 'prioridade'}
          onClose={() => setFolha(null)}
          onSalvar={(p) => gerencial('prioridade', () => apiOperacao.prioridade(c.id, p), 'Prioridade atualizada.')}
        />
      ) : null}
    </DefectDetail>
  );
}

function Grupo({ titulo, bloco, children }: { titulo: string; bloco?: boolean; children: React.ReactNode }) {
  return (
    <View style={styles.grupo}>
      <AppText variant="caption" tone="secondary" weight="600" accessibilityRole="header">
        {titulo.toUpperCase()}
      </AppText>
      <View style={bloco ? styles.bloco : styles.botoes}>{children}</View>
    </View>
  );
}

function Faixa({ tom, icone, texto }: { tom: Tom; icone: keyof typeof Ionicons.glyphMap; texto: string }) {
  const colors = useColors();
  const cor = corDoTom(colors, tom);
  return (
    <View style={[styles.faixa, { backgroundColor: cor.bg, borderColor: cor.border }]}>
      <Ionicons name={icone} size={16} color={cor.fg} />
      <AppText variant="caption" weight="600" style={[styles.flex, { color: cor.fg }]}>
        {texto}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  corpo: {
    width: '100%',
    gap: Spacing[4],
  },
  faixas: {
    gap: Spacing[1.5],
  },
  selos: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[1.5],
  },
  faixa: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
    borderWidth: 1,
    borderRadius: Radius.md,
  },
  grupo: {
    gap: Spacing[2],
  },
  botoes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
  },
  bloco: {
    gap: Spacing[2],
  },
});
