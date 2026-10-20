import {
  backoffMs,
  canDiscard,
  createIntent,
  expireStale,
  IntentError,
  markSending,
  MAX_UNSENT_AGE_MS,
  nextToSend,
  pendingEffects,
  prune,
  recoverInterrupted,
  retryNow,
  settle,
  StockIntent,
  wake,
} from './outbox';
import { decodeJwtPayload, scopeKey, scopeOf } from './session-scope';

const A = 'localhost:3000|company-1|user-a';
const B = 'localhost:3000|company-1|user-b';
let n = 0;
const key = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const intent = (over: Omit<Partial<StockIntent>, 'kind'> & { kind?: string; qty?: string } = {}): StockIntent => {
  const i = createIntent({
    id: key(),
    scope: over.scope ?? A,
    seq: over.seq ?? n,
    kind: over.kind ?? 'outbound',
    payload: { productId: over.payload?.productId ?? 'p1', warehouseId: over.payload?.warehouseId ?? 'w1', quantity: over.qty ?? '5' },
    now: 1_000,
  });
  const { kind: _kind, qty: _qty, ...rest } = over;
  return { ...i, ...rest, payload: i.payload };
};
const half = () => 0.5;

describe('offline intents: policy', () => {
  it('only receipts and dispatches may wait for the network', () => {
    expect(intent({ kind: 'inbound' }).state).toBe('PENDING');
    for (const kind of ['transfer', 'adjustment', 'delete']) {
      expect(() => intent({ kind })).toThrow(IntentError);
    }
  });

  it('refuses a bad quantity or key, and freezes the payload it was given', () => {
    expect(() => intent({ qty: '0' })).toThrow('INVALID_QUANTITY');
    expect(() => intent({ qty: '-3' })).toThrow('INVALID_QUANTITY');
    expect(() => intent({ qty: 'abc' })).toThrow('INVALID_QUANTITY');
    expect(() => createIntent({ id: 'short', scope: A, seq: 1, kind: 'inbound', payload: { productId: 'p', warehouseId: 'w', quantity: '1' }, now: 0 }))
      .toThrow('INVALID_KEY');
    const extra = { productId: 'p', warehouseId: 'w', quantity: '1', storeId: 's' } as never;
    expect(Object.keys(createIntent({ id: key(), scope: A, seq: 1, kind: 'inbound', payload: extra, now: 0 }).payload))
      .toEqual(['productId', 'warehouseId', 'quantity']);
  });
});

describe('offline intents: outcomes', () => {
  const sent = (over: Partial<StockIntent> = {}) => markSending(intent(over));

  it('a 2xx confirms with the server movement, replayed or not', () => {
    const c = settle(sent(), { ok: true, body: { id: 'm9', revision: '12', runningBalance: '88.000000', replayed: true } }, 50);
    expect(c).toMatchObject({ state: 'CONFIRMED', attempts: 1, result: { movementId: 'm9', revision: '12', replayed: true } });
  });

  it('no answer (offline/timeout) or a 5xx: retry later with the same key; it may already be recorded', () => {
    for (const status of [undefined, 408, 500, 502, 503, 504]) {
      const r = settle(sent(), { ok: false, status }, 10_000, half);
      expect(r).toMatchObject({ state: 'PENDING', maybeCommitted: true });
      expect(r.nextAttemptAt).toBe(10_000 + 1_500); // attempt 1: 2 s x 0.75
    }
    expect(settle(sent(), { ok: false, status: 429 }, 0, half)).toMatchObject({ state: 'PENDING', maybeCommitted: false });
  });

  it('backoff doubles up to five minutes, with jitter', () => {
    expect([1, 2, 3, 4].map((a) => backoffMs(a, () => 1))).toEqual([2_000, 4_000, 8_000, 16_000]);
    expect(backoffMs(30, () => 1)).toBe(300_000);
    expect(backoffMs(1, () => 0)).toBe(1_000);
  });

  it('a 409 is final and proves nothing was recorded under the key; a 401 waits for the same account', () => {
    expect(settle(sent(), { ok: false, status: 409 }, 0)).toMatchObject({ state: 'REJECTED', lastError: { reason: 'insufficient-stock', status: 409 } });
    expect(settle(sent(), { ok: false, status: 401 }, 7)).toMatchObject({ state: 'PENDING', nextAttemptAt: 7, lastError: { reason: 'auth' } });
    expect(settle(sent(), { ok: false, status: 402 }, 0).lastError?.reason).toBe('plan-limit');
    expect(settle(sent(), { ok: false, status: 400 }, 0)).toMatchObject({ state: 'REJECTED', lastError: { reason: 'invalid' } });
    expect(settle(sent(), { ok: false, status: 422 }, 0).state).toBe('NEEDS_REVIEW');
  });

  it('access removed: rejected if no attempt can have landed, otherwise held for review (outcome unknown)', () => {
    expect(settle(sent(), { ok: false, status: 404 }, 0)).toMatchObject({ state: 'REJECTED', lastError: { reason: 'no-access' } });
    const ambiguous = settle(sent(), { ok: false, status: undefined }, 0, half);
    expect(settle(markSending(ambiguous), { ok: false, status: 403 }, 0)).toMatchObject({ state: 'NEEDS_REVIEW', lastError: { reason: 'no-access' } });
  });
});

describe('offline intents: queue order and identity', () => {
  it('sends one at a time in creation order; a head in backoff holds the rest', () => {
    const first = intent({ kind: 'inbound', seq: 1 });
    const second = intent({ seq: 2 });
    expect(nextToSend([second, first], A, 1_000)).toEqual({ intent: first });
    const waiting = { ...first, nextAttemptAt: 5_000 };
    expect(nextToSend([second, waiting], A, 1_000)).toEqual({ waitMs: 4_000 });
    expect(nextToSend([{ ...first, state: 'CONFIRMED' }, second], A, 1_000)).toEqual({ intent: second });
    expect(nextToSend([{ ...first, state: 'REJECTED' }], A, 1_000)).toBeNull();
  });

  it('a sign of connectivity wakes waiting intents of that account only, keeping their order and keys', () => {
    const waiting = { ...intent({ seq: 1 }), nextAttemptAt: 60_000 };
    const theirs = { ...intent({ seq: 2, scope: B }), nextAttemptAt: 60_000 };
    const woken = wake([waiting, theirs], A, 2_000);
    expect(woken[0]).toMatchObject({ id: waiting.id, nextAttemptAt: 2_000 });
    expect(woken[1].nextAttemptAt).toBe(60_000);
    expect(nextToSend(woken, A, 2_000)).toEqual({ intent: woken[0] });
  });

  it("never offers one account's intents to another account", () => {
    const mine = intent({ scope: A });
    expect(nextToSend([mine], B, 9_999)).toBeNull();
    expect(pendingEffects([mine], B, 'w1', null)).toEqual({});
  });

  it('an app killed mid-send resumes with the same key, flagged as possibly recorded', () => {
    const killed = markSending(intent());
    const [resumed] = recoverInterrupted([killed]);
    expect(resumed).toMatchObject({ id: killed.id, state: 'PENDING', maybeCommitted: true, payload: killed.payload });
    expect(canDiscard(resumed)).toBe(false); // it may exist on the server: it must be resolved, not dropped
  });
});

describe('offline intents: display and housekeeping', () => {
  it('pending effects are separate from confirmed figures and stop counting once synced (no double count)', () => {
    const receipt = intent({ kind: 'inbound', qty: '10' });
    const dispatch = intent({ qty: '3' });
    const confirmed = { ...intent({ qty: '2' }), state: 'CONFIRMED' as const, result: { movementId: 'm', revision: '8', runningBalance: '1', replayed: false, at: 0 } };
    const other = intent({ qty: '4', payload: { productId: 'p1', warehouseId: 'w2', quantity: '4' } });
    expect(pendingEffects([receipt, dispatch, confirmed, other], A, 'w1', '7')).toEqual({
      p1: { pending: 7, awaitingSync: -2, count: 3 },
    });
    // Once the synced cursor reaches revision 8, the server figures include it: it no longer counts.
    expect(pendingEffects([confirmed], A, 'w1', '8')).toEqual({});
  });

  it('discard only when safe; retry unchanged only when nothing was recorded', () => {
    const fresh = intent();
    expect(canDiscard(fresh)).toBe(true);
    const rejected = settle(markSending(intent()), { ok: false, status: 409 }, 0);
    expect(canDiscard(rejected)).toBe(true);
    expect(retryNow(rejected, 42)).toMatchObject({ state: 'PENDING', nextAttemptAt: 42, id: rejected.id });
    const noAccess = settle(markSending(intent()), { ok: false, status: 404 }, 0);
    expect(retryNow(noAccess, 1)).toBeNull();
    expect(retryNow({ ...fresh, nextAttemptAt: 99 }, 5)?.nextAttemptAt).toBe(5);
  });

  it('a never-sent intent older than the limit is held for review; possibly-recorded ones are not', () => {
    const old = intent();
    const now = old.createdAt + MAX_UNSENT_AGE_MS + 1;
    expect(expireStale([old], now)[0]).toMatchObject({ state: 'NEEDS_REVIEW', lastError: { reason: 'too-old' } });
    const ambiguous = { ...old, attempts: 1, maybeCommitted: true };
    expect(expireStale([ambiguous], now)[0].state).toBe('PENDING');
  });

  it('prunes confirmed history after a day, never unresolved intents', () => {
    const done = { ...intent(), state: 'CONFIRMED' as const, result: { movementId: 'm', revision: '1', runningBalance: '0', replayed: false, at: 0 } };
    const waiting = intent();
    expect(prune([done, waiting], 25 * 60 * 60 * 1000)).toEqual([waiting]);
  });
});

describe('account scope', () => {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = (payload: object) => `${b64({ alg: 'HS256' })}.${b64(payload)}.sig`;

  it('reads the company from the token and binds it to the signed-in user', () => {
    const token = jwt({ sub: 'user-a', companyId: 'company-1', role: 'Staff' });
    expect(decodeJwtPayload(token)).toMatchObject({ sub: 'user-a', companyId: 'company-1' });
    const scope = scopeOf('localhost:3000', token, 'user-a');
    expect(scope && scopeKey(scope)).toBe(A);
  });

  it('yields no scope for a mismatched user, a missing company or a malformed token', () => {
    expect(scopeOf('h', jwt({ sub: 'user-b', companyId: 'c' }), 'user-a')).toBeNull();
    expect(scopeOf('h', jwt({ sub: 'user-a' }), 'user-a')).toBeNull();
    expect(scopeOf('h', 'not-a-jwt', 'user-a')).toBeNull();
    expect(scopeOf('h', null, 'user-a')).toBeNull();
  });
});
