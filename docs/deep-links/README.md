# Links universais do app (deep links)

O app compartilha o chamado como `https://tcc.josemurilors.com.br/chamado/<id>`
(`linkPublicoDoChamado`, em `mobile/src/services/api-cidadao.ts`). Com o app
instalado, esse link deve abrir direto a tela `app/chamado/[id].tsx`. Sem o
app, abre o site.

O lado do app já está em `mobile/app.config.js`:

- **Android:** `android.intentFilters` com `autoVerify: true` para
  `https://tcc.josemurilors.com.br/chamado/*`;
- **iOS:** `ios.associatedDomains` com `applinks:tcc.josemurilors.com.br`.

O domínio pode ser trocado pela variável `CIU_DOMINIO_LINKS` no build (EAS),
por exemplo para o domínio de uma prefeitura.

O lado do servidor são os dois arquivos de `.well-known/` desta pasta. Eles
são **modelos**, com valores de exemplo no lugar dos identificadores reais.
Sem eles publicados, o sistema não confia no domínio. O Android mostra o
seletor "Abrir com" e o iOS abre o navegador.

## 1. Preencher os modelos

### `assetlinks.json` (Android)

Troque `SUBSTITUA:PELO:SHA256:...` pela impressão digital SHA-256 do
certificado que assina o app. Ela vem do EAS, não deste repositório:

```bash
cd mobile
eas credentials -p android
# Escolha o perfil (production) e copie "SHA256 Fingerprint" do keystore.
```

Se o app for distribuído pela Play Store com a assinatura gerenciada pelo
Google (Play App Signing), a impressão digital que vale é a da **chave de
assinatura do app** em Play Console > Configuração > Integridade do app.
A da chave de upload do EAS não serve nesse caso. Pode listar as duas no
array.

### `apple-app-site-association` (iOS)

Troque `SUBSTITUA_PELO_TEAM_ID` pelo Team ID da conta Apple Developer. São
10 caracteres e aparecem em developer.apple.com > Membership, ou em
`eas credentials -p ios`. O bundle `com.ciu.mobile` é o de `app.config.js`.

O arquivo **não tem extensão** e precisa ser servido como
`application/json`.

## 2. Publicar no domínio

Os dois arquivos têm de responder com **200, sem redirecionamento** e com
`Content-Type: application/json`, em:

- `https://tcc.josemurilors.com.br/.well-known/assetlinks.json`
- `https://tcc.josemurilors.com.br/.well-known/apple-app-site-association`

Hoje o `location /` de `nginx.prod.conf` devolve o `index.html` da SPA para
qualquer caminho que não existe. Assim, `/.well-known/...` responderia HTML e
a verificação falharia. Antes do `location /`, acrescente:

```nginx
location /.well-known/ {
    alias /usr/share/nginx/well-known/;
    default_type application/json;
    add_header Cache-Control "public, max-age=3600";
    try_files $uri =404;
}
```

Depois copie os arquivos preenchidos para `/usr/share/nginx/well-known/` no
container do nginx. Pode ser por volume no `docker-compose.yml` ou por `COPY`
no `nginx.Dockerfile`.

## 3. Conferir

```bash
curl -sI https://tcc.josemurilors.com.br/.well-known/assetlinks.json
curl -sI https://tcc.josemurilors.com.br/.well-known/apple-app-site-association
# Esperado: HTTP/2 200 e content-type: application/json nos dois.

# Android, com o app instalado (build com o intentFilter):
adb shell pm verify-app-links --re-verify com.ciu.mobile
adb shell pm get-app-links com.ciu.mobile   # tcc.josemurilors.com.br: verified
```

O Google também tem um validador:
`https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://tcc.josemurilors.com.br&relation=delegate_permission/common.handle_all_urls`.

No iOS, a Apple busca o arquivo pela CDN dela na instalação do app. Depois de
mudar o arquivo, reinstale o app para testar.

## Observações

- `intentFilters` e `associatedDomains` só valem num **build nativo novo**
  (`eas build`). Não chegam por atualização OTA.
- No iOS, o EAS ativa a capability "Associated Domains" no App ID na hora do
  build, se as credenciais forem gerenciadas por ele.
- O esquema `ciu://chamado/<id>` continua funcionando, sem verificação.
