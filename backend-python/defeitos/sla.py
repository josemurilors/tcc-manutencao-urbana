"""
Roteamento e prazo (SLA) de um chamado pela categoria.

A base é a tabela `categorias` (prazo e prioridade) mais a secretaria padrão
de cada categoria; `categoria_municipio` sobrepõe tudo isso para a
prefeitura que configurou a sua. O nome da categoria é comparado sem acento
nem caixa: o app manda 'Iluminação', clientes antigos 'Iluminacao' — e
antes disso o roteamento só conhecia a grafia sem acento, então Semáforo e
Árvore Caída ganhavam o prazo de 'Outro' (15 dias em vez de 2).
"""
import unicodedata
from datetime import timedelta

from django.utils import timezone

CATEGORIA_OUTRO = 'outro'

# Secretaria padrão por categoria (chave normalizada), enquanto a prefeitura
# não cadastra as suas em `secretarias`/`categoria_municipio`.
SECRETARIAS_PADRAO = {
    'buraco': 'Secretaria de Obras e Infraestrutura',
    'iluminacao': 'Secretaria de Iluminação Pública',
    'semaforo': 'Secretaria de Trânsito e Mobilidade',
    'arvore caida': 'Secretaria de Meio Ambiente',
    'entulho': 'Secretaria de Limpeza Urbana',
    'calcada danificada': 'Secretaria de Obras e Infraestrutura',
    CATEGORIA_OUTRO: 'Secretaria de Serviços Urbanos',
}

# Se a tabela `categorias` não tiver nem 'Outro' (banco recém-criado).
PRAZO_PADRAO_DIAS = 15
PRIORIDADE_PADRAO = 'baixa'


def normalizar(nome):
    """'  Árvore  Caída ' -> 'arvore caida'."""
    sem_acento = unicodedata.normalize('NFKD', nome or '').encode('ascii', 'ignore').decode('ascii')
    return ' '.join(sem_acento.lower().split())


def _categoria_base(chave):
    from categorias.models import Categoria

    linhas = list(Categoria.objects.values('id', 'nome', 'prazo_sla_dias', 'prioridade_base'))
    por_chave = {normalizar(c['nome']): c for c in linhas}
    return por_chave.get(chave) or por_chave.get(CATEGORIA_OUTRO), chave in por_chave


def regra_para(categoria_nome, municipio_id):
    """
    {categoria_id, prazo_sla_dias, prioridade, secretaria_id, secretaria_nome}
    para um chamado novo. Categoria desconhecida (ou vazia) cai na regra de
    'Outro'.
    """
    chave = normalizar(categoria_nome)
    categoria, conhecida = _categoria_base(chave)
    if not conhecida:
        chave = CATEGORIA_OUTRO

    regra = {
        'categoria_id': categoria['id'] if categoria else None,
        'prazo_sla_dias': categoria['prazo_sla_dias'] if categoria else PRAZO_PADRAO_DIAS,
        'prioridade': (categoria['prioridade_base'] if categoria else '') or PRIORIDADE_PADRAO,
        'secretaria_id': None,
        'secretaria_nome': SECRETARIAS_PADRAO.get(chave, SECRETARIAS_PADRAO[CATEGORIA_OUTRO]),
    }

    if categoria and municipio_id:
        from gestao.models import CategoriaMunicipio

        local = (
            CategoriaMunicipio.objects.select_related('secretaria')
            .filter(municipio_id=str(municipio_id), categoria_id=categoria['id'], ativo=True)
            .first()
        )
        if local is not None:
            if local.prazo_sla_dias:
                regra['prazo_sla_dias'] = local.prazo_sla_dias
            if local.prioridade:
                regra['prioridade'] = local.prioridade
            if local.secretaria is not None:
                regra['secretaria_id'] = local.secretaria.id
                regra['secretaria_nome'] = local.secretaria.nome
    return regra


def calcular_prazo(criado_em, prazo_sla_dias):
    """`prazo_em` = criado_em + prazo; None sem prazo definido."""
    if not criado_em or not prazo_sla_dias:
        return None
    return criado_em + timedelta(days=prazo_sla_dias)


def sla_vencido(defeito, agora=None):
    from .fluxo import STATUS_ABERTOS

    if defeito.status not in STATUS_ABERTOS or not defeito.prazo_em:
        return False
    return (agora or timezone.now()) > defeito.prazo_em


def sla_restante_horas(defeito, agora=None):
    """Horas até o prazo (negativo = atrasado); None para fechados ou sem prazo."""
    from .fluxo import STATUS_ABERTOS

    if defeito.status not in STATUS_ABERTOS or not defeito.prazo_em:
        return None
    return round((defeito.prazo_em - (agora or timezone.now())).total_seconds() / 3600, 1)
