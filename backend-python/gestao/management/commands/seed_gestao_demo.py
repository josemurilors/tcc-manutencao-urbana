"""
Estrutura padrão de uma prefeitura recém-contratada: quatro secretarias,
equipes de campo e o roteamento das categorias da plataforma para elas.

Idempotente: o que já existe (pelo nome, sem caixa) fica como está — a
prefeitura pode ter ajustado algo e o comando não desfaz.
Uso: python manage.py seed_gestao_demo <codigo_ibge>
"""
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from defeitos.sla import normalizar

# (nome, sigla, equipes, categorias roteadas — chave normalizada de `sla.normalizar`)
ESTRUTURA = (
    ('Secretaria de Obras e Infraestrutura', 'SMOI',
     ('Equipe de Pavimentação', 'Equipe de Calçadas'), ('buraco', 'calcada danificada')),
    ('Secretaria de Serviços Urbanos', 'SMSU',
     ('Equipe de Iluminação Pública', 'Equipe de Limpeza Urbana'), ('iluminacao', 'entulho', 'outro')),
    ('Secretaria de Trânsito e Mobilidade', 'SMTM',
     ('Equipe de Sinalização Viária',), ('semaforo',)),
    ('Secretaria de Meio Ambiente', 'SMMA',
     ('Equipe de Poda e Arborização',), ('arvore caida',)),
)


class Command(BaseCommand):
    help = 'Cria secretarias, equipes e roteamento de categorias padrão para um município.'

    def add_arguments(self, parser):
        parser.add_argument('municipio', help='Código IBGE do município')

    @transaction.atomic
    def handle(self, *args, **opts):
        from categorias.models import Categoria
        from gestao.models import CategoriaMunicipio, Equipe, MunicipioConfig, Secretaria
        from municipios.models import Municipio

        codigo = str(opts['municipio']).strip()
        mun = Municipio.objects.filter(codigo=codigo).first()
        if mun is None:
            raise CommandError(f'Município {codigo} não encontrado na tabela municipios.')

        MunicipioConfig.objects.get_or_create(
            municipio_id=codigo, defaults={'nome_exibicao': f'Prefeitura de {mun.nome}'},
        )
        categorias = {normalizar(c.nome): c for c in Categoria.objects.all()}
        criadas = {'secretarias': 0, 'equipes': 0, 'categorias': 0}

        for nome, sigla, equipes, chaves in ESTRUTURA:
            sec = Secretaria.objects.filter(municipio_id=codigo, nome__iexact=nome).first()
            if sec is None:
                sec = Secretaria.objects.create(municipio_id=codigo, nome=nome, sigla=sigla)
                criadas['secretarias'] += 1
            for nome_equipe in equipes:
                if not Equipe.objects.filter(municipio_id=codigo, nome__iexact=nome_equipe).exists():
                    Equipe.objects.create(municipio_id=codigo, nome=nome_equipe, secretaria=sec)
                    criadas['equipes'] += 1
            for chave in chaves:
                cat = categorias.get(chave)
                if cat is None:
                    continue
                # Só a secretaria: prazo e prioridade seguem o padrão da plataforma.
                _, nova = CategoriaMunicipio.objects.get_or_create(
                    municipio_id=codigo, categoria=cat, defaults={'secretaria': sec},
                )
                criadas['categorias'] += int(nova)

        self.stdout.write(self.style.SUCCESS(
            f'{mun.nome}/{mun.uf_sigla}: {criadas["secretarias"]} secretaria(s), '
            f'{criadas["equipes"]} equipe(s) e {criadas["categorias"]} regra(s) de categoria criadas.'
        ))
