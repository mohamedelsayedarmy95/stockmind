/**
 * Build variants (Series 12). app.json stays the single source of the app's configuration; this file only derives the
 * StockMind QA variant from it.
 *
 * - STOCKMIND_VARIANT unset: exactly app.json (`io.stockmind.app`, "StockMind"): the development build and any future
 *   release build are unchanged by Series 12.
 * - STOCKMIND_VARIANT=qa: "StockMind QA", a standalone build installed SIDE BY SIDE with the existing app:
 *     * its own application id `io.stockmind.app.qa` (its own sandbox, data, keystore entries, never an update of
 *       `io.stockmind.app`) and its own deep-link scheme;
 *     * no production API URL in its config (app.json's `extra.apiBaseUrl` is removed), and a marker
 *       (`extra.stockmindVariant`) the app checks at run time together with the bundle's own marker;
 *     * the QA native plugin: release signing with a local QA key (never the public debug key), and cleartext HTTP only to
 *       the one loopback/private-network backend named at build time (plugins/with-stockmind-qa.js).
 *   Use mobile/scripts/qa-build.ps1, which sets these variables and checks the resulting APK.
 * Any other value of STOCKMIND_VARIANT is refused.
 */
const QA_APPLICATION_ID = 'io.stockmind.app.qa';

module.exports = ({ config }) => {
  const variant = process.env.STOCKMIND_VARIANT ?? '';
  if (variant === '') return config;
  if (variant !== 'qa') throw new Error(`Unknown STOCKMIND_VARIANT "${variant}" (expected "qa" or unset)`);

  const { apiBaseUrl: _productionUrl, ...extra } = config.extra ?? {};
  const buildId = process.env.STOCKMIND_QA_BUILD_ID || 'local';
  const versionCode = Number.parseInt(process.env.STOCKMIND_QA_VERSION_CODE ?? '', 10);

  return {
    ...config,
    name: 'StockMind QA',
    scheme: 'stockmind-qa',
    version: `${config.version}-qa.${buildId}`,
    android: {
      ...config.android,
      package: QA_APPLICATION_ID,
      versionCode: Number.isInteger(versionCode) && versionCode > 0 ? versionCode : config.android.versionCode,
    },
    ios: { ...config.ios, bundleIdentifier: QA_APPLICATION_ID },
    extra: { ...extra, stockmindVariant: 'qa', stockmindQaBuildId: buildId },
    plugins: [
      ...(config.plugins ?? []),
      ['./plugins/with-stockmind-qa', { apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? null }],
    ],
  };
};
