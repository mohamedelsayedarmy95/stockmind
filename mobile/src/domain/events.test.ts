import {
  validateEvent,
  requiresReason,
  affectsQuantity,
  InventoryEvent,
  WIRED_EVENT_TYPES,
  UNWIRED_EVENT_TYPES,
  EventType,
} from './events';

function evt(overrides: Partial<InventoryEvent> = {}): InventoryEvent {
  return {
    id: 'e1',
    eventType: 'Receive',
    occurredAt: 1_800_000_000_000,
    recordedAt: 1_800_000_000_000,
    productId: 'p1',
    warehouseId: 'w1',
    storeId: null,
    storageUnitId: null,
    batchId: null,
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

describe('type classification', () => {
  it('demands a reason exactly where an unexplained number would ruin an audit', () => {
    expect(requiresReason('Adjust')).toBe(true);
    expect(requiresReason('Dispose')).toBe(true);
    expect(requiresReason('Receive')).toBe(false);
    expect(requiresReason('Issue')).toBe(false);
  });

  it('does not treat reservations or relocations as stock movements', () => {
    // Counting either as a quantity change is how a ledger double-counts.
    expect(affectsQuantity('Reserve')).toBe(false);
    expect(affectsQuantity('ReleaseReservation')).toBe(false);
    expect(affectsQuantity('Relocate')).toBe(false);
    expect(affectsQuantity('Receive')).toBe(true);
    expect(affectsQuantity('Issue')).toBe(true);
  });

  it('keeps the wired and unwired lists disjoint and complete', () => {
    // Guards against a type being silently claimed as shipped, or forgotten.
    const overlap = WIRED_EVENT_TYPES.filter((t) => UNWIRED_EVENT_TYPES.includes(t));
    expect(overlap).toEqual([]);

    const all: EventType[] = [...WIRED_EVENT_TYPES, ...UNWIRED_EVENT_TYPES];
    expect(new Set(all).size).toBe(16);
  });
});

describe('validateEvent', () => {
  it('accepts a well-formed receipt', () => {
    expect(validateEvent(evt())).toEqual([]);
  });

  it('rejects an adjustment with no reason', () => {
    expect(validateEvent(evt({ eventType: 'Adjust', quantity: -5 }))).toContain(
      'Adjust requires a reason',
    );
  });

  it('rejects a whitespace-only reason', () => {
    expect(
      validateEvent(evt({ eventType: 'Adjust', quantity: -5, reason: '   ' })),
    ).toContain('Adjust requires a reason');
  });

  it('accepts an adjustment that explains itself', () => {
    expect(
      validateEvent(evt({ eventType: 'Adjust', quantity: -5, reason: 'تسوية جرد' })),
    ).toEqual([]);
  });

  it('rejects a zero-quantity movement', () => {
    // Always an upstream bug, and it litters the ledger with meaningless rows.
    expect(validateEvent(evt({ quantity: 0 }))).toContain('Receive quantity must not be zero');
  });

  it('rejects a non-finite quantity', () => {
    expect(validateEvent(evt({ quantity: NaN }))).toContain('Receive requires a finite quantity');
    expect(validateEvent(evt({ quantity: null }))).toContain('Receive requires a finite quantity');
  });

  it('rejects a movement with no product or warehouse', () => {
    expect(validateEvent(evt({ productId: null }))).toContain('Receive requires a productId');
    expect(validateEvent(evt({ warehouseId: null }))).toContain('Receive requires a warehouseId');
  });

  it('rejects a transfer with nowhere to go', () => {
    expect(validateEvent(evt({ eventType: 'Transfer', quantity: 5 }))).toContain(
      'Transfer requires a destination',
    );
  });

  it('accepts a transfer to another section of the same warehouse', () => {
    expect(
      validateEvent(evt({ eventType: 'Transfer', quantity: 5, storeId: 's1', destStoreId: 's2' })),
    ).toEqual([]);
  });

  it('requires identity and timestamps', () => {
    expect(validateEvent(evt({ id: '' }))).toContain('id is required');
    expect(validateEvent(evt({ createdBy: '' }))).toContain('createdBy is required');
    expect(validateEvent(evt({ occurredAt: NaN }))).toContain(
      'occurredAt must be a finite timestamp',
    );
  });

  it('will not let a reversal be recorded as anything but confirmed', () => {
    // A pending reversal that never confirms leaves the original standing
    // while looking, in the log, as though it was undone.
    expect(
      validateEvent(evt({ reversesEventId: 'e0', status: 'pending' })),
    ).toContain('a reversing event must be confirmed to take effect');
  });

  it('reports every problem at once rather than one at a time', () => {
    const errors = validateEvent(
      evt({ id: '', eventType: 'Adjust', quantity: 0, productId: null }),
    );
    expect(errors.length).toBeGreaterThan(2);
  });

  it('does not demand a quantity from a pure observation', () => {
    expect(
      validateEvent(evt({ eventType: 'Count', quantity: null, reason: null })),
    ).toEqual([]);
  });
});
