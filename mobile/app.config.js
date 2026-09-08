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
    },
    web: {
      // SPA, sem pré-renderização no servidor: o app depende de APIs de
      // navegador (Leaflet, localStorage) que não existem no Node, e não há
      // ganho de SEO num app autenticado.
      output: 'single',
      favicon: './assets/images/favicon.png',
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
