/**
 * Series 09 / S1 on the device: what happens to queued work when the server says the member's access was revoked.
 * Rule under test: nothing queued before a suspension is ever sent again on its own after a reactivation.
 */
import {
  canDiscard, createIntent, holdQueueAfterRevocation, nextToSend, retryNow, settle, StockIntent,
} from './outbox';
import { ACCESS_REVOKED_CODE, errorCodeOf, isAccessRevoked, loginFailure } from './auth-flow';
import { TEAM_ERROR_CODES } from './team-actions';

const SCOPE = 'srv|co|user';
const KEY = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const intent = (n: number, over: Partial<StockIntent> = {}): StockIntent => ({
  ...createIntent({ id: KEY(n), scope: SCOPE, seq: n, kind: 'inbound', payload: { productId: 'p', warehouseId: 'w', quantity: '3' }, now: 1000 }),
  ...over,
});
const sent = (n = 1, over: Partial<StockIntent> = {}) => ({ ...intent(n, over), state: 'SENDING' as const, attempts: 1 });
const revoked = { ok: false as const, status: 401, code: ACCESS_REVOKED_CODE };

describe('a send refused because access was revoked', () => {
  it('is held for a person: REJECTED when nothing may have been recorded, NEEDS_REVIEW when an earlier attempt may have landed', () => {
    expect(settle(sent(), revoked, 5000)).toMatchObject({ state: 'REJECTED', lastError: { status: 401, reason: 'access-revoked' } });
    expect(settle(sent(1, { maybeCommitted: true }), revoked, 5000)).toMatchObject({ state: 'NEEDS_REVIEW', lastError: { reason: 'access-revoked' } });
  });
  it('is never due again by itself: the queue does not pick it up, whatever the time or the account\'s session', () => {
    const held = settle(sent(), revoked, 5000);
    expect(nextToSend([held], SCOPE, 5000 + 365 * 86_400_000)).toBeNull();
  });
  it('is different from an ordinary expired session (401 without the code), which still waits for sign-in and then retries', () => {
    expect(settle(sent(), { ok: false, status: 401 }, 5000)).toMatchObject({ state: 'PENDING', lastError: { reason: 'auth' } });
  });
  it('the person can send a plain refusal again unchanged (nothing was recorded), but a possibly-recorded one needs a review', () => {
    const held = settle(sent(), revoked, 5000);
    expect(canDiscard(held)).toBe(true);
    expect(retryNow(held, 9000)).toMatchObject({ state: 'PENDING', nextAttemptAt: 9000, id: held.id, payload: held.payload });
    expect(retryNow(settle(sent(1, { maybeCommitted: true }), revoked, 5000), 9000)).toBeNull();
  });
});

describe('holdQueueAfterRevocation', () => {
  it('holds every waiting intent of the account, keeps order data and payloads, and touches nothing else', () => {
    const waiting = intent(2);
    const maybe = intent(3, { maybeCommitted: true });
    const other = { ...intent(4), scope: 'srv|co|someone-else' };
    const confirmed = intent(5, { state: 'CONFIRMED' });
    const out = holdQueueAfterRevocation([waiting, maybe, other, confirmed], SCOPE, 7000);
    expect(out[0]).toMatchObject({ state: 'REJECTED', lastError: { reason: 'access-revoked', at: 7000 }, id: waiting.id, payload: waiting.payload });
    expect(out[1]).toMatchObject({ state: 'NEEDS_REVIEW', lastError: { reason: 'access-revoked' } });
    expect(out[2]).toBe(other); // another account's queue
    expect(out[3]).toBe(confirmed); // history stays
    expect(nextToSend(out, SCOPE, 1e12)).toBeNull(); // nothing is left to send
  });
});

describe('error helpers', () => {
  it('reads the machine-readable code from an axios-style error', () => {
    const err = { response: { status: 401, data: { code: 'ACCESS_REVOKED', message: 'x' } } };
    expect(errorCodeOf(err)).toBe('ACCESS_REVOKED');
    expect(isAccessRevoked(err)).toBe(true);
    expect(isAccessRevoked({ response: { status: 401, data: { message: 'Unauthorized' } } })).toBe(false);
    expect(isAccessRevoked(null)).toBe(false);
    expect(errorCodeOf({ response: { data: { code: 42 } } })).toBeUndefined();
  });
  it('a login refused for revoked access is its own failure, not "wrong password"', () => {
    expect(loginFailure(403, 'ACCESS_REVOKED')).toBe('access-revoked');
    expect(loginFailure(401, undefined)).toBe('invalid-credentials');
    expect(loginFailure(undefined, 'ACCESS_REVOKED')).toBe('network');
  });
});

describe('copy', () => {
  const en = require('../i18n/locales/en.json');
  const ar = require('../i18n/locales/ar.json');
  const leaves = (o: unknown, p = ''): string[] =>
    o && typeof o === 'object' ? Object.entries(o).flatMap(([k, v]) => leaves(v, `${p}${p ? '.' : ''}${k}`)) : [p];

  it('Arabic and English cover exactly the same Team and revocation keys', () => {
    expect(leaves(ar.team).sort()).toEqual(leaves(en.team).sort());
    expect(typeof en.online.outbox.reason['access-revoked']).toBe('string');
    expect(typeof ar.online.outbox.reason['access-revoked']).toBe('string');
  });
  it('every refusal code the server can send has a message in both languages', () => {
    for (const code of TEAM_ERROR_CODES) {
      const key = code === 'ACCESS_REVOKED' || code === 'ROLE_REQUIRED' ? null : code;
      if (key) for (const lang of [en, ar]) expect(lang.team.error[key]).toBeTruthy();
    }
    for (const lang of [en, ar]) for (const k of ['network', 'forbidden', 'notFound', 'generic']) expect(lang.team.error[k]).toBeTruthy();
  });
  it('every action, status and role shown by the screen has a label, a confirmation where it is destructive, and a done message', () => {
    for (const lang of [en, ar]) {
      for (const a of ['suspend', 'reactivate', 'remove', 'revoke_sessions', 'change_role']) {
        expect(lang.team.action[a]).toBeTruthy();
        expect(lang.team.done[a]).toBeTruthy();
      }
      for (const a of ['suspend', 'remove', 'revoke_sessions']) {
        expect(lang.team.confirm[a].title).toBeTruthy();
        expect(lang.team.confirm[a].body).toBeTruthy();
      }
      for (const s of ['active', 'suspended', 'removed', 'suspendedHint', 'removedHint']) expect(lang.team.status[s]).toBeTruthy();
      for (const r of ['Admin', 'Manager', 'Staff']) expect(lang.team.role[r]).toBeTruthy();
    }
  });
});
