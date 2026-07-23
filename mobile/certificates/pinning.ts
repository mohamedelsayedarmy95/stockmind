/**
 * Certificate (public-key) pinning configuration for StockMind.
 *
 * ─── Why pinning matters ────────────────────────────────────────────────────
 * Certificate pinning defeats MITM attacks even when the device trusts a rogue
 * CA (corporate proxy, hotel Wi-Fi, user-installed root certificate). The native
 * TLS layer (OkHttp / NSURLSession) only completes the handshake when the
 * server presents one of the hashes below.
 *
 * ─── How it works in this codebase ─────────────────────────────────────────
 * 1. `mobile/src/lib/pinned-http.ts` exports `pinnedAxiosAdapter`.
 * 2. `mobile/src/api/client.ts` swaps axios's transport to that adapter when
 *    `shouldPin()` returns true (production + enforce=true in this config).
 * 3. `react-native-ssl-pinning` validates the DER cert file against the TLS
 *    chain at the native layer — JS never sees the raw certificate.
 *
 * ─── Required cert file ─────────────────────────────────────────────────────
 * Place a DER-encoded copy of the production leaf certificate at:
 *   mobile/certificates/stockmind-prod.cer
 *
 * Extract it from the live server once the TLS cert is provisioned:
 *
 *   openssl s_client -connect api.stockmind.io:443 \
 *                    -servername api.stockmind.io </dev/null \
 *     | openssl x509 -outform DER -out stockmind-prod.cer
 *
 * Then copy it to the native bundles (after `expo prebuild`):
 *   Android: android/app/src/main/assets/stockmind-prod.cer
 *   iOS:     Add to Xcode → target → Build Phases → Copy Bundle Resources
 *
 * ─── Public-key hash (backup pin) ───────────────────────────────────────────
 * Generate the SPKI hash from the LIVE cert for use as a backup pin:
 *
 *   openssl s_client -connect api.stockmind.io:443 \
 *                    -servername api.stockmind.io </dev/null \
 *     | openssl x509 -pubkey -noout \
 *     | openssl pkey -pubin -outform der \
 *     | openssl dgst -sha256 -binary \
 *     | openssl enc -base64
 *
 * Update `publicKeyHashes` below with the real base64 output.
 * Always keep a BACKUP hash (next cert / intermediate) to prevent lockouts
 * during certificate rotation.
 *
 * ─── Rotation plan ──────────────────────────────────────────────────────────
 * 1. At least 30 days before cert expiry: add the NEW cert hash as a second
 *    entry in `publicKeyHashes`, ship an app update.
 * 2. After ≥ 90 % of users have updated: rotate the live cert.
 * 3. After 100 % have updated: remove the OLD hash in the next release.
 * ────────────────────────────────────────────────────────────────────────────
 */

export interface PinningConfig {
  host: string;
  /** SHA-256 SPKI hashes — base64. Populated once the production TLS cert exists. */
  publicKeyHashes: string[];
  /**
   * Fail closed in production (true). In development, localhost has no matching
   * cert so we must leave this false — the adapter never loads in dev anyway
   * because `shouldPin()` checks `!__DEV__` first.
   */
  enforce: boolean;
}

const IS_DEV = __DEV__;

export const PINNING: PinningConfig = {
  host: 'api.stockmind.io',
  publicKeyHashes: [
    // ⚠️  REPLACE THESE with real hashes before submitting to app stores.
    // These are placeholder values — they will NOT match any real certificate.
    'sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', // primary  — replace
    'sha256/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=', // backup   — replace
  ],
  enforce: !IS_DEV,
};
