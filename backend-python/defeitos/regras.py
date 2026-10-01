"""
Regras de moderação comunitária dos chamados.

Cidadãos sinalizam um chamado aberto como "já foi resolvido" ou "não existe"
(`Sinalizacao`). Aqui mora o que acontece a partir daí:

* **Já foi resolvido** — fecha o chamado (`concluido`) quando o próprio autor
  sinaliza ou quando `RESOLVIDO_MIN` pessoas sinalizam. Continua nos
  relatórios: o problema existiu e foi resolvido.
* **Não existe** — remove o chamado (soft delete: `removido_em`, sai de
  todas as listagens mas fica no histórico e na auditoria da prefeitura).
  Pelo autor, remove na hora e sem penalidade (foi engano). Por terceiros, a
  barra sobe com cada confirmação no local (`apoios`): precisa de
  `NAO_EXISTE_MIN + apoios` sinalizações. Nesse caso o autor leva um `Strike`.
* **Quarentena** — com mais de `STRIKES_TOLERADOS` strikes ativos (não
  expirados), os chamados novos do autor nascem `restrita`: só quem está a até
  `RAIO_VISIBILIDADE_RESTRITA_M` do ponto, o autor e operadores enxergam. Na
  primeira confirmação no local por outra pessoa o chamado vira público e o
  autor perde um strike (redenção).

Todos os números vivem aqui para ajuste fino sem caçar pelo código.
"""

import json
from datetime import timedelta

from django.db import transaction
from django.db.models import Count
from django.utils import timezone

from core import permissoes

from . import fluxo
from .models import Apoio, Defeito, Sinalizacao, Strike

# "Já foi resolvido": quantas pessoas (fora o autor) fecham o chamado.
RESOLVIDO_MIN = 2
# "Não existe": base de sinalizações para apagar; cada confirmação no local soma 1.
NAO_EXISTE_MIN = 2
# Até quantos strikes ativos o usuário erra sem consequência.
STRIKES_TOLERADOS = 2
# Strike expira depois disso.
STRIKE_VALIDADE_DIAS = 90
# Chamado restrito aparece para quem está a até esta distância do ponto.
RAIO_VISIBILIDADE_RESTRITA_M = 500

# Deslocamento plausível entre dois reports da mesma pessoa: reportar exige
# estar no local, então o intervalo entre chamados precisa comportar o
# deslocamento até lá. Até DESLOCAMENTO_LIVRE_M não se cobra tempo nenhum
# (dois problemas na mesma esquina, ruído de GPS).
VELOCIDADE_MAX_KMH = 120
DESLOCAMENTO_LIVRE_M = 300

RESULTADO_CONCLUIDO = 'concluido'
RESULTADO_INEXISTENTE = 'inexistente'


def contar_sinalizacoes(defeito):
    contagem = {Sinalizacao.RESOLVIDO: 0, Sinalizacao.NAO_EXISTE: 0}
    linhas = (
        Sinalizacao.objects.filter(defeito=defeito)
        .values('tipo').annotate(total=Count('id'))
    )
    for linha in linhas:
        contagem[linha['tipo']] = linha['total']
    return contagem


def strikes_ativos(usuario):
    limite = timezone.now() - timedelta(days=STRIKE_VALIDADE_DIAS)
    return Strike.objects.filter(usuario=usuario, criado_em__gte=limite)


def em_quarentena(usuario):
    return strikes_ativos(usuario).count() > STRIKES_TOLERADOS


def visibilidade_inicial(usuario):
    if em_quarentena(usuario):
        return Defeito.VISIBILIDADE_RESTRITA
    return Defeito.VISIBILIDADE_PUBLICA


def _registrar_atualizacao(defeito, texto):
    try:
        lista = json.loads(defeito.atualizacoes or '[]')
    except ValueError:
        lista = []
    lista.append({'texto': texto, 'data': timezone.now().isoformat()})
    defeito.atualizacoes = json.dumps(lista, ensure_ascii=False)


def remover(defeito, usuario, motivo, *, papel=None, texto=''):
    """
    Soft delete: o chamado sai de todas as listagens (`removido_em`), mas o
    registro e o histórico ficam para a prefeitura e a auditoria. Chamado já
    removido não é removido de novo (nem ganha outro evento).
    """
    if defeito.removido_em is not None:
        return False
    agora = timezone.now()
    defeito.removido_em = agora
    defeito.removido_motivo = motivo
    defeito.atualizado_em = agora
    defeito.save(update_fields=['removido_em', 'removido_motivo', 'atualizado_em'])
    fluxo.registrar_evento(
        defeito, 'removido', usuario, papel=papel, texto=texto, dados={'motivo': motivo},
    )
    return True


def aplicar_sinalizacao(defeito, usuario, tipo):
    """
    Chamada logo depois de gravar a sinalização de `usuario` (tipo `tipo`).
    Devolve `RESULTADO_CONCLUIDO`, `RESULTADO_INEXISTENTE` ou None. Quando
    devolve `RESULTADO_INEXISTENTE` o `defeito` já foi removido (soft delete).
    """
    autor = defeito.usuario_id is not None and defeito.usuario_id == usuario.id
    contagem = contar_sinalizacoes(defeito)

    if tipo == Sinalizacao.RESOLVIDO:
        if autor or contagem[Sinalizacao.RESOLVIDO] >= RESOLVIDO_MIN:
            texto = 'Concluído pelo próprio autor' if autor else 'Concluído por confirmação de cidadãos'
            fluxo.transicionar(
                defeito, 'concluido', usuario, papel='comunidade', texto=texto,
                dados={'sinalizacoes': contagem[Sinalizacao.RESOLVIDO], 'pelo_autor': autor},
            )
            # Legado: o app ainda monta parte da linha do tempo por aqui.
            _registrar_atualizacao(defeito, texto)
            defeito.save(update_fields=['atualizacoes'])
            return RESULTADO_CONCLUIDO
        return None

    # tipo == NAO_EXISTE
    # O autor só desfaz o próprio chamado enquanto ninguém o pegou (a mesma
    # regra do DELETE). Depois disso o "não existe" dele vira insumo para a
    # moderação e não conta para a remoção pela comunidade.
    if autor:
        if defeito.status != 'pendente':
            return None
        remover(defeito, usuario, 'autor', papel='cidadao', texto='Removido pelo próprio autor')
        return RESULTADO_INEXISTENTE

    nao_existe = contagem[Sinalizacao.NAO_EXISTE]
    if defeito.usuario_id is not None:
        nao_existe -= Sinalizacao.objects.filter(
            defeito=defeito, tipo=Sinalizacao.NAO_EXISTE, usuario_id=defeito.usuario_id,
        ).count()
    apoios = Apoio.objects.filter(defeito=defeito).count()
    if nao_existe >= NAO_EXISTE_MIN + apoios:
        removido = remover(
            defeito, usuario, 'comunidade', papel='comunidade',
            texto='Removido por sinalizações de "não existe"',
        )
        if removido and defeito.usuario_id is not None:
            Strike.objects.create(
                usuario_id=defeito.usuario_id,
                titulo=defeito.titulo,
                criado_em=timezone.now(),
            )
        return RESULTADO_INEXISTENTE
    return None


def aplicar_confirmacao(defeito, usuario):
    """
    Chamada quando `usuario` confirma/apoia `defeito`. Se o chamado é
    restrito e esta é a primeira confirmação de outra pessoa, ele vira público
    e o autor resgata um strike. Devolve True se a visibilidade mudou.

    O resgate acontece uma vez só por chamado: a virada para público é um
    UPDATE condicional (`visibilidade='restrita'`), então desfazer e refazer o
    apoio — ou dois apoios simultâneos — não apaga outro strike. Chamado que
    nasceu público não resgata nada.
    """
    if defeito.usuario_id is None or defeito.usuario_id == usuario.id:
        return False
    if defeito.visibilidade != Defeito.VISIBILIDADE_RESTRITA:
        return False
    de_terceiros = Apoio.objects.filter(defeito=defeito).exclude(usuario_id=defeito.usuario_id).count()
    if de_terceiros != 1:
        return False

    with transaction.atomic():
        virou = Defeito.objects.filter(
            pk=defeito.pk, visibilidade=Defeito.VISIBILIDADE_RESTRITA,
        ).update(visibilidade=Defeito.VISIBILIDADE_PUBLICA)
        if not virou:
            return False
        mais_antigo = strikes_ativos(defeito.usuario).order_by('criado_em').first()
        if mais_antigo is not None:
            mais_antigo.delete()
    defeito.visibilidade = Defeito.VISIBILIDADE_PUBLICA
    return True


def visivel_para(defeito, usuario, lat=None, lng=None):
    """Se `usuario` (pode ser anônimo) pode ver `defeito` num contexto com/sem GPS."""
    if defeito.visibilidade != Defeito.VISIBILIDADE_RESTRITA:
        return True
    if usuario is not None and usuario.is_authenticated:
        if permissoes.eh_equipe(usuario) or defeito.usuario_id == usuario.id:
            return True
    if lat is None or lng is None or defeito.latitude is None or defeito.longitude is None:
        return False
    from .serializers import _distancia_m
    return _distancia_m(lat, lng, defeito.latitude, defeito.longitude) <= RAIO_VISIBILIDADE_RESTRITA_M


def deslocamento_implausivel(usuario, lat, lng):
    """
    Mensagem de erro se `usuario` não teria como estar em (lat, lng) agora,
    dado onde e quando foi seu último chamado; None se estiver tudo bem.
    Ex.: reportar algo e, 5 segundos depois, outra coisa 1 km adiante.
    """
    if lat is None or lng is None:
        return None
    ultimo = (
        Defeito.objects.filter(usuario=usuario)
        .exclude(latitude=None).exclude(longitude=None)
        .order_by('-criado_em')
        .first()
    )
    if ultimo is None:
        return None

    from .serializers import _distancia_m
    distancia = _distancia_m(lat, lng, ultimo.latitude, ultimo.longitude)
    if distancia <= DESLOCAMENTO_LIVRE_M:
        return None

    decorrido = max((timezone.now() - ultimo.criado_em).total_seconds(), 1.0)
    velocidade_kmh = (distancia / decorrido) * 3.6
    if velocidade_kmh <= VELOCIDADE_MAX_KMH:
        return None

    faltam = int((distancia * 3.6) / VELOCIDADE_MAX_KMH - decorrido) + 1
    return (
        'Seu último chamado foi agora há pouco, longe daqui. '
        f'Aguarde cerca de {max(faltam, 30)} segundos para reportar neste local.'
    )
