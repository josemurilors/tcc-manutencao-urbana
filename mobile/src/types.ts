/** Tipos do domínio, espelhando os serializers do backend Django. */

export type Municipio = {
  id?: string;
  codigo: string;
  nome: string;
  uf_sigla: string;
  poligono_json?: string | GeoJsonPolygon | null;
  min_lat?: number;
  max_lat?: number;
  min_lng?: number;
  max_lng?: number;
};

export type GeoJsonPolygon = {
  type: 'Polygon' | 'MultiPolygon';
  /** [lng, lat][] em Polygon; [lng, lat][][] em MultiPolygon. */
  coordinates: any;
};

export type User = {
  id: number | string;
  nome: string;
  email: string;
  cpf?: string | null;
  admin?: boolean | number;
  /** 'cidadao' | 'operador' | 'gestor' | 'admin_municipal' | 'super_admin' */
  papel?: string;
  super_admin?: boolean;
  municipio_id?: string | null;
  municipio?: Municipio | null;
  email_verificado?: boolean;
  email_verified?: boolean;
};

export type Categoria = {
  nome: string;
  icone?: string;
};

/** Sinal do cidadão sobre um chamado aberto (ver `Sinalizacao` no backend). */
export type TipoSinalizacao = 'resolvido' | 'nao_existe';

export type Defeito = {
  id: number;
  titulo: string;
  descricao: string;
  categoria?: string;
  /** A listagem devolve o nome da categoria neste campo; o detalhe, em `categoria`. */
  categoria_nome?: string;
  status: string;
  /** 'urgente' | 'alta' | 'media' | 'baixa' (vazio quando não triado). */
  prioridade?: string;
  latitude: number;
  longitude: number;
  rua?: string;
  bairro?: string;
  /** Código IBGE do município onde o ponto caiu (resolvido pelo backend). */
  municipio_id?: string | null;
  /** Só no detalhe: nome/UF do município. */
  municipio?: { codigo: string; nome: string; uf_sigla: string } | null;
  criado_em: string;
  atualizado_em?: string;
  atendido_em?: string | null;
  atendente_id?: number | string | null;
  /** Prazo (SLA) estourado e chamado ainda aberto. */
  sla_vencido?: boolean;
  total_apoios?: number;
  apoios_total?: number;
  /** Quantos cidadãos sinalizaram "já foi resolvido" / "não existe". */
  sinalizacoes?: { resolvido: number; nao_existe: number };
  /** 'restrita' = autor em quarentena; o backend já filtra quem vê. */
  visibilidade?: 'publica' | 'restrita';
  /** JSON string de [{texto, data}] com registros automáticos (ex.: conclusão por cidadãos). */
  atualizacoes?: string;
  imagem_thumbnail?: string | null;
  imagens_extra?: string | null;
  /** Legado: o backend não expõe mais o usuário; use `autor_nome` e `eh_autor`. */
  usuario?: { id: number | string; nome?: string } | null;

  // --- Contrato v3 ---
  /** Número legível do chamado, `AAAA-NNNNNN`. */
  protocolo?: string | null;
  categoria_id?: number | null;
  /** Rótulo do status para o cidadão (ver `rotuloCidadao`). */
  status_rotulo?: string;
  /** Nome do autor, mascarado ("Maria S.") para quem não é da prefeitura. */
  autor_nome?: string;
  /** O usuário logado é o autor do chamado. */
  eh_autor?: boolean;
  /** Há alguém atendendo (o id em `atendente_id` só vai para a equipe do município). */
  tem_atendente?: boolean;
  equipe_id?: number | null;
  secretaria_id?: number | null;
  secretaria_nome?: string;
  secretaria_responsavel?: string;
  prazo_sla_dias?: number;
  /** Vencimento do SLA (criado_em + prazo da categoria). */
  prazo_em?: string | null;
  /** Horas até o prazo (negativo = atrasado); null fechado ou sem prazo. */
  sla_restante_horas?: number | null;
  triado_em?: string | null;
  atribuido_em?: string | null;
  iniciado_em?: string | null;
  resolvido_em?: string | null;
  fechado_em?: string | null;
  reaberturas?: number;
  resposta_publica?: string;
  motivo_rejeicao?: string;
  /** Id do chamado original quando rejeitado como duplicado. */
  duplicado_de?: string | null;
  avaliacao_nota?: number | null;
  avaliacao_comentario?: string;
  avaliado_em?: string | null;
};

/** Linha do histórico (GET /defeitos/<id>/eventos/). */
export type DefeitoEvento = {
  id: number;
  tipo: string;
  de_status: string | null;
  para_status: string | null;
  para_status_rotulo: string | null;
  papel: string;
  publico: boolean;
  texto: string;
  dados: Record<string, unknown>;
  criado_em: string;
  autor_nome: string;
};

/** Resposta de GET /defeitos/municipio/?lat&lng — visão expandida do mapa. */
export type VisaoMunicipio = {
  municipio: {
    codigo: string;
    nome: string;
    uf_sigla: string;
    min_lat: number;
    max_lat: number;
    min_lng: number;
    max_lng: number;
  };
  total_abertos: number;
  /** Categorias mais frequentes, da maior para a menor. */
  tipos: { categoria: string; total: number }[];
  /** IDs (em `defeitos`) dos mais antigos e dos mais confirmados. */
  mais_antigos: (number | string)[];
  mais_apoiados: (number | string)[];
  defeitos: Defeito[];
};

/**
 * Resposta de GET /defeitos/area/ — chamados abertos no retângulo visível,
 * já rareados por quadrante conforme o zoom.
 */
export type AreaDoMapa = {
  /** Lado da célula da grade, em graus (potência de 2, alinhada ao globo). */
  celula_graus: number;
  /** Abertos no retângulo antes do corte. */
  total: number;
  /** Contagem real por célula (centro de massa), para o mapa de calor. */
  celulas: { latitude: number; longitude: number; total: number }[];
  defeitos: Defeito[];
};

/** Resposta de GET /defeitos/operacao/ — fila do operador no seu município. */
export type Operacao = {
  /** null para o super admin, que opera em qualquer cidade. */
  municipio: { codigo: string; nome: string; uf_sigla: string } | null;
  defeitos: Defeito[];
};

export type AuthResponse = {
  access: string;
  refresh?: string;
  user?: User;
  /** Login com Google: a conta acabou de ser criada (pedir o nome de exibição). */
  novo?: boolean;
};

export type Estatisticas = {
  total: number;
  pendentes: number;
  resolvidos: number;
  taxa_resolucao: number;
  sla_medio_minutos: number;
  sla_vencidos_total?: number;
  por_status?: { status: string; total: number }[];
  por_categoria?: {
    categoria: string;
    total: number;
    variacao?: number | null;
    mes_atual?: number;
    mes_anterior?: number;
  }[];
  tendencia_mensal?: { mes: string; ano?: number; total: number }[];
  sla_por_categoria?: { categoria: string; sla_medio_minutos: number }[];
  top_bairros?: { bairro: string; total: number; taxa_resolucao: number }[];
  recomendacoes?: {
    tipo: string;
    impacto: string;
    sugestao: string;
    local?: string;
    bairro?: string;
    ocorrencias: number;
  }[];
  medias_moveis?: {
    semana_atual?: number;
    media_4_semanas?: number;
    variacao_percentual?: number;
  };
  anomalias?: {
    bairro: string;
    total_mes: number;
    media_historica: number;
    z_score: number;
    intensidade: string;
  }[];
  sazonalidade?: {
    mes_atual?: number;
    mes_anterior?: number;
    variacao_percentual?: number | null;
  };
  sla_vencidos?: {
    id: number;
    titulo: string;
    categoria: string;
    criado_em: string;
    prazo_sla_dias: number;
    status: string;
  }[];
};

/** Nível/EXP do usuário, derivado do histórico (GET /defeitos/progresso/). */
export type Progresso = {
  xp: number;
  nivel: number;
  titulo: string;
  /** XP acumulado onde o nível atual começa/termina (barra de progresso). */
  xp_nivel: number;
  xp_proximo: number;
  chamados: number;
  resolvidos: number;
  confirmacoes: number;
};

export type RankingEntry = {
  posicao: number;
  usuario_id: string;
  nome: string;
  xp: number;
  nivel: number;
  titulo: string;
  chamados: number;
  resolvidos: number;
  confirmacoes: number;
};

export type PeriodoRanking = 'tudo' | 'mes' | 'semana';

/** Resposta de GET /defeitos/ranking/ — leaderboard por cidade ou geral. */
export type Ranking = {
  /** null = ranking geral (todas as cidades). */
  municipio: { codigo: string; nome: string; uf_sigla: string } | null;
  periodo: PeriodoRanking;
  total_participantes: number;
  ranking: RankingEntry[];
  /** Linha do usuário logado, mesmo fora do top; null deslogado ou sem pontos. */
  eu: RankingEntry | null;
};

/** Arquivo local selecionado pelo image picker, pronto para virar FormData. */
export type PickedImage = {
  uri: string;
  name: string;
  type: string;
};
