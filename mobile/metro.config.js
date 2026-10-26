const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

/**
 * O `expo-notifications` 57 carrega o módulo nativo `ExpoTopicSubscriptionModule`
 * já no import, e o Expo Go 57.0.9 não o tem: o app quebra antes de abrir.
 * O app não usa `subscribeToTopicAsync`/`unsubscribeFromTopicAsync`, então
 * apontamos o import para o stub sem nativo que o próprio pacote publica.
 * shortcut: assinatura de tópicos de push fica inerte; remova este bloco se o app passar a usá-la.
 */
const resolverPadrao = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === './TopicSubscriptionModule' && /expo-notifications[\\/]build/.test(context.originModulePath)) {
    return { type: 'sourceFile', filePath: require.resolve('expo-notifications/build/TopicSubscriptionModule.js') };
  }
  return (resolverPadrao ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
