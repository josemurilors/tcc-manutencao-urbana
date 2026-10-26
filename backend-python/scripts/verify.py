#!/usr/bin/env python3
"""Smoke test: verifica backend Django (task 21 do plano).

NOTA: módulos GIS (defeitos, municipios) requerem GDAL (Docker).
      Testamos syntax + core + users + categorias + services aqui.
"""
import importlib
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ['DJANGO_SETTINGS_MODULE'] = 'core.settings.base'
os.environ['JWT_SECRET'] = 'test-secret-key-not-for-production'
os.environ['ENCRYPTION_KEY'] = 'a' * 64
os.environ['DB_NAME'] = 'test'
os.environ['DB_USER'] = 'test'
os.environ['DB_PASSWORD'] = 'test'
os.environ['DB_HOST'] = 'localhost'
os.environ['FRONTEND_URL'] = 'http://localhost:8081'
os.environ['VAPID_PUBLIC_KEY'] = ''
os.environ['VAPID_PRIVATE_KEY'] = ''

import django
from django.conf import settings
# Desativa GIS apps para teste local (GDAL ausente)
settings.INSTALLED_APPS = [a for a in settings.INSTALLED_APPS
                           if a not in ('django.contrib.gis', 'defeitos', 'municipios')]
django.setup()

PASS = 0
FAIL = 0


def check(label, ok):
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f'  PASS  {label}')
    else:
        FAIL += 1
        print(f'  FAIL  {label}')


print('=== 1. Module imports ===')
modules = [
    'core.settings.base', 'core.wsgi',
    'users.models', 'users.hashers', 'users.serializers', 'users.views', 'users.admin',
    'categorias.models', 'categorias.serializers', 'categorias.views', 'categorias.admin',
    'services.encryption', 'services.cpf_validator', 'services.image_processor',
    'services.email_service', 'services.push_service', 'services.ia_client',
]
for m in modules:
    try:
        importlib.import_module(m)
        check(m, True)
    except Exception as e:
        check(f'{m} — {e}', False)

print()
print('=== 2. Encryption roundtrip ===')
from services.encryption import encrypt_text, decrypt_text, hash_text
encoded = encrypt_text('12345678901')
pt = decrypt_text(encoded)
check('AES-256-GCM roundtrip', pt == '12345678901')
h = hash_text('senha123')
check('SHA-256 HMAC produces 64 hex chars', len(h) == 64)

print()
print('=== 3. CPF Validator ===')
from services.cpf_validator import validar_digitos
check('CPF 52998224725 valido', validar_digitos('52998224725'))
check('CPF 11111111111 invalido', not validar_digitos('11111111111'))
check('CPF curto invalido', not validar_digitos('123'))

print()
print('=== 4. Image Processor ===')
from services.image_processor import make_thumbnail
from PIL import Image
import io
img = Image.new('RGB', (2000, 1500), color='red')
buf = io.BytesIO()
img.save(buf, 'JPEG')
buf.seek(0)
thumb = make_thumbnail(buf.read())
check('Thumbnail gerada', len(thumb) > 0)

print()
print('=== 5. IA Client routing ===')
from services.ia_client import routing
r = routing('Buraco')
check('Roteamento Buraco', r['secretaria'] == 'Secretaria de Obras e Infraestrutura')
r2 = routing('Desconhecido')
check('Fallback Outro', r2['secretaria'] == 'Secretaria de Servicos Urbanos')

print()
print('=== 6. BCrypt Hasher ===')
from users.hashers import BCryptPasswordHasher
h = BCryptPasswordHasher()
encoded = h.encode('senha123', h.salt())
check('Hasher produz hash', encoded.startswith('bcrypt$'))
check('Verifica senha', h.verify('senha123', encoded))
check('Rejeita senha errada', not h.verify('senha_errada', encoded))

print()
print(f'=== Resumo: {PASS} passed, {FAIL} failed ===')
sys.exit(FAIL)
