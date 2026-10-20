import {
  actionKeyFor,
  canonicalBody,
  IDEMPOTENCY_KEY_PATTERN,
  isRetryableWriteError,
  sendIdempotent,
  writeRejectionOf,
} from './idempotent-write';
import { httpStatusOf } from './auth-flow';

const httpError = (status?: number) => (status === undefined ? new Error('Network Error') : { response: { status } });
const noSleep = () => Promise.resolve();

describe('idempotency key per user action', () => {
  let n = 0;
  const gen = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

  it('a UUID satisfies the server pattern', () => {
    expect(IDEMPOTENCY_KEY_PATTERN.test('3f2b6c1e-8d4a-4f7b-9c2e-1a2b3c4d5e6f')).toBe(true);
    expect(IDEMPOTENCY_KEY_PATTERN.test('short')).toBe(false);
    expect(IDEMPOTENCY_KEY_PATTERN.test('has space in it')).toBe(false);
  });

  it('reuses the key while the body is the same (retry) and issues a new one when it changes', () => {
    const body = canonicalBody({ productId: 'p', warehouseId: 'w', quantity: '5' });
    const first = actionKeyFor(null, body, gen);
    expect(actionKeyFor(first, body, gen)).toBe(first);
    const edited = actionKeyFor(first, canonicalBody({ productId: 'p', warehouseId: 'w', quantity: '6' }), gen);
    expect(edited.key).not.toBe(first.key);
  });

  it('canonical body ignores key order and undefined fields', () => {
    expect(canonicalBody({ b: 1, a: 'x', c: undefined })).toBe(canonicalBody({ a: 'x', b: 1 }));
  });

  it('refuses a generator that produces an invalid key', () => {
    expect(() => actionKeyFor(null, '{}', () => 'bad key')).toThrow('INVALID_IDEMPOTENCY_KEY');
  });
});

describe('idempotent send with retries', () => {
  const KEY = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

  it('retries a lost response with the SAME key, and returns the replayed result', async () => {
    const seen: string[] = [];
    const send = jest.fn(async (key: string) => {
      seen.push(key);
      if (seen.length < 3) throw httpError(undefined);
      return { id: 'm1', replayed: true };
    });
    await expect(sendIdempotent(KEY, send, { statusOf: httpStatusOf, sleep: noSleep })).resolves.toEqual({
      id: 'm1',
      replayed: true,
    });
    expect(seen).toEqual([KEY, KEY, KEY]);
  });

  it('does not retry a refusal (409/422/400/403): the answer is final', async () => {
    for (const status of [409, 422, 400, 403]) {
      const send = jest.fn(async () => {
        throw httpError(status);
      });
      await expect(sendIdempotent(KEY, send, { statusOf: httpStatusOf, sleep: noSleep })).rejects.toEqual(
        httpError(status),
      );
      expect(send).toHaveBeenCalledTimes(1);
    }
  });

  it('gives up after the attempt budget and surfaces the last error', async () => {
    const send = jest.fn(async () => {
      throw httpError(503);
    });
    await expect(sendIdempotent(KEY, send, { attempts: 2, statusOf: httpStatusOf, sleep: noSleep })).rejects.toEqual(
      httpError(503),
    );
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('classifies retryable failures and rejections', () => {
    expect([undefined, 408, 429, 500, 502, 503, 504].every(isRetryableWriteError)).toBe(true);
    expect([400, 401, 403, 404, 409, 422].some(isRetryableWriteError)).toBe(false);
    expect(writeRejectionOf(409)).toBe('insufficient-stock');
    expect(writeRejectionOf(422)).toBe('key-reused');
    expect(writeRejectionOf(500)).toBeNull();
  });

  it('refuses to send with a malformed key', async () => {
    const send = jest.fn();
    await expect(sendIdempotent('bad key', send, { statusOf: httpStatusOf })).rejects.toThrow('INVALID_IDEMPOTENCY_KEY');
    expect(send).not.toHaveBeenCalled();
  });
});
