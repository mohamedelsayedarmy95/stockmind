/**
 * Series 13 / R-37: an unknown balance is not a zero balance. What the stock screens may say, from the reconciled sync state
 * and the direct balance request, for one product in one warehouse.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  BALANCE_LINE_KEYS, BalanceInput, balanceLine, issuableOnline, knownQuantity, resolveBalance, SyncBalanceInput, warehouseListState,
} from './balance-truth';

const P = 'prod-1'; const W = 'wh-1'; const W2 = 'wh-2';
const pending = (): BalanceInput['query'] => ({ status: 'pending' });
const ok = (baseQuantity: string, productId = P, warehouseId = W): BalanceInput['query'] => ({ status: 'success', data: { productId, warehouseId, baseQuantity } });
const failed = (errorStatus?: number): BalanceInput['query'] => ({ status: 'error', errorStatus });
const sync = (over: Partial<SyncBalanceInput> = {}): SyncBalanceInput => ({
  warehouseId: W, revision: '12', status: 'synced', balances: { [P]: { baseQuantity: '55.000000' } }, lastError: null, lastSuccessAt: 1_700_000_000_000, ...over,
});
const resolve = (over: Partial<BalanceInput>) => resolveBalance({ online: true, productId: P, warehouseId: W, sync: null, query: pending(), ...over });

describe('resolveBalance', () => {
  it('a confirmed zero is a real zero; a confirmed figure is the server one', () => {
    expect(resolve({ query: ok('0.000000') })).toEqual({ state: 'confirmed', quantity: 0, source: 'server' });
    expect(resolve({ query: ok('53.000000') })).toEqual({ state: 'confirmed', quantity: 53, source: 'server' });
    expect(resolve({ online: false, query: ok('7') })).toEqual({ state: 'confirmed', quantity: 7, source: 'device' });
  });

  it('THE DEFECT: the server cannot be reached and nothing was synced -> unknown, never 0', () => {
    const t = resolve({ query: failed(undefined) });
    expect(t).toEqual({ state: 'unknown', reason: 'unreachable' });
    expect(knownQuantity(t)).toBeNull();
    expect(resolve({ query: failed(500) })).toEqual({ state: 'unknown', reason: 'unreachable' });
    expect(resolve({ query: failed(503) })).toEqual({ state: 'unknown', reason: 'unreachable' });
  });

  it('loading is distinguishable from failure (and a failed first sync is not "loading")', () => {
    expect(resolve({ query: pending() })).toEqual({ state: 'loading' });
    expect(resolve({ query: pending(), sync: sync({ revision: null, balances: {}, lastError: 'network', lastSuccessAt: null }) }))
      .toEqual({ state: 'unknown', reason: 'unreachable' });
  });

  it('the reconciled sync figure: confirmed while current, last-known (with its time) once a poll failed', () => {
    expect(resolve({ sync: sync() })).toEqual({ state: 'confirmed', quantity: 55, source: 'server' });
    expect(resolve({ sync: sync({ lastError: 'network' }), query: failed(undefined) }))
      .toEqual({ state: 'last-known', quantity: 55, asOf: 1_700_000_000_000 });
    expect(resolve({ sync: sync({ status: 'catching-up' }) }).state).toBe('last-known');
    expect(resolve({ sync: sync({ lastError: 'server', lastSuccessAt: null }) })).toEqual({ state: 'last-known', quantity: 55, asOf: null });
  });

  it('after a snapshot, a product without a row is a confirmed 0, unless the direct request answered for exactly it', () => {
    expect(resolve({ sync: sync({ balances: {} }) })).toEqual({ state: 'confirmed', quantity: 0, source: 'server' });
    expect(resolve({ sync: sync({ balances: {} }), query: ok('4') })).toEqual({ state: 'confirmed', quantity: 4, source: 'server' });
    expect(resolve({ sync: sync({ balances: {}, lastError: 'network' }) })).toEqual({ state: 'last-known', quantity: 0, asOf: 1_700_000_000_000 });
  });

  it('no access to the warehouse: no figure at all, not even a cached one', () => {
    expect(resolve({ sync: sync({ lastError: 'denied' }), query: ok('55') })).toEqual({ state: 'unknown', reason: 'no-access' });
    expect(resolve({ query: failed(403) })).toEqual({ state: 'unknown', reason: 'no-access' });
    expect(resolve({ query: failed(404) })).toEqual({ state: 'unknown', reason: 'no-access' });
  });

  it('never reuses an unrelated warehouse or product figure', () => {
    expect(resolve({ query: ok('99', P, W2) })).toEqual({ state: 'unknown', reason: 'mismatch' });
    expect(resolve({ query: ok('99', 'prod-2', W) })).toEqual({ state: 'unknown', reason: 'mismatch' });
    // the sync state of another warehouse is ignored; with the request failed the figure is unknown
    expect(resolve({ sync: sync({ warehouseId: W2 }), query: failed(undefined) })).toEqual({ state: 'unknown', reason: 'unreachable' });
    expect(resolve({ sync: sync({ warehouseId: W2 }), query: ok('3') })).toEqual({ state: 'confirmed', quantity: 3, source: 'server' });
  });

  it('an unreadable figure is unknown, not 0; no warehouse chosen is said as such', () => {
    for (const bad of ['', 'abc', 'NaN']) expect(resolve({ query: ok(bad) })).toEqual({ state: 'unknown', reason: 'invalid' });
    expect(resolve({ sync: sync({ balances: { [P]: { baseQuantity: 'x' } } }) })).toEqual({ state: 'unknown', reason: 'invalid' });
    expect(resolve({ warehouseId: null, query: ok('5') })).toEqual({ state: 'unknown', reason: 'no-warehouse' });
  });

  it('offline mode ignores the online sync state (the device ledger is the figure there)', () => {
    expect(resolve({ online: false, sync: sync({ lastError: 'denied' }), query: ok('2') })).toEqual({ state: 'confirmed', quantity: 2, source: 'device' });
  });
});

describe('what a dispatch may take (online)', () => {
  it('a queued receipt never raises the balance or the dispatch limit; a queued dispatch lowers the limit', () => {
    const t = resolve({ sync: sync() }); // 55 confirmed
    expect(issuableOnline(t, +5)).toBe(55);
    expect(issuableOnline(t, -10)).toBe(45);
    expect(issuableOnline(t, -80)).toBe(0);
    expect(balanceLine(t, () => '')).toEqual({ key: 'balance.confirmed', params: { qty: 55 } }); // the receipt is not in it
  });

  it('an unknown balance allows no dispatch (and is not shown as 0)', () => {
    const t = resolve({ query: failed(undefined) });
    expect(issuableOnline(t, 0)).toBe(0);
    expect(balanceLine(t, () => '').key).toBe('balance.unknown.unreachable');
  });
});

describe('balance copy', () => {
  const root = path.join(__dirname, '..', '..');
  const locale = (l: string) => JSON.parse(fs.readFileSync(path.join(root, `src/i18n/locales/${l}.json`), 'utf8'));
  const get = (tree: any, key: string) => key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), tree);

  it('every state has its own line, in English and Arabic; "unknown" never reads like a number', () => {
    const at = (ms: number) => `@${ms}`;
    expect(balanceLine({ state: 'last-known', quantity: 3, asOf: 9 }, at)).toEqual({ key: 'balance.lastKnownAt', params: { qty: 3, time: '@9' } });
    expect(balanceLine({ state: 'loading' }, at)).toEqual({ key: 'balance.loading' });
    for (const lang of ['en', 'ar']) {
      const doc = locale(lang);
      for (const key of [...BALANCE_LINE_KEYS, 'balance.dispatchNeedsBalance', 'online.stockUnreachable', 'online.stockEmptyLastKnown']) {
        expect({ lang, key, present: typeof get(doc, key) === 'string' }).toEqual({ lang, key, present: true });
      }
      for (const reason of ['unreachable', 'no-access', 'mismatch', 'invalid', 'no-warehouse']) {
        expect(get(doc, `balance.unknown.${reason}`)).not.toMatch(/\{\{qty\}\}|\b0\b/);
      }
      expect(get(doc, 'balance.confirmed')).toContain('{{qty}}');
      expect(get(doc, 'balance.lastKnownAt')).toContain('{{time}}');
    }
    expect(get(locale('ar'), 'balance.unknown.unreachable')).not.toBe(get(locale('en'), 'balance.unknown.unreachable'));
  });
});

describe('warehouseListState (the online stock list with no rows)', () => {
  it('loading only while nothing failed; unknown when the first sync failed; empty only after the server said so', () => {
    expect(warehouseListState(null)).toBe('loading');
    expect(warehouseListState(sync({ revision: null, balances: {} }))).toBe('loading');
    expect(warehouseListState(sync({ revision: null, balances: {}, lastError: 'network' }))).toBe('unreachable');
    expect(warehouseListState(sync({ lastError: 'denied' }))).toBe('no-access');
    expect(warehouseListState(sync({ balances: {} }))).toBe('empty');
    expect(warehouseListState(sync({ balances: {}, lastError: 'network' }))).toBe('empty-last-known');
    expect(warehouseListState(sync())).toBe('rows');
  });
});
