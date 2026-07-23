module.exports = {
  dependencies: {
    // npm alias — JS resolves fine; exclude from native autolinking to avoid
    // duplicate librnworklets.so (real impl is react-native-worklets-core)
    'react-native-worklets': {
      platforms: { android: null, ios: null },
    },
    // v1.1.2 pulls a transitive material dep that references android:attr/lStar
    // (API 31+) which breaks the resource linker on GitHub Actions.
    // Pinning is opt-in via shouldPin() — safe to defer until prod cert is ready.
    'react-native-ssl-pinning': {
      platforms: { android: null, ios: null },
    },
  },
};
