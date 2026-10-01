/**
 * Tipos da gestão municipal (contrato v3, seção 7.6 — `api/v1/gestao/`).
 *
 * O contrato fixa rotas e alguns campos; o resto do formato foi inferido das
 * tabelas (seção 2). Por isso quase tudo que não é chave é opcional: o app
 * precisa continuar de pé se o backend devolver um campo a menos.
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
  criado_em?: string | null;
  ultimo_acesso?: string | null;
};

export type ConviteMembro = {
  email: string;
  papel: PapelEquipe;
  secretaria_id?: number | null;
  equipe_id?: number | null;
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
};

export type CategoriaAlteracao = Partial<
  Pick<CategoriaGestao, 'prazo_sla_dias' | 'prioridade' | 'secretaria_id' | 'ativo' | 'checklist'>
>;

/**
 * Parâmetros livres do município (`municipio_config.parametros`). Só os que o
 * app edita estão tipados; o resto é preservado no PATCH.
 */
export type ParametrosMunicipio = {
  /** A operação só conclui um chamado com foto de evidência ("depois"). */
  exigir_foto_conclusao?: boolean;
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

/** Chamado na fila de moderação (sinalizado pela comunidade ou removido). */
export type ChamadoModeracao = {
  id: string;
  protocolo?: string | null;
  titulo: string;
  categoria?: string | null;
  bairro?: string | null;
  status?: string;
  criado_em?: string;
  autor_nome?: string | null;
  sinalizacoes?: { resolvido: number; nao_existe: number };
  removido_em?: string | null;
  removido_motivo?: string | null;
};

/** Cidadão com strikes ou suspenso. */
export type UsuarioModeracao = {
  id: string;
  nome: string;
  email?: string | null;
  strikes: number;
  suspenso_ate?: string | null;
  ultimo_strike_em?: string | null;
};

export type FilaModeracao = {
  sinalizados: ChamadoModeracao[];
  removidos: ChamadoModeracao[];
  usuarios: UsuarioModeracao[];
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
  usuario_id?: string | null;
  usuario_nome?: string | null;
  /** Frase pronta, se o backend já mandar; senão o app monta. */
  descricao?: string | null;
};

export type FiltrosAuditoria = {
  acao?: string;
  usuario_id?: string;
};
