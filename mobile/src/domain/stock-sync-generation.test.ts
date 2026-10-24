import { applyChanges, ChangesResponse, initialSyncState, nextRequest, WarehouseSyncState } from './stock-sync';
import { pollWarehouse } from './sync-runner';

const W = 'w1';
const G1 = '11111111-1111-4111-8111-111111111111';
const G2 = '22222222-2222-4222-8222-222222222222';
const bal = (q: string) => ({ productId: 'p1', baseQuantity: q, reservedQuantity: '0', availableQuantity: q });

const snapshot = (revision: string, generation: string | undefined, q = '10', extra: Partial<ChangesResponse> = {}): ChangesResponse => ({
  warehouseId: W, mode: 'snapshot', revision, anchor: `a-${revision}`, hasMore: false, movements: [], balances: [bal(q)],
  ...(generation ? { generation } : {}), ...extra,
});
const delta = (revision: string, generation: string | undefined, q = '12'): ChangesResponse => ({
  warehouseId: W, mode: 'delta', revision, anchor: `a-${revision}`, hasMore: false,
  movements: [{ id: `m-${revision}`, productId: 'p1', userId: 'u', movementType: 'INBOUND', quantityChange: '2', runningBalance: q, revision, createdAt: 't' }],
  balances: [bal(q)], ...(generation ? { generation } : {}),
});

const synced = (revision = '5', generation: string | undefined = G1) => applyChanges(initialSyncState(W), undefined, snapshot(revision, generation));

describe('history generation in the sync cursor', () => {
  it('the first generation is adopted without counting as a reset', () => {
    const s = synced();
    expect(s).toMatchObject({ generation: G1, resets: 0, revision: '5', status: 'synced' });
  });

  it('the generation travels with the cursor, and is absent until a server told us one', () => {
    expect(nextRequest(initialSyncState(W))).toEqual({});
    expect(nextRequest(synced())).toEqual({ since: '5', anchor: 'a-5', generation: G1 });
    const legacy = applyChanges(initialSyncState(W), undefined, snapshot('5', undefined));
    expect(nextRequest(legacy)).toEqual({ since: '5', anchor: 'a-5' });
  });

  it('a snapshot of another generation answering our cursor is a reset that clears the old movement list', () => {
    let s = applyChanges(synced(), '5', delta('6', G1));
    expect(s.recent.length).toBe(1);
    s = applyChanges(s, '6', snapshot('3', G2, '7', { reset: true, resetReason: 'generation' }));
    expect(s).toMatchObject({ generation: G2, revision: '3', resets: 1, recent: [], status: 'synced' });
    expect(s.balances.p1.baseQuantity).toBe('7'); // the server's figures replace ours, nothing is added up
  });

  it('a restored history may have a LOWER revision: accepted when the generation changed, ignored when it did not', () => {
    const s = synced('9');
    // same generation: an older answer to a snapshot request must not roll back newer data
    expect(applyChanges(s, undefined, snapshot('4', G1))).toBe(s);
    // another generation: lower revision is the new truth
    const next = applyChanges(s, undefined, snapshot('4', G2, '3'));
    expect(next).toMatchObject({ revision: '4', generation: G2, resets: 1 });
  });

  it('revision numbers reused across generations are not mistaken for continuity (delta from another generation is refused)', () => {
    const s = synced('5');
    // a server that (wrongly) answered a delta that continues the same revision but names another generation
    const refused = applyChanges(s, '5', delta('6', G2));
    expect(refused).toMatchObject({ revision: null, anchor: null, generation: G2, balances: {}, recent: [], resets: 1, status: 'catching-up' });
    expect(nextRequest(refused)).toEqual({ generation: G2 }); // next call is a snapshot request
  });

  it('a server without generations never resets a cursor and never erases the generation we know', () => {
    const s = synced();
    const next = applyChanges(s, '5', delta('6', undefined));
    expect(next).toMatchObject({ revision: '6', generation: G1, resets: 0 });
  });

  it('several generations in a row each count once', () => {
    let s = synced('5', G1);
    s = applyChanges(s, '5', snapshot('5', G2, '1', { reset: true }));
    s = applyChanges(s, '5', snapshot('2', 'ffffffff-ffff-4fff-8fff-ffffffffffff', '2', { reset: true }));
    expect(s.resets).toBe(2);
  });

  it('survives an app restart: the generation is part of the persisted cursor, and an old cache without it still loads', () => {
    const restored = JSON.parse(JSON.stringify(synced())) as WarehouseSyncState;
    expect(restored.generation).toBe(G1);
    const { generation: _g, ...oldCache } = restored;
    const filled = { ...initialSyncState(W), ...oldCache }; // what warehouse-sync does with an older cache
    expect(filled.generation).toBeNull();
    expect(applyChanges(filled, '5', delta('6', G1)).generation).toBe(G1); // adopted, not a reset
  });

  it('poll: a generation change found in a delta is followed by the snapshot in the same poll', async () => {
    const calls: Array<{ since?: string; anchor?: string; generation?: string; limit: number }> = [];
    const answers = [delta('6', G2), snapshot('2', G2, '4')];
    const result = await pollWarehouse(synced(), async (q) => { calls.push(q); return answers.shift()!; }, { statusOf: () => undefined });
    expect(calls.length).toBe(2);
    expect(calls[0]).toMatchObject({ since: '5', anchor: 'a-5', generation: G1 });
    expect(calls[1].since).toBeUndefined();
    expect(result.state).toMatchObject({ revision: '2', generation: G2, resets: 1, status: 'synced' });
    expect(result.error).toBeNull();
  });
});
