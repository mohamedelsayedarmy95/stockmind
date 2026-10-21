/**
 * The account a piece of online data belongs to: which server, which company, which user. Queued stock intents and
 * cached server figures are stored under this scope, so they are never sent, shown or merged under another account
 * or organisation on the same device.
 *
 * The company comes from the access token's payload. Reading it does not verify the token (the server does that on
 * every request); it only labels local data. A token whose subject is not the signed-in user yields no scope.
 */

export interface AccountScope {
  api: string;
  companyId: string;
  userId: string;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** base64url → UTF-8 text, without relying on atob (not guaranteed on every JS engine). */
function decodeBase64Url(input: string): string | null {
  const s = input.replace(/-/g, '+').replace(/_/g, '/');
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of s) {
    if (ch === '=') break;
    const v = B64.indexOf(ch);
    if (v < 0) return null;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  try {
    return decodeURIComponent(bytes.map((b) => `%${b.toString(16).padStart(2, '0')}`).join(''));
  } catch {
    return null;
  }
}

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const text = decodeBase64Url(parts[1]);
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function scopeOf(api: string, accessToken: string | null, userId: string | null | undefined): AccountScope | null {
  if (!accessToken || !userId) return null;
  const payload = decodeJwtPayload(accessToken);
  if (!payload || payload.sub !== userId || typeof payload.companyId !== 'string' || !payload.companyId) return null;
  return { api, companyId: payload.companyId, userId };
}

export function scopeKey(scope: AccountScope): string {
  return `${scope.api}|${scope.companyId}|${scope.userId}`;
}
