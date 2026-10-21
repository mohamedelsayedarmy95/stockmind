import {
  applyLookup,
  canDiscard,
  createIntent,
  markForRecheck,
  markSending,
  nextToSend,
  OperationLookup,
  pendingEffects,
  prune,
  receiptDisplay,
  recheckCandidates,
  reentryDraft,
  retryNow,
  settle,
  StockIntent,
} from './outbox';

const A = 'localhost:3000|company-1|user-a';
const B = 'localhost:3000|company-1|user-b';
const W1 = 'w1';
let n = 0;
const key = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

/** A dispatch of 5 the server confirmed as movement m-<n> at `revision`. */
function confirmed(revision: string, opts: { scope?: string; warehouseId?: string; qty?: string } = {}): StockIntent {
  const id = key();
  const created = createIntent({
    id,
    scope: opts.scope ?? A,
    seq: n,
    kind: 'outbound',
    payload: { productId: 'p1', warehouseId: opts.warehouseId ?? W1, quantity: opts.qty ?? '5' },
    now: 1_000,
  });
  return settle(markSending(created), {
    ok: true,
    body: { id: `m-${id.slice(-4)}`, revision, runningBalance: '95.000000' },
  }, 2_000);
}

const present = (i: StockIntent, revision: string, over: Partial<NonNullable<OperationLookup['movement']>> = {}): OperationLookup => ({
  key: i.id,
  status: 'present',
  movement: {
    id: i.result!.movementId,
    warehouseId: i.payload.warehouseId,
    productId: i.payload.productId,
    movementType: 'OUTBOUND',
    quantityChange: `-${i.payload.quantity}.000000`,
    revision,
    ...over,
  },
});

describe('receipts after a server history reset', () => {
  it('a confirmed receipt is plainly "confirmed" until its history is questioned', () => {
    const c = confirmed('9');
    expect(c.state).toBe('CONFIRMED');
    expect(receiptDisplay(c)).toBe('confirmed');
  });

  it('a reset in its warehouse puts it back to "re-checking", and only that account and warehouse', () => {
    const mine = confirmed('9');
    const otherWarehouse = confirmed('4', { warehouseId: 'w2' });
    const theirs = confirmed('9', { scope: B });
    const [a, b, c] = markForRecheck([mine, otherWarehouse, theirs], A, W1, 5_000);
    expect(receiptDisplay(a)).toBe('rechecking');
    expect(receiptDisplay(b)).toBe('confirmed');
    expect(receiptDisplay(c)).toBe('confirmed');
    expect(recheckCandidates([a, b, c], A).map((i) => i.id)).toEqual([mine.id]);
    expect(recheckCandidates([a, b, c], A, { all: true }).map((i) => i.id).sort()).toEqual([mine.id, otherWarehouse.id].sort());
  });

  it('still in the ledger (present and matching): verified, with the CURRENT revision', () => {
    const [c] = markForRecheck([confirmed('9')], A, W1, 5_000);
    const v = applyLookup(c, present(c, '4'), 6_000);
    expect(v).toMatchObject({ state: 'CONFIRMED', verification: { state: 'verified', at: 6_000 }, result: { revision: '4' } });
    expect(receiptDisplay(v)).toBe('confirmed');
  });

  it('erased by the restore (absent): needs review, keeps the last receipt as evidence, and is NEVER re-queued', () => {
    const [c] = markForRecheck([confirmed('9')], A, W1, 5_000);
    const r = applyLookup(c, { key: c.id, status: 'absent' }, 6_000);
    expect(r).toMatchObject({ state: 'NEEDS_REVIEW', lastError: { reason: 'history-changed' }, result: { revision: '9', movementId: c.result!.movementId } });
    // Not sendable, not retryable: the drain never picks it up again.
    expect(nextToSend([r], A, 99_999)).toBeNull();
    expect(retryNow(r, 7_000)).toBeNull();
    // A person may acknowledge it, or re-enter it as a NEW action whose note names the original.
    expect(canDiscard(r)).toBe(true);
    expect(reentryDraft(r)).toEqual({
      kind: 'outbound',
      payload: { productId: 'p1', warehouseId: W1, quantity: '5', notes: expect.stringContaining(c.id.slice(0, 8)) },
    });
  });

  it('a different movement under its key or receipt: needs review as a mismatch', () => {
    const [c] = markForRecheck([confirmed('9')], A, W1, 5_000);
    for (const over of [{ id: 'm-other' }, { quantityChange: '-50.000000' }, { productId: 'p2' }, { movementType: 'INBOUND' }]) {
      expect(applyLookup(c, present(c, '9', over), 6_000)).toMatchObject({
        state: 'NEEDS_REVIEW',
        lastError: { reason: 'history-mismatch' },
      });
    }
  });

  it('the server cannot tell (indeterminate / no access): unverifiable, never shown as plainly confirmed', () => {
    const [c] = markForRecheck([confirmed('9')], A, W1, 5_000);
    const u = applyLookup(c, { key: c.id, status: 'indeterminate', reason: 'receipt-without-movement' }, 6_000);
    expect(u).toMatchObject({ state: 'CONFIRMED', verification: { state: 'unverifiable', reason: 'receipt-without-movement' } });
    expect(receiptDisplay(u)).toBe('unverifiable');
    expect(receiptDisplay(applyLookup(c, { key: c.id, status: 'unavailable', reason: 'no-access' }, 6_000))).toBe('unverifiable');
  });

  it('ignores answers for other keys and leaves non-confirmed intents alone', () => {
    const [c] = markForRecheck([confirmed('9')], A, W1, 5_000);
    expect(applyLookup(c, { key: 'someone-else', status: 'absent' }, 6_000)).toBe(c);
    const pending = createIntent({ id: key(), scope: A, seq: n, kind: 'inbound', payload: { productId: 'p1', warehouseId: W1, quantity: '1' }, now: 0 });
    expect(applyLookup(pending, { key: pending.id, status: 'absent' }, 6_000)).toBe(pending);
  });

  it('a receipt being re-checked never counts as "waiting for sync" (its revision may name another movement)', () => {
    const c = confirmed('9');
    expect(pendingEffects([c], A, W1, '8')).toEqual({ p1: { pending: 0, awaitingSync: -5, count: 1 } });
    const [rechecking] = markForRecheck([c], A, W1, 5_000);
    expect(pendingEffects([rechecking], A, W1, '4')).toEqual({});
    const verified = applyLookup(rechecking, present(rechecking, '4'), 6_000);
    expect(pendingEffects([verified], A, W1, '4')).toEqual({}); // synced cursor already includes revision 4
  });

  it('receipts waiting to be re-checked are not pruned; settled ones are, after the retention period', () => {
    const c = confirmed('9');
    const [rechecking] = markForRecheck([c], A, W1, 5_000);
    const eightDays = 8 * 24 * 60 * 60 * 1000;
    expect(prune([c], eightDays)).toEqual([]);
    expect(prune([rechecking], eightDays)).toEqual([rechecking]);
    expect(prune([c], 2 * 24 * 60 * 60 * 1000)).toEqual([c]); // kept for 7 days to allow reconciliation
  });

  it('only a history-changed review can be re-entered', () => {
    const c = confirmed('9');
    expect(reentryDraft(c)).toBeNull();
    const mismatch = applyLookup(c, present(c, '9', { id: 'other' }), 1);
    expect(reentryDraft(mismatch)).toBeNull();
  });
});
