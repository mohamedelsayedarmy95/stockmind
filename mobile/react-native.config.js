module.exports = {
  dependencies: {
    // npm alias — JS resolves fine; exclude from native autolinking to avoid
    // duplicate librnworklets.so (real impl is react-native-worklets-core)
    'react-native-worklets': {
      platforms: { android: null, ios: null },
    },
  },
};
