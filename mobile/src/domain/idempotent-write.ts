/**
 * Online stock writes carry an `Idempotency-Key`: one key per user action, reused on every retry of that action.
 *
 * The server stores the first result under the key, so a retry after a lost response replays it (`replayed: true`)
 * instead of moving the stock twice, and the same key with a different body is refused with 422. Hence:
 * - a key is bound to the exact request body; editing the action means a new key;
 * - after a success the key is spent, so the next identical action gets a fresh one;
 * - automatic retries happen only when no answer (or a transient 5xx/408/429) came back.
 */

/** What the server accepts (see the stock controller): 8–128 of A-Z a-z 0-9 _ -. A UUID fits. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export interface ActionKey {
  /** Canonical body the key was issued for. */
  body: string;
  key: string;
}

/** Reuses the key while the body is unchanged (a retry); issues a new one for a different body (a new action). */
export function actionKeyFor(prev: ActionKey | null, body: string, generate: () => string): ActionKey {
  if (prev && prev.body === body) return prev;
  const key = generate();
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) throw new Error('INVALID_IDEMPOTENCY_KEY');
  return { body, key };
}

/** Stable text for a request body: keys sorted, undefined dropped, so the same action always maps to the same key. */
export function canonicalBody(body: Record<string, unknown>): string {
  return JSON.stringify(
    Object.keys(body)
      .filter((k) => body[k] !== undefined)
      .sort()
      .map((k) => [k, body[k]]),
  );
}

const TRANSIENT = new Set([408, 429, 500, 502, 503, 504]);

/** True when the write may not have reached the server, or the server asked to come back later. */
export function isRetryableWriteError(status: number | undefined): boolean {
  return status === undefined || TRANSIENT.has(status);
}

export type WriteRejection = 'insufficient-stock' | 'key-reused';

/** 409: the server refused the movement (e.g. not enough stock); 422: the key was reused for a different request. */
export function writeRejectionOf(status: number | undefined): WriteRejection | null {
  if (status === 409) return 'insufficient-stock';
  if (status === 422) return 'key-reused';
  return null;
}

export interface RetryOptions {
  attempts?: number;
  /** Delay before attempt n (1-based, n >= 2). */
  delayMs?: (attempt: number) => number;
  sleep?: (ms: number) => Promise<void>;
  statusOf: (err: unknown) => number | undefined;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Sends one write, retrying transient failures with the SAME key. Non-retryable errors are thrown at once. */
export async function sendIdempotent<T>(
  key: string,
  send: (key: string) => Promise<T>,
  { attempts = 3, delayMs = (n) => 800 * 2 ** (n - 2), sleep = defaultSleep, statusOf }: RetryOptions,
): Promise<T> {
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) throw new Error('INVALID_IDEMPOTENCY_KEY');
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) await sleep(delayMs(attempt));
    try {
      return await send(key);
    } catch (err) {
      lastError = err;
      if (!isRetryableWriteError(statusOf(err))) throw err;
    }
  }
  throw lastError;
}
