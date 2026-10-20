import { applyChanges, ChangesResponse, initialSyncState, nextRequest, ServerMovement } from './stock-sync';

const W = 'w1';
const bal = (productId: string, q: string) => ({
  productId, baseQuantity: q, reservedQuantity: '0.000000', availableQuantity: q,
});
const mv = (id: string, revision: string, productId = 'p1'): ServerMovement => ({
  id, productId, userId: 'u', movementType: 'OUTBOUND', quantityChange: '-1', runningBalance: '0', revision,
  createdAt: '2026-10-20T00:00:00Z',
});
const snapshot = (revision: string, balances = [bal('p1', '10.000000')]): ChangesResponse => ({
  warehouseId: W, mode: 'snapshot', revision, hasMore: false, movements: [], balances,
});
const delta = (revision: string, movements: ServerMovement[], balances = [bal('p1', '8.000000')], hasMore = false): ChangesResponse =>
  ({ warehouseId: W, mode: 'delta', revision, hasMore, movements, balances });

describe('stock sync reconciliation', () => {
  it('starts with a snapshot request, then asks from the applied revision', () => {
    const s0 = initialSyncState(W);
    expect(nextRequest(s0)).toEqual({});
    const s1 = applyChanges(s0, undefined, snapshot('5'));
    expect(s1.status).toBe('synced');
    expect(nextRequest(s1)).toEqual({ since: '5' });
    expect(s1.balances.p1.baseQuantity).toBe('10.000000');
  });

  it('a delta that continues the cursor replaces balances (never adds) and records new movements once', () => {
    const s1 = applyChanges(initialSyncState(W), undefined, snapshot('5'));
    const s2 = applyChanges(s1, '5', delta('7', [mv('a', '6'), mv('b', '7')]));
    expect(s2.revision).toBe('7');
    expect(s2.balances.p1.baseQuantity).toBe('8.000000');
    expect(s2.recent.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('discards a duplicate or out-of-order delta (wrong since): the next poll catches up instead', () => {
    const s2 = applyChanges(applyChanges(initialSyncState(W), undefined, snapshot('5')), '5', delta('7', [mv('a', '6'), mv('b', '7')]));
    // The same response delivered twice, and a late answer to the older request, are both ignored.
    expect(applyChanges(s2, '5', delta('7', [mv('a', '6'), mv('b', '7')]))).toBe(s2);
    expect(applyChanges(s2, '5', delta('6', [mv('a', '6')], [bal('p1', '9.000000')]))).toBe(s2);
    expect(s2.balances.p1.baseQuantity).toBe('8.000000');
  });

  it('an older snapshot never rolls back newer data; a newer one replaces everything', () => {
    const s2 = applyChanges(applyChanges(initialSyncState(W), undefined, snapshot('5')), '5', delta('7', [mv('a', '6')]));
    expect(applyChanges(s2, undefined, snapshot('6', [bal('p1', '9.000000')]))).toBe(s2);
    const s3 = applyChanges(s2, undefined, snapshot('9', [bal('p2', '1.000000')]));
    expect(Object.keys(s3.balances)).toEqual(['p2']);
    expect(s3.revision).toBe('9');
  });

  it('pages: hasMore marks catching-up until the last page; revisions compare as numbers, not text', () => {
    const s1 = applyChanges(initialSyncState(W), undefined, snapshot('9'));
    const s2 = applyChanges(s1, '9', delta('10', [mv('a', '10')], [bal('p1', '5.000000')], true));
    expect(s2.status).toBe('catching-up');
    const s3 = applyChanges(s2, '10', delta('11', [mv('b', '11')]));
    expect([s3.status, s3.revision]).toEqual(['synced', '11']);
    expect(applyChanges(s3, undefined, snapshot('9'))).toBe(s3); // '9' < '11' numerically
  });

  it("ignores another warehouse's response and a delta before any snapshot", () => {
    const s0 = initialSyncState(W);
    expect(applyChanges(s0, undefined, { ...snapshot('3'), warehouseId: 'other' })).toBe(s0);
    expect(applyChanges(s0, '0', delta('2', [mv('a', '1')]))).toBe(s0);
  });
});
