import Constants from 'expo-constants';
import { decideBuild } from '@/domain/build-variant';

/**
 * Which build this is and whether Online Preview is reachable (rules and reasons: `domain/build-variant.ts`).
 * - a development build (`__DEV__`): online only when Metro was started with `EXPO_PUBLIC_ONLINE_MODE=1` and an explicit
 *   `EXPO_PUBLIC_API_BASE_URL` (never the production host), so the preview can never fall back to the production URL in
 *   app.json by accident;
 * - StockMind QA (Series 12, standalone, `io.stockmind.app.qa`): online only when built for it AND the backend is on a
 *   loopback/private-network address;
 * - any other release build keeps showing "Cloud sync coming soon".
 *
 * Expo inlines `process.env.EXPO_PUBLIC_*` at bundle time; the members must be written out literally.
 */
export const BUILD = decideBuild({
  isDev: __DEV__,
  bundleVariant: process.env.EXPO_PUBLIC_STOCKMIND_VARIANT,
  nativeVariant: Constants.expoConfig?.extra?.stockmindVariant,
  nativeApplicationId: Constants.expoConfig?.android?.package,
  onlineFlag: process.env.EXPO_PUBLIC_ONLINE_MODE,
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL,
});

export const ONLINE_MODE_DEV_PREVIEW: boolean = BUILD.onlineEnabled;

/** True in StockMind QA (the standalone side-by-side build). */
export const IS_QA_BUILD: boolean = BUILD.variant === 'qa';

/** Host[:port] of the configured API, shown on the dev-preview screens as evidence of where requests go. */
export function apiHostLabel(baseUrl: string): string {
  const match = /^[a-z]+:\/\/([^/]+)/i.exec(baseUrl);
  return match ? match[1] : baseUrl;
}
