/**
 * Online mode is a development preview. It is reachable only when ALL of these hold:
 * - a development build (`__DEV__`), so a release build keeps showing "Cloud sync coming soon";
 * - Metro was started with `EXPO_PUBLIC_ONLINE_MODE=1`;
 * - `EXPO_PUBLIC_API_BASE_URL` names the backend explicitly, so the preview can never fall back to the production
 *   URL in app.json by accident.
 *
 * Expo inlines `process.env.EXPO_PUBLIC_*` at bundle time; the members must be written out literally.
 */
export const ONLINE_MODE_DEV_PREVIEW: boolean =
  __DEV__ &&
  process.env.EXPO_PUBLIC_ONLINE_MODE === '1' &&
  Boolean(process.env.EXPO_PUBLIC_API_BASE_URL);

/** Host[:port] of the configured API, shown on the dev-preview screens as evidence of where requests go. */
export function apiHostLabel(baseUrl: string): string {
  const match = /^[a-z]+:\/\/([^/]+)/i.exec(baseUrl);
  return match ? match[1] : baseUrl;
}
