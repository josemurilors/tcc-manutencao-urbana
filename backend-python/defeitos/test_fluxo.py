"""
Fundação v3: ciclo de vida (`fluxo`), papéis (`core.permissoes`), SLA por
categoria (`sla`), protocolo, soft delete, histórico e o que cada um enxerga
do chamado.
"""
import re
import uuid
from datetime import timedelta

import pytest
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from defeitos import fluxo, sla
from defeitos.models import Defeito, DefeitoEvento
from defeitos.tests import _COORD_COUNTER, com_foto
from users.models import User

pytestmark = pytest.mark.django_db(transaction=True)

# Duas cidades de teste longe de todas as outras da suíte.
CIDADE = '9999920'
OUTRA_CIDADE = '9999921'


def _cidades():
    from django.db import connection
    with connection.cursor() as cur:
        for codigo, nome, (la0, la1, lo0, lo1) in (
            (CIDADE, 'Cidade Fluxo', (-31.0, -29.0, -60.0, -58.0)),
            (OUTRA_CIDADE, 'Outra Cidade', (-33.0, -32.0, -62.0, -61.0)),
        ):
            cur.execute(f"""
                INSERT INTO municipios (codigo, nome, uf, uf_sigla, min_lat, max_lat, min_lng, max_lng, polygon_geom)
                VALUES (%s, %s, '43', 'RS', {la0}, {la1}, {lo0}, {lo1},
                        ST_Multi(ST_GeomFromText('POLYGON(({lo0} {la0}, {lo1} {la0}, {lo1} {la1}, {lo0} {la1}, {lo0} {la0}))', 4326)))
                ON CONFLICT (codigo) DO NOTHING
            """, [codigo, nome])


def _usuario(papel='cidadao', municipio_id=None, nome=None):
    """(APIClient autenticado, User) com o papel/município pedidos."""
    uid = uuid.uuid4().hex[:8]
    cli = APIClient()
    resp = cli.post(reverse('auth-register'), {
        'email': f'fluxo-{uid}@example.com', 'nome': nome or f'Maria Silva {uid}',
        'password': 'Test@123456', 'confirm_password': 'Test@123456',
    }, format='json')
    assert resp.status_code == 201
    cli.credentials(HTTP_AUTHORIZATION=f"Bearer {resp.data['access']}")
    user = User.objects.get(id=resp.data['user']['id'])
    user.papel = papel
    user.municipio_id = municipio_id
    user.save(update_fields=['papel', 'municipio_id'])
    return cli, user


def _chamado(cli, cidade=CIDADE, **extra):
    _cidades()
    i = next(_COORD_COUNTER)
    lat, lng = (-30.0, -59.0) if cidade == CIDADE else (-32.5, -61.5)
    dados = {
        'titulo': f'Fluxo {i}', 'descricao': f'teste de fluxo {i}', 'categoria': 'Entulho',
        'rua': 'Rua A', 'bairro': 'Centro',
        'latitude': lat + (i % 400) * 0.002, 'longitude': lng + (i // 400) * 0.002,
        **extra,
    }
    resp = cli.post(reverse('defeitos-list'), com_foto(dados), format='multipart')
    assert resp.status_code == 201, resp.data
    return resp.data


def _status(cli, defeito_id, **dados):
    """
    PATCH status/. Concluir exige a foto do serviço (`exigir_foto_conclusao`,
    ligado por padrão): sem `foto_resolucao` explícita, vai uma foto junto.
    `foto_resolucao=None` manda sem foto.
    """
    url = reverse('defeitos-status', args=[defeito_id])
    if dados.get('status') == 'concluido' and 'foto_resolucao' not in dados:
        dados = com_foto(dados)
        dados['foto_resolucao'] = dados.pop('imagem')
        return cli.patch(url, dados, format='multipart')
    if dados.get('foto_resolucao', 0) is None:
        dados.pop('foto_resolucao')
    return cli.patch(url, dados, format='json')


class TestTransicoes:

    def test_caminho_feliz_grava_timestamps_e_eventos(self):
        cidadao, _ = _usuario()
        op, _ = _usuario('operador', CIDADE)
        d = _chamado(cidadao)
        assert d['status'] == 'pendente'

        assert _status(op, d['id'], status='em_analise').status_code == 200
        obj = Defeito.objects.get(id=d['id'])
        assert obj.triado_em and not obj.iniciado_em

        assert _status(op, d['id'], status='em_andamento').status_code == 200
        obj.refresh_from_db()
        assert obj.iniciado_em and not obj.fechado_em

        resp = _status(op, d['id'], status='concluido', resposta_publica='Entulho recolhido.')
        assert resp.status_code == 200
        assert resp.data['status_rotulo'] == 'Resolvido'
        assert resp.data['resposta_publica'] == 'Entulho recolhido.'
        obj.refresh_from_db()
        assert obj.resolvido_em and obj.fechado_em

        tipos = list(DefeitoEvento.objects.filter(defeito_id=d['id']).values_list('tipo', 'para_status'))
        assert tipos == [
            ('criado', 'pendente'), ('status', 'em_analise'),
            ('status', 'em_andamento'), ('status', 'concluido'), ('anexo', None),
        ]

    @pytest.mark.parametrize('de,para', [
        ('concluido', 'em_andamento'),
        ('em_andamento', 'em_analise'),
        ('pendente', 'pendente'),
    ])
    def test_transicoes_invalidas(self, de, para):
        cidadao, _ = _usuario()
        gestor, _ = _usuario('gestor', CIDADE)
        d = _chamado(cidadao)
        Defeito.objects.filter(id=d['id']).update(status=de)
        resp = _status(gestor, d['id'], status=para)
        assert resp.status_code == 400
        assert Defeito.objects.get(id=d['id']).status == de

    def test_status_desconhecido(self):
        gestor, _ = _usuario('gestor', CIDADE)
        d = _chamado(_usuario()[0])
        assert _status(gestor, d['id'], status='arquivado').status_code == 400

    def test_rejeitar_exige_motivo_e_gestor(self):
        cidadao, _ = _usuario()
        op, _ = _usuario('operador', CIDADE)
        gestor, _ = _usuario('gestor', CIDADE)
        d = _chamado(cidadao)
        assert _status(op, d['id'], status='rejeitado', motivo='improcedente').status_code == 403
        assert _status(gestor, d['id'], status='rejeitado').status_code == 400
        resp = _status(gestor, d['id'], status='rejeitado', motivo='improcedente')
        assert resp.status_code == 200
        assert resp.data['motivo_rejeicao'] == 'improcedente'
        assert resp.data['status_rotulo'] == 'Não procede'

    def test_duplicado_exige_original_do_mesmo_municipio(self):
        cidadao, _ = _usuario()
        gestor, _ = _usuario('gestor', CIDADE)
        original = _chamado(cidadao)
        de_fora = _chamado(cidadao, cidade=OUTRA_CIDADE)
        d = _chamado(cidadao)
        assert _status(gestor, d['id'], status='rejeitado', motivo='duplicado').status_code == 400
        assert _status(
            gestor, d['id'], status='rejeitado', motivo='duplicado', duplicado_de=de_fora['id'],
        ).status_code == 400
        resp = _status(gestor, d['id'], status='rejeitado', motivo='duplicado', duplicado_de=original['id'])
        assert resp.status_code == 200
        assert resp.data['duplicado_de'] == original['id']

    def test_reabertura_pela_gestao(self):
        cidadao, _ = _usuario()
        op, _ = _usuario('operador', CIDADE)
        gestor, _ = _usuario('gestor', CIDADE)
        d = _chamado(cidadao)
        assert _status(op, d['id'], status='concluido').status_code == 200
        # Operador não reabre; gestor sim.
        assert _status(op, d['id'], status='pendente').status_code == 403
        resp = _status(gestor, d['id'], status='pendente')
        assert resp.status_code == 200
        obj = Defeito.objects.get(id=d['id'])
        assert obj.fechado_em is None and obj.reaberturas == 1
        assert DefeitoEvento.objects.filter(defeito_id=d['id'], tipo='reaberto').exists()

    def test_autor_reabre_ate_30_dias(self):
        cidadao, autor = _usuario()
        op, _ = _usuario('operador', CIDADE)
        d = _chamado(cidadao)
        _status(op, d['id'], status='concluido')
        obj = Defeito.objects.get(id=d['id'])
        fluxo.transicionar(obj, 'pendente', autor)
        assert Defeito.objects.get(id=d['id']).status == 'pendente'

        _status(op, d['id'], status='concluido')
        Defeito.objects.filter(id=d['id']).update(fechado_em=timezone.now() - timedelta(days=31))
        with pytest.raises(fluxo.TransicaoNaoPermitida):
            fluxo.transicionar(Defeito.objects.get(id=d['id']), 'pendente', autor)

    def test_comunidade_so_conclui(self):
        cidadao, autor = _usuario()
        d = Defeito.objects.get(id=_chamado(cidadao)['id'])
        with pytest.raises(fluxo.TransicaoNaoPermitida):
            fluxo.transicionar(d, 'rejeitado', autor, papel='comunidade', motivo='outro')
        fluxo.transicionar(d, 'concluido', autor, papel='comunidade')
        evento = DefeitoEvento.objects.filter(defeito=d, tipo='status').last()
        assert evento.papel == 'comunidade'

    def test_mudanca_de_status_notifica_autor_e_apoiadores(self):
        from notificacoes.models import Notificacao
        cidadao, autor = _usuario()
        apoiador_cli, apoiador = _usuario()
        op, operador = _usuario('operador', CIDADE)
        d = _chamado(cidadao)
        apoiador_cli.post(reverse('defeitos-apoiar', args=[d['id']]), format='json')
        _status(op, d['id'], status='agendado')
        avisados = set(Notificacao.objects.filter(defeito_id=d['id']).values_list('usuario_id', flat=True))
        assert avisados == {autor.id, apoiador.id}
        assert operador.id not in avisados


class TestPermissoes:

    def test_cidadao_nao_altera_nem_apaga_chamado_alheio(self):
        autor, _ = _usuario()
        intruso, _ = _usuario()
        d = _chamado(autor)
        url = reverse('defeitos-detail', args=[d['id']])
        assert intruso.patch(url, {'descricao': 'hack'}, format='json').status_code == 403
        assert intruso.patch(url, {'status': 'concluido'}, format='json').status_code == 403
        assert intruso.delete(url).status_code == 403
        assert _status(intruso, d['id'], status='concluido').status_code == 403
        obj = Defeito.objects.get(id=d['id'])
        assert obj.status == 'pendente' and obj.removido_em is None

    def test_cidadao_nao_anexa_em_chamado_alheio(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        from defeitos.tests import _PNG_1X1
        autor, _ = _usuario()
        intruso, _ = _usuario()
        d = _chamado(autor)
        url = reverse('defeitos-anexar', args=[d['id']])
        arquivo = lambda: SimpleUploadedFile('f.png', _PNG_1X1, content_type='image/png')  # noqa: E731
        assert intruso.post(url, {'file': arquivo()}, format='multipart').status_code == 403
        assert autor.post(url, {'file': arquivo()}, format='multipart').status_code == 200

    def test_campos_protegidos_nao_mudam_por_patch(self):
        autor, _ = _usuario()
        d = _chamado(autor)
        url = reverse('defeitos-detail', args=[d['id']])
        for campo, valor in (
            ('municipio_id', OUTRA_CIDADE), ('prazo_sla_dias', 99), ('prioridade', 'urgente'),
            ('atendente', str(uuid.uuid4())), ('visibilidade', 'publica'),
        ):
            assert autor.patch(url, {campo: valor}, format='json').status_code == 400, campo

    def test_autor_nao_edita_nem_apaga_depois_da_triagem(self):
        autor, _ = _usuario()
        op, _ = _usuario('operador', CIDADE)
        d = _chamado(autor)
        _status(op, d['id'], status='em_analise')
        url = reverse('defeitos-detail', args=[d['id']])
        assert autor.patch(url, {'descricao': 'nova'}, format='json').status_code == 403
        assert autor.delete(url).status_code == 403

    def test_equipe_edita_dados_de_triagem(self):
        from gestao.models import AuditLog
        op, _ = _usuario('operador', CIDADE)
        gestor, _ = _usuario('gestor', CIDADE)
        d = _chamado(_usuario()[0])
        url = reverse('defeitos-detail', args=[d['id']])
        assert op.patch(url, {'bairro': 'Centro Novo'}, format='json').status_code == 200
        # Prioridade só gestor+ (e auditada), como em operacao/<id>/prioridade/.
        assert op.patch(url, {'prioridade': 'urgente'}, format='json').status_code == 403
        assert Defeito.objects.get(id=d['id']).prioridade != 'urgente'
        resp = gestor.patch(url, {'prioridade': 'urgente'}, format='json')
        assert resp.status_code == 200
        assert resp.data['prioridade'] == 'urgente'
        assert DefeitoEvento.objects.filter(defeito_id=d['id'], tipo='prioridade', publico=False).exists()
        assert AuditLog.objects.filter(acao='defeito.prioridade', alvo_id=str(d['id'])).exists()

    def test_operador_de_outro_municipio_bloqueado(self):
        d = _chamado(_usuario()[0])
        de_fora, _ = _usuario('admin_municipal', OUTRA_CIDADE)
        url = reverse('defeitos-detail', args=[d['id']])
        assert _status(de_fora, d['id'], status='em_analise').status_code == 403
        assert de_fora.patch(reverse('defeitos-atender', args=[d['id']])).status_code == 403
        assert de_fora.patch(url, {'prioridade': 'alta'}, format='json').status_code == 403
        assert de_fora.delete(url).status_code == 403
        assert Defeito.objects.get(id=d['id']).status == 'pendente'

    def test_papeis(self):
        from core import permissoes
        _, op = _usuario('operador', CIDADE)
        _, gestor = _usuario('gestor', CIDADE)
        _, adm = _usuario('admin_municipal', CIDADE)
        _, sup = _usuario('super_admin', OUTRA_CIDADE)
        _, cidadao = _usuario('cidadao', CIDADE)
        assert [permissoes.nivel(u) for u in (cidadao, op, gestor, adm, sup)] == [0, 1, 2, 3, 4]
        assert permissoes.pode_operar(op, CIDADE) and not permissoes.pode_operar(op, OUTRA_CIDADE)
        assert not permissoes.pode_operar(cidadao, CIDADE)
        assert not permissoes.pode_gerir(op, CIDADE) and permissoes.pode_gerir(gestor, CIDADE)
        assert not permissoes.pode_administrar(gestor, CIDADE) and permissoes.pode_administrar(adm, CIDADE)
        # Super admin gere qualquer cidade, mas só opera na sua.
        assert permissoes.pode_gerir(sup, CIDADE) and permissoes.pode_administrar(sup, CIDADE)
        assert not permissoes.pode_operar(sup, CIDADE) and permissoes.pode_operar(sup, OUTRA_CIDADE)
        # `admin` (legado) espelha o papel.
        assert (cidadao.admin, op.admin, adm.admin) == (0, 1, 1)
        # Django Admin só para o super admin.
        assert not adm.is_staff and sup.is_staff


class TestPrivacidade:

    def test_detalhe_anonimo_sem_pii(self):
        cli, autor = _usuario(nome='Maria Silva Souza')
        op, _ = _usuario('operador', CIDADE)
        d = _chamado(cli)
        op.patch(reverse('defeitos-atender', args=[d['id']]))

        anonimo = APIClient().get(reverse('defeitos-detail', args=[d['id']])).data
        for campo in ('usuario', 'usuario_email', 'atendente'):
            assert campo not in anonimo
        assert autor.email not in str(anonimo)
        assert str(autor.id) not in str(anonimo)
        assert anonimo['atendente_id'] is None and anonimo['tem_atendente'] is True
        assert anonimo['autor_nome'] == 'Maria S.'

        lista = APIClient().get(reverse('defeitos-list'), {'search': d['titulo']}).data['results']
        item = next(x for x in lista if x['id'] == d['id'])
        assert item['autor_nome'] == 'Maria S.'
        assert autor.email not in str(item)

        # A equipe do município vê o nome completo e quem atende.
        da_equipe = op.get(reverse('defeitos-detail', args=[d['id']])).data
        assert da_equipe['autor_nome'] == 'Maria Silva Souza'
        assert da_equipe['atendente_id']

    def test_eventos_internos_so_para_equipe(self):
        cli, _ = _usuario()
        op, _ = _usuario('operador', CIDADE)
        d = _chamado(cli)
        op.patch(reverse('defeitos-atender', args=[d['id']]))  # 'atribuido' é interno
        url = reverse('defeitos-eventos', args=[d['id']])

        publicos = APIClient().get(url).data
        assert [e['tipo'] for e in publicos] == ['criado', 'status']
        assert all(e['publico'] for e in publicos)
        assert publicos[1]['autor_nome'] == 'Prefeitura'
        assert publicos[1]['para_status_rotulo'] == 'Em execução'

        da_equipe = op.get(url).data
        assert 'atribuido' in [e['tipo'] for e in da_equipe]

        de_fora, _ = _usuario('operador', OUTRA_CIDADE)
        assert 'atribuido' not in [e['tipo'] for e in de_fora.get(url).data]

    def test_perfil_nao_escala_nem_troca_cidade(self):
        cli, user = _usuario('operador', CIDADE)
        resp = cli.patch(reverse('auth-profile'), {
            'nome': 'Novo Nome', 'municipio_id': OUTRA_CIDADE, 'email': 'outro@example.com',
            'admin': 1, 'papel': 'super_admin', 'cpf': '12345678909',
        }, format='json')
        assert resp.status_code == 200
        user.refresh_from_db()
        assert user.nome == 'Novo Nome'
        assert (user.municipio_id, user.papel) == (CIDADE, 'operador')
        assert user.email != 'outro@example.com' and not user.cpf
        _cidades()
        assert cli.patch(
            reverse('auth-update-municipio'), {'municipio_id': OUTRA_CIDADE}, format='json',
        ).status_code == 403

    def test_admin_municipal_nao_age_em_outra_cidade(self):
        _cidades()
        adm, _ = _usuario('admin_municipal', CIDADE)
        _, op_de_fora = _usuario('operador', OUTRA_CIDADE)
        _, cidadao = _usuario()
        url_papel = lambda u: reverse('auth-admin-toggle', kwargs={'pk': u.id})  # noqa: E731
        url_mun = lambda u: reverse('auth-admin-vinculate-municipio', kwargs={'pk': u.id})  # noqa: E731

        # Não mexe na equipe de outra cidade nem vincula a outra cidade.
        assert adm.patch(url_papel(op_de_fora), {'admin': False}, format='json').status_code == 403
        assert adm.patch(url_mun(op_de_fora), {'municipio_id': CIDADE}, format='json').status_code == 403
        assert adm.patch(url_mun(cidadao), {'municipio_id': OUTRA_CIDADE}, format='json').status_code == 403
        # Não concede papel acima do seu.
        assert adm.patch(url_papel(cidadao), {'papel': 'super_admin'}, format='json').status_code == 403
        # Recruta um cidadão: ele entra na equipe DESTA cidade.
        assert adm.patch(url_papel(cidadao), {'papel': 'gestor'}, format='json').status_code == 200
        cidadao.refresh_from_db()
        assert (cidadao.papel, cidadao.municipio_id, cidadao.admin) == ('gestor', CIDADE, 1)
        from gestao.models import AuditLog
        assert AuditLog.objects.filter(acao='usuario.papel', alvo_id=str(cidadao.id)).exists()

        # A lista é só da cidade dele.
        ids = {u['id'] for u in adm.get(reverse('auth-admin-users')).data}
        assert str(cidadao.id) in ids and str(op_de_fora.id) not in ids

    def test_operador_ve_metricas_mas_nao_gerencia_usuarios(self):
        op, _ = _usuario('operador', CIDADE)
        assert op.get(reverse('auth-admin-estatisticas')).status_code == 200
        assert op.get(reverse('auth-admin-users')).status_code == 403


class TestSla:

    @pytest.mark.parametrize('nome', ['Semáforo', 'Semaforo', 'semáforo '])
    def test_regra_casa_sem_acento(self, nome):
        regra = sla.regra_para(nome, None)
        assert regra['prazo_sla_dias'] == 2
        assert regra['prioridade'] == 'urgente'
        assert regra['secretaria_nome'] == 'Secretaria de Trânsito e Mobilidade'
        assert regra['categoria_id'] is not None

    def test_desconhecida_cai_em_outro(self):
        regra = sla.regra_para('Disco voador', None)
        outro = sla.regra_para('Outro', None)
        assert regra == outro

    def test_chamado_com_acento_ganha_prazo_certo(self):
        d = _chamado(_usuario()[0], categoria='Árvore Caída')
        obj = Defeito.objects.get(id=d['id'])
        assert obj.prazo_sla_dias == 2
        assert obj.secretaria_responsavel == 'Secretaria de Meio Ambiente'
        assert obj.prioridade == 'urgente'
        assert obj.categoria_id == sla.regra_para('Arvore Caida', None)['categoria_id']
        assert obj.prazo_em == obj.criado_em + timedelta(days=2)
        # O autor é cidadão: prazo vira `sla_*` só para a equipe (contrato v3).
        assert d['sla_vencido'] is False
        assert d['sla_restante_horas'] is None

    def test_regra_do_municipio_sobrepoe(self):
        from gestao.models import CategoriaMunicipio, Secretaria
        _cidades()
        base = sla.regra_para('Entulho', CIDADE)
        sec, _ = Secretaria.objects.get_or_create(municipio_id=CIDADE, nome='SMSU Fluxo')
        CategoriaMunicipio.objects.update_or_create(
            municipio_id=CIDADE, categoria_id=base['categoria_id'],
            defaults={'prazo_sla_dias': 3, 'prioridade': 'alta', 'secretaria': sec},
        )
        try:
            regra = sla.regra_para('entulho', CIDADE)
            assert (regra['prazo_sla_dias'], regra['prioridade']) == (3, 'alta')
            assert (regra['secretaria_id'], regra['secretaria_nome']) == (sec.id, 'SMSU Fluxo')
            # Outra cidade continua na regra padrão.
            assert sla.regra_para('Entulho', OUTRA_CIDADE)['prazo_sla_dias'] == base['prazo_sla_dias']
            d = _chamado(_usuario()[0])
            assert (d['secretaria_id'], d['secretaria_nome']) == (sec.id, 'SMSU Fluxo')
        finally:
            CategoriaMunicipio.objects.filter(municipio_id=CIDADE).delete()

    def test_routing_legado_passa_pela_regra(self):
        from services.ia_client import routing
        assert routing('Iluminação') == {
            'secretaria': 'Secretaria de Iluminação Pública', 'prazo_sla_dias': 5,
        }


class TestProtocolo:

    def test_formato_e_sequencia(self):
        cli, _ = _usuario()
        a, b = _chamado(cli), _chamado(cli)
        ano = timezone.localtime().year
        for d in (a, b):
            assert re.fullmatch(rf'{ano}-\d{{6}}', d['protocolo'])
        assert int(b['protocolo'][5:]) > int(a['protocolo'][5:])

    def test_criacao_pelo_orm_tambem_ganha(self):
        agora = timezone.now()
        d = Defeito.objects.create(titulo='ORM', criado_em=agora, atualizado_em=agora)
        assert d.protocolo and d.protocolo.startswith(f'{timezone.localtime(agora).year}-')


class TestSoftDelete:

    def test_autor_exclui_pendente(self):
        cli, _ = _usuario()
        d = _chamado(cli)
        assert cli.delete(reverse('defeitos-detail', args=[d['id']])).status_code == 204
        obj = Defeito.objects.get(id=d['id'])
        assert obj.removido_em and obj.removido_motivo == 'autor'
        assert cli.get(reverse('defeitos-detail', args=[d['id']])).status_code == 404
        assert d['id'] not in [x['id'] for x in cli.get(reverse('defeitos-meus')).data['results']]
        assert DefeitoEvento.objects.filter(defeito_id=d['id'], tipo='removido').exists()

    def test_gestao_remove_com_auditoria(self):
        from gestao.models import AuditLog
        d = _chamado(_usuario()[0])
        op, _ = _usuario('operador', CIDADE)
        gestor, _ = _usuario('gestor', CIDADE)
        url = reverse('defeitos-detail', args=[d['id']])
        assert op.delete(url).status_code == 403
        assert gestor.delete(url, {'motivo': 'conteúdo ofensivo'}, format='json').status_code == 204
        assert Defeito.objects.get(id=d['id']).removido_motivo == 'moderacao'
        log = AuditLog.objects.get(acao='defeito.remover', alvo_id=d['id'])
        assert log.municipio_id == CIDADE and log.dados['motivo'] == 'conteúdo ofensivo'

    def test_nao_existe_da_comunidade_remove_e_mantem_strike(self):
        from defeitos.models import Strike
        cli, autor = _usuario()
        d = _chamado(cli)
        for _ in range(2):
            outro, _ = _usuario()
            resp = outro.post(reverse('defeitos-sinalizar', args=[d['id']]), {'tipo': 'nao_existe'}, format='json')
        assert resp.data['resultado'] == 'inexistente'
        obj = Defeito.objects.get(id=d['id'])
        assert obj.removido_em and obj.removido_motivo == 'comunidade'
        assert Strike.objects.filter(usuario=autor).count() == 1
        assert APIClient().get(reverse('defeitos-detail', args=[d['id']])).status_code == 404
