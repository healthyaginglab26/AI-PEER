//
// visionCameraWebStub.js — Safe web mock for react-native-vision-camera & react-native-worklets-core
//
// Why this exists:
// react-native-vision-camera throws a hard error at module load time on Web
// ("Failed to initialize VisionCamera: VisionCamera currently does not work on web"),
// which crashes Expo Router when it eagerly evaluates all route files under app/.
//
// Metro maps `react-native-vision-camera` and `react-native-worklets-core` to this
// stub ONLY when bundling for `platform === 'web'` (see metro.config.js). Native
// iOS and Android builds are 100% untouched and continue to use the real native modules.
//

const React = require('react');
const { View, Text, StyleSheet } = require('react-native');

function Camera(props) {
  return React.createElement(
    View,
    { style: [styles.placeholder, props.style] },
    React.createElement(
      Text,
      { style: styles.text },
      '[Web Dev Mode] Native VisionCamera is disabled in browser mode.'
    )
  );
}

function useCameraDevice() {
  return { id: 'web-mock-camera', position: 'front', name: 'Web Mock Camera' };
}

function useCameraPermission() {
  return {
    hasPermission: true,
    requestPermission: async () => true,
  };
}

function useFrameProcessor(fn) {
  return fn;
}

const VisionCameraProxy = {
  initFrameProcessorPlugin: () => ({
    call: () => null,
  }),
};

// react-native-worklets-core stub exports
function useRunOnJS(fn) {
  return fn;
}

const Worklets = {
  createRunOnJS: (fn) => fn,
  createContext: () => ({}),
};

const styles = StyleSheet.create({
  placeholder: {
    flex: 1,
    backgroundColor: '#1f2937',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  text: {
    color: '#e5e7eb',
    fontSize: 14,
    textAlign: 'center',
  },
});

module.exports = {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
  VisionCameraProxy,
  useRunOnJS,
  Worklets,
  default: Camera,
};

