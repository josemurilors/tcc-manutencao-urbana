"""
API da operação — `api/v1/operacao/` (contrato v3, seção 7.1).

Tudo aqui é da equipe do município (operador+), com três exceções públicas
de leitura: a lista de anexos e a imagem de um chamado público, para o
cidadão ver o "antes/depois" do serviço. Mudança de status e atribuição
passam sempre por `defeitos.fluxo` (timestamps, histórico, aviso ao
cidadão); este módulo só valida a entrada, aplica as regras da prefeitura
(foto obrigatória ao concluir, checklist) e monta as respostas.
"""
import json
from datetime import timedelta

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import FloatField, Q
from django.db.models.expressions import RawSQL
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from core import auditoria, permissoes
from defeitos import fluxo, sla
from defeitos.fluxo import TransicaoInvalida, TransicaoNaoPermitida
from defeitos.models import Defeito, DefeitoAnexo, DefeitoEvento, RespostaPadrao, Sinalizacao
from defeitos.serializers import PRIORIDADES, DefeitoEventoSerializer, _distancia_m
from gestao.models import Equipe, MunicipioConfig
from users.models import User

from . import fila
from .imagens import ImagemInvalida, comprimir_jpeg, tipo_mime
from .serializers import (
    AnexoSerializer, ChamadoFilaSerializer, ChamadoOperacaoSerializer, RespostaPadraoSerializer,
    checklists_do_municipio, membro,
)

SEM_MUNICIPIO = 'Seu usuário não está vinculado a um município.'
NAO_EQUIPE = 'Disponível só para a equipe da prefeitura.'
FORA_DO_MUNICIPIO = 'Chamado fora do seu município de operação.'
SO_GESTOR = 'Disponível só para gestores.'

# Parâmetros da prefeitura (`municipio_config.parametros`) e seus padrões.
# A foto do serviço concluído é a prova que o cidadão e o controle externo
# cobram; fica ligada até a prefeitura desligar explicitamente.
PARAMETROS_PADRAO = {
    'exigir_foto_conclusao': True,
    'raio_evidencia_m': 150,
}

# Evidências da equipe por chamado: cada uma é um JPEG de até ~300 KB; o
# teto evita que um cliente com defeito encha o banco num loop de reenvio.
MAX_EVIDENCIAS = 20
LOTE_MAXIMO = 100
CHECKLIST_MAX_ITENS = 50
TEXTO_MAX = 4000
RESPOSTA_MAX = 2000
SLA_MAX_DIAS = 365


def _erro(mensagem, codigo=status.HTTP_400_BAD_REQUEST):
    return Response({'detail': mensagem}, status=codigo)


def _parametro(municipio_id, nome):
    padrao = PARAMETROS_PADRAO[nome]
    if not municipio_id:
        return padrao
    parametros = (
        MunicipioConfig.objects.filter(municipio_id=str(municipio_id))
        .values_list('parametros', flat=True).first()
    ) or {}
    valor = parametros.get(nome, padrao)
    return padrao if valor is None else valor


def _base():
    return Defeito.objects.ativos().select_related('usuario', 'secretaria', 'atendente', 'equipe')


def _equipe_do_municipio(user):
    """None se o usuário pode usar a operação; senão a resposta de erro."""
    if not permissoes.eh_equipe(user):
        return _erro(NAO_EQUIPE, status.HTTP_403_FORBIDDEN)
    if not user.municipio_id:
        return _erro(SEM_MUNICIPIO, status.HTTP_403_FORBIDDEN)
    return None


def _carregar(request, pk, gestao=False):
    """
    (defeito, None) ou (None, resposta de erro). Ações de operação exigem a
    equipe do município do chamado; as de gestão (SLA, prioridade), gestor+
    — o super admin gere qualquer município, como em `permissoes`.
    """
    try:
        defeito = _base().filter(pk=pk).first()
    except DjangoValidationError:
        defeito = None
    if defeito is None:
        return None, _erro('Chamado não encontrado.', status.HTTP_404_NOT_FOUND)
    user = request.user
    if gestao:
        if not (permissoes.eh_equipe(user) and permissoes.pode_gerir(user, defeito.municipio_id)):
            return None, _erro(SO_GESTOR if permissoes.eh_equipe(user) else NAO_EQUIPE,
                               status.HTTP_403_FORBIDDEN)
    elif not permissoes.pode_operar(user, defeito):
        return None, _erro(FORA_DO_MUNICIPIO if permissoes.eh_equipe(user) else NAO_EQUIPE,
                           status.HTTP_403_FORBIDDEN)
    return defeito, None


def _detalhe(request, defeito):
    obj = fila.anotar(_base()).get(pk=defeito.pk)
    return ChamadoOperacaoSerializer(obj, context={'request': request}).data


def _float(valor):
    try:
        return float(valor)
    except (TypeError, ValueError):
        return None


def _int(valor, campo):
    if valor in (None, ''):
        return None
    try:
        return int(valor)
    except (TypeError, ValueError):
        raise TransicaoInvalida(f'"{campo}" precisa ser um número.')


def _valor(dados, campo):
    """Campo do corpo (JSON ou multipart); listas repetidas no multipart viram lista."""
    if hasattr(dados, 'getlist'):
        valores = dados.getlist(campo)
        if len(valores) > 1:
            return valores
    return dados.get(campo)


# --- Fila e resumo ----------------------------------------------------------

class FilaPaginacao(PageNumberPagination):
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 100


ATRIBUICOES = ('meus', 'equipe', 'sem', 'todos')
STATUS_GRUPOS = {
    'abertos': fluxo.STATUS_ABERTOS,
    'fechados': fluxo.STATUS_FECHADOS,
    'todos': fluxo.STATUS_ABERTOS + fluxo.STATUS_FECHADOS,
}


def _filtrar_fila(request):
    """Queryset filtrado e ordenado da fila, ou levanta `TransicaoInvalida` (400)."""
    user = request.user
    p = request.query_params
    agora = timezone.now()
    qs = fila.anotar(_base().defer('imagem_thumbnail', 'foto_resolucao'), agora)
    qs = qs.filter(municipio_id=user.municipio_id)

    pedidos = [s.strip() for s in (p.get('status') or 'abertos').split(',') if s.strip()]
    estados = set()
    for s in pedidos:
        if s in STATUS_GRUPOS:
            estados.update(STATUS_GRUPOS[s])
            continue
        s = fluxo.normalizar_status(s)
        if s not in fluxo.TRANSICOES:
            raise TransicaoInvalida(f'Status desconhecido: {s}.')
        estados.add(s)
    qs = qs.filter(status__in=estados)

    categoria_id = _int(p.get('categoria_id'), 'categoria_id')
    if categoria_id is not None:
        qs = qs.filter(categoria_id=categoria_id)
    equipe_id = _int(p.get('equipe_id'), 'equipe_id')
    if equipe_id is not None:
        qs = qs.filter(equipe_id=equipe_id)

    atribuicao = p.get('atribuicao') or 'todos'
    if atribuicao not in ATRIBUICOES:
        raise TransicaoInvalida('atribuicao deve ser meus, equipe, sem ou todos.')
    if atribuicao == 'meus':
        qs = qs.filter(atendente_id=user.id)
    elif atribuicao == 'equipe':
        # Sem equipe cadastrada não há "da minha equipe": lista vazia, não tudo.
        qs = qs.filter(equipe_id=user.equipe_id) if user.equipe_id else qs.none()
    elif atribuicao == 'sem':
        qs = qs.filter(atendente__isnull=True, equipe__isnull=True)

    if p.get('vencidos') in ('1', 'true'):
        qs = qs.filter(fila.filtro_vencidos(agora))
    if p.get('bairro'):
        qs = qs.filter(bairro__iexact=p['bairro'].strip())
    termo = (p.get('q') or '').strip()
    if termo:
        qs = qs.filter(
            Q(protocolo__icontains=termo) | Q(titulo__icontains=termo) | Q(descricao__icontains=termo)
            | Q(rua__icontains=termo) | Q(bairro__icontains=termo)
        )

    lat, lng = _float(p.get('lat')), _float(p.get('lng'))
    if lat is not None and lng is not None:
        # Distância geodésica no PostGIS (metros), só quando o app manda a posição.
        qs = qs.annotate(distancia_m=RawSQL(
            'ST_DistanceSphere(ST_MakePoint("defeitos"."longitude", "defeitos"."latitude"), '
            'ST_MakePoint(%s, %s))', (lng, lat), output_field=FloatField(),
        ))
    ordenar = p.get('ordenar') or 'score'
    if ordenar not in fila.ORDENACOES:
        raise TransicaoInvalida('ordenar deve ser score, prazo, antigos, apoios ou distancia.')
    if ordenar == 'distancia' and (lat is None or lng is None):
        raise TransicaoInvalida('Para ordenar por distância, envie lat e lng.')
    return qs.order_by(*fila.ORDENACOES[ordenar])


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def fila_view(request):
    negado = _equipe_do_municipio(request.user)
    if negado:
        return negado
    try:
        qs = _filtrar_fila(request)
    except TransicaoInvalida as e:
        return _erro(str(e))
    paginador = FilaPaginacao()
    pagina = paginador.paginate_queryset(qs, request)
    contexto = {'request': request, 'checklists': checklists_do_municipio(request.user.municipio_id)}
    return paginador.get_paginated_response(ChamadoFilaSerializer(pagina, many=True, context=contexto).data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def resumo_view(request):
    negado = _equipe_do_municipio(request.user)
    if negado:
        return negado
    user = request.user
    agora = timezone.now()
    base = Defeito.objects.ativos().filter(municipio_id=user.municipio_id)
    abertos = base.filter(status__in=fluxo.STATUS_ABERTOS)
    inicio_do_dia = timezone.localtime(agora).replace(hour=0, minute=0, second=0, microsecond=0)
    sinalizados = Sinalizacao.objects.filter(defeito_id__in=abertos.values('id')).values('defeito_id').distinct()
    return Response({
        'abertos': abertos.count(),
        'meus': abertos.filter(atendente_id=user.id).count(),
        'vencidos': abertos.filter(prazo_em__lt=agora).count(),
        'vencem_24h': abertos.filter(prazo_em__gte=agora, prazo_em__lt=agora + timedelta(hours=24)).count(),
        'sem_atribuicao': abertos.filter(atendente__isnull=True, equipe__isnull=True).count(),
        'sinalizados': sinalizados.count(),
        'concluidos_hoje': base.filter(status='concluido', resolvido_em__gte=inicio_do_dia).count(),
    })


# --- Transição -----------------------------------------------------------------

def _normalizar_checklist(valor):
    """
    Aceita a lista de itens feitos (["Sinalizou a via", ...]), uma lista de
    {item, feito} ou um JSON disso (multipart). Grava sempre [{item, feito}].
    """
    if valor in (None, '', []):
        return None
    if isinstance(valor, str):
        try:
            valor = json.loads(valor)
        except ValueError:
            valor = [valor]
    if isinstance(valor, dict):
        valor = [{'item': k, 'feito': v} for k, v in valor.items()]
    if not isinstance(valor, list):
        raise TransicaoInvalida('Checklist em formato inválido.')
    if len(valor) > CHECKLIST_MAX_ITENS:
        raise TransicaoInvalida(f'Checklist com mais de {CHECKLIST_MAX_ITENS} itens.')
    saida = []
    for linha in valor:
        if isinstance(linha, str):
            item, feito = linha, True
        elif isinstance(linha, dict) and linha.get('item'):
            item, feito = linha['item'], linha.get('feito', True)
        else:
            raise TransicaoInvalida('Checklist em formato inválido.')
        if isinstance(feito, str):
            feito = feito.lower() not in ('false', '0', 'nao', 'não', '')
        saida.append({'item': str(item).strip()[:200], 'feito': bool(feito)})
    return saida


def _tem_foto_depois_valida(defeito):
    """Já há foto "depois" da equipe desde a última reabertura (enviada por `evidencia/`)?"""
    reaberto_em = (
        DefeitoEvento.objects.filter(defeito_id=defeito.pk, tipo='reaberto')
        .order_by('-criado_em').values_list('criado_em', flat=True).first()
    )
    qs = DefeitoAnexo.objects.filter(defeito_id=defeito.pk, tipo='depois')
    if reaberto_em:
        qs = qs.filter(criado_em__gt=reaberto_em)
    return qs.exists()


def _gravar_evidencia(defeito, user, imagem_jpeg, tipo, lat, lng):
    """Cria o anexo e o evento `anexo`, marcando se a foto foi tirada longe do ponto."""
    anexo = DefeitoAnexo.objects.create(
        defeito=defeito, tipo=tipo, imagem=imagem_jpeg, autor=user, latitude=lat, longitude=lng,
    )
    dados = {'tipo': tipo, 'anexo_id': anexo.id}
    if None not in (lat, lng, defeito.latitude, defeito.longitude):
        distancia = round(_distancia_m(defeito.latitude, defeito.longitude, lat, lng))
        dados['distancia_m'] = distancia
        # Aceita, mas sinaliza: GPS de celular erra dezenas de metros e o
        # gestor decide se a evidência vale.
        if distancia > float(_parametro(defeito.municipio_id, 'raio_evidencia_m')):
            dados['fora_do_local'] = True
    fluxo.registrar_evento(defeito, 'anexo', user, dados=dados)
    if tipo == 'depois':
        # Legado: o detalhe do cidadão ainda mostra `foto_resolucao` (WebP pequena).
        from services.image_processor import make_thumbnail
        defeito.foto_resolucao = make_thumbnail(imagem_jpeg)
        defeito.save(update_fields=['foto_resolucao'])
    return anexo


def _aplicar_transicao(defeito, user, dados, foto=None, lat=None, lng=None):
    """
    Uma transição pedida pela equipe (endpoint individual e lote). Levanta
    `TransicaoInvalida`/`TransicaoNaoPermitida`/`ImagemInvalida`; tudo ou nada.
    """
    para = fluxo.normalizar_status(dados.get('para') or '')
    if not para:
        raise TransicaoInvalida('Informe o novo status ("para").')
    checklist = _normalizar_checklist(_valor(dados, 'checklist'))
    resposta = (dados.get('resposta_publica') or '').strip()
    if len(resposta) > RESPOSTA_MAX:
        raise TransicaoInvalida(f'Resposta pública com mais de {RESPOSTA_MAX} caracteres.')

    jpeg = comprimir_jpeg(foto) if foto is not None else None
    # A exigência de foto só entra se a transição em si é possível; senão o
    # `fluxo` responde o erro certo ("não é possível passar de ... para ...").
    possivel = para in fluxo.TRANSICOES.get(fluxo.normalizar_status(defeito.status), ())
    if (para == 'concluido' and possivel and jpeg is None
            and _parametro(defeito.municipio_id, 'exigir_foto_conclusao')
            and not _tem_foto_depois_valida(defeito)):
        raise TransicaoInvalida('Envie a foto do serviço concluído para encerrar o chamado.')

    extras = {}
    if checklist is not None:
        extras['checklist'] = checklist
    with transaction.atomic():
        anexo = None
        if jpeg is not None:
            tipo = 'depois' if para == 'concluido' else 'antes'
            anexo = _gravar_evidencia(defeito, user, jpeg, tipo, lat, lng)
            extras['anexo_id'] = anexo.id
        fluxo.transicionar(
            defeito, para, user,
            texto=(dados.get('texto') or '').strip()[:TEXTO_MAX],
            resposta_publica=resposta,
            motivo=dados.get('motivo') or '',
            duplicado_de=dados.get('duplicado_de') or None,
            dados=extras,
        )
    return defeito


def _responder_erro_fluxo(e):
    if isinstance(e, TransicaoNaoPermitida):
        return _erro(str(e), status.HTTP_403_FORBIDDEN)
    return _erro(str(e))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def transicao_view(request, pk):
    defeito, negado = _carregar(request, pk)
    if negado:
        return negado
    try:
        _aplicar_transicao(
            defeito, request.user, request.data, foto=request.FILES.get('foto'),
            lat=_float(request.data.get('latitude')), lng=_float(request.data.get('longitude')),
        )
    except (TransicaoInvalida, ImagemInvalida) as e:
        return _responder_erro_fluxo(e)
    return Response(_detalhe(request, defeito))


# --- Atribuição -------------------------------------------------------------------

def _aplicar_atribuicao(defeito, user, dados):
    equipe_id = _int(dados.get('equipe_id'), 'equipe_id')
    atendente_id = dados.get('atendente_id') or None
    with transaction.atomic():
        # Trava a linha: dois operadores tocando "assumir" juntos não ficam
        # ambos achando que pegaram o chamado.
        atual = Defeito.objects.select_for_update().only('atendente_id').get(pk=defeito.pk)
        eh_gestor = permissoes.nivel(user) >= permissoes.NIVEIS['gestor']
        if (not eh_gestor and atual.atendente_id
                and str(atual.atendente_id) != str(user.id)):
            raise TransicaoNaoPermitida('Este chamado já foi assumido por outra pessoa.')
        fluxo.atribuir(defeito, user, equipe_id=equipe_id, atendente_id=atendente_id)
    return defeito


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def atribuir_view(request, pk):
    defeito, negado = _carregar(request, pk)
    if negado:
        return negado
    try:
        _aplicar_atribuicao(defeito, request.user, request.data)
    except TransicaoInvalida as e:
        return _responder_erro_fluxo(e)
    except DjangoValidationError:
        return _erro('Operador inválido.')
    return Response(_detalhe(request, defeito))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def liberar_view(request, pk):
    """Devolve o chamado à fila: o próprio atendente ou gestor+. Sem atendente, não faz nada."""
    defeito, negado = _carregar(request, pk)
    if negado:
        return negado
    user = request.user
    if not defeito.atendente_id:
        return Response(_detalhe(request, defeito))
    eh_gestor = permissoes.nivel(user) >= permissoes.NIVEIS['gestor']
    if str(defeito.atendente_id) != str(user.id) and not eh_gestor:
        return _erro('Só quem assumiu o chamado, ou um gestor, pode liberá-lo.', status.HTTP_403_FORBIDDEN)
    anterior = str(defeito.atendente_id)
    with transaction.atomic():
        defeito.atendente = None
        defeito.atualizado_em = timezone.now()
        defeito.save(update_fields=['atendente', 'atualizado_em'])
        fluxo.registrar_evento(
            defeito, 'atribuido', user, publico=False,
            texto=(request.data.get('motivo') or '').strip()[:500] if hasattr(request.data, 'get') else '',
            dados={'liberado': True, 'atendente_anterior_id': anterior},
        )
    return Response(_detalhe(request, defeito))


# --- Comunicação ------------------------------------------------------------------

def _texto_obrigatorio(request, limite):
    texto = (request.data.get('texto') or '').strip() if hasattr(request.data, 'get') else ''
    if not texto:
        raise TransicaoInvalida('Escreva o texto.')
    if len(texto) > limite:
        raise TransicaoInvalida(f'Texto com mais de {limite} caracteres.')
    return texto


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def nota_view(request, pk):
    """Nota interna: só a equipe do município vê (evento `publico=false`)."""
    defeito, negado = _carregar(request, pk)
    if negado:
        return negado
    try:
        texto = _texto_obrigatorio(request, TEXTO_MAX)
    except TransicaoInvalida as e:
        return _erro(str(e))
    evento = fluxo.registrar_evento(defeito, 'nota_interna', request.user, publico=False, texto=texto)
    return Response(
        DefeitoEventoSerializer(evento, context={'request': request, 'equipe': True}).data,
        status=status.HTTP_201_CREATED,
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def resposta_view(request, pk):
    """Resposta pública: fica no chamado e vira aviso para autor e apoiadores (`ao_evento`)."""
    defeito, negado = _carregar(request, pk)
    if negado:
        return negado
    try:
        texto = _texto_obrigatorio(request, RESPOSTA_MAX)
    except TransicaoInvalida as e:
        return _erro(str(e))
    with transaction.atomic():
        defeito.resposta_publica = texto
        defeito.atualizado_em = timezone.now()
        defeito.save(update_fields=['resposta_publica', 'atualizado_em'])
        evento = fluxo.registrar_evento(defeito, 'resposta_publica', request.user, texto=texto)
    return Response(
        DefeitoEventoSerializer(evento, context={'request': request, 'equipe': True}).data,
        status=status.HTTP_201_CREATED,
    )


# --- Evidências e anexos ----------------------------------------------------------

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def evidencia_view(request, pk):
    defeito, negado = _carregar(request, pk)
    if negado:
        return negado
    tipo = request.data.get('tipo')
    if tipo not in ('antes', 'depois'):
        return _erro('tipo deve ser "antes" ou "depois".')
    foto = request.FILES.get('foto')
    if foto is None:
        return _erro('Envie a foto.')
    if defeito.status == 'rejeitado':
        return _erro('Chamado rejeitado não recebe evidência de serviço.')
    if DefeitoAnexo.objects.filter(defeito_id=defeito.pk, tipo__in=('antes', 'depois')).count() >= MAX_EVIDENCIAS:
        return _erro(f'Limite de {MAX_EVIDENCIAS} fotos de evidência por chamado atingido.')
    try:
        jpeg = comprimir_jpeg(foto)
    except ImagemInvalida as e:
        return _erro(str(e))
    with transaction.atomic():
        anexo = _gravar_evidencia(
            defeito, request.user, jpeg, tipo,
            _float(request.data.get('latitude')), _float(request.data.get('longitude')),
        )
        defeito.atualizado_em = timezone.now()
        defeito.save(update_fields=['atualizado_em'])
    return Response(
        AnexoSerializer(anexo, context={'request': request, 'equipe': True}).data,
        status=status.HTTP_201_CREATED,
    )


def _visivel(request, defeito):
    """(equipe?, visível?) — o restrito (quarentena) só para a equipe e o autor."""
    user = request.user
    equipe = permissoes.pode_operar(user, defeito)
    if equipe or defeito.visibilidade == Defeito.VISIBILIDADE_PUBLICA:
        return equipe, True
    return False, bool(user.is_authenticated and defeito.usuario_id == user.id)


@api_view(['GET'])
@permission_classes([AllowAny])
def anexos_view(request, pk):
    try:
        defeito = Defeito.objects.ativos().filter(pk=pk).only(
            'id', 'municipio_id', 'visibilidade', 'usuario_id').first()
    except DjangoValidationError:
        defeito = None
    if defeito is None:
        return _erro('Chamado não encontrado.', status.HTTP_404_NOT_FOUND)
    equipe, visivel = _visivel(request, defeito)
    if not visivel:
        return _erro('Chamado não encontrado.', status.HTTP_404_NOT_FOUND)
    anexos = DefeitoAnexo.objects.filter(defeito_id=defeito.pk).select_related('autor').defer('imagem')
    return Response(AnexoSerializer(anexos, many=True, context={'request': request, 'equipe': equipe}).data)


@api_view(['GET'])
@permission_classes([AllowAny])
def anexo_imagem_view(request, pk):
    anexo = get_object_or_404(DefeitoAnexo.objects.select_related('defeito'), pk=pk)
    defeito = anexo.defeito
    if defeito.removido_em is not None and not permissoes.pode_operar(request.user, defeito):
        return _erro('Imagem não encontrada.', status.HTTP_404_NOT_FOUND)
    _, visivel = _visivel(request, defeito)
    if not visivel:
        return _erro('Imagem não encontrada.', status.HTTP_404_NOT_FOUND)
    dados = bytes(anexo.imagem)
    resposta = HttpResponse(dados, content_type=tipo_mime(dados))
    # Anexo não muda depois de gravado; o app pode guardar em cache.
    publico = defeito.visibilidade == Defeito.VISIBILIDADE_PUBLICA and defeito.removido_em is None
    resposta['Cache-Control'] = f'{"public" if publico else "private"}, max-age=86400'
    resposta['X-Content-Type-Options'] = 'nosniff'
    return resposta


# --- Gestão do chamado (gestor+) ----------------------------------------------

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def sla_view(request, pk):
    defeito, negado = _carregar(request, pk, gestao=True)
    if negado:
        return negado
    try:
        dias = int(request.data.get('prazo_sla_dias'))
    except (TypeError, ValueError):
        return _erro('prazo_sla_dias precisa ser um número de dias.')
    if not 1 <= dias <= SLA_MAX_DIAS:
        return _erro(f'O prazo deve ficar entre 1 e {SLA_MAX_DIAS} dias.')
    motivo = (request.data.get('motivo') or '').strip()
    if len(motivo) < 3:
        return _erro('Explique o motivo da mudança de prazo.')
    if defeito.status not in fluxo.STATUS_ABERTOS:
        return _erro('Chamado já finalizado.')
    anterior = {'prazo_sla_dias': defeito.prazo_sla_dias, 'prazo_em': defeito.prazo_em}
    with transaction.atomic():
        defeito.prazo_sla_dias = dias
        defeito.prazo_em = sla.calcular_prazo(defeito.criado_em, dias)
        defeito.atualizado_em = timezone.now()
        defeito.save(update_fields=['prazo_sla_dias', 'prazo_em', 'atualizado_em'])
        dados = {
            'de': anterior['prazo_sla_dias'], 'para': dias,
            'prazo_em_anterior': anterior['prazo_em'], 'prazo_em': defeito.prazo_em,
        }
        fluxo.registrar_evento(defeito, 'sla', request.user, publico=False, texto=motivo[:500], dados=dados)
        auditoria.registrar(
            request, 'defeito.sla', 'defeito', defeito.id,
            dados={**dados, 'motivo': motivo[:500], 'protocolo': defeito.protocolo},
            municipio_id=defeito.municipio_id,
        )
    return Response(_detalhe(request, defeito))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def prioridade_view(request, pk):
    defeito, negado = _carregar(request, pk, gestao=True)
    if negado:
        return negado
    nova = request.data.get('prioridade')
    if nova not in PRIORIDADES:
        return _erro('prioridade deve ser baixa, media, alta ou urgente.')
    if nova != defeito.prioridade:
        anterior = defeito.prioridade
        with transaction.atomic():
            defeito.prioridade = nova
            defeito.atualizado_em = timezone.now()
            defeito.save(update_fields=['prioridade', 'atualizado_em'])
            fluxo.registrar_evento(defeito, 'prioridade', request.user, publico=False,
                                   dados={'de': anterior, 'para': nova})
            auditoria.registrar(
                request, 'defeito.prioridade', 'defeito', defeito.id,
                dados={'de': anterior, 'para': nova, 'protocolo': defeito.protocolo},
                municipio_id=defeito.municipio_id,
            )
    return Response(_detalhe(request, defeito))


# --- Lote ----------------------------------------------------------------------------

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def lote_view(request):
    """
    A mesma ação em vários chamados, um a um e cada um na sua transação: o que
    falha (permissão, transição, foto exigida) volta em `erros` sem desfazer
    o resto. Foto não vai em lote — concluir em lote só passa se a evidência
    já foi enviada por `evidencia/` ou se a prefeitura não exige foto.
    """
    negado = _equipe_do_municipio(request.user)
    if negado:
        return negado
    ids = request.data.get('ids')
    acao = request.data.get('acao')
    if not isinstance(ids, list) or not ids:
        return _erro('Informe ao menos um chamado em "ids".')
    if len(ids) > LOTE_MAXIMO:
        return _erro(f'Máximo de {LOTE_MAXIMO} chamados por lote.')
    if acao not in ('transicao', 'atribuir'):
        return _erro('acao deve ser "transicao" ou "atribuir".')

    ok, erros = [], []
    vistos = set()
    for bruto in ids:
        chave = str(bruto)
        if chave in vistos:
            continue
        vistos.add(chave)
        defeito, falha = _carregar(request, chave)
        if falha:
            erros.append({'id': chave, 'detail': falha.data['detail']})
            continue
        try:
            if acao == 'transicao':
                _aplicar_transicao(defeito, request.user, request.data)
            else:
                _aplicar_atribuicao(defeito, request.user, request.data)
        except (TransicaoInvalida, ImagemInvalida) as e:
            erros.append({'id': chave, 'detail': str(e)})
            continue
        except DjangoValidationError:
            erros.append({'id': chave, 'detail': 'Dados inválidos.'})
            continue
        ok.append(chave)
    return Response({'ok': ok, 'erros': erros})


# --- Respostas-padrão ------------------------------------------------------------------

@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def respostas_padrao_view(request):
    negado = _equipe_do_municipio(request.user)
    if negado:
        return negado
    municipio_id = request.user.municipio_id
    if request.method == 'GET':
        qs = RespostaPadrao.objects.filter(municipio_id=municipio_id, ativo=True)
        categoria = request.query_params.get('categoria_id')
        if categoria:
            try:
                qs = qs.filter(Q(categoria_id=int(categoria)) | Q(categoria_id__isnull=True))
            except ValueError:
                return _erro('categoria_id precisa ser um número.')
        return Response(RespostaPadraoSerializer(qs, many=True).data)

    if not permissoes.pode_gerir(request.user, municipio_id):
        return _erro(SO_GESTOR, status.HTTP_403_FORBIDDEN)
    serializer = RespostaPadraoSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    resposta = serializer.save(municipio_id=municipio_id, criado_em=timezone.now())
    auditoria.registrar(request, 'resposta_padrao.criar', 'resposta_padrao', resposta.id,
                        dados={'titulo': resposta.titulo}, municipio_id=municipio_id)
    return Response(RespostaPadraoSerializer(resposta).data, status=status.HTTP_201_CREATED)


@api_view(['PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def resposta_padrao_view(request, pk):
    negado = _equipe_do_municipio(request.user)
    if negado:
        return negado
    municipio_id = request.user.municipio_id
    # Fora do município do usuário a resposta "não existe" (sem vazar ids alheios).
    resposta = RespostaPadrao.objects.filter(pk=pk, municipio_id=municipio_id, ativo=True).first()
    if resposta is None:
        return _erro('Resposta-padrão não encontrada.', status.HTTP_404_NOT_FOUND)
    if not permissoes.pode_gerir(request.user, municipio_id):
        return _erro(SO_GESTOR, status.HTTP_403_FORBIDDEN)
    if request.method == 'DELETE':
        resposta.delete()
        auditoria.registrar(request, 'resposta_padrao.excluir', 'resposta_padrao', pk,
                            dados={'titulo': resposta.titulo}, municipio_id=municipio_id)
        return Response(status=status.HTTP_204_NO_CONTENT)
    serializer = RespostaPadraoSerializer(resposta, data=request.data, partial=True)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    serializer.save()
    auditoria.registrar(request, 'resposta_padrao.editar', 'resposta_padrao', pk,
                        dados={k: v for k, v in serializer.validated_data.items()}, municipio_id=municipio_id)
    return Response(serializer.data)


# --- Equipes -------------------------------------------------------------------------

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def equipes_view(request):
    negado = _equipe_do_municipio(request.user)
    if negado:
        return negado
    municipio_id = request.user.municipio_id
    equipes = list(
        Equipe.objects.filter(municipio_id=municipio_id, ativo=True)
        .select_related('secretaria').order_by('nome')
    )
    membros = {}
    pessoas = (
        User.objects.filter(municipio_id=municipio_id, equipe_id__in=[e.id for e in equipes],
                            papel__in=permissoes.PAPEIS_EQUIPE)
        .only('id', 'nome', 'papel', 'equipe_id').order_by('nome')
    )
    for pessoa in pessoas:
        membros.setdefault(pessoa.equipe_id, []).append(membro(pessoa))
    return Response([
        {
            'id': e.id,
            'nome': e.nome,
            'secretaria_nome': e.secretaria.nome if e.secretaria_id and e.secretaria else None,
            'membros': membros.get(e.id, []),
        }
        for e in equipes
    ])


# --- Ordem de serviço --------------------------------------------------------------------

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def ordem_servico_view(request, pk):
    defeito, negado = _carregar(request, pk)
    if negado:
        return negado
    from services.ordem_servico import gerar_ordem_servico

    pdf = gerar_ordem_servico(defeito)
    nome = defeito.protocolo or str(defeito.id)[:8]
    resposta = HttpResponse(pdf, content_type='application/pdf')
    resposta['Content-Disposition'] = f'attachment; filename="OS-{nome}.pdf"'
    return resposta
