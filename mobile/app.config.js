/**
 * Configuração do app Expo.
 *
 * Usa `app.config.js` em vez de `app.json` porque a chave do Google Maps só é
 * necessária em builds nativos (no Expo Go o mapa usa a chave do próprio Expo).
 * Defina `GOOGLE_MAPS_API_KEY_ANDROID` / `GOOGLE_MAPS_API_KEY_IOS` no ambiente
 * antes de rodar `eas build` para que o plugin seja incluído.
 */

const androidMapsKey = process.env.GOOGLE_MAPS_API_KEY_ANDROID;
const iosMapsKey = process.env.GOOGLE_MAPS_API_KEY_IOS;

/**
 * Links universais: `https://tcc.josemurilors.com.br/chamado/<id>` (o link que
 * o app compartilha, `linkPublicoDoChamado`) abre direto no app instalado; sem
 * o app, cai no site. A verificação depende dos arquivos servidos pelo domínio
 * em `/.well-known/` (modelos e passo a passo em `docs/deep-links/`): sem eles
 * o Android mostra o seletor "abrir com" e o iOS abre o navegador.
 */
const DOMINIO_LINKS = process.env.CIU_DOMINIO_LINKS || 'tcc.josemurilors.com.br';

const mapsPlugin =
  androidMapsKey || iosMapsKey
    ? [
        [
          'react-native-maps',
          {
            ...(androidMapsKey && { androidGoogleMapsApiKey: androidMapsKey }),
            ...(iosMapsKey && { iosGoogleMapsApiKey: iosMapsKey }),
          },
        ],
      ]
    : [];

module.exports = {
  expo: {
    name: 'Central de Inteligência Urbana',
    slug: 'ciu-mobile',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'ciu',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.ciu.mobile',
      associatedDomains: [`applinks:${DOMINIO_LINKS}`],
      infoPlist: {
        NSPhotoLibraryUsageDescription:
          'Permite anexar fotos dos defeitos urbanos aos seus chamados.',
        NSCameraUsageDescription: 'Permite fotografar o defeito urbano ao abrir um chamado.',
        NSLocationWhenInUseUsageDescription:
          'Usamos sua localização para posicionar chamados no mapa e filtrar os defeitos próximos a você.',
      },
    },
    android: {
      package: 'com.ciu.mobile',
      adaptiveIcon: {
        backgroundColor: '#000000',
        foregroundImage: './assets/images/android-icon-foreground.png',
      },
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      permissions: [
        'android.permission.ACCESS_COARSE_LOCATION',
        'android.permission.ACCESS_FINE_LOCATION',
      ],
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: true,
          data: [{ scheme: 'https', host: DOMINIO_LINKS, pathPrefix: '/chamado/' }],
          category: ['BROWSABLE', 'DEFAULT'],
        },
      ],
    },
    web: {
      // SPA, sem pré-renderização no servidor: o app depende de APIs de
      // navegador (Leaflet, localStorage) que não existem no Node, e não há
      // ganho de SEO num app autenticado.
      output: 'single',
      favicon: './assets/images/favicon.png',
      // O app também é o site: leitor de tela em português e cor da barra do navegador.
      lang: 'pt-BR',
      themeColor: '#000000',
      description: 'Abertura e acompanhamento de chamados de manutenção urbana.',
    },
    plugins: [
      'expo-router',
      [
        'expo-splash-screen',
        {
          backgroundColor: '#000000',
          image: './assets/images/splash-icon.png',
          imageWidth: 140,
        },
      ],
      'expo-secure-store',
      [
        'expo-location',
        {
          locationWhenInUsePermission:
            'Usamos sua localização para posicionar chamados no mapa e filtrar os defeitos próximos a você.',
        },
      ],
      [
        'expo-image-picker',
        {
          photosPermission: 'Permite anexar fotos dos defeitos urbanos aos seus chamados.',
          cameraPermission: 'Permite fotografar o defeito urbano ao abrir um chamado.',
        },
      ],
      [
        // Push de andamento dos chamados. Sem `icon` próprio o Android usa o
        // ícone do app; um PNG monocromático branco fica de pendência de arte.
        'expo-notifications',
        {
          color: '#D4AF37',
          defaultChannel: 'chamados',
        },
      ],
      ...mapsPlugin,
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      eas: {
        projectId: 'c2a38d38-63b7-4e86-bb5f-5f771f7145dc',
      },
    },
    owner: 'caiocinel',
  },
};
