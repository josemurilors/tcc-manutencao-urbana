# Central de Inteligência Urbana — App Mobile (Expo)

App universal (iOS, Android e web) do TCC, escrito em **Expo SDK 57 +
React Native 0.86 + Expo Router**. Consome a **mesma API Django** do frontend
web.

O frontend web (`../frontend`, React 19 + Vite) continua sendo a versão de
produção em [tcc.josemurilors.com.br](https://tcc.josemurilors.com.br). Este
app é um cliente adicional, não um substituto.

## Índice

- [Requisitos](#requisitos)
- [Rodando](#rodando)
- [Configuração](#configuração)
- [Mapa em modo de navegação](#mapa-em-modo-de-navegação)
- [Suporte a web](#suporte-a-web)
- [Estrutura](#estrutura)
- [Equivalência com o frontend web](#equivalência-com-o-frontend-web)
- [Decisões de porte](#decisões-de-porte)
- [Limitações conhecidas](#limitações-conhecidas)
- [Build de produção](#build-de-produção)

## Requisitos

- Node.js ≥ 20
- App **Expo Go** no celular, ou emulador Android / simulador iOS
- Backend rodando (ver `../README.md`) ou apontar para a API de produção

## Rodando

```bash
cd mobile
npm install
npm start                 # abre o Metro; leia o QR code com o Expo Go
```

Atalhos:

```bash
npm run android    # abre no emulador/dispositivo Android
npm run ios        # abre no simulador iOS (requer macOS)
npm run web        # abre no navegador (http://localhost:8081)
npm run lint       # ESLint (eslint-config-expo)
npm run typecheck  # tsc --noEmit
```

O app roda nas três plataformas: iOS, Android e web.

## Configuração

**Em desenvolvimento você não precisa configurar nada.** O app deriva a base da
API do host que serve o Metro e usa a porta 8000:

| Onde você abre        | `hostUri` / origem   | API resolvida                |
| --------------------- | -------------------- | ---------------------------- |
| Navegador (`--web`)   | `localhost:8081`     | `http://localhost:8000`      |
| Expo Go no celular    | `192.168.x.x:8081`   | `http://192.168.x.x:8000`    |
| Build de produção     | —                    | `https://tcc.josemurilors.com.br` |

Isso evita ter que reeditar o `.env` toda vez que o IP do DHCP muda. Veja
`resolverApiUrl()` em `src/services/api.ts`.

Variáveis opcionais (ver `.env.example`):

| Variável                      | Efeito                                          |
| ----------------------------- | ----------------------------------------------- |
| `EXPO_PUBLIC_API_URL`         | Força um destino fixo (vence sobre tudo)        |
| `EXPO_PUBLIC_API_PORT`        | Porta do backend local (padrão `8000`)          |
| `GOOGLE_MAPS_API_KEY_ANDROID` | Só em build nativo Android                      |
| `GOOGLE_MAPS_API_KEY_IOS`     | Não necessária (iOS usa Apple Maps)             |

`app.config.js` só adiciona o plugin do `react-native-maps` quando alguma
chave está definida — por isso o app roda no Expo Go sem nenhuma chave.

### Login com Google

O botão **Continuar com Google** aparece em Login e Cadastro quando o backend
tem `GOOGLE_CLIENT_ID_WEB` no `.env` da raiz (os IDs chegam ao app por
`GET /api/v1/auth/google/`, nada de env no cliente). Na primeira entrada o
usuário só escolhe o nome de exibição (`/escolher-nome`); e-mail já vem
verificado pelo Google e a conta fica sem senha.

| Plataforma | Como | Precisa de |
| ---------- | ---- | ---------- |
| Web (`npm run web`) | Google Identity Services (`google-button.web.tsx`) | só o client ID Web |
| Android / iOS | `expo-auth-session` (`google-button.tsx`) | `GOOGLE_CLIENT_ID_ANDROID` (pacote `com.ciu.mobile` + SHA-1) / `GOOGLE_CLIENT_ID_IOS`, e um **development build** — não funciona no Expo Go |

Sem o ID da plataforma o botão nativo fica desabilitado com o aviso.

### Backend: CORS e ALLOWED_HOSTS

Duas variáveis no `.env` da raiz controlam quem consegue falar com o Django.
Ambas precisam do endereço que você usa para abrir o app:

| Variável        | O que libera                          |
| --------------- | ------------------------------------- |
| `FRONTEND_URL`  | A **origem** do navegador (CORS)       |
| `ALLOWED_HOSTS` | O **host** do backend (`Host:` header) |

Abrindo em `http://localhost:8081`, o padrão já basta. Abrindo de outro
aparelho na rede (ou pelo IP da máquina), adicione esse IP nas duas:

```
FRONTEND_URL=http://localhost:5173,http://localhost:8081,http://192.168.1.3:8081
ALLOWED_HOSTS=localhost,backend,192.168.1.3
```

Faltando a primeira, o navegador acusa `Failed to fetch` (a resposta vem sem
`Access-Control-Allow-Origin`). Faltando a segunda, o Django devolve
`400 Bad Request` antes mesmo de olhar a rota.

Depois de alterar o `.env`, **recrie o container** — variáveis de ambiente são
fixadas na criação, então `restart` não resolve:

```bash
docker compose -f docker-compose.dev.yml up -d backend
```

Para conferir sem abrir o navegador:

```bash
curl -i -H "Origin: http://192.168.1.3:8081" http://192.168.1.3:8000/api/v1/defeitos/
```

> O IP da LAN é do DHCP e pode mudar. Se o app parar de conectar de um dia para
> o outro, confira o IP atual (`ipconfig` / `ip addr`) e atualize as duas
> variáveis — ou reserve um IP fixo no roteador.

Nada disso afeta o app **nativo**: Expo Go não passa por CORS, mas continua
precisando do IP em `ALLOWED_HOSTS`.

## Estrutura

```
mobile/
├── app.config.js          # configuração do Expo (plugins, permissões, ícones)
├── src/
│   ├── app/               # rotas (Expo Router, file-based)
│   │   ├── _layout.tsx    # providers + Stack raiz
│   │   ├── index.tsx      # redireciona para o mapa
│   │   ├── login.tsx
│   │   ├── registro.tsx
│   │   ├── novo.tsx       # novo chamado (modal)
│   │   ├── admin/usuarios.tsx
│   │   └── (tabs)/        # mapa · chamados · painel · conta
│   ├── components/        # UI compartilhada (charts, sheet, header, ui/*)
│   │   ├── map-surface.tsx      # mapa nativo (react-native-maps)
│   │   ├── map-surface.web.tsx  # mapa web (Leaflet)
│   │   └── map-surface.types.ts # contrato comum às duas
│   ├── constants/         # tokens de tema, status, estilo do mapa
│   ├── context/           # auth, tema, toasts
│   ├── hooks/             # sincronização offline
│   ├── services/          # api, storage, fila offline
│   └── utils/             # geo, heatmap, formatação, jwt, imagens
└── assets/images/         # ícone, splash, favicon
```

## Equivalência com o frontend web

| Web (`frontend/src`)         | Mobile (`mobile/src`)                | Observação                                            |
| ---------------------------- | ------------------------------------ | ----------------------------------------------------- |
| `pages/MapPage.jsx`          | `app/(tabs)/mapa.tsx` + `app/novo.tsx` | Formulário de criação virou tela modal                |
| `pages/DefectList.jsx`       | `app/(tabs)/chamados.tsx`            | Tabela → cartões; seleção em lote por toque longo     |
| `pages/AdminDashboardMetrics.jsx` | `app/(tabs)/painel.tsx`         | Recharts → `components/charts.tsx` (react-native-svg) |
| `pages/SuperAdmin.jsx`       | `app/admin/usuarios.tsx`             | —                                                     |
| `pages/ProfileSettings.jsx`  | `app/(tabs)/conta.tsx`               | Somada ao menu do `UserDropdown`                      |
| `pages/Login/Register.jsx`   | `app/login.tsx` / `app/registro.tsx` | Senha ou Google; sem CPF/município                    |
| `context/AuthContext.jsx`    | `context/auth-context.tsx`           | SecureStore no lugar do localStorage                  |
| `context/ThemeContext.jsx`   | `context/theme-context.tsx`          | —                                                     |
| `components/Toast.jsx`       | `context/toast-context.tsx`          | —                                                     |
| `services/api.js`            | `services/api.ts`                    | Mesmos endpoints, tipado                              |
| `hooks/useOfflineSync.js`    | `hooks/use-offline-sync.ts`          | AsyncStorage no lugar do IndexedDB                    |
| `styles/tokens.css`          | `constants/theme.ts`                 | Mesmos valores de cor/espaçamento                     |
| `pages/Landing.jsx`          | —                                    | Página de marketing; não faz sentido no app           |
| `pages/Settings/GeneralSettings.jsx` | —                            | Eram stubs "em desenvolvimento" no web                |

Funcionalidades portadas: mapa de navegação por GPS (qualquer cidade), mapa de
calor, filtros (todos/pendentes/atendidos/meus), "Perto de Mim" com raio
ajustável, criação de chamado com foto obrigatória (só câmera) e GPS, detalhe com histórico e imagens,
apoio (upvote), anexos, atender/responder/finalizar, alteração de status em
lote, geração de Ordem de Serviço em PDF, painel de métricas completo, gestão
de usuários, verificação de e-mail, troca de senha, tema claro/escuro e fila
offline.

O app não prende o usuário a um município: qualquer cidade do país vale. Em
qual cidade cada chamado caiu é o **backend** que resolve (PostGIS, tabela
`municipios`) e grava em `defeitos.municipio_id` — assim, no futuro, dá para
restringir admins ao próprio município sem mudar o app.

## Mapa em modo de navegação

A aba **Mapa** funciona como Waze + Pokémon Go: tudo parte do GPS, que fica
ligado enquanto a aba está aberta (`src/hooks/use-localizacao.ts`).

| Ação                       | Como                                                                    |
| -------------------------- | ----------------------------------------------------------------------- |
| Seguir a posição           | Padrão; a câmera acompanha o GPS com zoom de rua. Arrastar o mapa pausa; o botão de bússola retoma |
| Para onde estou virado     | Cone azul no marcador, girado pela bússola do aparelho (`watchHeadingAsync` no nativo, `deviceorientation` no web); sem magnetômetro (desktop) fica só o ponto |
| Reportar chamado           | Botão **Reportar aqui** usa a posição atual. Toque longo posiciona em outro ponto |
| Pendências próximas        | Bandeja inferior lista os chamados no raio (200 m–2 km, no menu de filtros), mais perto primeiro |
| Confirmar que a demanda existe | No detalhe, **Confirmar no local** — liberado só a até `RAIO_CONFIRMACAO_M` (20 m) do ponto; pinos ao alcance ganham anel dourado |

### Simular GPS no desktop (dev)

Em desenvolvimento, no web, aparece o painel **GPS simulado (dev)** no canto
superior esquerdo do mapa (`src/dev/gps-joystick.tsx`):

- **GPS real / Simulando** — liga a simulação a partir dos campos (por padrão
  `-23.00039, -49.31988`, rumo 214°, em Manduri/SP) e desliga de volta para o
  aparelho;
- **joystick** — arraste para andar: a direção vira a bússola, a deflexão a
  velocidade (até ~6 m/s);
- **lat / lng / rumo + Ir** — teleporta e gira a bússola.

Nada disso entra no build de produção (`__DEV__`) nem aparece no celular.

A confirmação usa o mesmo registro de **apoio** do backend
(`POST /api/v1/defeitos/{id}/apoiar/`); na aba Chamados o botão continua sendo
"Apoiar", sem exigir proximidade. Os raios ficam em `src/constants/proximidade.ts`.

## Suporte a web

`npm run web` roda o app no navegador. A única peça que não é universal é o
mapa: `react-native-maps` chama `codegenNativeComponent`, que não existe no
react-native-web e derruba o bundle inteiro.

A solução é uma superfície de mapa com duas implementações, escolhidas pelo
Metro através da extensão do arquivo:

| Arquivo                 | Plataforma | Biblioteca         |
| ----------------------- | ---------- | ------------------ |
| `map-surface.tsx`       | iOS/Android| react-native-maps  |
| `map-surface.web.tsx`   | web        | Leaflet + react-leaflet (mesmos tiles CartoDB do frontend Vite) |
| `map-surface.types.ts`  | —          | contrato comum     |

A tela (`app/(tabs)/mapa.tsx`) importa só `@/components/map-surface` e não
sabe qual das duas está em uso — toda a lógica de filtros, heatmap e perímetro
é compartilhada.

O `web.output` é `single` (SPA), não `static`: a pré-renderização no servidor
executaria o Leaflet no Node, onde não há `window`.

## Decisões de porte

- **Mapa:** `react-native-maps` no nativo (Apple Maps no iOS, Google Maps no
  Android; funciona no Expo Go sem chave de API) e Leaflet no web — ver
  [Suporte a web](#suporte-a-web).
- **Mapa de calor:** o `Heatmap` do `react-native-maps` só existe no provider
  Google. Para funcionar nas duas plataformas, `utils/heatmap.ts` agrupa os
  chamados numa grade e desenha um círculo translúcido por célula, com raio e
  cor proporcionais à densidade — a mesma leitura visual do `leaflet.heat`.
- **Máscara fora do município:** o `holes` do `Polygon` substitui o truque de
  `fill-rule: evenodd` que o web usa no Leaflet.
- **Gráficos:** Recharts depende do DOM. Pizza, barras (verticais e
  horizontais) e linha foram redesenhados com `react-native-svg`.
- **Armazenamento:** tokens no **SecureStore** (keychain/keystore) — mais
  seguro que o `localStorage` do web; perfil, tema e fila offline no
  AsyncStorage.
- **Offline:** sem service worker, a fila é drenada quando o app volta ao
  primeiro plano ou quando a conexão retorna (`expo-network`).
- **JWT:** o React Native não expõe `atob`, então `utils/jwt.ts` decodifica o
  payload base64url por conta própria.
- **Ordem de Serviço:** o PDF é baixado para o cache e aberto na folha de
  compartilhamento do sistema, no lugar do download do navegador.
- **Municípios:** o web precisava do `@tanstack/react-virtual` para os ~5.500
  municípios; a `FlatList` já é virtualizada.

## Limitações conhecidas

- **Notificações push não estão implementadas.** O backend usa Web Push
  (VAPID), que é uma API de navegador e não funciona em app nativo. Habilitar
  push aqui exigiria adicionar FCM/APNs ao backend e usar
  `expo-notifications` — está fora do escopo desta entrega.
- **Foto de perfil** segue apenas como inicial do nome, como no web (o backend
  ainda não expõe upload de avatar).
- **2FA e exclusão de conta** continuam como "em desenvolvimento", igual ao web.
- O **web** aqui é para desenvolvimento e demonstração. Quem está em produção
  em `tcc.josemurilors.com.br` continua sendo o frontend Vite (`../frontend`),
  que tem PWA, service worker e Web Push — coisas que este app não replica.

## Build de produção

Os perfis ficam em `eas.json`. Todos os builds nativos rodam no EAS Build
(nuvem da Expo); a máquina local não precisa de JDK nem Android SDK.

```bash
npm install -g eas-cli
eas login            # uma vez por máquina
eas init             # uma vez por projeto: vincula ao projectId da Expo
```

Variáveis de ambiente do build vêm de dois lugares: o `env` do perfil em
`eas.json` (só `EXPO_PUBLIC_API_URL`, que não é segredo) e as variáveis do
projeto na Expo (expo.dev → projeto → Environment variables), onde está
`GOOGLE_MAPS_API_KEY_ANDROID` marcada como *sensitive* nos três ambientes.
Cada perfil declara qual ambiente da Expo usa via `environment`. Sem a chave
do Maps o plugin do `react-native-maps` não entra no build e o mapa nativo
fica em branco.

Para autenticar o CLI sem prompt, defina `EXPO_TOKEN` com um access token
gerado em expo.dev → Account settings → Access tokens.

| Perfil        | Gera            | Uso                                                     |
| ------------- | --------------- | ------------------------------------------------------- |
| `apk`         | `.apk` assinado | Instalar direto no celular (demonstração, banca)        |
| `development` | `.apk` dev client | Rodar contra o Metro com módulos nativos (login Google) |
| `production`  | `.aab`          | Play Store                                              |

```bash
# APK pra instalar no celular (aponta pra API de produção)
eas build --platform android --profile apk

# Play Store
eas build --platform android --profile production

# iOS
eas build --platform ios --profile production
```

Materiais da Play Store (descrições, feature graphic, respostas do
formulário de segurança de dados e checklist) estão em `docs/play-store/`.
A política de privacidade e a página de exclusão de conta exigidas pela
loja ficam em `frontend/public/` e são servidas na raiz do domínio.

O primeiro build gera a keystore Android na conta Expo. Pegue o SHA-1 com
`eas credentials --platform android` e cadastre no client ID Android do Google
Cloud para o login com Google funcionar no APK.
