module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    // Anti-reverse-engineering: strip all console.* and debugger statements from
    // PRODUCTION bundles so release APKs leak no logs or debug hooks. Expo sets
    // BABEL_ENV/NODE_ENV to "production" for release builds, activating this env.
    env: {
      production: {
        plugins: ['transform-remove-console'],
      },
    },
    plugins: [
      // Reanimated plugin MUST be listed last.
      'react-native-reanimated/plugin',
    ],
  };
};
