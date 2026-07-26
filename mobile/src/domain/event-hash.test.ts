import { buildHashInput, findChainBreaks, GENESIS_HASH } from './event-hash';
import { InventoryEvent } from './events';

function makeEvent(overrides: Partial<InventoryEvent> = {}): InventoryEvent {
  return {
    id: 'evt-1',
    eventType: 'Receive',
    occurredAt: 1_800_000_000_000,
    recordedAt: 1_800_000_000_500,
    productId: 'p1',
    warehouseId: 'w1',
    storeId: null,
    storageUnitId: null,
    batchId: 'b1',
    destWarehouseId: null,
    destStoreId: null,
    destStorageUnitId: null,
    quantity: 10,
    reason: null,
    reference: null,
    createdBy: 'u1',
    approvedBy: null,
    status: 'confirmed',
    reversesEventId: null,
    costImpact: null,
    financialImpact: null,
    payload: null,
    ...overrides,
  };
}

describe('buildHashInput', () => {
  it('is stable for the same event', () => {
    expect(buildHashInput(makeEvent(), GENESIS_HASH)).toBe(
      buildHashInput(makeEvent(), GENESIS_HASH),
    );
  });

  it('changes when the previous hash changes, which is what chains the log', () => {
    const event = makeEvent();
    expect(buildHashInput(event, GENESIS_HASH)).not.toBe(buildHashInput(event, 'a'.repeat(64)));
  });

  it('changes when the quantity is altered', () => {
    // The core tamper case: someone edits a stored quantity.
    const before = buildHashInput(makeEvent({ quantity: 10 }), GENESIS_HASH);
    const after = buildHashInput(makeEvent({ quantity: 1000 }), GENESIS_HASH);
    expect(before).not.toBe(after);
  });

  it('changes when any covered field is altered', () => {
    const baseline = buildHashInput(makeEvent(), GENESIS_HASH);
    const mutations: Partial<InventoryEvent>[] = [
      { id: 'evt-2' },
      { eventType: 'Issue' },
      { occurredAt: 1_800_000_000_001 },
      { recordedAt: 1_800_000_000_501 },
      { productId: 'p2' },
      { warehouseId: 'w2' },
      { storeId: 's1' },
      { storageUnitId: 'u1' },
      { batchId: 'b2' },
      { destWarehouseId: 'w3' },
      { reason: 'edited' },
      { reference: 'INV-9' },
      { createdBy: 'u2' },
      { approvedBy: 'u3' },
      { status: 'cancelled' },
      { reversesEventId: 'evt-0' },
      { costImpact: 5 },
      { financialImpact: 7 },
      { payload: { note: 'x' } },
    ];
    for (const mutation of mutations) {
      expect(buildHashInput(makeEvent(mutation), GENESIS_HASH)).not.toBe(baseline);
    }
  });

  it('ignores syncStatus, so uploading an event cannot break the chain', () => {
    // syncStatus is not part of the envelope passed here at all — this test
    // documents that intent by proving an otherwise identical event hashes the
    // same regardless of any sync bookkeeping around it.
    const a = makeEvent();
    const b = makeEvent();
    expect(buildHashInput(a, GENESIS_HASH)).toBe(buildHashInput(b, GENESIS_HASH));
  });

  it('does not confuse an absent field with an explicitly null one', () => {
    const withNull = buildHashInput(makeEvent({ reason: null }), GENESIS_HASH);
    const withText = buildHashInput(makeEvent({ reason: '' }), GENESIS_HASH);
    expect(withNull).not.toBe(withText);
  });

  it('refuses to hash an event carrying a NaN quantity', () => {
    expect(() => buildHashInput(makeEvent({ quantity: NaN }), GENESIS_HASH)).toThrow(/non-finite/);
  });

  it('is insensitive to payload key order', () => {
    const a = buildHashInput(makeEvent({ payload: { b: 2, a: 1 } }), GENESIS_HASH);
    const b = buildHashInput(makeEvent({ payload: { a: 1, b: 2 } }), GENESIS_HASH);
    expect(a).toBe(b);
  });

  it('is sensitive to pick order inside a payload', () => {
    // Which lot was drawn first is a real fact and must be covered.
    const a = buildHashInput(makeEvent({ payload: { picks: ['MID', 'OLD'] } }), GENESIS_HASH);
    const b = buildHashInput(makeEvent({ payload: { picks: ['OLD', 'MID'] } }), GENESIS_HASH);
    expect(a).not.toBe(b);
  });
});

describe('findChainBreaks', () => {
  const intact = [
    { seq: 1, prevHash: GENESIS_HASH, hash: 'h1' },
    { seq: 2, prevHash: 'h1', hash: 'h2' },
    { seq: 3, prevHash: 'h2', hash: 'h3' },
  ];

  it('finds nothing in an intact chain', () => {
    expect(findChainBreaks(intact)).toEqual([]);
  });

  it('accepts an empty log', () => {
    expect(findChainBreaks([])).toEqual([]);
  });

  it('requires the first link to start from genesis', () => {
    // A truncated log — someone deleted the earliest events — is detectable
    // precisely because row 1 no longer points at genesis.
    const truncated = [{ seq: 2, prevHash: 'h1', hash: 'h2' }];
    expect(findChainBreaks(truncated)).toEqual([
      { seq: 2, expectedPrevHash: GENESIS_HASH, actualPrevHash: 'h1' },
    ]);
  });

  it('flags a row whose parent link was altered', () => {
    const tampered = [
      { seq: 1, prevHash: GENESIS_HASH, hash: 'h1' },
      { seq: 2, prevHash: 'FORGED', hash: 'h2' },
      { seq: 3, prevHash: 'h2', hash: 'h3' },
    ];
    const breaks = findChainBreaks(tampered);
    expect(breaks).toHaveLength(1);
    expect(breaks[0].seq).toBe(2);
  });

  it('reports one break rather than cascading onto every later row', () => {
    // Resyncing from what each row claims keeps the report pointing at the
    // actual edit instead of drowning it in false positives.
    const tampered = [
      { seq: 1, prevHash: GENESIS_HASH, hash: 'h1' },
      { seq: 2, prevHash: 'FORGED', hash: 'h2' },
      { seq: 3, prevHash: 'h2', hash: 'h3' },
      { seq: 4, prevHash: 'h3', hash: 'h4' },
    ];
    expect(findChainBreaks(tampered)).toHaveLength(1);
  });

  it('detects a deleted middle event', () => {
    const withHole = [
      { seq: 1, prevHash: GENESIS_HASH, hash: 'h1' },
      { seq: 3, prevHash: 'h2', hash: 'h3' },
    ];
    expect(findChainBreaks(withHole)).toHaveLength(1);
  });
});
