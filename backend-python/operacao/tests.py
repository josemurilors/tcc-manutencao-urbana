"""
API da operação (contrato v3, 7.1): permissões por papel e município, fila
priorizada (score, filtros, ordenação, paginação), transição com evidência e
checklist, atribuição, comunicação, gestão de SLA/prioridade, lote,
respostas-padrão, equipes e a ordem de serviço.
"""
import io
import uuid
from datetime import timedelta

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from categorias.models import Categoria
from defeitos.models import Apoio, Defeito, DefeitoAnexo, DefeitoEvento, RespostaPadrao, Sinalizacao
from gestao.models import CategoriaMunicipio, Equipe, MunicipioConfig, Secretaria
from notificacoes.models import Notificacao
from users.models import User

pytestmark = pytest.mark.django_db(transaction=True)

LAT, LNG = -30.0, -59.0

# As tabelas do domínio são `managed=False`: o flush do pytest-django não as
# limpa entre testes. Cada teste ganha então um par de municípios só seu,
# para contagens, fila e unicidades (categoria_municipio) não vazarem.
CIDADE = OUTRA = None


@pytest.fixture(autouse=True)
def _municipios_novos():
    global CIDADE, OUTRA
    CIDADE = f'T{uuid.uuid4().hex[:10]}'
    OUTRA = f'T{uuid.uuid4().hex[:10]}'


def _usuario(papel='cidadao', municipio_id='cidade', **extra):
    if municipio_id == 'cidade':
        municipio_id = CIDADE
    uid = uuid.uuid4().hex[:8]
    user = User.objects.create_user(
        f'op-{uid}@example.com', f'Pessoa {uid} Souza', 'Test@123456',
        papel=papel, municipio_id=municipio_id, **extra,
    )
    cli = APIClient()
    cli.force_authenticate(user=user)
    return cli, user


def _defeito(municipio_id=None, idade_dias=0, prazo_dias=7, **extra):
    municipio_id = municipio_id or CIDADE
    agora = timezone.now()
    criado = agora - timedelta(days=idade_dias)
    dados = {
        'titulo': f'Chamado {uuid.uuid4().hex[:6]}', 'descricao': 'Descrição de teste',
        'latitude': LAT, 'longitude': LNG, 'categoria': 'Entulho', 'rua': 'Rua A', 'bairro': 'Centro',
        'status': 'pendente', 'municipio_id': municipio_id, 'prioridade': 'media',
        'prazo_sla_dias': prazo_dias, 'prazo_em': criado + timedelta(days=prazo_dias) if prazo_dias else None,
        'criado_em': criado, 'atualizado_em': agora,
        'categoria_id': Categoria.objects.filter(nome='Entulho').values_list('id', flat=True).first(),
        **extra,
    }
    return Defeito.objects.create(**dados)


def _foto(largura=2000, altura=1500, formato='PNG'):
    buf = io.BytesIO()
    Image.new('RGB', (largura, altura), (200, 30, 30)).save(buf, formato)
    return SimpleUploadedFile(f'foto.{formato.lower()}', buf.getvalue(), content_type=f'image/{formato.lower()}')


def _url(nome, *args):
    return reverse(f'operacao-{nome}', args=[str(a) for a in args])


def _fila(cli, **params):
    resp = cli.get(_url('fila'), params)
    assert resp.status_code == 200, resp.data
    return resp.data


class TestPermissoes:

    def test_cidadao_e_anonimo_nao_usam_a_operacao(self):
        cidadao, _ = _usuario('cidadao')
        d = _defeito()
        assert cidadao.get(_url('fila')).status_code == 403
        assert cidadao.get(_url('resumo')).status_code == 403
        assert cidadao.post(_url('transicao', d.id), {'para': 'em_analise'}, format='json').status_code == 403
        assert cidadao.post(_url('nota', d.id), {'texto': 'x'}, format='json').status_code == 403
        assert APIClient().get(_url('fila')).status_code == 401

    def test_operador_sem_municipio(self):
        op, _ = _usuario('operador', municipio_id=None)
        resp = op.get(_url('fila'))
        assert resp.status_code == 403
        assert 'município' in resp.data['detail']

    def test_fila_so_do_proprio_municipio(self):
        op, _ = _usuario('operador')
        meu = _defeito()
        alheio = _defeito(OUTRA)
        ids = {r['id'] for r in _fila(op)['results']}
        assert str(meu.id) in ids and str(alheio.id) not in ids

    def test_operador_de_outra_cidade_nao_age(self):
        op, _ = _usuario('operador', municipio_id=OUTRA)
        d = _defeito()
        for nome, corpo in (('transicao', {'para': 'em_analise'}), ('atribuir', {}), ('liberar', {}),
                            ('nota', {'texto': 'oi'}), ('resposta', {'texto': 'oi'})):
            resp = op.post(_url(nome, d.id), corpo, format='json')
            assert resp.status_code == 403, nome
        assert Defeito.objects.get(id=d.id).status == 'pendente'

    def test_operador_nao_rejeita_gestor_rejeita(self):
        op, _ = _usuario('operador')
        gestor, _ = _usuario('gestor')
        d = _defeito()
        corpo = {'para': 'rejeitado', 'motivo': 'improcedente'}
        assert op.post(_url('transicao', d.id), corpo, format='json').status_code == 403
        resp = gestor.post(_url('transicao', d.id), corpo, format='json')
        assert resp.status_code == 200, resp.data
        assert resp.data['status'] == 'rejeitado'

    def test_chamado_inexistente_ou_removido_404(self):
        op, _ = _usuario('operador')
        assert op.post(_url('nota', uuid.uuid4()), {'texto': 'x'}, format='json').status_code == 404
        d = _defeito(removido_em=timezone.now())
        assert op.post(_url('nota', d.id), {'texto': 'x'}, format='json').status_code == 404

    def test_sla_e_prioridade_so_gestor(self):
        op, _ = _usuario('operador')
        gestor_outra, _ = _usuario('gestor', municipio_id=OUTRA)
        d = _defeito()
        corpo = {'prazo_sla_dias': 3, 'motivo': 'Via de acesso a hospital'}
        assert op.post(_url('sla', d.id), corpo, format='json').status_code == 403
        assert gestor_outra.post(_url('sla', d.id), corpo, format='json').status_code == 403
        assert op.post(_url('prioridade', d.id), {'prioridade': 'urgente'}, format='json').status_code == 403


class TestAtribuicao:

    def test_operador_assume_para_si_mas_nao_para_outro(self):
        op, user = _usuario('operador')
        _, colega = _usuario('operador')
        d = _defeito()
        assert op.post(_url('atribuir', d.id), {'atendente_id': str(colega.id)}, format='json').status_code == 403
        resp = op.post(_url('atribuir', d.id), {'atendente_id': str(user.id)}, format='json')
        assert resp.status_code == 200, resp.data
        assert resp.data['atendente_id'] == str(user.id)
        assert resp.data['atendente_nome'] == user.nome
        assert Defeito.objects.get(id=d.id).atribuido_em is not None

    def test_operador_nao_toma_chamado_assumido_gestor_reatribui(self):
        op1, u1 = _usuario('operador')
        op2, u2 = _usuario('operador')
        gestor, _ = _usuario('gestor')
        d = _defeito()
        assert op1.post(_url('atribuir', d.id), {'atendente_id': str(u1.id)}, format='json').status_code == 200
        resp = op2.post(_url('atribuir', d.id), {'atendente_id': str(u2.id)}, format='json')
        assert resp.status_code == 403
        assert 'assumido' in resp.data['detail']
        resp = gestor.post(_url('atribuir', d.id), {'atendente_id': str(u2.id)}, format='json')
        assert resp.status_code == 200
        assert resp.data['atendente_id'] == str(u2.id)

    def test_gestor_atribui_equipe_do_municipio(self):
        gestor, _ = _usuario('gestor')
        equipe = Equipe.objects.create(municipio_id=CIDADE, nome=f'Tapa-buraco {uuid.uuid4().hex[:4]}')
        alheia = Equipe.objects.create(municipio_id=OUTRA, nome=f'Outra {uuid.uuid4().hex[:4]}')
        d = _defeito()
        assert gestor.post(_url('atribuir', d.id), {'equipe_id': alheia.id}, format='json').status_code == 400
        resp = gestor.post(_url('atribuir', d.id), {'equipe_id': equipe.id}, format='json')
        assert resp.status_code == 200
        assert resp.data['equipe_id'] == equipe.id and resp.data['equipe_nome'] == equipe.nome

    def test_liberar(self):
        op1, u1 = _usuario('operador')
        op2, _ = _usuario('operador')
        gestor, _ = _usuario('gestor')
        d = _defeito(atendente=u1)
        assert op2.post(_url('liberar', d.id)).status_code == 403
        resp = op1.post(_url('liberar', d.id), {'motivo': 'Falta material'}, format='json')
        assert resp.status_code == 200
        assert resp.data['atendente_id'] is None
        evento = DefeitoEvento.objects.filter(defeito_id=d.id, tipo='atribuido').last()
        assert evento.dados['liberado'] is True and not evento.publico
        # Gestor libera o de qualquer um; sem atendente é no-op.
        Defeito.objects.filter(id=d.id).update(atendente=u1)
        assert gestor.post(_url('liberar', d.id)).status_code == 200
        assert gestor.post(_url('liberar', d.id)).status_code == 200


class TestFila:

    def test_score_prioriza_vencido_urgente_apoiado(self):
        op, _ = _usuario('operador')
        novo_baixa = _defeito(prioridade='baixa')
        vencido_urgente = _defeito(prioridade='urgente', idade_dias=10, prazo_dias=2)
        apoiado = _defeito(prioridade='media')
        for _ in range(5):
            _, cidadao = _usuario()
            Apoio.objects.create(usuario=cidadao, defeito=apoiado, criado_em=timezone.now())
        linhas = _fila(op)['results']
        ordem = [r['id'] for r in linhas]
        assert ordem.index(str(vencido_urgente.id)) < ordem.index(str(apoiado.id)) < ordem.index(str(novo_baixa.id))
        por_id = {r['id']: r for r in linhas}
        topo = por_id[str(vencido_urgente.id)]
        # 30 (urgente) + 30 (vencido) + 10 * 10/60 (idade) = 61,7
        assert topo['score'] == pytest.approx(61.7, abs=0.2)
        assert topo['sla_vencido'] is True and topo['sla_restante_horas'] < 0
        assert topo['score_motivos'][0].startswith('Prazo vencido')
        assert por_id[str(apoiado.id)]['total_apoios'] == 5
        assert 0 <= por_id[str(novo_baixa.id)]['score'] <= 100

    def test_sinalizacao_aumenta_score(self):
        op, _ = _usuario('operador')
        a = _defeito()
        b = _defeito()
        _, cidadao = _usuario()
        Sinalizacao.objects.create(usuario=cidadao, defeito=b, tipo='resolvido', criado_em=timezone.now())
        por_id = {r['id']: r for r in _fila(op)['results']}
        assert por_id[str(b.id)]['score'] > por_id[str(a.id)]['score']
        assert por_id[str(b.id)]['total_resolvido'] == 1

    def test_padrao_so_abertos_e_filtro_de_status(self):
        op, _ = _usuario('operador')
        aberto = _defeito()
        fechado = _defeito(status='concluido', resolvido_em=timezone.now())
        ids = {r['id'] for r in _fila(op)['results']}
        assert str(aberto.id) in ids and str(fechado.id) not in ids
        ids = {r['id'] for r in _fila(op, status='concluido')['results']}
        assert ids == {str(fechado.id)}
        assert op.get(_url('fila'), {'status': 'xyz'}).status_code == 400

    def test_filtros(self):
        op, user = _usuario('operador', equipe_id=None)
        equipe = Equipe.objects.create(municipio_id=CIDADE, nome=f'Equipe {uuid.uuid4().hex[:4]}')
        meu = _defeito(atendente=user)
        da_equipe = _defeito(equipe=equipe, bairro='Vila Nova')
        vencido = _defeito(idade_dias=5, prazo_dias=1)
        sem = _defeito()

        def ids(**p):
            return {r['id'] for r in _fila(op, **p)['results']}

        assert ids(atribuicao='meus') == {str(meu.id)}
        assert str(sem.id) in ids(atribuicao='sem') and str(meu.id) not in ids(atribuicao='sem')
        assert ids(atribuicao='equipe') == set()  # sem equipe cadastrada: nada
        user.equipe_id = equipe.id
        user.save(update_fields=['equipe_id'])
        assert ids(atribuicao='equipe') == {str(da_equipe.id)}
        assert ids(equipe_id=equipe.id) == {str(da_equipe.id)}
        assert ids(vencidos=1) == {str(vencido.id)}
        assert ids(bairro='vila nova') == {str(da_equipe.id)}
        assert ids(q=meu.protocolo) == {str(meu.id)}
        assert op.get(_url('fila'), {'atribuicao': 'x'}).status_code == 400
        assert op.get(_url('fila'), {'categoria_id': 'abc'}).status_code == 400

    def test_ordenacoes_e_distancia(self):
        op, _ = _usuario('operador')
        perto = _defeito(latitude=LAT, longitude=LNG)
        longe = _defeito(latitude=LAT + 0.05, longitude=LNG, idade_dias=3)
        dados = _fila(op, ordenar='distancia', lat=LAT, lng=LNG)['results']
        assert [r['id'] for r in dados] == [str(perto.id), str(longe.id)]
        assert dados[0]['distancia_m'] < 5
        assert 5000 < dados[1]['distancia_m'] < 6000
        assert [r['id'] for r in _fila(op, ordenar='antigos')['results']] == [str(longe.id), str(perto.id)]
        assert op.get(_url('fila'), {'ordenar': 'distancia'}).status_code == 400
        assert op.get(_url('fila'), {'ordenar': 'nada'}).status_code == 400

    def test_paginacao_sem_teto(self):
        op, _ = _usuario('operador')
        for _ in range(25):
            _defeito()
        pagina = _fila(op)
        assert pagina['count'] == 25 and len(pagina['results']) == 20 and pagina['next']
        assert len(_fila(op, page=2)['results']) == 5
        assert len(_fila(op, page_size=100)['results']) == 25

    def test_checklist_da_categoria_e_campos(self):
        op, _ = _usuario('operador')
        categoria = Categoria.objects.get(nome='Entulho')
        CategoriaMunicipio.objects.create(
            municipio_id=CIDADE, categoria=categoria, checklist=['Sinalizar a via', 'Recolher material'],
        )
        d = _defeito()
        linha = _fila(op)['results'][0]
        assert linha['id'] == str(d.id)
        assert linha['checklist'] == ['Sinalizar a via', 'Recolher material']
        for campo in ('protocolo', 'score', 'prazo_em', 'sla_restante_horas', 'sla_vencido', 'distancia_m',
                      'atendente_id', 'atendente_nome', 'equipe_id', 'equipe_nome', 'total_apoios',
                      'total_resolvido', 'total_nao_existe'):
            assert campo in linha, campo

    def test_resumo(self):
        op, user = _usuario('operador')
        _defeito(atendente=user)
        _defeito(idade_dias=5, prazo_dias=1)
        _defeito(idade_dias=0, prazo_dias=1)  # vence em < 24 h
        sinalizado = _defeito()
        _, cidadao = _usuario()
        Sinalizacao.objects.create(usuario=cidadao, defeito=sinalizado, tipo='nao_existe', criado_em=timezone.now())
        _defeito(status='concluido', resolvido_em=timezone.now())
        _defeito(OUTRA)
        resp = op.get(_url('resumo'))
        assert resp.status_code == 200
        assert resp.data == {
            'abertos': 4, 'meus': 1, 'vencidos': 1, 'vencem_24h': 1,
            'sem_atribuicao': 3, 'sinalizados': 1, 'concluidos_hoje': 1,
        }


class TestTransicaoEEvidencia:

    def test_concluir_exige_foto_por_padrao(self):
        op, _ = _usuario('operador')
        d = _defeito(status='em_andamento')
        resp = op.post(_url('transicao', d.id), {'para': 'concluido'}, format='json')
        assert resp.status_code == 400
        assert 'foto' in resp.data['detail']
        assert Defeito.objects.get(id=d.id).status == 'em_andamento'

    def test_concluir_com_foto_checklist_e_resposta(self):
        op, user = _usuario('operador')
        _, autor = _usuario()
        d = _defeito(status='em_andamento', usuario=autor)
        resp = op.post(_url('transicao', d.id), {
            'para': 'concluido', 'foto': _foto(), 'latitude': LAT, 'longitude': LNG,
            'resposta_publica': 'Entulho recolhido.',
            'checklist': '["Sinalizar a via", {"item": "Varrer", "feito": false}]',
        }, format='multipart')
        assert resp.status_code == 200, resp.data
        assert resp.data['status'] == 'concluido'
        assert resp.data['resposta_publica'] == 'Entulho recolhido.'

        anexo = DefeitoAnexo.objects.get(defeito_id=d.id)
        assert anexo.tipo == 'depois' and anexo.autor_id == user.id
        img = Image.open(io.BytesIO(bytes(anexo.imagem)))
        assert img.format == 'JPEG' and max(img.size) == 1280
        evento = DefeitoEvento.objects.get(defeito_id=d.id, tipo='status')
        assert evento.dados['checklist'] == [
            {'item': 'Sinalizar a via', 'feito': True}, {'item': 'Varrer', 'feito': False},
        ]
        assert evento.dados['anexo_id'] == anexo.id
        assert DefeitoEvento.objects.get(defeito_id=d.id, tipo='anexo').dados['distancia_m'] == 0
        assert Defeito.objects.get(id=d.id).foto_resolucao
        assert Notificacao.objects.filter(usuario=autor, defeito_id=d.id).exists()

    def test_evidencia_antes_libera_conclusao_sem_foto_no_ato(self):
        op, _ = _usuario('operador')
        d = _defeito(status='em_andamento')
        resp = op.post(_url('evidencia', d.id), {
            'tipo': 'depois', 'foto': _foto(800, 600, 'JPEG'),
            'latitude': LAT + 0.01, 'longitude': LNG,  # ~1,1 km do ponto
        }, format='multipart')
        assert resp.status_code == 201, resp.data
        assert resp.data['tipo'] == 'depois' and resp.data['url'].endswith(f'/anexos/{resp.data["id"]}/imagem/')
        evento = DefeitoEvento.objects.get(defeito_id=d.id, tipo='anexo')
        assert evento.dados['fora_do_local'] is True
        resp = op.post(_url('transicao', d.id), {'para': 'concluido'}, format='json')
        assert resp.status_code == 200, resp.data

    def test_municipio_que_nao_exige_foto(self):
        op, _ = _usuario('operador')
        MunicipioConfig.objects.create(municipio_id=CIDADE, parametros={'exigir_foto_conclusao': False})
        d = _defeito(status='em_andamento')
        resp = op.post(_url('transicao', d.id), {'para': 'concluido'}, format='json')
        assert resp.status_code == 200, resp.data

    def test_transicao_invalida_e_foto_invalida(self):
        op, _ = _usuario('operador')
        d = _defeito(status='concluido')
        resp = op.post(_url('transicao', d.id), {'para': 'em_andamento'}, format='json')
        assert resp.status_code == 400 and 'Não é possível' in resp.data['detail']
        d2 = _defeito()
        lixo = SimpleUploadedFile('x.jpg', b'nao e imagem', content_type='image/jpeg')
        resp = op.post(_url('evidencia', d2.id), {'tipo': 'antes', 'foto': lixo}, format='multipart')
        assert resp.status_code == 400
        resp = op.post(_url('evidencia', d2.id), {'tipo': 'durante', 'foto': _foto(10, 10)}, format='multipart')
        assert resp.status_code == 400

    def test_anexos_publicos_e_imagem(self):
        op, _ = _usuario('operador')
        d = _defeito()
        op.post(_url('evidencia', d.id), {'tipo': 'antes', 'foto': _foto(300, 200)}, format='multipart')
        anon = APIClient()
        resp = anon.get(_url('anexos', d.id))
        assert resp.status_code == 200
        assert resp.data[0]['autor_nome'] == 'Prefeitura'
        img = anon.get(_url('anexo-imagem', resp.data[0]['id']))
        assert img.status_code == 200 and img['Content-Type'] == 'image/jpeg'

        restrito = _defeito(visibilidade='restrita')
        anexo = DefeitoAnexo.objects.create(defeito=restrito, tipo='cidadao', imagem=b'\xff\xd8xx')
        assert anon.get(_url('anexos', restrito.id)).status_code == 404
        assert anon.get(_url('anexo-imagem', anexo.id)).status_code == 404
        assert op.get(_url('anexo-imagem', anexo.id)).status_code == 200


class TestComunicacao:

    def test_nota_interna_so_para_equipe(self):
        op, _ = _usuario('operador')
        d = _defeito()
        resp = op.post(_url('nota', d.id), {'texto': 'Precisa de caminhão'}, format='json')
        assert resp.status_code == 201
        assert resp.data['publico'] is False and resp.data['tipo'] == 'nota_interna'
        publico = APIClient().get(reverse('defeitos-eventos', args=[d.id])).data
        assert all(e['tipo'] != 'nota_interna' for e in publico)
        assert op.post(_url('nota', d.id), {'texto': '  '}, format='json').status_code == 400

    def test_resposta_publica_notifica_autor(self):
        op, _ = _usuario('operador')
        _, autor = _usuario()
        d = _defeito(usuario=autor)
        resp = op.post(_url('resposta', d.id), {'texto': 'Equipe agendada para quinta.'}, format='json')
        assert resp.status_code == 201
        assert Defeito.objects.get(id=d.id).resposta_publica == 'Equipe agendada para quinta.'
        assert Notificacao.objects.filter(usuario=autor, tipo='resposta').exists()


class TestGestao:

    def test_sla_recalcula_prazo_e_registra(self):
        gestor, _ = _usuario('gestor')
        d = _defeito(prazo_dias=15)
        resp = gestor.post(_url('sla', d.id), {'prazo_sla_dias': 2, 'motivo': 'Risco a pedestres'}, format='json')
        assert resp.status_code == 200, resp.data
        obj = Defeito.objects.get(id=d.id)
        assert obj.prazo_sla_dias == 2 and obj.prazo_em == obj.criado_em + timedelta(days=2)
        evento = DefeitoEvento.objects.get(defeito_id=d.id, tipo='sla')
        assert evento.dados['de'] == 15 and evento.dados['para'] == 2 and not evento.publico
        from gestao.models import AuditLog
        assert AuditLog.objects.filter(acao='defeito.sla', alvo_id=str(d.id)).exists()
        assert gestor.post(_url('sla', d.id), {'prazo_sla_dias': 2}, format='json').status_code == 400
        assert gestor.post(_url('sla', d.id), {'prazo_sla_dias': 0, 'motivo': 'abc'}, format='json').status_code == 400

    def test_prioridade(self):
        gestor, _ = _usuario('gestor')
        d = _defeito()
        resp = gestor.post(_url('prioridade', d.id), {'prioridade': 'urgente'}, format='json')
        assert resp.status_code == 200 and resp.data['prioridade'] == 'urgente'
        assert DefeitoEvento.objects.filter(defeito_id=d.id, tipo='prioridade').count() == 1
        assert gestor.post(_url('prioridade', d.id), {'prioridade': 'altissima'}, format='json').status_code == 400


class TestLote:

    def test_transicao_em_lote_com_erros_por_item(self):
        op, _ = _usuario('operador')
        a, b = _defeito(), _defeito()
        fechado = _defeito(status='rejeitado')
        alheio = _defeito(OUTRA)
        ids = [str(a.id), str(b.id), str(fechado.id), str(alheio.id), 'nao-e-uuid', str(a.id)]
        resp = op.post(_url('lote'), {'ids': ids, 'acao': 'transicao', 'para': 'em_analise'}, format='json')
        assert resp.status_code == 200
        assert sorted(resp.data['ok']) == sorted([str(a.id), str(b.id)])
        erros = {e['id']: e['detail'] for e in resp.data['erros']}
        assert set(erros) == {str(fechado.id), str(alheio.id), 'nao-e-uuid'}
        assert 'município' in erros[str(alheio.id)]
        assert Defeito.objects.get(id=a.id).status == 'em_analise'
        assert Defeito.objects.get(id=alheio.id).status == 'pendente'

    def test_concluir_em_lote_respeita_foto(self):
        op, _ = _usuario('operador')
        d = _defeito(status='em_andamento')
        resp = op.post(_url('lote'), {'ids': [str(d.id)], 'acao': 'transicao', 'para': 'concluido'}, format='json')
        assert resp.data['ok'] == [] and 'foto' in resp.data['erros'][0]['detail']

    def test_atribuir_em_lote(self):
        op, user = _usuario('operador')
        _, outro = _usuario('operador')
        a = _defeito()
        tomado = _defeito(atendente=outro)
        resp = op.post(_url('lote'), {
            'ids': [str(a.id), str(tomado.id)], 'acao': 'atribuir', 'atendente_id': str(user.id),
        }, format='json')
        assert resp.data['ok'] == [str(a.id)]
        assert resp.data['erros'][0]['id'] == str(tomado.id)

    def test_validacao_do_lote(self):
        op, _ = _usuario('operador')
        assert op.post(_url('lote'), {'ids': [], 'acao': 'transicao'}, format='json').status_code == 400
        assert op.post(_url('lote'), {'ids': ['x'], 'acao': 'apagar'}, format='json').status_code == 400
        muitos = [str(uuid.uuid4()) for _ in range(101)]
        assert op.post(_url('lote'), {'ids': muitos, 'acao': 'transicao'}, format='json').status_code == 400
        cidadao, _ = _usuario()
        assert cidadao.post(_url('lote'), {'ids': ['x'], 'acao': 'transicao'}, format='json').status_code == 403


class TestRespostasPadrao:

    def test_crud_por_papel_e_municipio(self):
        op, _ = _usuario('operador')
        gestor, _ = _usuario('gestor')
        gestor_outra, _ = _usuario('gestor', municipio_id=OUTRA)
        corpo = {'titulo': 'Agendado', 'texto': 'Serviço agendado para esta semana.'}
        assert op.post(_url('respostas-padrao'), corpo, format='json').status_code == 403
        resp = gestor.post(_url('respostas-padrao'), corpo, format='json')
        assert resp.status_code == 201, resp.data
        rid = resp.data['id']
        assert RespostaPadrao.objects.get(id=rid).municipio_id == CIDADE

        lista = op.get(_url('respostas-padrao')).data
        assert [r['id'] for r in lista] == [rid]
        assert gestor_outra.get(_url('respostas-padrao')).data == []
        assert gestor_outra.patch(_url('resposta-padrao', rid), {'titulo': 'x'}, format='json').status_code == 404
        assert op.patch(_url('resposta-padrao', rid), {'titulo': 'x'}, format='json').status_code == 403

        resp = gestor.patch(_url('resposta-padrao', rid), {'titulo': 'Programado'}, format='json')
        assert resp.status_code == 200 and resp.data['titulo'] == 'Programado'
        assert gestor.delete(_url('resposta-padrao', rid)).status_code == 204
        assert not RespostaPadrao.objects.filter(id=rid).exists()

    def test_filtro_por_categoria(self):
        gestor, _ = _usuario('gestor')
        entulho = Categoria.objects.get(nome='Entulho')
        outra = Categoria.objects.exclude(id=entulho.id).first()
        geral = RespostaPadrao.objects.create(municipio_id=CIDADE, titulo='Geral', texto='t')
        da_cat = RespostaPadrao.objects.create(municipio_id=CIDADE, titulo='Entulho', texto='t', categoria_id=entulho.id)
        RespostaPadrao.objects.create(municipio_id=CIDADE, titulo='Outra', texto='t', categoria_id=outra.id)
        ids = {r['id'] for r in gestor.get(_url('respostas-padrao'), {'categoria_id': entulho.id}).data}
        assert ids == {geral.id, da_cat.id}


class TestEquipes:

    def test_lista_com_membros(self):
        op, _ = _usuario('operador')
        secretaria = Secretaria.objects.create(municipio_id=CIDADE, nome=f'Obras {uuid.uuid4().hex[:4]}')
        equipe = Equipe.objects.create(municipio_id=CIDADE, nome=f'Asfalto {uuid.uuid4().hex[:4]}',
                                       secretaria=secretaria)
        Equipe.objects.create(municipio_id=OUTRA, nome=f'Alheia {uuid.uuid4().hex[:4]}')
        _, membro = _usuario('operador', equipe_id=equipe.id)
        _usuario('cidadao', equipe_id=equipe.id)  # cidadão não é membro
        resp = op.get(_url('equipes'))
        assert resp.status_code == 200
        assert len(resp.data) == 1
        linha = resp.data[0]
        assert linha['nome'] == equipe.nome and linha['secretaria_nome'] == secretaria.nome
        assert linha['membros'] == [{'id': str(membro.id), 'nome': membro.nome, 'papel': 'operador'}]


class TestOrdemDeServico:

    def test_escapa_texto_e_mostra_protocolo_e_checklist(self, monkeypatch):
        from services import ordem_servico

        capturado = {}

        def falso_pdf(html, dest, encoding, link_callback):
            capturado['html'] = html
            capturado['callback'] = link_callback
            dest.write(b'%PDF-falso')

        monkeypatch.setattr(ordem_servico.pisa, 'CreatePDF', falso_pdf)
        categoria = Categoria.objects.get(nome='Entulho')
        CategoriaMunicipio.objects.create(municipio_id=CIDADE, categoria=categoria, checklist=['Isolar <área>'])
        d = _defeito(titulo='<img src="http://interno/x">', descricao='a & b\nlinha 2')
        op, _ = _usuario('operador')
        resp = op.get(_url('ordem-servico', d.id))
        assert resp.status_code == 200 and resp['Content-Type'] == 'application/pdf'
        html = capturado['html']
        assert '<img src="http://interno' not in html
        assert '&lt;img src=&quot;http://interno/x&quot;&gt;' in html
        assert 'a &amp; b<br/>linha 2' in html
        assert d.protocolo in html
        assert 'Isolar &lt;área&gt;' in html
        assert capturado['callback']('http://interno/x', None) == ''
        assert capturado['callback']('data:image/png;base64,AAA', None).startswith('data:')

    def test_pdf_real_gera(self):
        from services.ordem_servico import gerar_ordem_servico

        d = _defeito(titulo='Buraco <b>grande</b> & fundo')
        assert gerar_ordem_servico(d).startswith(b'%PDF')
