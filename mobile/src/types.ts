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
  admin?: boolean;
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
  /** Só na listagem: prazo da categoria estourado e chamado ainda aberto. */
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
  usuario?: { id: number | string; nome?: string } | null;
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
