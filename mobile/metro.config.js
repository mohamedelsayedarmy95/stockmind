const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// Harden the release JS bundle: aggressive name-mangling + drop comments and any
// residual console/debugger. Combined with the babel transform-remove-console
// plugin, this makes the shipped JavaScript materially harder to reverse.
config.transformer.minifierConfig = {
  compress: {
    drop_console: true,
    drop_debugger: true,
  },
  mangle: {
    toplevel: true,
  },
  output: {
    comments: false,
  },
};

module.exports = withNativeWind(config, { input: './global.css' });
