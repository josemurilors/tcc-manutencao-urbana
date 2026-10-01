"""
Limite de requisições (throttling) das rotas sensíveis a abuso: login,
enumeração de e-mail, códigos de 6 dígitos (verificação e recuperação de
senha) e abertura de chamados.

Por que classes próprias em vez do `ScopedRateThrottle` puro do DRF:

* as taxas moram aqui (`TAXAS`), ao lado de quem as usa, e podem ser
  sobrepostas por `settings.CIU_THROTTLE_TAXAS` sem mexer no código;
* além do IP, várias rotas limitam pelo **e-mail alvo** — senão um atacante
  troca de IP e continua tentando o código de 6 dígitos da mesma conta;
* o cache é o Redis compartilhado: a chave leva o nome do banco, para que a
  suíte de testes (banco `test_*`) não divida contador com o servidor de dev
  nem com outra execução em paralelo;
* se o cache cair, a rota continua respondendo (fail-open, com log): um
  Redis fora do ar não pode derrubar o login da cidade inteira.

Formato da taxa: `N/<período>`, período `s`, `m`, `h`, `d` com multiplicador
opcional — `5/10m` = 5 a cada 10 minutos.
"""
import logging
import re

from django.conf import settings
from django.db import connection
from rest_framework.throttling import SimpleRateThrottle

logger = logging.getLogger(__name__)

TAXAS = {
    # Login: freia força bruta de senha por IP e por conta.
    'login_ip': '10/m',
    'login_email': '20/h',
    # Passo 1 da entrada diz se a conta existe: sem limite, vira enumeração.
    'existe_ip': '10/m',
    # Código de 6 dígitos com validade de 10 min: 5 tentativas por janela
    # deixam a chance de acerto às cegas em ~5 em 1 milhão.
    'verificar_email': '5/10m',
    'reenviar_codigo': '5/h',
    'senha_esqueci_ip': '5/h',
    'senha_esqueci_email': '5/h',
    'senha_redefinir_email': '5/10m',
    # Abrir chamado: folga para o envio em lote da fila offline do app.
    'criar_chamado': '30/h',
    # Exportação LGPD monta um JSON com tudo do usuário: barata, mas não grátis.
    'meus_dados': '10/h',
    # Processamento de imagem avulso (`defeitos/imagem/`).
    'imagem': '30/h',
}

_PERIODOS = {'s': 1, 'm': 60, 'h': 3600, 'd': 86400}


def _email(request):
    dados = getattr(request, 'data', None)
    valor = dados.get('email') if hasattr(dados, 'get') else None
    return (valor or '').strip().lower() if isinstance(valor, str) else ''


class _Throttle(SimpleRateThrottle):
    """Base: escopo fixo por classe, taxa de `TAXAS` (ou settings) e fail-open."""
    scope = None
    # O que identifica o "cliente" do limite: 'ip', 'email' ou 'usuario'.
    chave = 'ip'

    def get_rate(self):
        sobrepostas = getattr(settings, 'CIU_THROTTLE_TAXAS', None) or {}
        return sobrepostas.get(self.scope, TAXAS.get(self.scope))

    def parse_rate(self, rate):
        if rate is None:
            return (None, None)
        num, periodo = rate.split('/')
        m = re.fullmatch(r'(\d*)([smhd])\w*', periodo.strip())
        if not m:
            raise ValueError(f'Taxa de throttle inválida: {rate}')
        mult = int(m.group(1) or 1)
        return (int(num), mult * _PERIODOS[m.group(2)])

    def get_cache_key(self, request, view):
        if self.chave == 'usuario':
            if not request.user or not request.user.is_authenticated:
                ident = self.get_ident(request)
            else:
                ident = str(request.user.pk)
        elif self.chave == 'email':
            ident = _email(request)
            if not ident:
                return None  # sem e-mail a view responde 400; não há conta a proteger
        else:
            ident = self.get_ident(request)
        banco = connection.settings_dict.get('NAME', '')
        return f'ciu_throttle:{banco}:{self.scope}:{ident}'

    def allow_request(self, request, view):
        try:
            return super().allow_request(request, view)
        except Exception:  # cache indisponível: registra e deixa passar
            logger.warning('throttle %s indisponível; liberando a requisição', self.scope, exc_info=True)
            return True


def throttle(scope, chave='ip'):
    """Cria a classe de throttle de um escopo (`throttle('login_ip')`)."""
    return type(f'Throttle_{scope}', (_Throttle,), {'scope': scope, 'chave': chave})


LoginIp = throttle('login_ip')
LoginEmail = throttle('login_email', 'email')
ExisteIp = throttle('existe_ip')
VerificarEmail = throttle('verificar_email', 'usuario')
ReenviarCodigo = throttle('reenviar_codigo', 'usuario')
SenhaEsqueciIp = throttle('senha_esqueci_ip')
SenhaEsqueciEmail = throttle('senha_esqueci_email', 'email')
SenhaRedefinirEmail = throttle('senha_redefinir_email', 'email')
CriarChamado = throttle('criar_chamado', 'usuario')
MeusDados = throttle('meus_dados', 'usuario')
Imagem = throttle('imagem', 'usuario')
