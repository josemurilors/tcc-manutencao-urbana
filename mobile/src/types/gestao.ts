/**
 * Tipos da gestão municipal (contrato v3, seção 7.6 — `api/v1/gestao/`).
 *
 * Formatos conferidos contra o backend (`gestao/views.py`) e descritos no
 * contrato, 7.6. Campos auxiliares seguem opcionais para o app continuar de
 * pé se o backend devolver um a menos.
 */

/** Papéis canônicos (`users.papel`). */
export type Papel = 'cidadao' | 'operador' | 'gestor' | 'admin_municipal' | 'super_admin';

/** Papéis que se concedem pela tela de equipe (super_admin é da plataforma). */
export type PapelEquipe = 'operador' | 'gestor' | 'admin_municipal';

export type Prioridade = 'baixa' | 'media' | 'alta' | 'urgente';

/** Página no formato DRF; listas sem paginação são normalizadas para ele. */
export type Pagina<T> = {
  count: number;
  next: string | null;
  previous?: string | null;
  results: T[];
};

/** Servidor do município (GET `membros/`). */
export type Membro = {
  id: string;
  nome: string;
  email: string;
  papel: Papel;
  secretaria_id?: number | null;
  secretaria_nome?: string | null;
  equipe_id?: number | null;
  equipe_nome?: string | null;
  suspenso_ate?: string | null;
  /** Nível do papel (operador 1 … super_admin 4). */
  nivel?: number;
  /** Chamados abertos em que a pessoa é a atendente (voltam à fila se revogar). */
  chamados_abertos?: number;
  criado_em?: string | null;
};

/** Resposta do DELETE `membros/<id>/`. */
export type RevogacaoMembro = {
  id: string;
  papel: Papel;
  chamados_liberados: number;
};

export type ConviteMembro = {
  email: string;
  papel: PapelEquipe;
  secretaria_id?: number | null;
  equipe_id?: number | null;
};

/**
 * Convite pendente para quem ainda não tem conta (GET `convites/`). O papel
 * entra sozinho quando a pessoa entra no app com o e-mail verificado.
 */
export type Convite = {
  id: number;
  email: string;
  papel: PapelEquipe;
  secretaria_id?: number | null;
  secretaria_nome?: string | null;
  equipe_id?: number | null;
  equipe_nome?: string | null;
  convidado_por_nome?: string | null;
  criado_em?: string;
  expira_em: string;
  /** Passou do prazo: só vale de novo se reenviar. */
  expirado?: boolean;
};

/** POST `membros/` com e-mail sem conta, e POST `convites/<id>/reenviar/`. */
export type ConviteResposta = {
  convite: Convite;
  /** `false` = e-mail não configurado ou falhou; o convite vale assim mesmo. */
  email_enviado: boolean;
};

/** Resposta-padrão da operação (`operacao/respostas-padrao/`, escrita gestor+). */
export type RespostaPadraoGestao = {
  id: number;
  titulo: string;
  texto: string;
  /** `null` = vale para qualquer categoria. */
  categoria_id?: number | null;
  ativo?: boolean;
  criado_em?: string;
};

export type RespostaPadraoEntrada = {
  titulo: string;
  texto: string;
  categoria_id?: number | null;
};

export type AlteracaoMembro = {
  papel?: PapelEquipe;
  secretaria_id?: number | null;
  equipe_id?: number | null;
};

export type Secretaria = {
  id: number;
  nome: string;
  sigla?: string;
  email?: string;
  ativo: boolean;
  criado_em?: string;
  /** Equipes ativas ligadas a ela. */
  total_equipes?: number;
};

export type SecretariaEntrada = Pick<Secretaria, 'nome'> &
  Partial<Pick<Secretaria, 'sigla' | 'email' | 'ativo'>>;

export type Equipe = {
  id: number;
  nome: string;
  secretaria_id?: number | null;
  secretaria_nome?: string | null;
  ativo: boolean;
  total_membros?: number;
  criado_em?: string;
};

export type EquipeEntrada = Pick<Equipe, 'nome'> &
  Partial<Pick<Equipe, 'secretaria_id' | 'ativo'>>;

/** Regra efetiva da categoria no município (GET/PATCH `categorias/`). */
export type CategoriaGestao = {
  categoria_id: number;
  nome: string;
  icone?: string | null;
  prazo_sla_dias: number | null;
  prioridade: Prioridade | null;
  secretaria_id: number | null;
  secretaria_nome?: string | null;
  ativo: boolean;
  checklist: string[];
  /** O município sobrepôs alguma regra da plataforma. */
  personalizado?: boolean;
  /** Padrão da plataforma (o que volta ao mandar `null`). */
  base?: { prazo_sla_dias: number | null; prioridade: Prioridade | null };
  /** Só no PATCH: chamados abertos que ganharam o prazo novo. */
  chamados_recalculados?: number;
};

/** PATCH de categoria: `null` em prazo/prioridade/secretaria volta ao padrão. */
export type CategoriaAlteracao = Partial<
  Pick<CategoriaGestao, 'prazo_sla_dias' | 'prioridade' | 'secretaria_id' | 'ativo' | 'checklist'>
>;

/**
 * Parâmetros livres do município (`municipio_config.parametros`). Só os que o
 * app edita estão tipados; o resto é preservado no PATCH.
 */
export type ParametrosMunicipio = {
  /**
   * A operação só conclui um chamado com foto de evidência ("depois").
   * Ausente = ligado (padrão do backend, `operacao/views.py`).
   */
  exigir_foto_conclusao?: boolean;
  /** Distância máxima (m) entre a foto de evidência e o chamado. Padrão 150. */
  raio_evidencia_m?: number;
  [chave: string]: unknown;
};

/** `MunicipioConfig` + nome/uf (GET/PATCH `municipio/`). */
export type ConfigMunicipio = {
  municipio_id: string;
  nome?: string;
  uf_sigla?: string;
  contratado?: boolean;
  nome_exibicao: string;
  cor_primaria: string;
  email_contato: string;
  telefone: string;
  site: string;
  raio_duplicado_m: number;
  parametros: ParametrosMunicipio;
  atualizado_em?: string;
};

export type ConfigMunicipioAlteracao = Partial<
  Pick<
    ConfigMunicipio,
    | 'nome_exibicao'
    | 'cor_primaria'
    | 'email_contato'
    | 'telefone'
    | 'site'
    | 'raio_duplicado_m'
    | 'parametros'
  >
>;

/** Origem da remoção (`defeitos.removido_motivo`). */
export type OrigemRemocao = 'moderacao' | 'comunidade' | 'autor' | string;

/** Chamado na fila de moderação (sinalizado pela comunidade ou removido). */
export type ChamadoModeracao = {
  id: string;
  protocolo?: string | null;
  titulo: string;
  categoria?: string | null;
  bairro?: string | null;
  rua?: string | null;
  status?: string;
  visibilidade?: string;
  criado_em?: string;
  autor_id?: string | null;
  autor_nome?: string | null;
  /** Só em `sinalizados`. */
  total_resolvido?: number;
  total_nao_existe?: number;
  total_apoios?: number;
  /** Só em `removidos`. */
  removido_em?: string | null;
  removido_motivo?: OrigemRemocao | null;
  /** Motivo escrito por quem removeu (texto do evento `removido`). */
  removido_texto?: string | null;
};

/** Cidadão com strike ativo ou suspenso. */
export type UsuarioModeracao = {
  id: string;
  nome: string;
  suspenso_ate?: string | null;
  suspenso?: boolean;
  /** Strikes dentro da validade (os antigos caducam). */
  strikes_ativos: number;
  /** Passou do limite tolerado: chamados novos dele entram em revisão. */
  em_quarentena?: boolean;
  chamados_removidos?: number;
};

export type ContagensModeracao = {
  sinalizados: number;
  removidos: number;
  suspensos: number;
  em_quarentena: number;
};

export type FilaModeracao = {
  sinalizados: ChamadoModeracao[];
  removidos: ChamadoModeracao[];
  usuarios: UsuarioModeracao[];
  /** Totais reais (as listas têm teto: 100/50/100). */
  contagens: ContagensModeracao;
};

/** Resposta de suspender/reativar. */
export type UsuarioModerado = {
  id: string;
  nome: string;
  suspenso_ate: string | null;
  suspenso: boolean;
};

/** Linha de `audit_log` (GET `auditoria/`). */
export type RegistroAuditoria = {
  id: number;
  acao: string;
  alvo_tipo?: string;
  alvo_id?: string;
  dados?: Record<string, unknown> | null;
  ip?: string;
  criado_em: string;
  municipio_id?: string | null;
  usuario_id?: string | null;
  usuario_nome?: string | null;
  /** Frase pronta, se o backend já mandar; senão o app monta. */
  descricao?: string | null;
};

export type FiltrosAuditoria = {
  /** Ação exata (`membro.revogar`) ou família (`membro`). */
  acao?: string;
  usuario_id?: string;
  /** AAAA-MM-DD, inclusivo. */
  inicio?: string;
  fim?: string;
};
