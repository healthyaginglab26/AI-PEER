// React Native Firebase is Android-only for now (phone auth fix).
// iOS needs GoogleService-Info.plist, APNs and static frameworks before it can
// be linked, so keep it out of the iOS build until that setup is done.
//
// Overriding a dependency here replaces the library's own config, so the
// Android import path from @react-native-firebase/app must be restated.
module.exports = {
  dependencies: {
    '@react-native-firebase/app': {
      platforms: {
        ios: null,
        android: {
          packageImportPath: 'import io.invertase.firebase.app.ReactNativeFirebaseAppPackage;',
        },
      },
    },
    '@react-native-firebase/auth': { platforms: { ios: null } },
  },
};
