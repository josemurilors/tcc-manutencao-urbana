"""
Município de demonstração para vendas e BI: cidadãos fictícios, equipe da
prefeitura (gestor e operadores por equipe) e chamados com o ciclo de vida
completo — triagem, atribuição, execução, conclusão com resposta pública,
rejeições com motivo, duplicados, reaberturas, avaliações, apoios e
sinalizações —, espalhados pelos últimos `--dias` com horários coerentes.

Tudo passa por `defeitos.fluxo` (transições, atribuição, eventos), com o
relógio do Django recuado para o instante simulado de cada passo; os eventos
do histórico ganham o mesmo instante. Nenhum aviso sai (in-app nem push).

O que é demo: usuários com e-mail `@demo.ciu` do município e os chamados
abertos por eles. `--limpar-demo` apaga só isso (chamados e, em cascata,
histórico, apoios, sinalizações e avisos). Rodar de novo limpa a demo
anterior do município antes de gerar outra. Secretarias e equipes vêm do
`seed_gestao_demo` (criadas se faltarem) e ficam: são a estrutura da
prefeitura, não dado de demonstração.

Uso:
    python manage.py seed_demo                      # São Paulo, 600 chamados, 180 dias
    python manage.py seed_demo --municipio 3509502 --chamados 300 --dias 90
    python manage.py seed_demo --senha 'Demo@2026'  # equipe demo pode entrar no app
    python manage.py seed_demo --limpar-demo        # remove só a demo do município
"""
import math
import random
import unicodedata
from contextlib import contextmanager
from datetime import timedelta
from unittest import mock

from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from django.db.models import Count
from django.utils import timezone

DOMINIO_DEMO = 'demo.ciu'
MUNICIPIO_PADRAO = '3550308'

# (categoria, peso, trecho do nome da equipe que atende)
CATEGORIAS = (
    ('Buraco', 30, 'pavimenta'),
    ('Iluminação', 22, 'ilumina'),
    ('Entulho', 16, 'limpeza'),
    ('Calçada Danificada', 12, 'calcada'),
    ('Outro', 8, 'limpeza'),
    ('Árvore Caída', 7, 'poda'),
    ('Semáforo', 5, 'sinaliza'),
)

# Bairros reais de São Paulo (centro aproximado e peso ~ população/volume).
BAIRROS_SP = (
    ('Sé', -23.5503, -46.6339, 4), ('República', -23.5432, -46.6420, 4),
    ('Bela Vista', -23.5614, -46.6450, 4), ('Consolação', -23.5530, -46.6610, 3),
    ('Pinheiros', -23.5670, -46.6930, 4), ('Vila Mariana', -23.5890, -46.6340, 5),
    ('Mooca', -23.5600, -46.5990, 5), ('Tatuapé', -23.5400, -46.5760, 5),
    ('Santana', -23.5020, -46.6250, 5), ('Lapa', -23.5250, -46.7030, 4),
    ('Butantã', -23.5700, -46.7300, 4), ('Ipiranga', -23.5890, -46.6060, 5),
    ('Jabaquara', -23.6460, -46.6410, 4), ('Vila Prudente', -23.5830, -46.5800, 4),
    ('Penha', -23.5260, -46.5440, 5), ('Freguesia do Ó', -23.5020, -46.6970, 4),
    ('Santo Amaro', -23.6540, -46.7100, 5), ('Itaquera', -23.5400, -46.4560, 7),
    ('São Miguel Paulista', -23.4980, -46.4440, 6), ('Brasilândia', -23.4690, -46.6900, 6),
    ('Campo Limpo', -23.6400, -46.7600, 6), ('Capão Redondo', -23.6720, -46.7790, 7),
    ('Cidade Tiradentes', -23.5820, -46.4090, 6), ('Grajaú', -23.7600, -46.6950, 7),
)

# Para outros municípios: nomes comuns, posicionados em volta do centro.
BAIRROS_GENERICOS = (
    'Centro', 'Vila Nova', 'Jardim América', 'Vila São José', 'Jardim Primavera',
    'Parque Industrial', 'Vila Esperança', 'Jardim das Flores', 'Santa Cruz',
    'Boa Vista', 'São Benedito', 'Jardim Europa', 'Vila Operária', 'Cidade Nova',
)

RUAS = (
    'Rua São Bento', 'Rua das Flores', 'Avenida Brasil', 'Rua Tiradentes',
    'Rua Sete de Setembro', 'Rua XV de Novembro', 'Avenida Santos Dumont',
    'Rua Dom Pedro II', 'Rua Rui Barbosa', 'Rua José Bonifácio', 'Rua Marechal Deodoro',
    'Avenida Getúlio Vargas', 'Rua Castro Alves', 'Rua Monteiro Lobato',
    'Rua Padre Anchieta', 'Rua das Palmeiras', 'Rua Ipiranga', 'Rua da Paz',
    'Avenida Independência', 'Rua Benjamin Constant', 'Travessa Santa Luzia',
    'Rua Cecília Meireles', 'Rua Carlos Gomes', 'Rua Machado de Assis',
)

NOMES = (
    'Ana', 'Bruno', 'Carla', 'Daniel', 'Eduarda', 'Felipe', 'Gabriela', 'Henrique',
    'Isabela', 'João', 'Larissa', 'Lucas', 'Mariana', 'Mateus', 'Natália', 'Otávio',
    'Patrícia', 'Rafael', 'Renata', 'Rodrigo', 'Sabrina', 'Thiago', 'Vanessa',
    'Vinícius', 'Aline', 'Carlos', 'Fernanda', 'Gustavo', 'Juliana', 'Marcelo',
    'Priscila', 'Ricardo', 'Simone', 'Tatiane', 'Wagner', 'Beatriz', 'Diego',
    'Elaine', 'Fábio', 'Helena', 'Igor', 'Jéssica', 'Leandro', 'Márcia', 'Paulo',
)
SOBRENOMES = (
    'Silva', 'Santos', 'Oliveira', 'Souza', 'Rodrigues', 'Ferreira', 'Alves',
    'Pereira', 'Lima', 'Gomes', 'Costa', 'Ribeiro', 'Martins', 'Carvalho',
    'Almeida', 'Lopes', 'Soares', 'Fernandes', 'Vieira', 'Barbosa', 'Rocha',
    'Dias', 'Nascimento', 'Andrade', 'Moreira', 'Nunes', 'Marques', 'Machado',
)

TEXTOS = {
    'Buraco': (
        ('Buraco grande na pista', 'Buraco fundo no meio da faixa, carros desviam pela contramão.'),
        ('Cratera perto da faixa de pedestres', 'Já vi moto cair aqui. Fica cheio de água quando chove.'),
        ('Asfalto afundando', 'O asfalto está cedendo perto do bueiro e o buraco aumenta a cada dia.'),
        ('Buraco na frente da escola', 'Na saída das crianças fica perigoso, os carros freiam em cima.'),
    ),
    'Iluminação': (
        ('Poste apagado há dias', 'Rua escura à noite, moradores com medo de passar.'),
        ('Lâmpada piscando', 'A lâmpada do poste fica acendendo e apagando a noite toda.'),
        ('Quarteirão inteiro sem luz', 'Três postes seguidos apagados, perto do ponto de ônibus.'),
        ('Luz acesa durante o dia', 'O poste fica aceso o dia inteiro, desperdício de energia.'),
    ),
    'Entulho': (
        ('Entulho jogado na calçada', 'Restos de obra bloqueando a passagem de pedestres.'),
        ('Descarte irregular de móveis', 'Sofá e colchão abandonados na esquina há uma semana.'),
        ('Lixo acumulado em terreno', 'Terreno baldio virou ponto de descarte, aparecendo ratos.'),
    ),
    'Calçada Danificada': (
        ('Calçada quebrada', 'Piso solto e levantado, idosos já tropeçaram aqui.'),
        ('Raiz levantou a calçada', 'A raiz da árvore quebrou todo o passeio, cadeirante não passa.'),
        ('Rampa de acessibilidade destruída', 'A rampa da esquina está quebrada e com ferragem exposta.'),
    ),
    'Outro': (
        ('Boca de lobo entupida', 'Quando chove a rua alaga por causa do bueiro entupido.'),
        ('Placa de rua caída', 'A placa com o nome da rua caiu e está no chão.'),
        ('Banco da praça quebrado', 'O banco está sem o assento e com pregos para fora.'),
    ),
    'Árvore Caída': (
        ('Árvore caída na via', 'Árvore caiu com o temporal e bloqueia metade da rua.'),
        ('Galho grande quebrado', 'Galho pendurado sobre a fiação, pode cair a qualquer momento.'),
        ('Árvore inclinada sobre a casa', 'A árvore está tombando na direção das casas depois da chuva.'),
    ),
    'Semáforo': (
        ('Semáforo apagado', 'Cruzamento movimentado com o semáforo desligado, risco de acidente.'),
        ('Semáforo travado no vermelho', 'O sinal não abre para quem vem da avenida, forma fila enorme.'),
        ('Semáforo de pedestre quebrado', 'O botão não funciona e o sinal de pedestre nunca abre.'),
    ),
}

RESPOSTAS = {
    'Buraco': 'Buraco tapado com massa asfáltica pela equipe de pavimentação.',
    'Iluminação': 'Lâmpada e reator substituídos; iluminação restabelecida.',
    'Entulho': 'Material recolhido e local limpo pela equipe de limpeza urbana.',
    'Calçada Danificada': 'Trecho da calçada refeito e piso nivelado.',
    'Outro': 'Serviço executado pela equipe responsável.',
    'Árvore Caída': 'Árvore removida e via liberada pela equipe de poda.',
    'Semáforo': 'Semáforo reparado e sincronizado com o cruzamento.',
}

NOTAS_INTERNAS = (
    'Material solicitado ao almoxarifado.',
    'Equipe passou no local, precisa de caminhão para concluir.',
    'Aguardando liberação do trânsito para executar.',
    'Serviço incluído na rota da semana.',
)

# (motivo, resposta pública ao cidadão)
REJEICOES = (
    ('fora_da_competencia', 'Esta ocorrência é de responsabilidade da concessionária; encaminhamos o pedido a ela.'),
    ('nao_localizado', 'A equipe esteve no endereço informado e não localizou o problema.'),
    ('ja_resolvido', 'O problema já havia sido resolvido quando a equipe chegou ao local.'),
    ('improcedente', 'Após vistoria, a situação não caracteriza defeito na via pública.'),
)

REABERTURAS = (
    'O buraco voltou depois da chuva.',
    'A lâmpada apagou de novo dois dias depois.',
    'O serviço ficou pela metade, ainda há entulho no local.',
)

COMENTARIOS = {
    5: ('Resolveram muito rápido, parabéns!', 'Ótimo atendimento, ficou perfeito.',
        'Nem acreditei, em poucos dias estava pronto.', ''),
    4: ('Bom serviço, só demorou um pouco.', 'Resolvido, obrigado.', ''),
    3: ('Resolveram, mas demorou bastante.', 'O serviço ficou razoável.', ''),
    2: ('Demorou demais e o acabamento ficou ruim.', 'Precisei reclamar várias vezes.'),
    1: ('Fecharam o chamado mas o problema continua.', 'Péssimo, levou semanas.'),
}


def _slug(texto):
    sem_acento = unicodedata.normalize('NFKD', texto).encode('ascii', 'ignore').decode('ascii')
    return '.'.join(sem_acento.lower().split())


@contextmanager
def _relogio(quando):
    """`timezone.now()` devolve `quando` (o fluxo grava timestamps por ele)."""
    with mock.patch('django.utils.timezone.now', return_value=quando):
        yield


def _escolher(rng, itens, pesos):
    return rng.choices(itens, weights=pesos, k=1)[0]


def demo_users(codigo):
    from users.models import User

    return User.objects.filter(email__iendswith=f'@{DOMINIO_DEMO}', municipio_id=str(codigo))


def demo_chamados(codigo):
    from defeitos.models import Defeito

    return Defeito.objects.filter(
        municipio_id=str(codigo), usuario__email__iendswith=f'@{DOMINIO_DEMO}',
    )


def limpar(codigo):
    """Apaga a demo do município; devolve (chamados, usuários) removidos."""
    from defeitos.models import Defeito

    ids = list(demo_chamados(codigo).values_list('id', flat=True))
    # Duplicados apontam para o original: solta a referência antes de apagar.
    Defeito.objects.filter(duplicado_de_id__in=ids).update(duplicado_de=None)
    Defeito.objects.filter(id__in=ids).delete()
    usuarios = demo_users(codigo)
    total_usuarios = usuarios.count()
    usuarios.delete()
    return len(ids), total_usuarios


class Gerador:
    def __init__(self, codigo, municipio, total, dias, senha, rng, stdout):
        self.codigo = codigo
        self.municipio = municipio
        self.total = total
        self.dias = dias
        self.senha = senha
        self.rng = rng
        self.stdout = stdout
        self.agora = timezone.now()
        self.inicio_real = self.agora
        self.contagem = {'duplicado': 0, 'reaberto': 0, 'avaliacoes': 0, 'apoios': 0, 'sinalizacoes': 0}

    # --- estrutura ------------------------------------------------------

    def bairros(self):
        if self.codigo == MUNICIPIO_PADRAO:
            return [(n, lat, lng, p) for n, lat, lng, p in BAIRROS_SP]
        with connection.cursor() as cur:
            cur.execute(
                'SELECT ST_Y(p), ST_X(p) FROM (SELECT ST_PointOnSurface(polygon_geom::geometry) AS p '
                'FROM municipios WHERE codigo = %s AND polygon_geom IS NOT NULL) s',
                [self.codigo],
            )
            linha = cur.fetchone()
        m = self.municipio
        lat0, lng0 = linha if linha else ((m.min_lat + m.max_lat) / 2, (m.min_lng + m.max_lng) / 2)
        # Raio: um quarto da menor dimensão da cidade, no máximo ~6 km.
        raio = min(0.055, (m.max_lat - m.min_lat) / 4, (m.max_lng - m.min_lng) / 4)
        bairros = [('Centro', lat0, lng0, 6)]
        for i, nome in enumerate(BAIRROS_GENERICOS[1:]):
            angulo = 2 * math.pi * i / (len(BAIRROS_GENERICOS) - 1)
            dist = raio * (0.45 + 0.55 * self.rng.random())
            bairros.append((nome, lat0 + dist * math.sin(angulo), lng0 + dist * math.cos(angulo),
                            self.rng.randint(2, 5)))
        return bairros

    def _usuario(self, nome, email, **extra):
        from users.models import User

        user = User(email=email, nome=nome, municipio_id=self.codigo, email_verified=1,
                    aceite_termos_em=self.agora, **extra)
        if self.senha and extra.get('papel', 'cidadao') != 'cidadao':
            user.set_password(self.senha)
        else:
            user.set_unusable_password()
        user.save()
        return user

    def _nome(self):
        return f'{self.rng.choice(NOMES)} {self.rng.choice(SOBRENOMES)}'

    def equipe_e_usuarios(self):
        from gestao.models import Equipe

        if not Equipe.objects.filter(municipio_id=self.codigo, ativo=True).exists():
            call_command('seed_gestao_demo', self.codigo, stdout=self.stdout)
        self.equipes = list(Equipe.objects.filter(municipio_id=self.codigo, ativo=True).order_by('id'))
        self.gestor = self._usuario('Gestora Demo', f'gestora.{self.codigo}@{DOMINIO_DEMO}',
                                    papel='gestor')
        self.operadores = {}
        for equipe in self.equipes:
            membros = []
            for i in range(self.rng.randint(2, 3)):
                membros.append(self._usuario(
                    self._nome(), f'operador.{equipe.id}.{i + 1}.{self.codigo}@{DOMINIO_DEMO}',
                    papel='operador', equipe_id=equipe.id, secretaria_id=equipe.secretaria_id,
                ))
            self.operadores[equipe.id] = membros

        qtd = max(20, self.total // 3)
        self.cidadaos = []
        for i in range(qtd):
            nome = self._nome()
            self.cidadaos.append(self._usuario(nome, f'{_slug(nome)}.{i + 1}.{self.codigo}@{DOMINIO_DEMO}'))
        # Poucos cidadãos reportam muito; a maioria, uma ou duas vezes.
        self.pesos_cidadaos = [1 / (i + 1) ** 0.7 for i in range(qtd)]

    def _equipe_para(self, trecho, secretaria_id):
        def chave(e):
            return _slug(e.nome).replace('.', ' ')
        for equipe in self.equipes:
            if trecho in chave(equipe):
                return equipe
        da_secretaria = [e for e in self.equipes if e.secretaria_id == secretaria_id]
        return (da_secretaria or self.equipes or [None])[0]

    # --- tempo ----------------------------------------------------------

    def _instante_criacao(self):
        # Mais volume recente (adoção crescendo) e horário comercial ampliado.
        idade_dias = self.dias * self.rng.random() ** 1.35
        quando = self.agora - timedelta(days=idade_dias)
        local = timezone.localtime(quando)
        hora = _escolher(self.rng, list(range(6, 23)),
                         [1, 3, 5, 6, 6, 5, 5, 6, 6, 5, 5, 5, 6, 6, 4, 3, 2])
        local = local.replace(hour=hora, minute=self.rng.randint(0, 59), second=self.rng.randint(0, 59))
        quando = local.astimezone(timezone.get_current_timezone())
        return min(quando, self.agora - timedelta(minutes=30))

    def _horas(self, minimo, maximo):
        return timedelta(hours=self.rng.uniform(minimo, maximo))

    # --- passos do fluxo -------------------------------------------------

    def _em(self, defeito, quando, funcao, *args, **kwargs):
        """Roda `funcao` no instante simulado e dá esse instante aos eventos criados."""
        from defeitos.models import DefeitoEvento

        with _relogio(quando):
            resultado = funcao(*args, **kwargs)
        DefeitoEvento.objects.filter(defeito=defeito, criado_em__gte=self.inicio_real).update(criado_em=quando)
        return resultado

    def _passou(self, quando):
        return quando >= self.agora

    def criar(self, categoria, bairro, criado_em, autor, perto_de=None):
        from defeitos import fluxo, sla
        from defeitos.models import Defeito

        nome_bairro, lat0, lng0, _ = bairro
        if perto_de is not None:
            lat = perto_de.latitude + self.rng.gauss(0, 0.00012)
            lng = perto_de.longitude + self.rng.gauss(0, 0.00012)
            rua = perto_de.rua
        else:
            lat = lat0 + self.rng.gauss(0, 0.007)
            lng = lng0 + self.rng.gauss(0, 0.007)
            rua = f'{self.rng.choice(RUAS)}, {self.rng.randint(10, 2500)}'
        titulo, descricao = self.rng.choice(TEXTOS[categoria])
        regra = sla.regra_para(categoria, self.codigo)
        defeito = Defeito(
            usuario=autor, usuario_email=autor.email, titulo=titulo, descricao=descricao,
            latitude=round(lat, 6), longitude=round(lng, 6), rua=rua, bairro=nome_bairro,
            categoria=categoria, status='pendente', municipio_id=self.codigo,
            categoria_id=regra['categoria_id'], prioridade=regra['prioridade'],
            secretaria_id=regra['secretaria_id'], secretaria_responsavel=regra['secretaria_nome'],
            prazo_sla_dias=regra['prazo_sla_dias'],
            prazo_em=sla.calcular_prazo(criado_em, regra['prazo_sla_dias']),
            criado_em=criado_em, atualizado_em=criado_em,
        )
        defeito.save()
        self._em(defeito, criado_em, fluxo.registrar_evento, defeito, 'criado', autor,
                 para_status='pendente')
        return defeito

    def ciclo(self, defeito, categoria, trecho, idade_frac, duplicado_de=None):
        """Leva o chamado pelo ciclo até onde o tempo simulado alcança (`agora`)."""
        from defeitos import fluxo

        rng = self.rng
        t = defeito.criado_em
        sla_dias = max(defeito.prazo_sla_dias or 7, 1)

        # Triagem.
        t += self._horas(1, 30) * (1 + idade_frac)
        if self._passou(t):
            return
        self._em(defeito, t, fluxo.transicionar, defeito, 'em_analise', self.gestor)

        if duplicado_de is not None:
            t += self._horas(0.5, 6)
            if self._passou(t):
                return
            self._em(defeito, t, fluxo.transicionar, defeito, 'rejeitado', self.gestor,
                     motivo='duplicado', duplicado_de=duplicado_de,
                     resposta_publica=f'Já existe um chamado para este problema: {duplicado_de.protocolo}. '
                                      'Acompanhe por ele.')
            self.contagem['duplicado'] += 1
            return
        if rng.random() < 0.08:
            motivo, resposta = rng.choice(REJEICOES)
            t += self._horas(2, 48)
            if self._passou(t):
                return
            self._em(defeito, t, fluxo.transicionar, defeito, 'rejeitado', self.gestor,
                     motivo=motivo, resposta_publica=resposta)
            return

        # Atribuição a equipe e operador.
        equipe = self._equipe_para(trecho, defeito.secretaria_id)
        t += self._horas(0.5, 20)
        if self._passou(t) or equipe is None:
            return
        operador = rng.choice(self.operadores[equipe.id])
        self._em(defeito, t, fluxo.atribuir, defeito, self.gestor,
                 equipe_id=equipe.id, atendente_id=operador.id)

        # Uns ficam parados (backlog real que envelhece).
        if rng.random() < 0.05:
            return

        # Tempo de solução ~ SLA da categoria; mais lento no começo da operação.
        fator = rng.lognormvariate(-0.45, 0.55) * (1 + 0.6 * idade_frac)
        solucao = timedelta(days=sla_dias * fator)
        inicio = defeito.criado_em + solucao * rng.uniform(0.4, 0.85)
        fim = defeito.criado_em + solucao
        if rng.random() < 0.5:
            t += self._horas(1, 6)
            if self._passou(t):
                return
            self._em(defeito, t, fluxo.transicionar, defeito, 'agendado', operador)
        t = max(inicio, t + self._horas(1, 4))
        if self._passou(t):
            return
        self._em(defeito, t, fluxo.transicionar, defeito, 'em_andamento', operador)
        if rng.random() < 0.25:
            t += self._horas(0.2, 3)
            if self._passou(t):
                return
            self._em(defeito, t, fluxo.registrar_evento, defeito, 'nota_interna', operador,
                     publico=False, texto=rng.choice(NOTAS_INTERNAS))
        t = max(fim, t + self._horas(1, 8))
        if self._passou(t):
            return
        self._em(defeito, t, fluxo.transicionar, defeito, 'concluido', operador,
                 resposta_publica=RESPOSTAS[categoria])
        atrasado = defeito.prazo_em is not None and t > defeito.prazo_em

        # Reabertura pela gestão (o problema voltou) e nova solução.
        if rng.random() < 0.05:
            t2 = t + self._horas(24, 120)
            if self._passou(t2):
                return self.avaliar(defeito, t, atrasado)
            self._em(defeito, t2, fluxo.transicionar, defeito, 'pendente', self.gestor,
                     texto=rng.choice(REABERTURAS))
            self.contagem['reaberto'] += 1
            t2 += self._horas(2, 24)
            if self._passou(t2):
                return
            self._em(defeito, t2, fluxo.transicionar, defeito, 'em_andamento', operador)
            t2 += self._horas(12, 24 * sla_dias)
            if self._passou(t2):
                return
            self._em(defeito, t2, fluxo.transicionar, defeito, 'concluido', operador,
                     resposta_publica=RESPOSTAS[categoria] + ' Serviço refeito após a reabertura.')
            t, atrasado = t2, True
        self.avaliar(defeito, t, atrasado)

    def avaliar(self, defeito, resolvido, atrasado):
        from defeitos import fluxo

        rng = self.rng
        if rng.random() > 0.55:
            return
        quando = resolvido + self._horas(1, 96)
        if self._passou(quando):
            return
        pesos = [2, 4, 12, 30, 52] if not atrasado else [7, 11, 24, 33, 25]
        if defeito.reaberturas:
            pesos = [25, 25, 25, 15, 10]
        nota = _escolher(rng, [1, 2, 3, 4, 5], pesos)
        comentario = rng.choice(COMENTARIOS[nota])
        defeito.avaliacao_nota = nota
        defeito.avaliacao_comentario = comentario
        defeito.avaliado_em = quando
        defeito.save(update_fields=['avaliacao_nota', 'avaliacao_comentario', 'avaliado_em'])
        self._em(defeito, quando, fluxo.registrar_evento, defeito, 'avaliacao', defeito.usuario,
                 texto=comentario, dados={'nota': nota, 'edicao': False})
        self.contagem['avaliacoes'] += 1

    def interacoes(self, defeitos):
        """Apoios e sinalizações de outros cidadãos (sem sinal: sem aviso)."""
        from defeitos.models import Apoio, DefeitoEvento, Sinalizacao

        apoios, sinais, eventos, apoiadores = [], [], [], set()
        for d in defeitos:
            fim = d.fechado_em or self.agora
            janela = (fim - d.criado_em).total_seconds()
            if janela <= 0:
                continue
            # Maioria sem apoio; alguns viram "pauta do bairro".
            qtd = min(int(self.rng.paretovariate(1.6)) - 1, 25)
            if self.rng.random() < 0.45:
                qtd = 0
            outros = [c for c in self.rng.sample(self.cidadaos, min(len(self.cidadaos), qtd + 3))
                      if c.id != d.usuario_id][:qtd]
            for c in outros:
                quando = d.criado_em + timedelta(seconds=janela * self.rng.random() ** 2)
                apoios.append(Apoio(usuario=c, defeito=d, criado_em=quando))
                apoiadores.add((c.id, d.id))
                eventos.append(DefeitoEvento(defeito=d, tipo='apoio', autor=c, papel='cidadao',
                                             criado_em=quando))
            # "Já foi resolvido" em parte dos que demoraram; "não existe" nos não localizados.
            tipo = None
            if d.motivo_rejeicao == 'nao_localizado':
                tipo = Sinalizacao.NAO_EXISTE
            elif d.status == 'concluido' and self.rng.random() < 0.06:
                tipo = Sinalizacao.RESOLVIDO
            if tipo:
                for c in [c for c in self.rng.sample(self.cidadaos, 3) if c.id != d.usuario_id][:2]:
                    if (c.id, d.id) in apoiadores:
                        continue
                    quando = d.criado_em + timedelta(seconds=janela * self.rng.uniform(0.5, 0.95))
                    sinais.append(Sinalizacao(usuario=c, defeito=d, tipo=tipo, criado_em=quando))
                    eventos.append(DefeitoEvento(defeito=d, tipo='sinalizacao', autor=c, papel='cidadao',
                                                 publico=False, dados={'tipo': tipo}, criado_em=quando))
        Apoio.objects.bulk_create(apoios, batch_size=500)
        Sinalizacao.objects.bulk_create(sinais, batch_size=500)
        DefeitoEvento.objects.bulk_create(eventos, batch_size=500)
        self.contagem['apoios'] = len(apoios)
        self.contagem['sinalizacoes'] = len(sinais)

    def gerar(self):
        from defeitos.models import Defeito

        self.equipe_e_usuarios()
        bairros = self.bairros()
        pesos_bairros = [b[3] for b in bairros]
        nomes_cat = [c[0] for c in CATEGORIAS]
        pesos_cat = [c[1] for c in CATEGORIAS]
        trechos = {c[0]: c[2] for c in CATEGORIAS}

        instantes = sorted(self._instante_criacao() for _ in range(self.total))
        criados = []
        for i, criado_em in enumerate(instantes):
            autor = _escolher(self.rng, self.cidadaos, self.pesos_cidadaos)
            original = None
            # ~3%: alguém reporta de novo um problema que já estava aberto ali perto.
            if criados and self.rng.random() < 0.03:
                # Original ainda aberto quando o novo chega, e de outra pessoa.
                candidatos = [d for d in criados[-60:] if d.status != 'rejeitado'
                              and (d.fechado_em is None or d.fechado_em > criado_em)
                              and d.usuario_id != autor.id]
                original = self.rng.choice(candidatos) if candidatos else None
            if original is not None:
                categoria = original.categoria
                bairro = next(b for b in bairros if b[0] == original.bairro)
            else:
                categoria = _escolher(self.rng, nomes_cat, pesos_cat)
                bairro = _escolher(self.rng, bairros, pesos_bairros)
            defeito = self.criar(categoria, bairro, criado_em, autor, perto_de=original)
            idade_frac = (self.agora - criado_em).total_seconds() / (self.dias * 86400)
            self.ciclo(defeito, categoria, trechos[categoria], idade_frac, duplicado_de=original)
            criados.append(defeito)
            if (i + 1) % 100 == 0:
                self.stdout.write(f'  {i + 1}/{self.total} chamados...')

        self.interacoes(criados)

        # Cadastro dos cidadãos antes do primeiro chamado de cada um.
        primeiro = {}
        for d in criados:
            primeiro.setdefault(d.usuario_id, d.criado_em)
        from users.models import User
        for c in self.cidadaos:
            base = primeiro.get(c.id, self.agora - timedelta(days=self.rng.uniform(1, self.dias)))
            User.objects.filter(pk=c.pk).update(
                criado_em=base - timedelta(hours=self.rng.uniform(0.2, 240)))
        return Defeito.objects.filter(pk__in=[d.pk for d in criados])


class Command(BaseCommand):
    help = 'Gera (ou limpa) um município de demonstração com chamados e ciclo de vida completos.'

    def add_arguments(self, parser):
        parser.add_argument('--municipio', default=MUNICIPIO_PADRAO,
                            help=f'Código IBGE (padrão: {MUNICIPIO_PADRAO}, São Paulo)')
        parser.add_argument('--chamados', type=int, default=600, help='Quantos chamados gerar (padrão: 600)')
        parser.add_argument('--dias', type=int, default=180, help='Janela de tempo, em dias (padrão: 180)')
        parser.add_argument('--limpar-demo', action='store_true',
                            help='Só remove a demo do município (usuários @demo.ciu e chamados deles)')
        parser.add_argument('--senha', default='',
                            help='Senha da gestora e dos operadores demo (padrão: sem login)')
        parser.add_argument('--semente', type=int, default=None,
                            help='Semente aleatória (mesma semente, mesma distribuição)')

    def handle(self, *args, **opts):
        from defeitos import fluxo
        from municipios.models import Municipio

        codigo = str(opts['municipio']).strip()
        municipio = Municipio.objects.filter(codigo=codigo).first()
        if municipio is None:
            raise CommandError(f'Município {codigo} não encontrado na tabela municipios.')

        if not opts['limpar_demo'] and (opts['chamados'] < 1 or opts['dias'] < 1):
            raise CommandError('--chamados e --dias precisam ser positivos.')

        # Limpeza e geração na mesma transação: se a geração falhar, a demo
        # anterior continua lá. Nenhum aviso sai: o histórico é retroativo.
        with mock.patch.object(fluxo, '_notificar', lambda *a, **k: None), transaction.atomic():
            chamados, usuarios = limpar(codigo)
            if chamados or usuarios:
                self.stdout.write(f'Demo anterior removida: {chamados} chamado(s), {usuarios} usuário(s).')
            if opts['limpar_demo']:
                self.stdout.write(self.style.SUCCESS(f'{municipio.nome}/{municipio.uf_sigla}: demo limpa.'))
                return
            rng = random.Random(opts['semente'])
            gerador = Gerador(codigo, municipio, opts['chamados'], opts['dias'], opts['senha'], rng, self.stdout)
            gerados = gerador.gerar()
            por_status = dict(gerados.order_by().values_list('status').annotate(n=Count('id')))

        c = gerador.contagem
        abertos = sum(n for st, n in por_status.items() if st in fluxo.STATUS_ABERTOS)
        self.stdout.write(self.style.SUCCESS(
            f'{municipio.nome}/{municipio.uf_sigla}: {opts["chamados"]} chamados em {opts["dias"]} dias — '
            f'{por_status.get("concluido", 0)} concluídos, {por_status.get("rejeitado", 0)} rejeitados '
            f'({c["duplicado"]} duplicados), {abertos} abertos, {c["reaberto"]} reaberturas; '
            f'{c["avaliacoes"]} avaliações, '
            f'{c["apoios"]} apoios, {c["sinalizacoes"]} sinalizações; '
            f'{len(gerador.cidadaos)} cidadãos e {1 + sum(len(m) for m in gerador.operadores.values())} '
            f'servidores demo (@{DOMINIO_DEMO}).'
        ))
