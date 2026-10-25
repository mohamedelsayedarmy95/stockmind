/**
 * Series 12: which kind of build is running, and whether it may reach a server. Pure (no React Native), so the boundary is
 * unit-tested in plain Node.
 *
 * Three kinds of build:
 * - `dev`: a debug build that loads JavaScript from Metro (`__DEV__`). Online Preview works as before Series 12: Metro was
 *   started with `EXPO_PUBLIC_ONLINE_MODE=1` and an explicit `EXPO_PUBLIC_API_BASE_URL`.
 * - `qa`: "StockMind QA", a standalone release build with its JavaScript embedded (no Metro), installed side by side as
 *   `io.stockmind.app.qa`. It is QA only when TWO independent build-time markers agree: the JavaScript bundle was built with
 *   `EXPO_PUBLIC_STOCKMIND_VARIANT=qa`, AND the native app config embedded in the APK says variant `qa` with the QA
 *   application id (written by app.config.js only when `STOCKMIND_VARIANT=qa`). A leaked environment variable alone cannot
 *   turn a normal build into a QA build. QA Online Preview additionally needs `EXPO_PUBLIC_ONLINE_MODE=1` and a backend on a
 *   loopback or private-network address; anything else (a public host, the production host, no URL) keeps it offline-only.
 * - `release`: everything else (including a QA marker that the native identity does not confirm). Online stays off, exactly
 *   as before Series 12 ("Cloud sync coming soon").
 */

export type BuildVariant = 'dev' | 'qa' | 'release';

export const QA_APPLICATION_ID = 'io.stockmind.app.qa';

/** Hosts that belong to the production service. No preview, dev or QA, may ever use them. */
export const PRODUCTION_HOSTS: readonly string[] = ['stockmind-api-vmht.onrender.com', 'api.stockmind.io'];

/**
 * Where a QA build sends requests when no usable local backend was configured: the discard port on the phone itself.
 * It never answers, so a stray request fails as "server unreachable" and can never reach a real service.
 */
export const QA_UNREACHABLE_BASE_URL = 'http://127.0.0.1:9/api/v1';

export interface BuildInputs {
  /** `__DEV__` */
  isDev: boolean;
  /** `process.env.EXPO_PUBLIC_STOCKMIND_VARIANT`, inlined into the bundle at build time. */
  bundleVariant: string | undefined;
  /** `Constants.expoConfig.extra.stockmindVariant`, from the app config embedded in the native build. */
  nativeVariant: unknown;
  /** `Constants.expoConfig.android.package`, from the same embedded app config. */
  nativeApplicationId: unknown;
  /** `process.env.EXPO_PUBLIC_ONLINE_MODE` */
  onlineFlag: string | undefined;
  /** `process.env.EXPO_PUBLIC_API_BASE_URL` */
  apiBaseUrl: string | undefined;
}

export type OnlineRefusal =
  | 'release-build'
  | 'flag-off'
  | 'no-url'
  | 'bad-url'
  | 'production-host'
  | 'not-private-network'
  | 'qa-identity-mismatch';

export interface BuildDecision {
  variant: BuildVariant;
  onlineEnabled: boolean;
  /** Why online is off (null when it is on). Shown nowhere as an error; it explains the build in diagnostics. */
  refusal: OnlineRefusal | null;
  /** The backend a QA/dev online build talks to, or null when online is off. */
  apiHost: string | null;
}

/** `host` of an http(s) URL in lower case, or null if it is not one. */
export function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  const m = /^(https?):\/\/(\[[^\]]+\]|[^/:?#]+)(?::(\d+))?(?:[/?#]|$)/i.exec(url.trim());
  return m ? m[2].toLowerCase() : null;
}

export function isProductionHost(host: string): boolean {
  const h = host.toLowerCase();
  return PRODUCTION_HOSTS.some((p) => h === p || h.endsWith(`.${p}`));
}

/**
 * Loopback or private-network address (RFC 1918, the Android emulator's host alias): the only places a QA build may send
 * requests. Names other than `localhost` are refused, because a name can resolve anywhere.
 */
export function isPrivateNetworkHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h === '[::1]') return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some((n) => n > 255)) return false;
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export function decideBuild(input: BuildInputs): BuildDecision {
  const off = (variant: BuildVariant, refusal: OnlineRefusal): BuildDecision =>
    ({ variant, onlineEnabled: false, refusal, apiHost: null });

  if (input.isDev) {
    if (input.onlineFlag !== '1') return off('dev', 'flag-off');
    if (!input.apiBaseUrl) return off('dev', 'no-url');
    const host = hostOf(input.apiBaseUrl);
    if (!host) return off('dev', 'bad-url');
    if (isProductionHost(host)) return off('dev', 'production-host');
    return { variant: 'dev', onlineEnabled: true, refusal: null, apiHost: host };
  }

  if (input.bundleVariant !== 'qa') return off('release', 'release-build');
  // Both build-time markers must agree, or this is not a QA build (fail closed, as a release build).
  if (input.nativeVariant !== 'qa' || input.nativeApplicationId !== QA_APPLICATION_ID) {
    return off('release', 'qa-identity-mismatch');
  }
  if (input.onlineFlag !== '1') return off('qa', 'flag-off');
  if (!input.apiBaseUrl) return off('qa', 'no-url');
  const host = hostOf(input.apiBaseUrl);
  if (!host) return off('qa', 'bad-url');
  if (isProductionHost(host)) return off('qa', 'production-host');
  if (!isPrivateNetworkHost(host)) return off('qa', 'not-private-network');
  return { variant: 'qa', onlineEnabled: true, refusal: null, apiHost: host };
}

/**
 * The base URL the API client uses. A QA build never falls back to the production URL in app.json: with online off it gets
 * an address that cannot answer. Other builds keep the pre-Series-12 order (explicit URL, app config, emulator default).
 */
export function resolveApiBaseUrl(
  decision: BuildDecision,
  urls: { explicit: string | undefined; appConfig: string | undefined },
): string {
  if (decision.variant === 'qa') return decision.onlineEnabled ? (urls.explicit as string) : QA_UNREACHABLE_BASE_URL;
  return urls.explicit ?? urls.appConfig ?? 'http://10.0.2.2:3000/api/v1';
}

/**
 * Certificate pinning is for the production host. A QA build talking to its loopback/private-network backend does not use
 * the pinned transport (that backend has no production certificate, and the pinning module is not linked in this app);
 * every other non-dev build keeps whatever the pinning configuration says.
 */
export function usesPinnedTransport(decision: BuildDecision, pinningWanted: boolean): boolean {
  if (decision.variant === 'qa') return false;
  return pinningWanted;
}
