import itertools
from datetime import timedelta

import base64
import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from django.utils import timezone

from defeitos.models import Defeito

pytestmark = pytest.mark.django_db(transaction=True)

# Coordenadas únicas por chamada para evitar que a detecção de duplicados
# (raio espacial + similaridade) rejeite defeitos criados em testes distintos
# que usariam as mesmas coordenadas de São Paulo.

# PNG 1x1 válido: todo chamado exige uma foto (o backend recusa sem `imagem`).
_PNG_1X1 = base64.b64decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
)


def com_foto(data):
    """Copia `data` acrescentando um arquivo `imagem` (multipart)."""
    return {**data, 'imagem': SimpleUploadedFile('foto.png', _PNG_1X1, content_type='image/png')}


_COORD_COUNTER = itertools.count()


def _create_defeito(auth_client, **overrides):
    i = next(_COORD_COUNTER)
    data = {
        'titulo': f'Test Bug Report {i}',
        'descricao': f'A test bug for integration testing numero {i}',
        'latitude': -23.5505,
        'longitude': -46.6333 + i * 0.01,
        'rua': 'Avenida Paulista',
        'bairro': 'Bela Vista',
        'categoria': 'Buraco',
    }
    data.update(overrides)
    resp = auth_client.post(reverse('defeitos-list'), com_foto(data), format='multipart')
    assert resp.status_code == 201
    return resp.data


def _new_user_client(client):
    """Registra um usuário independente e retorna um APIClient autenticado."""
    import uuid as uuid_mod
    uid = str(uuid_mod.uuid4())[:8]
    creds = {
        'email': f'other-{uid}@example.com',
        'nome': f'Other User {uid}',
        'password': 'Test@123456',
    }
    from rest_framework.test import APIClient
    resp = client.post(reverse('auth-register'), {**creds, 'confirm_password': creds['password']}, format='json')
    assert resp.status_code == 201
    new_client = APIClient()
    new_client.credentials(HTTP_AUTHORIZATION=f"Bearer {resp.data['access']}")
    return new_client


class TestDefeitosList:

    def test_list_unauthenticated(self, client):
        resp = client.get(reverse('defeitos-list'))
        assert resp.status_code == 200

    def test_list_structure(self, client):
        resp = client.get(reverse('defeitos-list'))
        assert resp.status_code == 200
        assert 'count' in resp.data
        assert 'results' in resp.data

    def test_list_with_data(self, auth_client, client):
        _create_defeito(auth_client)
        resp = client.get(reverse('defeitos-list'))
        assert resp.status_code == 200
        assert resp.data['count'] >= 1

    def test_list_pagination(self, auth_client, client):
        for i in range(3):
            _create_defeito(auth_client, titulo=f'Bug {i}')
        resp = client.get(reverse('defeitos-list'))
        assert resp.status_code == 200
        assert len(resp.data['results']) >= 1
        assert 'count' in resp.data
        assert 'next' in resp.data
        assert 'previous' in resp.data

    def test_search_by_titulo(self, auth_client, client):
        _create_defeito(auth_client, titulo='Buraco na Rua Augusta')
        _create_defeito(auth_client, titulo='Poste queimado')
        resp = client.get(reverse('defeitos-list'), {'search': 'Buraco'})
        assert resp.status_code == 200
        assert any('Buraco' in r['titulo'] for r in resp.data['results'])

    def test_search_by_bairro(self, auth_client, client):
        _create_defeito(auth_client, bairro='Pinheiros')
        resp = client.get(reverse('defeitos-list'), {'search': 'Pinheiros'})
        assert resp.status_code == 200
        assert any(r['bairro'] == 'Pinheiros' for r in resp.data['results'])


class TestDefeitosCreate:

    def test_create_authenticated(self, auth_client):
        data = {
            'titulo': 'New Bug',
            'descricao': 'Description',
            'latitude': -23.5,
            'longitude': -46.6,
            'rua': 'Rua Teste',
            'bairro': 'Centro',
            'categoria': 'Iluminacao',
        }
        resp = auth_client.post(reverse('defeitos-list'), com_foto(data), format='multipart')
        assert resp.status_code == 201
        assert resp.data['titulo'] == 'New Bug'
        assert 'id' in resp.data

    def test_create_unauthenticated(self, client):
        resp = client.post(reverse('defeitos-list'), {}, format='json')
        assert resp.status_code == 401

    def test_create_minimal_fields(self, auth_client):
        resp = auth_client.post(reverse('defeitos-list'), com_foto({
            'titulo': 'Minimal bug',
        }), format='multipart')
        assert resp.status_code == 201

    def test_create_with_coordinates(self, auth_client):
        lat, lng = -22.9068, -43.1729
        resp = auth_client.post(reverse('defeitos-list'), com_foto({
            'titulo': 'Bug with coords',
            'latitude': lat,
            'longitude': lng,
        }), format='multipart')
        assert resp.status_code == 201
        assert abs(float(resp.data['latitude']) - lat) < 0.01
        assert abs(float(resp.data['longitude']) - lng) < 0.01

    def test_create_defeito_persists_routing(self, auth_client):
        resp = auth_client.post(reverse('defeitos-list'), com_foto({
            'titulo': 'Buraco na rua',
            'descricao': 'Buraco grande na via',
            'latitude': -21.17,
            'longitude': -47.82,
            'categoria': 'Buraco',
            'status': 'pendente',
        }), format='multipart')
        assert resp.status_code == 201
        defeito_id = resp.data['id']
        defeito = Defeito.objects.get(id=defeito_id)
        assert defeito.secretaria_responsavel == 'Secretaria de Obras e Infraestrutura'
        assert defeito.prazo_sla_dias == 7


class TestDefeitosRetrieve:

    def test_retrieve(self, auth_client, client):
        created = _create_defeito(auth_client)
        resp = client.get(reverse('defeitos-detail', args=[created['id']]))
        assert resp.status_code == 200
        assert resp.data['titulo'] == created['titulo']

    def test_retrieve_nonexistent(self, client):
        import uuid
        resp = client.get(reverse('defeitos-detail', args=[uuid.uuid4()]))
        assert resp.status_code == 404

    def test_retrieve_includes_extra_fields(self, auth_client, client):
        created = _create_defeito(auth_client)
        resp = client.get(reverse('defeitos-detail', args=[created['id']]))
        assert 'categoria' in resp.data
        assert 'descricao' in resp.data
        assert 'status' in resp.data
        assert 'total_apoios' in resp.data

    def test_detail_nao_expoe_foto_resolucao_bruta(self, auth_client):
        """O serializer de detalhe NÃO deve expor o binário bruto foto_resolucao."""
        import io
        from PIL import Image
        created = _create_defeito(auth_client)
        buf = io.BytesIO()
        Image.new('RGB', (64, 64), color='red').save(buf, format='JPEG')
        buf.seek(0)
        auth_client.patch(
            reverse('defeitos-status', args=[created['id']]),
            {'status': 'atendido', 'foto_resolucao': buf},
            format='multipart',
        )
        resp = auth_client.get(reverse('defeitos-detail', args=[created['id']]))
        assert resp.status_code == 200
        assert 'foto_resolucao' not in resp.data
        assert 'foto_resolucao_url' in resp.data


class TestDefeitosUpdate:

    def test_update_own(self, auth_client):
        created = _create_defeito(auth_client)
        resp = auth_client.patch(
            reverse('defeitos-detail', args=[created['id']]),
            {'titulo': 'Updated Title'}, format='json',
        )
        assert resp.status_code == 200
        assert resp.data['titulo'] == 'Updated Title'

    def test_update_status(self, auth_client):
        created = _create_defeito(auth_client)
        resp = auth_client.patch(
            reverse('defeitos-detail', args=[created['id']]),
            {'status': 'em_andamento'}, format='json',
        )
        assert resp.status_code == 200

    def test_update_unauthenticated(self, client, auth_client):
        created = _create_defeito(auth_client)
        resp = client.patch(
            reverse('defeitos-detail', args=[created['id']]),
            {'titulo': 'Hacked'}, format='json',
        )
        assert resp.status_code == 401


class TestDefeitosDelete:

    def test_delete_own(self, auth_client):
        created = _create_defeito(auth_client)
        resp = auth_client.delete(reverse('defeitos-detail', args=[created['id']]))
        assert resp.status_code == 204

    def test_delete_unauthenticated(self, client, auth_client):
        created = _create_defeito(auth_client)
        resp = client.delete(reverse('defeitos-detail', args=[created['id']]))
        assert resp.status_code == 401


class TestApoiar:

    APOIAR_URL = 'defeitos-apoiar'

    def test_apoiar(self, auth_client):
        created = _create_defeito(auth_client)
        resp = auth_client.post(reverse(self.APOIAR_URL, args=[created['id']]), format='json')
        assert resp.status_code == 201
        assert resp.data['apoiado'] is True

    def test_remover_apoio(self, auth_client):
        created = _create_defeito(auth_client)
        auth_client.post(reverse(self.APOIAR_URL, args=[created['id']]), format='json')
        resp = auth_client.post(reverse(self.APOIAR_URL, args=[created['id']]), format='json')
        assert resp.status_code == 200
        assert resp.data['apoiado'] is False

    def test_apoiar_unauthenticated(self, client, auth_client):
        created = _create_defeito(auth_client)
        resp = client.post(reverse(self.APOIAR_URL, args=[created['id']]), format='json')
        assert resp.status_code == 401

    def test_apoiar_nonexistent(self, auth_client):
        import uuid
        resp = auth_client.post(reverse(self.APOIAR_URL, args=[uuid.uuid4()]), format='json')
        assert resp.status_code == 404


class TestSinalizar:
    """Mecânica da sinalização em si; o que ela dispara está em TestRegra*."""

    URL = 'defeitos-sinalizar'

    def _sinalizar(self, client, defeito_id, tipo):
        return client.post(reverse(self.URL, args=[defeito_id]), {'tipo': tipo}, format='json')

    def test_sinalizar_resolvido(self, client, auth_client):
        created = _create_defeito(auth_client)
        outro = _new_user_client(client)
        resp = self._sinalizar(outro, created['id'], 'resolvido')
        assert resp.status_code == 200
        assert resp.data['tipo'] == 'resolvido'
        assert resp.data['sinalizacoes'] == {'resolvido': 1, 'nao_existe': 0}
        assert resp.data['resultado'] is None
        assert resp.data['defeito']['sinalizacoes'] == {'resolvido': 1, 'nao_existe': 0}

    def test_repetir_remove(self, client, auth_client):
        created = _create_defeito(auth_client)
        outro = _new_user_client(client)
        self._sinalizar(outro, created['id'], 'nao_existe')
        resp = self._sinalizar(outro, created['id'], 'nao_existe')
        assert resp.status_code == 200
        assert resp.data['tipo'] is None
        assert resp.data['sinalizacoes'] == {'resolvido': 0, 'nao_existe': 0}

    def test_outro_tipo_troca(self, client, auth_client):
        created = _create_defeito(auth_client)
        outro = _new_user_client(client)
        self._sinalizar(outro, created['id'], 'resolvido')
        resp = self._sinalizar(outro, created['id'], 'nao_existe')
        assert resp.data['tipo'] == 'nao_existe'
        assert resp.data['sinalizacoes'] == {'resolvido': 0, 'nao_existe': 1}

    def test_tipo_invalido(self, auth_client):
        created = _create_defeito(auth_client)
        resp = self._sinalizar(auth_client, created['id'], 'qualquer')
        assert resp.status_code == 400

    def test_nao_autenticado(self, client, auth_client):
        created = _create_defeito(auth_client)
        resp = self._sinalizar(client, created['id'], 'resolvido')
        assert resp.status_code == 401

    def test_chamado_fechado_recusa(self, auth_client):
        created = _create_defeito(auth_client)
        Defeito.objects.filter(id=created['id']).update(status='concluido')
        resp = self._sinalizar(auth_client, created['id'], 'resolvido')
        assert resp.status_code == 400

    def test_contagem_no_detalhe_e_na_lista(self, client, auth_client):
        created = _create_defeito(auth_client)
        a, b = _new_user_client(client), _new_user_client(client)
        self._sinalizar(a, created['id'], 'resolvido')
        self._sinalizar(b, created['id'], 'nao_existe')
        # Apoio junto, para garantir que um join não infla a contagem do outro.
        a.post(reverse('defeitos-apoiar', args=[created['id']]), format='json')
        b.post(reverse('defeitos-apoiar', args=[created['id']]), format='json')

        detalhe = auth_client.get(reverse('defeitos-detail', args=[created['id']]))
        assert detalhe.data['sinalizacoes'] == {'resolvido': 1, 'nao_existe': 1}
        assert detalhe.data['total_apoios'] == 2

        lista = auth_client.get(reverse('defeitos-list'))
        item = next(d for d in lista.data['results'] if d['id'] == created['id'])
        assert item['sinalizacoes'] == {'resolvido': 1, 'nao_existe': 1}
        assert item['total_apoios'] == 2

    def test_sinalizei(self, client, auth_client):
        a = _create_defeito(auth_client)
        b = _create_defeito(auth_client)
        outro = _new_user_client(client)
        self._sinalizar(outro, a['id'], 'resolvido')
        self._sinalizar(outro, b['id'], 'nao_existe')
        resp = outro.get(reverse('defeitos-sinalizei'))
        assert resp.status_code == 200
        assert resp.data['sinalizacoes'] == {a['id']: 'resolvido', b['id']: 'nao_existe'}


def _sinalizar(client, defeito_id, tipo):
    return client.post(reverse('defeitos-sinalizar', args=[defeito_id]), {'tipo': tipo}, format='json')


def _apoiar(client, defeito_id):
    return client.post(reverse('defeitos-apoiar', args=[defeito_id]), format='json')


def _existe(defeito_id):
    return Defeito.objects.filter(id=defeito_id).exists()


def _dar_strikes(client, auth_client, n, dias_atras=0):
    """Cria `n` strikes para o dono de `auth_client` (via /auth/me)."""
    from defeitos.models import Strike
    me = auth_client.get(reverse('auth-profile'))
    quando = timezone.now() - timedelta(days=dias_atras)
    for i in range(n):
        Strike.objects.create(usuario_id=me.data['id'], titulo=f'strike {i}', criado_em=quando)


@pytest.mark.deslocamento_real
class TestDeslocamentoPlausivel:
    """Não dá para reportar aqui e, segundos depois, 1 km adiante."""

    def _reportar(self, client, lat, lng, titulo):
        return client.post(reverse('defeitos-list'), com_foto({
            'titulo': titulo, 'descricao': 'deslocamento teste', 'categoria': 'Entulho',
            'latitude': lat, 'longitude': lng, 'rua': 'Rua Y', 'bairro': 'Centro',
        }), format='multipart')

    def test_longe_demais_rapido_demais(self, auth_client):
        created = _create_defeito(auth_client)
        resp = self._reportar(
            auth_client, created['latitude'], created['longitude'] + 0.012,
            f"Longe demais {created['longitude']}",
        )
        assert resp.status_code == 429
        assert 'Aguarde' in resp.data['error']

    def test_perto_pode_na_hora(self, auth_client):
        created = _create_defeito(auth_client)
        resp = self._reportar(
            auth_client, created['latitude'] + 0.0008, created['longitude'] + 0.0008,
            f"Mesma esquina {created['longitude']}",
        )
        assert resp.status_code == 201, resp.data

    def test_com_tempo_passa(self, auth_client):
        created = _create_defeito(auth_client)
        # 1 km em 10 minutos: caminhada tranquila.
        Defeito.objects.filter(id=created['id']).update(
            criado_em=timezone.now() - timedelta(minutes=10),
        )
        resp = self._reportar(
            auth_client, created['latitude'], created['longitude'] + 0.012,
            f"Depois da caminhada {created['longitude']}",
        )
        assert resp.status_code == 201, resp.data

    def test_outro_usuario_nao_e_afetado(self, client, auth_client):
        created = _create_defeito(auth_client)
        outro = _new_user_client(client)
        resp = self._reportar(
            outro, created['latitude'], created['longitude'] + 0.012,
            f"Outra pessoa {created['longitude']}",
        )
        assert resp.status_code == 201, resp.data


class TestRegraResolvido:
    """"Já foi resolvido": fecha pelo autor ou por RESOLVIDO_MIN pessoas; fica nos relatórios."""

    def test_autor_fecha_sozinho(self, auth_client):
        created = _create_defeito(auth_client)
        resp = _sinalizar(auth_client, created['id'], 'resolvido')
        assert resp.status_code == 200
        assert resp.data['resultado'] == 'concluido'
        assert resp.data['defeito']['status'] == 'concluido'
        assert resp.data['defeito']['atendido_em']
        assert 'autor' in resp.data['defeito']['atualizacoes']

    def test_um_terceiro_nao_fecha(self, client, auth_client):
        created = _create_defeito(auth_client)
        outro = _new_user_client(client)
        resp = _sinalizar(outro, created['id'], 'resolvido')
        assert resp.data['resultado'] is None
        assert resp.data['defeito']['status'] == 'pendente'

    def test_dois_terceiros_fecham_e_continua_na_lista(self, client, auth_client):
        created = _create_defeito(auth_client)
        a, b = _new_user_client(client), _new_user_client(client)
        _sinalizar(a, created['id'], 'resolvido')
        resp = _sinalizar(b, created['id'], 'resolvido')
        assert resp.data['resultado'] == 'concluido'
        assert resp.data['defeito']['status'] == 'concluido'
        assert 'cidadãos' in resp.data['defeito']['atualizacoes']
        lista = client.get(reverse('defeitos-list'))
        assert any(d['id'] == created['id'] for d in lista.data['results'])


class TestRegraNaoExiste:
    """"Não existe": apaga de vez; autor sem penalidade, terceiros com barra por confirmação."""

    def test_autor_apaga_na_hora_sem_strike(self, auth_client):
        from defeitos.models import Strike
        created = _create_defeito(auth_client)
        resp = _sinalizar(auth_client, created['id'], 'nao_existe')
        assert resp.status_code == 200
        assert resp.data['resultado'] == 'inexistente'
        assert resp.data['defeito'] is None
        assert not _existe(created['id'])
        me = auth_client.get(reverse('auth-profile')).data
        assert Strike.objects.filter(usuario_id=me['id']).count() == 0
        assert auth_client.get(reverse('defeitos-detail', args=[created['id']])).status_code == 404

    def test_um_terceiro_nao_apaga(self, client, auth_client):
        created = _create_defeito(auth_client)
        outro = _new_user_client(client)
        resp = _sinalizar(outro, created['id'], 'nao_existe')
        assert resp.data['resultado'] is None
        assert _existe(created['id'])

    def test_dois_terceiros_apagam_e_autor_leva_strike(self, client, auth_client):
        from defeitos.models import Strike
        created = _create_defeito(auth_client)
        a, b = _new_user_client(client), _new_user_client(client)
        _sinalizar(a, created['id'], 'nao_existe')
        resp = _sinalizar(b, created['id'], 'nao_existe')
        assert resp.data['resultado'] == 'inexistente'
        assert not _existe(created['id'])
        me = auth_client.get(reverse('auth-profile')).data
        assert Strike.objects.filter(usuario_id=me['id']).count() == 1
        # Some de todo lugar.
        lista = client.get(reverse('defeitos-list'))
        assert not any(d['id'] == created['id'] for d in lista.data['results'])

    def test_confirmacao_sobe_a_barra(self, client, auth_client):
        created = _create_defeito(auth_client)
        confirmou = _new_user_client(client)
        _apoiar(confirmou, created['id'])
        a, b, c = (_new_user_client(client) for _ in range(3))
        _sinalizar(a, created['id'], 'nao_existe')
        resp = _sinalizar(b, created['id'], 'nao_existe')
        assert resp.data['resultado'] is None, 'com 1 confirmação precisa de 3'
        assert _existe(created['id'])
        resp = _sinalizar(c, created['id'], 'nao_existe')
        assert resp.data['resultado'] == 'inexistente'
        assert not _existe(created['id'])


class TestQuarentena:
    """Com > STRIKES_TOLERADOS strikes ativos, chamados novos nascem restritos."""

    def test_ate_dois_strikes_nada_muda(self, client, auth_client):
        _dar_strikes(client, auth_client, 2)
        created = _create_defeito(auth_client)
        assert created['visibilidade'] == 'publica'

    def test_tres_strikes_restringe(self, client, auth_client):
        _dar_strikes(client, auth_client, 3)
        created = _create_defeito(auth_client)
        assert created['visibilidade'] == 'restrita'

    def test_strike_expirado_nao_conta(self, client, auth_client):
        _dar_strikes(client, auth_client, 2)
        _dar_strikes(client, auth_client, 1, dias_atras=120)
        created = _create_defeito(auth_client)
        assert created['visibilidade'] == 'publica'

    def test_cliente_nao_pode_forcar_visibilidade(self, client, auth_client):
        _dar_strikes(client, auth_client, 3)
        created = _create_defeito(auth_client, visibilidade='publica')
        assert created['visibilidade'] == 'restrita'

    def test_restrito_some_da_lista_para_os_outros(self, client, auth_client, admin_client):
        # admin_client é o mesmo usuário de auth_client promovido; usamos outro autor.
        autor = _new_user_client(client)
        _dar_strikes(client, autor, 3)
        created = _create_defeito(autor)
        assert created['visibilidade'] == 'restrita'

        ids = lambda resp: [d['id'] for d in resp.data['results']]
        assert created['id'] not in ids(client.get(reverse('defeitos-list')))
        assert created['id'] not in ids(_new_user_client(client).get(reverse('defeitos-list')))
        assert created['id'] in ids(autor.get(reverse('defeitos-list')))
        assert created['id'] in ids(admin_client.get(reverse('defeitos-list')))
        assert created['id'] in ids(autor.get(reverse('defeitos-meus')))

    def test_restrito_no_mapa_so_para_quem_esta_perto(self, client, auth_client):
        from django.db import connection
        with connection.cursor() as cur:
            cur.execute("""
                INSERT INTO municipios (codigo, nome, uf, uf_sigla, min_lat, max_lat, min_lng, max_lng, polygon_geom)
                VALUES ('9999909', 'Cidade Quarentena', '35', 'SP', -26.1, -25.9, -52.4, -52.2,
                        ST_Multi(ST_GeomFromText('POLYGON((-52.4 -26.1, -52.2 -26.1, -52.2 -25.9, -52.4 -25.9, -52.4 -26.1))', 4326)))
                ON CONFLICT (codigo) DO NOTHING
            """)
        autor = _new_user_client(client)
        _dar_strikes(client, autor, 3)
        created = _create_defeito(autor, latitude=-26.0, longitude=-52.3)
        assert created['visibilidade'] == 'restrita'

        longe = client.get(reverse('defeitos-municipio'), {'lat': -26.05, 'lng': -52.35})
        assert created['id'] not in [d['id'] for d in longe.data['defeitos']]
        perto = client.get(reverse('defeitos-municipio'), {'lat': -26.001, 'lng': -52.301})
        assert created['id'] in [d['id'] for d in perto.data['defeitos']]
        do_autor = autor.get(reverse('defeitos-municipio'), {'lat': -26.05, 'lng': -52.35})
        assert created['id'] in [d['id'] for d in do_autor.data['defeitos']]

    def test_confirmacao_publica_e_resgata_strike(self, client, auth_client):
        from defeitos.models import Strike
        autor = _new_user_client(client)
        _dar_strikes(client, autor, 3)
        created = _create_defeito(autor)
        assert created['visibilidade'] == 'restrita'
        autor_id = autor.get(reverse('auth-profile')).data['id']
        strikes = Strike.objects.filter(usuario_id=autor_id)

        # O próprio autor apoiando não conta.
        _apoiar(autor, created['id'])
        assert Defeito.objects.get(id=created['id']).visibilidade == 'restrita'
        assert strikes.count() == 3

        outro = _new_user_client(client)
        _apoiar(outro, created['id'])
        assert Defeito.objects.get(id=created['id']).visibilidade == 'publica'
        assert strikes.count() == 2

        # Segunda confirmação não resgata de novo.
        _apoiar(_new_user_client(client), created['id'])
        assert strikes.count() == 2


class TestAtender:

    ATENDER_URL = 'defeitos-atender'

    def test_atender(self, admin_client):
        """Assumir é ação de operador (admin); cidadão comum não assume."""
        created = _create_defeito(admin_client)
        resp = admin_client.patch(reverse(self.ATENDER_URL, args=[created['id']]), format='json')
        assert resp.status_code == 200
        assert 'message' in resp.data

    def test_atender_duplicate(self, admin_client):
        created = _create_defeito(admin_client)
        admin_client.patch(reverse(self.ATENDER_URL, args=[created['id']]), format='json')
        resp = admin_client.patch(reverse(self.ATENDER_URL, args=[created['id']]), format='json')
        assert resp.status_code == 400

    def test_atender_unauthenticated(self, client, auth_client):
        created = _create_defeito(auth_client)
        resp = client.patch(reverse(self.ATENDER_URL, args=[created['id']]), format='json')
        assert resp.status_code == 401

    def test_atender_nonexistent(self, auth_client):
        import uuid
        resp = auth_client.patch(reverse(self.ATENDER_URL, args=[uuid.uuid4()]), format='json')
        assert resp.status_code == 404


class TestStatusAction:

    STATUS_URL = 'defeitos-status'

    def test_update_status(self, admin_client):
        created = _create_defeito(admin_client)
        resp = admin_client.patch(
            reverse(self.STATUS_URL, args=[created['id']]),
            {'status': 'em_andamento'}, format='json',
        )
        assert resp.status_code == 200
        assert resp.data['status'] == 'em_andamento'

    def test_invalid_status(self, admin_client):
        created = _create_defeito(admin_client)
        resp = admin_client.patch(
            reverse(self.STATUS_URL, args=[created['id']]),
            {'status': 'invalid_status'}, format='json',
        )
        assert resp.status_code == 400

    def test_resolvido_sem_foto_resolucao(self, admin_client):
        """A foto de resolução é opcional: finalizar sem ela é permitido."""
        created = _create_defeito(admin_client)
        resp = admin_client.patch(
            reverse(self.STATUS_URL, args=[created['id']]),
            {'status': 'atendido'}, format='json',
        )
        assert resp.status_code == 200
        assert resp.data['status'] == 'atendido'
        assert resp.data['atendido_em']
        assert resp.data['foto_resolucao_url'] is None

    def test_resolvido_com_foto_resolucao(self, admin_client):
        import io
        from PIL import Image
        created = _create_defeito(admin_client)
        buf = io.BytesIO()
        Image.new('RGB', (64, 64), color='red').save(buf, format='JPEG')
        buf.seek(0)
        resp = admin_client.patch(
            reverse(self.STATUS_URL, args=[created['id']]),
            {'status': 'atendido', 'foto_resolucao': buf},
            format='multipart',
        )
        assert resp.status_code == 200
        assert resp.data['status'] == 'atendido'

    def test_update_status_unauthenticated(self, client, auth_client):
        created = _create_defeito(auth_client)
        resp = client.patch(
            reverse(self.STATUS_URL, args=[created['id']]),
            {'status': 'em_andamento'}, format='json',
        )
        assert resp.status_code == 401

    def test_update_status_denied_for_plain_user(self, client, admin_client):
        """Cidadão comum NÃO pode alterar status de defeito de outro cidadão."""
        created = _create_defeito(admin_client)
        other = _new_user_client(client)
        resp = other.patch(
            reverse(self.STATUS_URL, args=[created['id']]),
            {'status': 'em_andamento'}, format='json',
        )
        assert resp.status_code == 403

    def test_update_status_denied_for_plain_user_to_resolved(self, client, admin_client):
        """Cidadão comum NÃO pode marcar como atendido sem ser admin/atendente."""
        import io
        from PIL import Image
        created = _create_defeito(admin_client)
        other = _new_user_client(client)
        buf = io.BytesIO()
        Image.new('RGB', (64, 64), color='red').save(buf, format='JPEG')
        buf.seek(0)
        resp = other.patch(
            reverse(self.STATUS_URL, args=[created['id']]),
            {'status': 'atendido', 'foto_resolucao': buf},
            format='multipart',
        )
        assert resp.status_code == 403

    def test_update_status_allowed_for_admin(self, admin_client):
        created = _create_defeito(admin_client)
        resp = admin_client.patch(
            reverse(self.STATUS_URL, args=[created['id']]),
            {'status': 'em_andamento'}, format='json',
        )
        assert resp.status_code == 200

    def test_update_status_allowed_for_atendente(self, admin_client):
        """Atendente vinculado ao defeito pode alterar o status."""
        created = _create_defeito(admin_client)
        resp = admin_client.patch(
            reverse('defeitos-atender', args=[created['id']]), format='json',
        )
        assert resp.status_code == 200
        resp = admin_client.patch(
            reverse(self.STATUS_URL, args=[created['id']]),
            {'status': 'em_andamento'}, format='json',
        )
        assert resp.status_code == 200

    def test_update_status_denied_for_own_plain_user(self, auth_client):
        """Mesmo o autor do defeito (sem ser admin/atendente) NÃO pode mudar status."""
        created = _create_defeito(auth_client)
        resp = auth_client.patch(
            reverse(self.STATUS_URL, args=[created['id']]),
            {'status': 'em_andamento'}, format='json',
        )
        assert resp.status_code == 403

    def test_atendido_em_imutavel_apos_resolvido(self, admin_client):
        """Transição resolvido→resolvido NÃO sobrescreve o timestamp original."""
        import io
        from PIL import Image
        created = _create_defeito(admin_client)
        buf = io.BytesIO()
        Image.new('RGB', (64, 64), color='red').save(buf, format='JPEG')
        buf.seek(0)
        first = admin_client.patch(
            reverse(self.STATUS_URL, args=[created['id']]),
            {'status': 'atendido', 'foto_resolucao': buf},
            format='multipart',
        )
        assert first.status_code == 200
        first_ts = first.data['atendido_em']

        buf = io.BytesIO()
        Image.new('RGB', (64, 64), color='red').save(buf, format='JPEG')
        buf.seek(0)
        second = admin_client.patch(
            reverse(self.STATUS_URL, args=[created['id']]),
            {'status': 'concluido', 'foto_resolucao': buf},
            format='multipart',
        )
        assert second.status_code == 200
        assert second.data['atendido_em'] == first_ts


class TestBatchStatus:

    URL = 'defeitos-batch-status'

    def test_batch_status_updates_multiple(self, admin_client):
        d1 = _create_defeito(admin_client)
        d2 = _create_defeito(admin_client)
        d3 = _create_defeito(admin_client)
        resp = admin_client.patch(
            reverse(self.URL),
            {'ids': [d1['id'], d2['id']], 'status': 'em_andamento'},
            format='json',
        )
        assert resp.status_code == 200
        assert resp.data['updated'] == 2
        for d in (d1, d2):
            assert Defeito.objects.get(id=d['id']).status == 'em_andamento'
        assert Defeito.objects.get(id=d3['id']).status == 'pendente'

    def test_batch_status_invalid_status(self, admin_client):
        d1 = _create_defeito(admin_client)
        resp = admin_client.patch(
            reverse(self.URL),
            {'ids': [d1['id']], 'status': 'status_invalido'},
            format='json',
        )
        assert resp.status_code == 400

    def test_batch_status_denied_for_plain_user(self, client, admin_client):
        d1 = _create_defeito(admin_client)
        other = _new_user_client(client)
        resp = other.patch(
            reverse(self.URL),
            {'ids': [d1['id']], 'status': 'em_andamento'},
            format='json',
        )
        assert resp.status_code == 403

    def test_batch_status_unauthenticated(self, client, admin_client):
        d1 = _create_defeito(admin_client)
        resp = client.patch(
            reverse(self.URL),
            {'ids': [d1['id']], 'status': 'em_andamento'},
            format='json',
        )
        assert resp.status_code == 401

    def test_batch_status_rejects_empty_ids(self, admin_client):
        resp = admin_client.patch(
            reverse(self.URL),
            {'ids': [], 'status': 'em_andamento'},
            format='json',
        )
        assert resp.status_code == 400

    def test_batch_status_rejects_missing_ids(self, admin_client):
        resp = admin_client.patch(
            reverse(self.URL),
            {'status': 'em_andamento'},
            format='json',
        )
        assert resp.status_code == 400

    def test_batch_status_rejects_more_than_100_ids(self, admin_client):
        import uuid
        ids = [str(uuid.uuid4()) for _ in range(101)]
        resp = admin_client.patch(
            reverse(self.URL),
            {'ids': ids, 'status': 'em_andamento'},
            format='json',
        )
        assert resp.status_code == 400

    def test_batch_status_updates_atualizado_em(self, admin_client):
        d1 = _create_defeito(admin_client)
        antes = Defeito.objects.get(id=d1['id']).atualizado_em
        resp = admin_client.patch(
            reverse(self.URL),
            {'ids': [d1['id']], 'status': 'em_andamento'},
            format='json',
        )
        assert resp.status_code == 200
        depois = Defeito.objects.get(id=d1['id']).atualizado_em
        assert depois >= antes

    def test_batch_status_ignores_nonexistent_ids(self, admin_client):
        d1 = _create_defeito(admin_client)
        import uuid
        resp = admin_client.patch(
            reverse(self.URL),
            {'ids': [d1['id'], str(uuid.uuid4())], 'status': 'em_andamento'},
            format='json',
        )
        assert resp.status_code == 200
        assert resp.data['updated'] == 1
        assert Defeito.objects.get(id=d1['id']).status == 'em_andamento'

    def test_batch_status_resolvido_marca_atendido_em(self, admin_client):
        """Finalizar em lote é permitido (foto opcional) e registra atendido_em."""
        d1 = _create_defeito(admin_client)
        resp = admin_client.patch(
            reverse(self.URL),
            {'ids': [d1['id']], 'status': 'atendido'},
            format='json',
        )
        assert resp.status_code == 200
        obj = Defeito.objects.get(id=d1['id'])
        assert obj.status == 'atendido'
        assert obj.atendido_em


class TestOrdemServico:

    URL = 'defeitos-ordem-servico'

    def test_ordem_servico_pdf(self, admin_client):
        created = _create_defeito(admin_client, titulo='Buraco na Avenida')
        resp = admin_client.get(reverse(self.URL, args=[created['id']]))
        assert resp.status_code == 200
        assert resp['Content-Type'] == 'application/pdf'
        assert 'attachment' in resp['Content-Disposition']
        assert resp['Content-Disposition'].startswith('attachment; filename="OS-')
        assert b'%PDF' in resp.content

    def test_ordem_servico_contains_defeito_titulo(self, admin_client):
        from pypdf import PdfReader
        import io
        created = _create_defeito(admin_client, titulo='Buraco gigante no centro')
        resp = admin_client.get(reverse(self.URL, args=[created['id']]))
        assert resp.status_code == 200
        reader = PdfReader(io.BytesIO(resp.content))
        texto = ' '.join(page.extract_text() for page in reader.pages)
        assert 'Buraco gigante no centro' in texto

    def test_ordem_servico_denied_for_plain_user(self, client, admin_client):
        created = _create_defeito(admin_client)
        other = _new_user_client(client)
        resp = other.get(reverse(self.URL, args=[created['id']]))
        assert resp.status_code == 403

    def test_ordem_servico_unauthenticated(self, client, admin_client):
        created = _create_defeito(admin_client)
        resp = client.get(reverse(self.URL, args=[created['id']]))
        assert resp.status_code == 401

    def test_ordem_servico_nonexistent(self, admin_client):
        import uuid
        resp = admin_client.get(reverse(self.URL, args=[uuid.uuid4()]))
        assert resp.status_code == 404


class TestMeus:

    URL = 'defeitos-meus'

    def test_meus(self, auth_client):
        _create_defeito(auth_client, titulo='My Bug')
        _create_defeito(auth_client, titulo='Another Bug')
        resp = auth_client.get(reverse(self.URL))
        assert resp.status_code == 200
        assert resp.data['count'] >= 2

    def test_meus_empty(self, auth_client):
        resp = auth_client.get(reverse(self.URL))
        assert resp.status_code == 200
        assert resp.data['count'] == 0

    def test_meus_unauthenticated(self, client):
        resp = client.get(reverse(self.URL))
        assert resp.status_code == 401

    def test_meus_only_own(self, auth_client):
        _create_defeito(auth_client, titulo='My Bug')
        resp = auth_client.get(reverse(self.URL))
        for r in resp.data['results']:
            assert r['titulo'] == 'My Bug'


class TestApoiados:

    APOIAR_URL = 'defeitos-apoiar'
    APOIADOS_URL = 'defeitos-apoiados'

    def test_apoiados(self, auth_client):
        created = _create_defeito(auth_client)
        auth_client.post(reverse(self.APOIAR_URL, args=[created['id']]), format='json')
        resp = auth_client.get(reverse(self.APOIADOS_URL))
        assert resp.status_code == 200
        assert resp.data['count'] >= 1

    def test_apoiados_empty(self, auth_client):
        resp = auth_client.get(reverse(self.APOIADOS_URL))
        assert resp.status_code == 200
        assert resp.data['count'] == 0


class TestSlaVencido:

    def test_sla_vencido(self, auth_client, client):
        created = _create_defeito(auth_client)
        defeito = Defeito.objects.get(id=created['id'])
        defeito.criado_em = timezone.now() - timedelta(days=30)
        defeito.save()
        resp = client.get(reverse('defeitos-detail', args=[created['id']]))
        assert resp.status_code == 200
        assert resp.data['sla_vencido'] is True

    def test_sla_vencido_fresh(self, auth_client, client):
        created = _create_defeito(auth_client)
        resp = client.get(reverse('defeitos-detail', args=[created['id']]))
        assert resp.status_code == 200
        assert resp.data['sla_vencido'] is False


class TestDuplicadoPorCategoria:
    """Mesma categoria + chamado aberto + <= DUPLICATE_CATEGORY_RADIUS_M -> 409."""

    BASE = {'latitude': -22.9, 'longitude': -43.2, 'categoria': 'Buraco', 'descricao': ''}

    def _post(self, auth_client, **over):
        i = next(_COORD_COUNTER)
        data = {'titulo': f'Buraco {i}', 'rua': 'Rua X', 'bairro': 'Centro', **self.BASE, **over}
        return auth_client.post(reverse('defeitos-list'), com_foto(data), format='multipart')

    def test_mesma_categoria_a_5m_e_rejeitada(self, auth_client):
        primeiro = self._post(auth_client, longitude=-43.2000)
        assert primeiro.status_code == 201
        # ~5 m para leste (1e-5 grau de longitude ≈ 1 m nesta latitude)
        resp = self._post(auth_client, longitude=-43.2000 + 0.00005)
        assert resp.status_code == 409
        assert resp.data['duplicado'] is True
        assert resp.data['defeito_existente_id'] == str(primeiro.data['id'])
        assert resp.data['distancia_m'] <= 10
        assert 'Buraco' in resp.data['detail']

    def test_categoria_diferente_no_mesmo_ponto_passa(self, auth_client):
        assert self._post(auth_client, latitude=-22.91).status_code == 201
        assert self._post(auth_client, latitude=-22.91, categoria='Iluminação').status_code == 201

    def test_fora_do_raio_passa(self, auth_client):
        assert self._post(auth_client, latitude=-22.92).status_code == 201
        # ~30 m ao norte
        assert self._post(auth_client, latitude=-22.92 + 0.00027).status_code == 201

    def test_chamado_fechado_nao_bloqueia(self, auth_client):
        primeiro = self._post(auth_client, latitude=-22.93)
        assert primeiro.status_code == 201
        Defeito.objects.filter(id=primeiro.data['id']).update(status='concluido')
        assert self._post(auth_client, latitude=-22.93).status_code == 201

    def test_categoria_ignora_caixa(self, auth_client):
        assert self._post(auth_client, latitude=-22.94).status_code == 201
        assert self._post(auth_client, latitude=-22.94, categoria='buraco').status_code == 409


class TestMunicipioDoChamado:
    """O backend grava em qual município o ponto caiu (tabela `municipios`)."""

    def _post(self, auth_client, lat, lng):
        i = next(_COORD_COUNTER)
        return auth_client.post(reverse('defeitos-list'), com_foto({
            'titulo': f'Poste {i}', 'rua': 'Rua X', 'bairro': 'Centro', 'categoria': 'Iluminação',
            'descricao': '', 'latitude': lat, 'longitude': lng,
        }), format='multipart')

    def test_resolve_pelo_poligono(self, auth_client):
        from django.db import connection
        with connection.cursor() as cur:
            cur.execute("""
                INSERT INTO municipios (codigo, nome, uf, uf_sigla, min_lat, max_lat, min_lng, max_lng, polygon_geom)
                VALUES ('9999901', 'Cidade Teste', '35', 'SP', -23.1, -22.9, -49.4, -49.2,
                        ST_Multi(ST_GeomFromText('POLYGON((-49.4 -23.1, -49.2 -23.1, -49.2 -22.9, -49.4 -22.9, -49.4 -23.1))', 4326)))
                ON CONFLICT (codigo) DO NOTHING
            """)
        resp = self._post(auth_client, -23.0, -49.3)
        assert resp.status_code == 201, resp.data
        assert resp.data['municipio_id'] == '9999901'
        detalhe = auth_client.get(reverse('defeitos-detail', args=[resp.data['id']]))
        assert detalhe.data['municipio'] == {'codigo': '9999901', 'nome': 'Cidade Teste', 'uf_sigla': 'SP'}

    def test_fora_de_qualquer_municipio_fica_nulo(self, auth_client):
        resp = self._post(auth_client, 0.0, -30.0)  # Atlântico
        assert resp.status_code == 201, resp.data
        assert resp.data['municipio_id'] is None


class TestFotoObrigatoria:
    def test_sem_imagem_da_400(self, auth_client):
        resp = auth_client.post(reverse('defeitos-list'), {
            'titulo': 'Buraco sem foto', 'rua': 'Rua X', 'bairro': 'Centro', 'categoria': 'Buraco',
            'descricao': '', 'latitude': -22.95, 'longitude': -43.25,
        }, format='json')
        assert resp.status_code == 400
        assert 'imagem' in resp.data


class TestVisaoMunicipio:
    """GET /defeitos/municipio/?lat&lng: cidade do ponto, abertos e rankings."""

    def _post(self, auth_client, categoria, lat, lng):
        i = next(_COORD_COUNTER)
        return auth_client.post(reverse('defeitos-list'), com_foto({
            'titulo': f'{categoria} {i}', 'rua': 'Rua X', 'bairro': 'Centro', 'categoria': categoria,
            'descricao': '', 'latitude': lat, 'longitude': lng,
        }), format='multipart')

    def test_rankings_da_cidade(self, auth_client, client):
        from django.db import connection
        with connection.cursor() as cur:
            cur.execute("""
                INSERT INTO municipios (codigo, nome, uf, uf_sigla, min_lat, max_lat, min_lng, max_lng, polygon_geom)
                VALUES ('9999902', 'Cidade Ranking', '35', 'SP', -24.1, -23.9, -50.4, -50.2,
                        ST_Multi(ST_GeomFromText('POLYGON((-50.4 -24.1, -50.2 -24.1, -50.2 -23.9, -50.4 -23.9, -50.4 -24.1))', 4326)))
                ON CONFLICT (codigo) DO NOTHING
            """)
        assert self._post(auth_client, 'Buraco', -24.00, -50.30).status_code == 201
        assert self._post(auth_client, 'Buraco', -24.01, -50.31).status_code == 201
        assert self._post(auth_client, 'Entulho', -24.02, -50.32).status_code == 201

        resp = client.get(reverse('defeitos-municipio'), {'lat': -24.0, 'lng': -50.3})
        assert resp.status_code == 200, resp.data
        assert resp.data['municipio']['codigo'] == '9999902'
        assert resp.data['municipio']['min_lat'] == -24.1
        assert resp.data['total_abertos'] == 3
        assert resp.data['tipos'][0] == {'categoria': 'Buraco', 'total': 2}
        assert len(resp.data['mais_antigos']) == 3
        assert resp.data['mais_apoiados'] == []
        assert {d['municipio_id'] for d in resp.data['defeitos']} == {'9999902'}

    def test_ponto_sem_municipio_404(self, client):
        assert client.get(reverse('defeitos-municipio'), {'lat': 0, 'lng': -30}).status_code == 404

    def test_sem_coordenadas_400(self, client):
        assert client.get(reverse('defeitos-municipio')).status_code == 400


class TestOperacaoPorMunicipio:
    """
    Operador vinculado a um município só opera (fila, assumir, status, OS,
    lote) nos chamados que caíram nele. Como cidadão, vê e reporta em
    qualquer lugar.
    """

    CIDADE = '9999903'

    def _cidade(self):
        from django.db import connection
        with connection.cursor() as cur:
            cur.execute("""
                INSERT INTO municipios (codigo, nome, uf, uf_sigla, min_lat, max_lat, min_lng, max_lng, polygon_geom)
                VALUES (%s, 'Cidade Operacao', '35', 'SP', -25.1, -24.9, -51.4, -51.2,
                        ST_Multi(ST_GeomFromText('POLYGON((-51.4 -25.1, -51.2 -25.1, -51.2 -24.9, -51.4 -24.9, -51.4 -25.1))', 4326)))
                ON CONFLICT (codigo) DO NOTHING
            """, [self.CIDADE])

    def _operador(self, client, municipio_id=None):
        """Admin comum (não super) vinculado — ou não — a um município."""
        from users.models import User
        op = _new_user_client(client)
        # O cliente autentica por JWT; acha o usuário pelo perfil.
        perfil = op.get(reverse('auth-profile'))
        user = User.objects.get(id=perfil.data['id'])
        user.admin = 1
        user.municipio_id = municipio_id
        user.save(update_fields=['admin', 'municipio_id'])
        return op

    @staticmethod
    def _passo():
        """Deslocamento unico na sessao: o banco de teste guarda chamados entre
        testes e a deteccao de duplicado (mesma categoria, perto) daria 409."""
        return next(_COORD_COUNTER) * 0.0005

    def _dentro(self, auth_client):
        passo = self._passo()
        return _create_defeito(auth_client, latitude=-25.095 + passo, longitude=-51.395 + passo)

    def _fora(self, auth_client):
        passo = self._passo()
        # Longe de qualquer outra cidade de teste.
        return _create_defeito(auth_client, latitude=-27.0 + passo, longitude=-52.0 - passo)

    def test_fila_so_do_municipio(self, client, auth_client):
        self._cidade()
        dentro = self._dentro(auth_client)
        self._fora(auth_client)
        op = self._operador(client, self.CIDADE)
        resp = op.get(reverse('defeitos-operacao'))
        assert resp.status_code == 200, resp.data
        assert resp.data['municipio'] == {'codigo': self.CIDADE, 'nome': 'Cidade Operacao', 'uf_sigla': 'SP'}
        assert [d['id'] for d in resp.data['defeitos']] == [dentro['id']]

    def test_sem_municipio_nao_opera(self, client):
        op = self._operador(client, None)
        assert op.get(reverse('defeitos-operacao')).status_code == 403

    def test_assumir_so_no_seu_municipio(self, client, auth_client):
        self._cidade()
        dentro = self._dentro(auth_client)
        fora = self._fora(auth_client)
        op = self._operador(client, self.CIDADE)
        assert op.patch(reverse('defeitos-atender', args=[fora['id']])).status_code == 403
        assert op.patch(reverse('defeitos-atender', args=[dentro['id']])).status_code == 200

    def test_status_e_os_so_no_seu_municipio(self, client, auth_client):
        self._cidade()
        fora = self._fora(auth_client)
        op = self._operador(client, self.CIDADE)
        resp = op.patch(reverse('defeitos-status', args=[fora['id']]), {'status': 'em_andamento'}, format='json')
        assert resp.status_code == 403
        assert op.get(reverse('defeitos-ordem-servico', args=[fora['id']])).status_code == 403

    def test_lote_ignora_outros_municipios(self, client, auth_client):
        self._cidade()
        dentro = self._dentro(auth_client)
        fora = self._fora(auth_client)
        op = self._operador(client, self.CIDADE)
        resp = op.patch(
            reverse('defeitos-batch-status'),
            {'ids': [dentro['id'], fora['id']], 'status': 'em_andamento'}, format='json',
        )
        assert resp.status_code == 200
        assert resp.data['updated'] == 1
        assert Defeito.objects.get(id=fora['id']).status == 'pendente'

    def test_como_cidadao_continua_vendo_tudo(self, client, auth_client):
        """O vínculo não recorta a listagem pública nem o detalhe."""
        self._cidade()
        fora = self._fora(auth_client)
        op = self._operador(client, self.CIDADE)
        # Busca pelo titulo: a listagem e paginada.
        lista = op.get(reverse('defeitos-list'), {'search': fora['titulo']}).data['results']
        assert fora['id'] in {d['id'] for d in lista}
        assert op.get(reverse('defeitos-detail', args=[fora['id']])).status_code == 200


class TestAtenderSoOperador:
    def test_cidadao_nao_assume(self, auth_client):
        created = _create_defeito(auth_client)
        resp = auth_client.patch(reverse('defeitos-atender', args=[created['id']]), format='json')
        assert resp.status_code == 403



def _progresso(cli):
    resp = cli.get(reverse('defeitos-progresso'))
    assert resp.status_code == 200
    return resp.data


def _id_do_usuario(cli):
    return str(cli.get(reverse('auth-profile')).data['id'])


class TestGamificacao:
    """Nível/EXP derivados do histórico (ver `gamificacao.py`)."""

    def test_curva_de_nivel(self):
        from defeitos import gamificacao
        assert gamificacao.progresso(0)['nivel'] == 1
        assert gamificacao.progresso(29)['nivel'] == 1
        # 3 chamados (30 XP) ou 5 confirmações (30 XP) sobem ao nível 2.
        assert gamificacao.XP_CHAMADO * 3 == gamificacao.xp_para_nivel(2)
        assert gamificacao.XP_CONFIRMACAO * 5 == gamificacao.xp_para_nivel(2)
        dois = gamificacao.progresso(30)
        assert dois['nivel'] == 2
        assert dois['xp_nivel'] == 30
        assert dois['xp_proximo'] == 90
        assert gamificacao.progresso(90)['nivel'] == 3
        assert gamificacao.progresso(10_000)['titulo'] == 'Lenda da Cidade'

    def test_progresso_exige_login(self, client):
        assert client.get(reverse('defeitos-progresso')).status_code == 401

    def test_tres_chamados_sobem_de_nivel(self, client):
        cli = _new_user_client(client)
        for _ in range(3):
            _create_defeito(cli)
        dados = _progresso(cli)
        assert dados['chamados'] == 3
        assert dados['xp'] == 30
        assert dados['nivel'] == 2

    def test_cinco_confirmacoes_sobem_de_nivel(self, client, auth_client):
        cli = _new_user_client(client)
        for _ in range(5):
            created = _create_defeito(auth_client)
            resp = cli.post(reverse('defeitos-apoiar', args=[created['id']]), format='json')
            assert resp.status_code == 201
        dados = _progresso(cli)
        assert dados['confirmacoes'] == 5
        assert dados['xp'] == 30
        assert dados['nivel'] == 2

    def test_apoio_no_proprio_chamado_nao_pontua(self, client):
        cli = _new_user_client(client)
        created = _create_defeito(cli)
        cli.post(reverse('defeitos-apoiar', args=[created['id']]), format='json')
        dados = _progresso(cli)
        assert dados['confirmacoes'] == 0
        assert dados['xp'] == 10

    def test_chamado_resolvido_da_bonus(self, client):
        cli = _new_user_client(client)
        created = _create_defeito(cli)
        Defeito.objects.filter(id=created['id']).update(status='concluido')
        dados = _progresso(cli)
        assert dados['resolvidos'] == 1
        assert dados['xp'] == 25

    def test_strike_desconta_sem_ficar_negativo(self, client):
        from defeitos.models import Strike
        cli = _new_user_client(client)
        _create_defeito(cli)
        Strike.objects.create(
            usuario_id=_id_do_usuario(cli), titulo='t', criado_em=timezone.now(),
        )
        assert _progresso(cli)['xp'] == 0

    def test_chamado_apagado_leva_o_xp_junto(self, client):
        cli = _new_user_client(client)
        created = _create_defeito(cli)
        assert _progresso(cli)['xp'] == 10
        resp = cli.post(
            reverse('defeitos-sinalizar', args=[created['id']]),
            {'tipo': 'nao_existe'}, format='json',
        )
        assert resp.data['resultado'] == 'inexistente'
        assert _progresso(cli)['xp'] == 0


class TestRanking:
    """Leaderboard por município: contribuição na cidade (chamados + confirmações)."""

    CIDADE = '9999910'

    def _cria_municipio(self):
        from django.db import connection
        with connection.cursor() as cur:
            cur.execute("""
                INSERT INTO municipios (codigo, nome, uf, uf_sigla, min_lat, max_lat, min_lng, max_lng, polygon_geom)
                VALUES ('9999910', 'Cidade Ranking', '35', 'SP', -27.1, -26.9, -54.4, -54.2,
                        ST_Multi(ST_GeomFromText('POLYGON((-54.4 -27.1, -54.2 -27.1, -54.2 -26.9, -54.4 -26.9, -54.4 -27.1))', 4326)))
                ON CONFLICT (codigo) DO NOTHING
            """)

    def _report(self, cli, lat):
        return _create_defeito(cli, latitude=lat, longitude=-54.3, categoria='Entulho')

    def test_parametros_obrigatorios(self, client):
        assert client.get(reverse('defeitos-ranking')).status_code == 400
        resp = client.get(reverse('defeitos-ranking'), {'municipio': '0000000'})
        assert resp.status_code == 404

    def test_ordena_por_contribuicao_na_cidade(self, client):
        self._cria_municipio()
        autor, outro = _new_user_client(client), _new_user_client(client)
        id_autor, id_outro = _id_do_usuario(autor), _id_do_usuario(outro)

        # autor: 2 chamados (20 XP); outro: 1 chamado + 2 confirmações (22 XP).
        a1 = self._report(autor, -27.01)
        a2 = self._report(autor, -27.03)
        self._report(outro, -27.05)
        for criado in (a1, a2):
            outro.post(reverse('defeitos-apoiar', args=[criado['id']]), format='json')

        resp = autor.get(reverse('defeitos-ranking'), {'municipio': self.CIDADE})
        assert resp.status_code == 200
        assert resp.data['municipio']['nome'] == 'Cidade Ranking'
        posicoes = {i['usuario_id']: i for i in resp.data['ranking']}
        assert posicoes[id_outro]['xp'] == 22
        assert posicoes[id_autor]['xp'] == 20
        assert posicoes[id_outro]['posicao'] < posicoes[id_autor]['posicao']
        assert resp.data['eu']['usuario_id'] == id_autor

        # Chamado do autor resolvido: bônus vira 35 XP e ele passa à frente.
        Defeito.objects.filter(id=a1['id']).update(status='concluido')
        resp = client.get(reverse('defeitos-ranking'), {'municipio': self.CIDADE})
        posicoes = {i['usuario_id']: i for i in resp.data['ranking']}
        assert posicoes[id_autor]['xp'] == 35
        assert posicoes[id_autor]['posicao'] < posicoes[id_outro]['posicao']
        assert resp.data['eu'] is None

    def test_resolve_municipio_pelo_ponto(self, client, auth_client):
        self._cria_municipio()
        self._report(auth_client, -27.07)
        resp = client.get(reverse('defeitos-ranking'), {'lat': -27.0, 'lng': -54.3})
        assert resp.status_code == 200
        assert resp.data['municipio']['codigo'] == self.CIDADE

    def test_geral_e_periodo(self, client):
        self._cria_municipio()
        cli = _new_user_client(client)
        meu_id = _id_do_usuario(cli)
        antigo = self._report(cli, -27.081)
        # Um chamado "de um mês atrás": sai do recorte semanal, fica no geral.
        Defeito.objects.filter(id=antigo['id']).update(
            criado_em=timezone.now() - timedelta(days=31),
        )
        self._report(cli, -27.083)

        geral = client.get(reverse('defeitos-ranking'), {'geral': '1'})
        assert geral.status_code == 200
        assert geral.data['municipio'] is None
        linha = next(i for i in geral.data['ranking'] if i['usuario_id'] == meu_id)
        assert linha['chamados'] == 2

        semana = client.get(reverse('defeitos-ranking'), {'geral': '1', 'periodo': 'semana'})
        linha = next(i for i in semana.data['ranking'] if i['usuario_id'] == meu_id)
        assert linha['chamados'] == 1

        assert client.get(
            reverse('defeitos-ranking'), {'geral': '1', 'periodo': 'ano'},
        ).status_code == 400
