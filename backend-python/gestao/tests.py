"""
Gestão da prefeitura (contrato v3, 7.6): permissão por papel, isolamento
entre municípios, regras de membros, categorias com recálculo de SLA,
moderação, auditoria e o seed de estrutura padrão.
"""
import uuid
from datetime import timedelta

import pytest
from django.core.management import call_command
from django.db import connection
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from categorias.models import Categoria
from defeitos.models import Defeito, DefeitoEvento, Sinalizacao, Strike
from gestao.models import AuditLog, CategoriaMunicipio, Equipe, MunicipioConfig, Secretaria
from users.models import User

pytestmark = pytest.mark.django_db(transaction=True)

# Tabelas `managed=False` não são esvaziadas entre testes: cada teste ganha
# duas cidades novas, senão "último admin" e contagens vazariam de um teste
# para outro. Os helpers leem os globais na hora da chamada.
CIDADE = OUTRA = None


@pytest.fixture(autouse=True)
def _cidades(db):
    global CIDADE, OUTRA
    CIDADE, OUTRA = f'g{uuid.uuid4().hex[:8]}', f'g{uuid.uuid4().hex[:8]}'
    with connection.cursor() as cur:
        for codigo, nome in ((CIDADE, 'Cidade Gestão'), (OUTRA, 'Outra Gestão')):
            # Caixa no Ártico: nunca contém coordenadas de outros testes.
            cur.execute("""
                INSERT INTO municipios (codigo, nome, uf, uf_sigla, min_lat, max_lat, min_lng, max_lng)
                VALUES (%s, %s, '43', 'RS', 80, 81, 0, 1)
            """, [codigo, nome])


_PADRAO = object()


def _usuario(papel='cidadao', municipio_id=_PADRAO, nome=None, email=None):
    uid = uuid.uuid4().hex[:8]
    user = User.objects.create_user(
        email=email or f'gestao-{uid}@example.com', nome=nome or f'Pessoa Teste {uid}',
        password='Test@123456', papel=papel, municipio_id=CIDADE if municipio_id is _PADRAO else municipio_id,
    )
    cli = APIClient()
    cli.force_authenticate(user)
    return cli, user


def _chamado(municipio_id=None, categoria='Buraco', status='pendente', autor=None, **extra):
    municipio_id = municipio_id or CIDADE
    agora = timezone.now()
    cat = Categoria.objects.get(nome=categoria)
    prazo = extra.pop('prazo_sla_dias', cat.prazo_sla_dias)
    criado = extra.pop('criado_em', agora - timedelta(days=1))
    return Defeito.objects.create(
        titulo=f'Chamado {uuid.uuid4().hex[:6]}', descricao='teste', latitude=0.1, longitude=0.1,
        categoria=cat.nome, categoria_id=cat.id, status=status, municipio_id=municipio_id,
        usuario=autor, prazo_sla_dias=prazo, prazo_em=criado + timedelta(days=prazo),
        criado_em=criado, atualizado_em=agora, **extra,
    )


def _url(nome, *args, municipio=None):
    url = reverse(nome, args=args)
    return f'{url}?municipio={municipio}' if municipio else url


# ------------------------------------------------------------- permissões

class TestPermissoesPorPapel:

    def test_cidadao_nao_acessa_nada(self):
        cli, _ = _usuario('cidadao')
        for nome in ('gestao-municipio', 'gestao-secretarias', 'gestao-equipes', 'gestao-membros',
                     'gestao-categorias', 'gestao-moderacao', 'gestao-auditoria'):
            assert cli.get(reverse(nome)).status_code == 403, nome

    def test_anonimo_401(self):
        assert APIClient().get(reverse('gestao-municipio')).status_code == 401

    def test_operador_le_config_e_categorias_mas_nao_estrutura(self):
        cli, _ = _usuario('operador')
        assert cli.get(reverse('gestao-municipio')).status_code == 200
        assert cli.get(reverse('gestao-categorias')).status_code == 200
        assert cli.get(reverse('gestao-secretarias')).status_code == 403
        assert cli.get(reverse('gestao-membros')).status_code == 403
        assert cli.get(reverse('gestao-moderacao')).status_code == 403
        assert cli.patch(reverse('gestao-municipio'), {'telefone': '1'}, format='json').status_code == 403

    def test_gestor_le_e_modera_mas_nao_administra(self):
        cli, _ = _usuario('gestor')
        assert cli.get(reverse('gestao-secretarias')).status_code == 200
        assert cli.get(reverse('gestao-membros')).status_code == 200
        assert cli.get(reverse('gestao-moderacao')).status_code == 200
        assert cli.post(reverse('gestao-secretarias'), {'nome': 'Obras'}, format='json').status_code == 403
        assert cli.get(reverse('gestao-auditoria')).status_code == 403
        cat = Categoria.objects.get(nome='Buraco')
        resp = cli.patch(reverse('gestao-categoria', args=[cat.id]), {'prazo_sla_dias': 3}, format='json')
        assert resp.status_code == 403

    def test_servidor_sem_municipio_recebe_400(self):
        cli, _ = _usuario('admin_municipal', municipio_id=None)
        assert cli.get(reverse('gestao-secretarias')).status_code == 400


# ------------------------------------------------------------- isolamento

class TestIsolamento:

    def test_admin_nao_ve_nem_altera_outro_municipio(self):
        cli_a, _ = _usuario('admin_municipal')
        sec_b = Secretaria.objects.create(municipio_id=OUTRA, nome='Obras B')
        eq_b = Equipe.objects.create(municipio_id=OUTRA, nome='Equipe B')
        _, membro_b = _usuario('operador', OUTRA)

        assert cli_a.get(reverse('gestao-secretaria', args=[sec_b.id])).status_code == 404
        assert cli_a.patch(reverse('gestao-secretaria', args=[sec_b.id]), {'nome': 'x'}, format='json').status_code == 404
        assert cli_a.delete(reverse('gestao-equipe', args=[eq_b.id])).status_code == 404
        assert cli_a.patch(reverse('gestao-membro', args=[membro_b.id]), {'papel': 'gestor'}, format='json').status_code == 404
        assert cli_a.delete(reverse('gestao-membro', args=[membro_b.id])).status_code == 404
        ids = [s['id'] for s in cli_a.get(reverse('gestao-secretarias')).data]
        assert sec_b.id not in ids
        assert str(membro_b.id) not in [m['id'] for m in cli_a.get(reverse('gestao-membros')).data['results']]

    def test_admin_nao_usa_parametro_municipio_de_outra_cidade(self):
        cli_a, _ = _usuario('admin_municipal')
        assert cli_a.get(_url('gestao-secretarias', municipio=OUTRA)).status_code == 403
        assert cli_a.get(_url('gestao-secretarias', municipio=CIDADE)).status_code == 200

    def test_super_admin_gere_qualquer_municipio(self):
        cli, _ = _usuario('super_admin')
        resp = cli.post(_url('gestao-secretarias', municipio=OUTRA), {'nome': 'Secretaria da Outra'}, format='json')
        assert resp.status_code == 201
        assert Secretaria.objects.get(id=resp.data['id']).municipio_id == OUTRA
        assert AuditLog.objects.filter(acao='secretaria.criar', municipio_id=OUTRA).exists()
        assert cli.get(_url('gestao-secretarias', municipio='0000000')).status_code == 404

    def test_secretaria_de_outro_municipio_nao_serve_para_equipe(self):
        cli, _ = _usuario('admin_municipal')
        sec_b = Secretaria.objects.create(municipio_id=OUTRA, nome='Obras B2')
        resp = cli.post(reverse('gestao-equipes'), {'nome': 'Equipe X', 'secretaria_id': sec_b.id}, format='json')
        assert resp.status_code == 400

    def test_moderacao_isolada(self):
        cli_a, _ = _usuario('gestor')
        _, cidadao_b = _usuario('cidadao', OUTRA)
        d_b = _chamado(OUTRA, autor=cidadao_b)
        url = reverse('gestao-moderacao-remover', args=[d_b.id])
        assert cli_a.post(url, {'motivo': 'abuso'}, format='json').status_code == 404
        url = reverse('gestao-moderacao-suspender', args=[cidadao_b.id])
        assert cli_a.post(url, {'dias': 3, 'motivo': 'abuso'}, format='json').status_code == 404

    def test_auditoria_isolada(self):
        cli_a, _ = _usuario('admin_municipal')
        cli_b, _ = _usuario('admin_municipal', OUTRA)
        cli_b.post(reverse('gestao-secretarias'), {'nome': 'Só da B'}, format='json')
        acoes = [r['alvo_id'] for r in cli_a.get(reverse('gestao-auditoria')).data['results']]
        sec_b = Secretaria.objects.get(municipio_id=OUTRA, nome='Só da B')
        assert str(sec_b.id) not in acoes


# --------------------------------------------------------------- município

class TestMunicipio:

    def test_get_sem_config_traz_padrao_e_nome(self):
        cli, _ = _usuario('operador')
        resp = cli.get(reverse('gestao-municipio'))
        assert resp.status_code == 200
        assert resp.data['nome'] == 'Cidade Gestão'
        assert resp.data['uf_sigla'] == 'RS'
        assert resp.data['raio_duplicado_m'] == 30

    def test_patch_admin_grava_e_audita(self):
        cli, _ = _usuario('admin_municipal')
        resp = cli.patch(reverse('gestao-municipio'), {
            'nome_exibicao': 'Prefeitura de Teste', 'cor_primaria': '#1A2B3C', 'raio_duplicado_m': 50,
        }, format='json')
        assert resp.status_code == 200, resp.data
        assert MunicipioConfig.objects.get(pk=CIDADE).cor_primaria == '#1A2B3C'
        log = AuditLog.objects.filter(acao='municipio.config', municipio_id=CIDADE).latest('criado_em')
        assert log.dados['depois']['raio_duplicado_m'] == 50

    def test_validacoes(self):
        cli, _ = _usuario('admin_municipal')
        r = cli.patch(reverse('gestao-municipio'), {'cor_primaria': 'azul'}, format='json')
        assert r.status_code == 400 and 'detail' in r.data
        assert cli.patch(reverse('gestao-municipio'), {'raio_duplicado_m': 0}, format='json').status_code == 400
        url = reverse('gestao-municipio')
        assert cli.patch(url, {'parametros': {'exigir_foto_conclusao': 'nao'}}, format='json').status_code == 400
        assert cli.patch(url, {'parametros': {'raio_evidencia_m': 5}}, format='json').status_code == 400
        r = cli.patch(url, {'parametros': {'exigir_foto_conclusao': False, 'raio_evidencia_m': 300}}, format='json')
        assert r.status_code == 200 and r.data['parametros']['raio_evidencia_m'] == 300

    def test_contratado_so_super_admin(self):
        cli, _ = _usuario('admin_municipal')
        assert cli.patch(reverse('gestao-municipio'), {'contratado': True}, format='json').status_code == 403
        sup, _ = _usuario('super_admin')
        assert sup.patch(_url('gestao-municipio', municipio=CIDADE), {'contratado': True}, format='json').status_code == 200
        assert MunicipioConfig.objects.get(pk=CIDADE).contratado is True


# --------------------------------------------------- secretarias e equipes

class TestEstrutura:

    def test_crud_secretaria_e_equipe(self):
        cli, _ = _usuario('admin_municipal')
        r = cli.post(reverse('gestao-secretarias'), {'nome': ' Secretaria  de Obras ', 'sigla': 'SMO'}, format='json')
        assert r.status_code == 201
        assert r.data['nome'] == 'Secretaria de Obras'
        sec_id = r.data['id']
        assert cli.post(reverse('gestao-secretarias'), {'nome': 'secretaria de obras'}, format='json').status_code == 409

        r = cli.post(reverse('gestao-equipes'), {'nome': 'Tapa-buraco', 'secretaria_id': sec_id}, format='json')
        assert r.status_code == 201
        assert r.data['secretaria_nome'] == 'Secretaria de Obras'
        eq_id = r.data['id']

        r = cli.patch(reverse('gestao-equipe', args=[eq_id]), {'nome': 'Pavimentação'}, format='json')
        assert r.status_code == 200 and r.data['nome'] == 'Pavimentação'
        lista = cli.get(reverse('gestao-secretarias')).data
        assert next(s for s in lista if s['id'] == sec_id)['total_equipes'] == 1

        # Em uso (tem equipe): desativa em vez de apagar.
        assert cli.delete(reverse('gestao-secretaria', args=[sec_id])).status_code == 204
        assert Secretaria.objects.get(id=sec_id).ativo is False
        # Equipe sem nada apontando: apaga de verdade.
        assert cli.delete(reverse('gestao-equipe', args=[eq_id])).status_code == 204
        assert not Equipe.objects.filter(id=eq_id).exists()

        acoes = set(AuditLog.objects.filter(municipio_id=CIDADE).values_list('acao', flat=True))
        assert {'secretaria.criar', 'equipe.criar', 'equipe.alterar', 'secretaria.desativar', 'equipe.excluir'} <= acoes

    def test_salvar_equipe_mantem_secretaria_desativada(self):
        # Reenviar a secretaria atual (desativada) não pode barrar a edição de
        # outro campo; trocar PARA uma desativada continua proibido.
        cli, _ = _usuario('admin_municipal')
        sec = Secretaria.objects.create(municipio_id=CIDADE, nome='Antiga', ativo=False)
        outra = Secretaria.objects.create(municipio_id=CIDADE, nome='Outra antiga', ativo=False)
        eq = Equipe.objects.create(municipio_id=CIDADE, nome='Equipe X', secretaria=sec)
        r = cli.patch(reverse('gestao-equipe', args=[eq.id]),
                      {'nome': 'Equipe Y', 'secretaria_id': sec.id}, format='json')
        assert r.status_code == 200, r.data
        assert r.data['secretaria_id'] == sec.id
        r = cli.patch(reverse('gestao-equipe', args=[eq.id]), {'secretaria_id': outra.id}, format='json')
        assert r.status_code == 400


# ------------------------------------------------------------------ membros

class TestMembros:

    def test_vincular_por_email(self):
        cli, admin = _usuario('admin_municipal')
        _, pessoa = _usuario('cidadao', municipio_id=OUTRA, email=f'Nova-{uuid.uuid4().hex[:6]}@Example.com')
        sec = Secretaria.objects.create(municipio_id=CIDADE, nome='Obras M')
        eq = Equipe.objects.create(municipio_id=CIDADE, nome='Equipe M', secretaria=sec)
        r = cli.post(reverse('gestao-membros'), {
            'email': pessoa.email.upper(), 'papel': 'operador', 'equipe_id': eq.id,
        }, format='json')
        assert r.status_code == 201, r.data
        pessoa.refresh_from_db()
        assert pessoa.papel == 'operador' and pessoa.municipio_id == CIDADE
        # A equipe puxa a secretaria dela.
        assert pessoa.equipe_id == eq.id and pessoa.secretaria_id == sec.id
        assert r.data['equipe_nome'] == 'Equipe M'
        log = AuditLog.objects.get(acao='membro.vincular', alvo_id=str(pessoa.id))
        assert log.usuario_id == admin.id and log.dados['antes']['papel'] == 'cidadao'

    def test_vincular_email_sem_ponto_no_dominio(self):
        # Contas de teste/intranet (ex.: fulano@local) existem no cadastro e
        # precisam poder ser vinculadas; o nome entra na auditoria.
        cli, _ = _usuario('admin_municipal')
        _, pessoa = _usuario('cidadao', email=f'pessoa-{uuid.uuid4().hex[:6]}@local')
        r = cli.post(reverse('gestao-membros'), {'email': pessoa.email, 'papel': 'operador'}, format='json')
        assert r.status_code == 201, r.data
        log = AuditLog.objects.get(acao='membro.vincular', alvo_id=str(pessoa.id))
        assert log.dados['nome'] == pessoa.nome
        assert cli.post(reverse('gestao-membros'), {'email': 'sem-arroba', 'papel': 'operador'},
                        format='json').status_code == 400

    def test_admin_municipal_nao_cria_super_admin(self):
        cli, _ = _usuario('admin_municipal')
        _, pessoa = _usuario('cidadao')
        r = cli.post(reverse('gestao-membros'), {'email': pessoa.email, 'papel': 'super_admin'}, format='json')
        assert r.status_code == 403
        _, membro = _usuario('operador')
        r = cli.patch(reverse('gestao-membro', args=[membro.id]), {'papel': 'super_admin'}, format='json')
        assert r.status_code == 403
        membro.refresh_from_db()
        assert membro.papel == 'operador'

    def test_nao_rouba_servidor_de_outra_cidade(self):
        cli, _ = _usuario('admin_municipal')
        _, de_fora = _usuario('operador', OUTRA)
        r = cli.post(reverse('gestao-membros'), {'email': de_fora.email, 'papel': 'gestor'}, format='json')
        assert r.status_code == 409
        de_fora.refresh_from_db()
        assert de_fora.municipio_id == OUTRA

    def test_nao_rebaixa_ultimo_admin(self):
        cli, admin = _usuario('admin_municipal')
        sup, _ = _usuario('super_admin', OUTRA)
        url = _url('gestao-membro', admin.id, municipio=CIDADE)
        r = sup.patch(url, {'papel': 'gestor'}, format='json')
        assert r.status_code == 409
        assert sup.delete(url).status_code == 409
        # Com um segundo admin, pode.
        _, outro_admin = _usuario('admin_municipal')
        assert sup.patch(url, {'papel': 'gestor'}, format='json').status_code == 200
        admin.refresh_from_db()
        assert admin.papel == 'gestor'
        assert outro_admin.papel == 'admin_municipal'

    def test_nao_altera_o_proprio_papel(self):
        cli, admin = _usuario('admin_municipal')
        _usuario('admin_municipal')
        r = cli.patch(reverse('gestao-membro', args=[admin.id]), {'papel': 'gestor'}, format='json')
        assert r.status_code == 400
        assert cli.delete(reverse('gestao-membro', args=[admin.id])).status_code == 400

    def test_admin_nao_mexe_em_super_admin(self):
        cli, _ = _usuario('admin_municipal')
        _, sup = _usuario('super_admin')
        assert cli.delete(reverse('gestao-membro', args=[sup.id])).status_code == 403
        assert cli.patch(reverse('gestao-membro', args=[sup.id]), {'papel': 'operador'}, format='json').status_code == 403

    def test_revogar_volta_a_cidadao_e_libera_chamados(self):
        cli, _ = _usuario('admin_municipal')
        eq = Equipe.objects.create(municipio_id=CIDADE, nome='Equipe R')
        _, op = _usuario('operador')
        op.equipe_id = eq.id
        op.save(update_fields=['equipe_id'])
        aberto = _chamado(atendente=op, status='em_andamento')
        fechado = _chamado(atendente=op, status='concluido')

        r = cli.delete(reverse('gestao-membro', args=[op.id]))
        assert r.status_code == 200
        assert r.data['chamados_liberados'] == 1
        op.refresh_from_db()
        assert op.papel == 'cidadao' and op.equipe_id is None and op.admin == 0
        aberto.refresh_from_db()
        fechado.refresh_from_db()
        assert aberto.atendente_id is None
        assert fechado.atendente_id == op.id  # histórico de quem concluiu fica
        ev = DefeitoEvento.objects.filter(defeito=aberto, tipo='atribuido').latest('criado_em')
        assert ev.publico is False and ev.dados['motivo'] == 'membro_revogado'
        assert AuditLog.objects.filter(acao='membro.revogar', alvo_id=str(op.id)).exists()

    def test_lista_com_filtros(self):
        cli, _ = _usuario('gestor', nome='Gestora Ana')
        _, op = _usuario('operador', nome='Operador Zé')
        _usuario('cidadao', nome='Cidadão Fora Da Lista')
        lista = cli.get(reverse('gestao-membros')).data['results']
        nomes = [m['nome'] for m in lista]
        assert 'Gestora Ana' in nomes and 'Operador Zé' in nomes
        assert 'Cidadão Fora Da Lista' not in nomes
        so_ops = cli.get(reverse('gestao-membros') + '?papel=operador').data['results']
        assert all(m['papel'] == 'operador' for m in so_ops)
        assert [m['id'] for m in cli.get(reverse('gestao-membros') + '?q=Zé').data['results']] == [str(op.id)]

    def test_lista_paginada_no_servidor(self):
        cli, _ = _usuario('admin_municipal', nome='Admin Paginado')
        for i in range(4):
            _usuario('operador', nome=f'Operador {i:02d}')
        r = cli.get(reverse('gestao-membros') + '?page_size=2')
        assert r.data['count'] == 5 and len(r.data['results']) == 2 and r.data['next']
        # Papel mais alto primeiro, depois nome.
        assert r.data['results'][0]['nome'] == 'Admin Paginado'
        pag3 = cli.get(reverse('gestao-membros') + '?page_size=2&page=3').data
        assert [m['nome'] for m in pag3['results']] == ['Operador 03'] and pag3['next'] is None


# ---------------------------------------------------------------- convites

class TestConvites:

    def _convidar(self, cli, email, papel='operador', **extra):
        return cli.post(reverse('gestao-membros'), {'email': email, 'papel': papel, **extra}, format='json')

    def test_email_sem_conta_vira_convite(self, monkeypatch):
        enviados = []

        async def falso_envio(to, subject, html):
            enviados.append((to, html))
            return {'id': 'x'}

        monkeypatch.setattr('services.email_service._send_email', falso_envio)
        cli, _ = _usuario('admin_municipal')
        eq = Equipe.objects.create(municipio_id=CIDADE, nome='Equipe Convite')
        email = f'novo-{uuid.uuid4().hex[:6]}@example.com'
        r = self._convidar(cli, email.upper(), 'gestor', equipe_id=eq.id)
        assert r.status_code == 201, r.data
        assert r.data['email_enviado'] is True
        assert r.data['convite']['email'] == email and r.data['convite']['equipe_nome'] == 'Equipe Convite'
        assert 'token' not in r.data['convite']
        assert enviados and enviados[0][0] == email and 'Gestor' in enviados[0][1]
        assert AuditLog.objects.filter(acao='convite.criar', municipio_id=CIDADE).exists()
        # Convidar de novo o mesmo e-mail atualiza o convite, não duplica.
        r2 = self._convidar(cli, email, 'operador')
        assert r2.data['convite']['id'] == r.data['convite']['id']
        lista = cli.get(reverse('gestao-convites')).data
        assert [c['papel'] for c in lista] == ['operador']

    def test_sem_resend_convite_fica_e_avisa(self, settings):
        settings.RESEND_API_KEY = ''
        cli, _ = _usuario('admin_municipal')
        r = self._convidar(cli, f'sem-envio-{uuid.uuid4().hex[:6]}@example.com')
        assert r.status_code == 201 and r.data['email_enviado'] is False

    def test_gestor_le_mas_nao_convida(self):
        cli, _ = _usuario('gestor')
        assert cli.get(reverse('gestao-convites')).status_code == 200
        assert self._convidar(cli, 'x@example.com').status_code == 403

    def test_convites_isolados_por_municipio(self, settings):
        settings.RESEND_API_KEY = ''
        cli_a, _ = _usuario('admin_municipal')
        cli_b, _ = _usuario('admin_municipal', OUTRA)
        cid = self._convidar(cli_b, f'b-{uuid.uuid4().hex[:6]}@example.com').data['convite']['id']
        assert cid not in [c['id'] for c in cli_a.get(reverse('gestao-convites')).data]
        assert cli_a.delete(reverse('gestao-convite', args=[cid])).status_code == 404
        assert cli_a.post(reverse('gestao-convite-reenviar', args=[cid])).status_code == 404

    def test_reenviar_renova_e_cancelar_remove(self, settings):
        from gestao.models import Convite

        settings.RESEND_API_KEY = ''
        cli, _ = _usuario('admin_municipal')
        cid = self._convidar(cli, f'r-{uuid.uuid4().hex[:6]}@example.com').data['convite']['id']
        Convite.objects.filter(pk=cid).update(expira_em=timezone.now() - timedelta(days=1))
        assert cli.get(reverse('gestao-convites')).data[0]['expirado'] is True
        r = cli.post(reverse('gestao-convite-reenviar', args=[cid]))
        assert r.status_code == 200 and r.data['convite']['expirado'] is False
        assert cli.delete(reverse('gestao-convite', args=[cid])).status_code == 204
        assert not Convite.objects.filter(pk=cid).exists()
        assert AuditLog.objects.filter(acao='convite.cancelar', alvo_id=str(cid)).exists()

    def test_convite_aplicado_ao_verificar_o_email(self, settings):
        settings.RESEND_API_KEY = ''
        cli, _ = _usuario('admin_municipal')
        sec = Secretaria.objects.create(municipio_id=CIDADE, nome='Obras Convite')
        email = f'chega-{uuid.uuid4().hex[:6]}@example.com'
        cid = self._convidar(cli, email, 'gestor', secretaria_id=sec.id).data['convite']['id']

        anon = APIClient()
        r = anon.post(reverse('auth-register'), {
            'nome': 'Pessoa Convidada', 'email': email,
            'password': 'Test@123456', 'confirm_password': 'Test@123456',
        }, format='json')
        assert r.status_code == 201, r.data
        novo = User.objects.get(email__iexact=email)
        # Sem verificar o e-mail, nada muda: o convite é de quem prova o e-mail.
        assert novo.papel == 'cidadao'
        login = anon.post(reverse('auth-login'), {'email': email, 'password': 'Test@123456'}, format='json')
        assert login.status_code == 200
        novo.refresh_from_db()
        assert novo.papel == 'cidadao'

        anon.force_authenticate(novo)
        r = anon.post(reverse('auth-verify-email'), {'codigo': novo.codigo_2fa}, format='json')
        assert r.status_code == 200, r.data
        novo.refresh_from_db()
        assert novo.papel == 'gestor' and novo.municipio_id == CIDADE and novo.secretaria_id == sec.id
        assert cli.get(reverse('gestao-convites')).data == []
        log = AuditLog.objects.get(acao='convite.aceitar', alvo_id=str(novo.id))
        assert log.dados['convite_id'] == cid

    def test_convite_aplicado_no_login_de_conta_verificada(self, settings):
        settings.RESEND_API_KEY = ''
        cli, _ = _usuario('admin_municipal')
        email = f'login-{uuid.uuid4().hex[:6]}@example.com'
        # Conta criada depois do convite (o vínculo direto não se aplica).
        self._convidar(cli, email, 'operador')
        _, pessoa = _usuario('cidadao', municipio_id=None, email=email)
        pessoa.email_verified = 1
        pessoa.save(update_fields=['email_verified'])
        r = APIClient().post(reverse('auth-login'), {'email': email, 'password': 'Test@123456'}, format='json')
        assert r.status_code == 200
        assert r.data['user']['papel'] == 'operador'

    def test_convite_vencido_nao_aplica_e_equipe_nao_e_sobrescrita(self, settings):
        from gestao.models import Convite
        from gestao.servicos import aplicar_convite

        settings.RESEND_API_KEY = ''
        cli, _ = _usuario('admin_municipal')
        email = f'venc-{uuid.uuid4().hex[:6]}@example.com'
        cid = self._convidar(cli, email).data['convite']['id']
        Convite.objects.filter(pk=cid).update(expira_em=timezone.now() - timedelta(minutes=1))
        _, pessoa = _usuario('cidadao', municipio_id=None, email=email)
        pessoa.email_verified = 1
        pessoa.save(update_fields=['email_verified'])
        assert aplicar_convite(pessoa) is None and pessoa.papel == 'cidadao'

        email2 = f'op-{uuid.uuid4().hex[:6]}@example.com'
        self._convidar(cli, email2, 'admin_municipal')
        _, de_fora = _usuario('operador', OUTRA, email=email2)
        de_fora.email_verified = 1
        assert aplicar_convite(de_fora) is None
        de_fora.refresh_from_db()
        assert de_fora.papel == 'operador' and de_fora.municipio_id == OUTRA


# --------------------------------------------------------------- categorias

class TestCategorias:

    def test_lista_mescla_base_e_override(self):
        cli, _ = _usuario('operador')
        cat = Categoria.objects.get(nome='Semáforo')
        sec = Secretaria.objects.create(municipio_id=CIDADE, nome='Trânsito C')
        CategoriaMunicipio.objects.create(municipio_id=CIDADE, categoria=cat, prazo_sla_dias=1, secretaria=sec,
                                          checklist=['Foto do poste'])
        CategoriaMunicipio.objects.create(municipio_id=OUTRA, categoria=cat, prazo_sla_dias=9)
        lista = cli.get(reverse('gestao-categorias')).data
        sem = next(c for c in lista if c['categoria_id'] == cat.id)
        assert sem['prazo_sla_dias'] == 1 and sem['secretaria_nome'] == 'Trânsito C'
        assert sem['personalizado'] is True and sem['base']['prazo_sla_dias'] == 2
        assert sem['checklist'] == ['Foto do poste']
        buraco = next(c for c in lista if c['nome'] == 'Buraco')
        assert buraco['personalizado'] is False and buraco['prazo_sla_dias'] == 7

    def test_mudar_sla_recalcula_abertos(self):
        cli, admin = _usuario('admin_municipal')
        cat = Categoria.objects.get(nome='Entulho')  # base 15 dias
        aberto = _chamado(categoria='Entulho')
        ajustado = _chamado(categoria='Entulho', prazo_sla_dias=30)  # ajuste manual: fica
        fechado = _chamado(categoria='Entulho', status='concluido')
        de_fora = _chamado(OUTRA, categoria='Entulho')

        r = cli.patch(reverse('gestao-categoria', args=[cat.id]), {'prazo_sla_dias': 5}, format='json')
        assert r.status_code == 200, r.data
        assert r.data['prazo_sla_dias'] == 5 and r.data['chamados_recalculados'] == 1

        aberto.refresh_from_db()
        assert aberto.prazo_sla_dias == 5
        assert aberto.prazo_em == aberto.criado_em + timedelta(days=5)
        ev = DefeitoEvento.objects.get(defeito=aberto, tipo='sla')
        assert ev.publico is False and ev.dados['de_dias'] == 15 and ev.dados['para_dias'] == 5
        for outro in (ajustado, fechado, de_fora):
            outro.refresh_from_db()
            assert outro.prazo_sla_dias in (15, 30)
            assert not DefeitoEvento.objects.filter(defeito=outro, tipo='sla').exists()
        log = AuditLog.objects.get(acao='categoria.alterar', alvo_id=str(cat.id))
        assert log.dados['antes']['prazo_sla_dias'] == 15 and log.dados['chamados_recalculados'] == 1

        # null volta ao padrão da plataforma (e recalcula de novo).
        r = cli.patch(reverse('gestao-categoria', args=[cat.id]), {'prazo_sla_dias': None}, format='json')
        assert r.data['prazo_sla_dias'] == 15 and r.data['chamados_recalculados'] == 1

    def test_validacoes(self):
        cli, _ = _usuario('admin_municipal')
        cat = Categoria.objects.get(nome='Buraco')
        url = reverse('gestao-categoria', args=[cat.id])
        assert cli.patch(url, {'prazo_sla_dias': 0}, format='json').status_code == 400
        assert cli.patch(url, {'prioridade': 'altissima'}, format='json').status_code == 400
        sec_b = Secretaria.objects.create(municipio_id=OUTRA, nome='Secretaria B Cat')
        assert cli.patch(url, {'secretaria_id': sec_b.id}, format='json').status_code == 400
        assert cli.patch(reverse('gestao-categoria', args=[999999]), {'ativo': False}, format='json').status_code == 404
        r = cli.patch(url, {'checklist': ['  Sinalizar  o local ', 'Foto depois'], 'prioridade': 'urgente'}, format='json')
        assert r.status_code == 200
        assert r.data['checklist'] == ['Sinalizar o local', 'Foto depois'] and r.data['prioridade'] == 'urgente'


# ---------------------------------------------------------------- moderação

class TestModeracao:

    def test_fila_de_sinalizados_com_contagens(self):
        cli, _ = _usuario('gestor')
        _, autor = _usuario('cidadao')
        d = _chamado(autor=autor)
        _chamado()  # sem sinalização: fora da fila
        agora = timezone.now()
        for tipo in ('nao_existe', 'nao_existe', 'resolvido'):
            _, u = _usuario('cidadao')
            Sinalizacao.objects.create(usuario=u, defeito=d, tipo=tipo, criado_em=agora)
        r = cli.get(reverse('gestao-moderacao'))
        assert r.status_code == 200
        assert [s['id'] for s in r.data['sinalizados']] == [str(d.id)]
        item = r.data['sinalizados'][0]
        assert item['total_nao_existe'] == 2 and item['total_resolvido'] == 1
        assert item['autor_nome'] == autor.nome
        assert r.data['contagens']['sinalizados'] == 1

    def test_remover_e_restaurar_devolve_strike(self):
        cli, gestor = _usuario('gestor')
        _, autor = _usuario('cidadao')
        d = _chamado(autor=autor)

        r = cli.post(reverse('gestao-moderacao-remover', args=[d.id]), {'motivo': 'Conteúdo ofensivo'}, format='json')
        assert r.status_code == 200
        d.refresh_from_db()
        assert d.removido_em is not None and d.removido_motivo == 'moderacao'
        ev = DefeitoEvento.objects.get(defeito=d, tipo='removido')
        assert ev.texto == 'Conteúdo ofensivo' and ev.dados['motivo'] == 'moderacao'
        # O autor é avisado com o motivo escrito pelo gestor.
        aviso = autor.notificacoes.get(tipo='moderacao')
        assert 'Conteúdo ofensivo' in aviso.corpo
        assert cli.post(reverse('gestao-moderacao-remover', args=[d.id]), {'motivo': 'de novo'}, format='json').status_code == 409
        removido = next(x for x in cli.get(reverse('gestao-moderacao')).data['removidos'] if x['id'] == str(d.id))
        assert removido['removido_motivo'] == 'moderacao' and removido['removido_texto'] == 'Conteúdo ofensivo'

        # Simula remoção comunitária, que deu strike ao autor.
        Defeito.objects.filter(pk=d.pk).update(removido_motivo='comunidade')
        Strike.objects.create(usuario=autor, titulo=d.titulo, criado_em=timezone.now())
        r = cli.post(reverse('gestao-moderacao-restaurar', args=[d.id]), {'motivo': 'Problema confirmado'}, format='json')
        assert r.status_code == 200 and r.data['strike_retirado'] is True
        d.refresh_from_db()
        assert d.removido_em is None
        assert not Strike.objects.filter(usuario=autor).exists()
        ev = DefeitoEvento.objects.filter(defeito=d, tipo='moderacao').latest('criado_em')
        assert ev.dados['acao'] == 'restaurar' and ev.autor_id == gestor.id
        assert cli.post(reverse('gestao-moderacao-restaurar', args=[d.id]), {}, format='json').status_code == 409
        acoes = set(AuditLog.objects.filter(alvo_id=str(d.id)).values_list('acao', flat=True))
        assert acoes == {'moderacao.remover', 'moderacao.restaurar'}

    def test_remover_exige_motivo(self):
        cli, _ = _usuario('gestor')
        d = _chamado()
        assert cli.post(reverse('gestao-moderacao-remover', args=[d.id]), {}, format='json').status_code == 400

    def test_operador_nao_modera(self):
        cli, _ = _usuario('operador')
        d = _chamado()
        assert cli.post(reverse('gestao-moderacao-remover', args=[d.id]), {'motivo': 'abc'}, format='json').status_code == 403

    def test_suspender_e_reativar(self):
        cli, _ = _usuario('gestor')
        _, cidadao = _usuario('cidadao', municipio_id=OUTRA)
        _chamado(autor=cidadao)  # reportou aqui: entra no alcance da moderação

        r = cli.post(reverse('gestao-moderacao-suspender', args=[cidadao.id]),
                     {'dias': 7, 'motivo': 'Reports falsos repetidos'}, format='json')
        assert r.status_code == 200 and r.data['suspenso'] is True
        cidadao.refresh_from_db()
        assert cidadao.suspenso_ate > timezone.now() + timedelta(days=6)
        assert cidadao.notificacoes.filter(tipo='moderacao').count() == 1
        usuarios = cli.get(reverse('gestao-moderacao')).data['usuarios']
        assert any(u['id'] == str(cidadao.id) and u['suspenso'] for u in usuarios)

        assert cli.post(reverse('gestao-moderacao-reativar', args=[cidadao.id])).status_code == 200
        cidadao.refresh_from_db()
        assert cidadao.suspenso_ate is None
        assert cli.post(reverse('gestao-moderacao-reativar', args=[cidadao.id])).status_code == 409
        acoes = list(AuditLog.objects.filter(alvo_id=str(cidadao.id)).values_list('acao', flat=True))
        assert sorted(acoes) == ['usuario.reativar', 'usuario.suspender']

    def test_nao_suspende_servidor_nem_a_si(self):
        cli, gestor = _usuario('gestor')
        _, op = _usuario('operador')
        url = reverse('gestao-moderacao-suspender', args=[op.id])
        assert cli.post(url, {'dias': 3, 'motivo': 'teste'}, format='json').status_code == 400
        url = reverse('gestao-moderacao-suspender', args=[gestor.id])
        assert cli.post(url, {'dias': 3, 'motivo': 'teste'}, format='json').status_code == 400
        _, cidadao = _usuario('cidadao')
        url = reverse('gestao-moderacao-suspender', args=[cidadao.id])
        assert cli.post(url, {'dias': 0, 'motivo': 'teste'}, format='json').status_code == 400


# ---------------------------------------------------------------- auditoria

class TestAuditoria:

    def test_paginada_com_filtros(self):
        cli, admin = _usuario('admin_municipal')
        _, gestor = _usuario('gestor')
        for i in range(3):
            cli.post(reverse('gestao-secretarias'), {'nome': f'Secretaria Aud {i}'}, format='json')
        cli.post(reverse('gestao-equipes'), {'nome': 'Equipe Aud'}, format='json')

        r = cli.get(reverse('gestao-auditoria'))
        assert r.status_code == 200
        assert {'count', 'next', 'previous', 'results'} <= set(r.data)
        assert r.data['count'] == 4

        r = cli.get(reverse('gestao-auditoria') + '?acao=secretaria')
        assert r.data['count'] == 3 and all(x['acao'] == 'secretaria.criar' for x in r.data['results'])
        r = cli.get(reverse('gestao-auditoria') + '?acao=equipe.criar')
        assert r.data['count'] == 1 and r.data['results'][0]['usuario_nome'] == admin.nome
        r = cli.get(reverse('gestao-auditoria') + f'?usuario_id={gestor.id}')
        assert r.data['count'] == 0
        r = cli.get(reverse('gestao-auditoria') + '?page_size=2')
        assert len(r.data['results']) == 2 and r.data['next']
        hoje = timezone.localdate().isoformat()
        assert cli.get(reverse('gestao-auditoria') + f'?inicio={hoje}&fim={hoje}').data['count'] == 4
        assert cli.get(reverse('gestao-auditoria') + '?inicio=ontem').status_code == 400
        assert cli.get(reverse('gestao-auditoria') + '?usuario_id=abc').status_code == 400

    def test_exporta_csv_com_os_filtros(self):
        import csv
        import io

        cli, admin = _usuario('admin_municipal')
        cli.post(reverse('gestao-secretarias'), {'nome': 'Secretaria Ção; CSV'}, format='json')
        cli.post(reverse('gestao-equipes'), {'nome': 'Equipe CSV'}, format='json')
        _, outro_admin = _usuario('admin_municipal', OUTRA)
        AuditLog.objects.create(usuario=outro_admin, municipio_id=OUTRA, acao='secretaria.criar')

        r = cli.get(reverse('gestao-auditoria') + '?formato=csv&acao=secretaria')
        assert r.status_code == 200
        assert r['Content-Type'].startswith('text/csv')
        assert 'attachment' in r['Content-Disposition'] and CIDADE in r['Content-Disposition']
        texto = r.content.decode('utf-8')
        assert texto.startswith('﻿')
        linhas = list(csv.reader(io.StringIO(texto.lstrip('﻿')), delimiter=';'))
        assert linhas[0][:4] == ['data_hora', 'usuario', 'usuario_id', 'acao']
        assert len(linhas) == 2  # cabeçalho + a secretaria (sem a equipe nem a outra cidade)
        assert linhas[1][1] == admin.nome and linhas[1][3] == 'secretaria.criar'
        assert 'Secretaria Ção; CSV' in linhas[1][7]
        # Gestor não exporta (a auditoria é do administrador).
        gestor, _ = _usuario('gestor')
        assert gestor.get(reverse('gestao-auditoria') + '?formato=csv').status_code == 403


# ------------------------------------------------------------------- seed

class TestSeed:

    def test_seed_cria_estrutura_idempotente(self):
        call_command('seed_gestao_demo', OUTRA, verbosity=0)
        call_command('seed_gestao_demo', OUTRA, verbosity=0)
        nomes = set(Secretaria.objects.filter(municipio_id=OUTRA).values_list('nome', flat=True))
        assert {'Secretaria de Obras e Infraestrutura', 'Secretaria de Serviços Urbanos',
                'Secretaria de Trânsito e Mobilidade', 'Secretaria de Meio Ambiente'} <= nomes
        assert Secretaria.objects.filter(municipio_id=OUTRA).count() == 4
        assert Equipe.objects.filter(municipio_id=OUTRA).count() == 6
        semaforo = CategoriaMunicipio.objects.get(municipio_id=OUTRA, categoria__nome='Semáforo')
        assert semaforo.secretaria.nome == 'Secretaria de Trânsito e Mobilidade'
        assert semaforo.prazo_sla_dias is None  # prazo segue o padrão da plataforma
        assert MunicipioConfig.objects.filter(pk=OUTRA).exists()

    def test_seed_municipio_inexistente(self):
        from django.core.management.base import CommandError
        with pytest.raises(CommandError):
            call_command('seed_gestao_demo', '0000001', verbosity=0)


def test_ip_da_auditoria_ignora_xff_forjado():
    # O 1º item do X-Forwarded-For vem do cliente; o nginx grava o real em
    # X-Real-IP e no fim do XFF.
    from django.test import RequestFactory

    from core.auditoria import _ip

    rf = RequestFactory()
    assert _ip(rf.get('/', HTTP_X_REAL_IP='200.1.1.1', HTTP_X_FORWARDED_FOR='6.6.6.6, 200.1.1.1')) == '200.1.1.1'
    assert _ip(rf.get('/', HTTP_X_FORWARDED_FOR='6.6.6.6, 200.1.1.1')) == '200.1.1.1'
    assert _ip(rf.get('/', REMOTE_ADDR='10.0.0.9')) == '10.0.0.9'
