const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add tflite to asset extensions so Metro bundles the model file
config.resolver.assetExts.push('tflite');

// Resolve @/ path alias from tsconfig.json (maps @/* to ./* from project root)
// and stub native-only camera/worklet/llama modules when bundling for Web mode
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    platform === 'web' &&
    (moduleName === 'react-native-vision-camera' ||
      moduleName === 'react-native-worklets-core')
  ) {
    return {
      filePath: path.join(__dirname, 'src/vision/visionCameraWebStub.js'),
      type: 'sourceFile',
    };
  }

  if (moduleName.startsWith('@/')) {
    const newModuleName = path.join(__dirname, moduleName.slice(2));
    return context.resolveRequest(context, newModuleName, platform);
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
