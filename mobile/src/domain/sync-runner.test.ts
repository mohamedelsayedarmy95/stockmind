import { ChangesResponse, initialSyncState, ServerMovement } from './stock-sync';
import { pollErrorOf, pollWarehouse, syncDisplay, SyncView } from './sync-runner';
import { httpStatusOf } from './auth-flow';

const W = 'w1';
const bal = (q: string, productId = 'p1') => ({ productId, baseQuantity: q, reservedQuantity: '0.000000', availableQuantity: q });
const mv = (id: string, revision: string): ServerMovement => ({
  id, productId: 'p1', userId: 'u', movementType: 'OUTBOUND', quantityChange: '-1', runningBalance: '0', revision,
  createdAt: '2026-10-20T00:00:00Z',
});
const snapshot = (revision: string, q = '100.000000'): ChangesResponse => ({
  warehouseId: W, mode: 'snapshot', revision, hasMore: false, movements: [], balances: [bal(q)],
});
const delta = (revision: string, movements: ServerMovement[], q: string, hasMore = false): ChangesResponse => ({
  warehouseId: W, mode: 'delta', revision, hasMore, movements, balances: movements.length ? [bal(q)] : [],
});
const opts = { statusOf: httpStatusOf };

/** A fake endpoint that records every query and answers from a script. */
function server(script: Array<ChangesResponse | Error | { response: { status: number } }>) {
  const queries: Array<{ since?: string; limit: number }> = [];
  const fetchPage = async (q: { since?: string; limit: number }) => {
    queries.push(q);
    const next = script.shift();
    if (!next) throw new Error('script exhausted');
    if ('mode' in next) return next;
    throw next;
  };
  return { queries, fetchPage };
}

describe('sync wiring: polling GET /stock/changes', () => {
  it('first poll asks for a snapshot (no since), the next one continues from its revision', async () => {
    const s = server([snapshot('4'), delta('5', [mv('a', '5')], '93.000000')]);
    const first = await pollWarehouse(initialSyncState(W), s.fetchPage, opts);
    expect(first).toMatchObject({ pages: 1, error: null });
    expect(first.state.balances.p1.baseQuantity).toBe('100.000000');

    const second = await pollWarehouse(first.state, s.fetchPage, opts);
    expect(s.queries).toEqual([{ limit: 200 }, { since: '4', limit: 200 }]);
    expect(second.state.balances.p1.baseQuantity).toBe('93.000000'); // replaced from the server, not summed
    expect(second.state.revision).toBe('5');
    expect(syncDisplay({ sync: second.state, inFlight: false, lastError: null, rejection: null }).display).toBe('synced');
  });

  it('follows hasMore pages within one poll, and leaves the rest as catching-up past maxPages', async () => {
    const s = server([
      snapshot('1'),
      delta('2', [mv('a', '2')], '99.000000', true),
      delta('3', [mv('b', '3')], '98.000000', true),
      delta('4', [mv('c', '4')], '97.000000'),
    ]);
    // A snapshot is complete by itself: it ends that poll.
    const a = await pollWarehouse(initialSyncState(W), s.fetchPage, { ...opts, limit: 1 });
    expect(a.pages).toBe(1);

    const b = await pollWarehouse(a.state, s.fetchPage, { ...opts, maxPages: 2, limit: 1 });
    expect(b.pages).toBe(2);
    expect(b.state.status).toBe('catching-up');
    expect(syncDisplay({ sync: b.state, inFlight: false, lastError: null, rejection: null }).display).toBe('catching-up');

    const c = await pollWarehouse(b.state, s.fetchPage, { ...opts, maxPages: 2, limit: 1 });
    expect(s.queries.map((q) => q.since)).toEqual([undefined, '1', '2', '3']);
    expect([c.pages, c.state.status, c.state.revision]).toEqual([1, 'synced', '4']);
    expect(c.state.recent.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('an empty delta keeps the balances and reports synced', async () => {
    const s = server([snapshot('7'), delta('7', [], '0')]);
    const a = await pollWarehouse(initialSyncState(W), s.fetchPage, opts);
    const b = await pollWarehouse(a.state, s.fetchPage, opts);
    expect(b.state.balances.p1.baseQuantity).toBe('100.000000');
    expect(b.state.status).toBe('synced');
  });

  it('a failed poll keeps the last synced figures and says Offline, never Synced', async () => {
    const s = server([snapshot('4'), new Error('Network Error')]);
    const a = await pollWarehouse(initialSyncState(W), s.fetchPage, opts);
    const b = await pollWarehouse(a.state, s.fetchPage, opts);
    expect(b.error).toBe('network');
    expect(b.state).toBe(a.state);
    expect(syncDisplay({ sync: b.state, inFlight: false, lastError: b.error, rejection: null }).display).toBe('offline');
  });

  it('a 403/404 on a warehouse is shown as Rejected (no access), not as Offline', async () => {
    const s = server([{ response: { status: 403 } }]);
    const r = await pollWarehouse(initialSyncState(W), s.fetchPage, opts);
    expect(r.error).toBe('denied');
    expect(syncDisplay({ sync: r.state, inFlight: false, lastError: r.error, rejection: null })).toEqual({
      display: 'rejected',
      reason: 'no-access',
    });
  });

  it('stops instead of looping when an answer is discarded (another warehouse)', async () => {
    const s = server([{ ...snapshot('3'), warehouseId: 'other' }]);
    const r = await pollWarehouse(initialSyncState(W), s.fetchPage, opts);
    expect(r).toMatchObject({ pages: 1, error: null });
    expect(r.state.status).toBe('never-synced');
  });

  it('maps poll errors', () => {
    expect(pollErrorOf(undefined)).toBe('network');
    expect(pollErrorOf(401)).toBe('auth');
    expect(pollErrorOf(403)).toBe('denied');
    expect(pollErrorOf(404)).toBe('denied');
    expect(pollErrorOf(500)).toBe('server');
  });
});

describe('honest sync display', () => {
  const synced = { ...initialSyncState(W), revision: '9', status: 'synced' as const };
  const view = (over: Partial<SyncView>): SyncView => ({ sync: synced, inFlight: false, lastError: null, rejection: null, ...over });

  it('a refused write shows Rejected with its reason, above every other state', () => {
    expect(syncDisplay(view({ rejection: 'insufficient-stock', lastError: 'network' }))).toEqual({
      display: 'rejected',
      reason: 'insufficient-stock',
    });
    expect(syncDisplay(view({ rejection: 'key-reused' })).reason).toBe('key-reused');
  });

  it('never Synced before the first snapshot or while a poll is in flight', () => {
    expect(syncDisplay(view({ sync: initialSyncState(W) })).display).toBe('catching-up');
    expect(syncDisplay(view({ inFlight: true })).display).toBe('catching-up');
    expect(syncDisplay(view({})).display).toBe('synced');
  });

  it('an error stays Offline even while the retry is in flight', () => {
    expect(syncDisplay(view({ lastError: 'server', inFlight: true })).display).toBe('offline');
    expect(syncDisplay(view({ lastError: 'auth' })).display).toBe('offline');
  });
});
