import { reduceEvent, netByWarehouse, foldEvents } from './event-reducer';
import { InventoryEvent, EventType } from './events';

function evt(overrides: Partial<InventoryEvent> = {}): InventoryEvent {
  return {
    id: 'e',
    eventType: 'Receive',
    occurredAt: 1,
    recordedAt: 1,
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

const warehouseTotal = (e: InventoryEvent, warehouseId = 'w1') =>
  netByWarehouse(reduceEvent(e).balances).get(`p1|${warehouseId}`) ?? 0;

describe('status gating', () => {
  it('only confirmed events move stock', () => {
    for (const status of ['pending', 'cancelled', 'reversed'] as const) {
      expect(reduceEvent(evt({ status }))).toEqual({ balances: [], reservedDelta: 0 });
    }
    expect(reduceEvent(evt({ status: 'confirmed' })).balances).toHaveLength(1);
  });
});

describe('single-location movements', () => {
  it('adds on receipt and subtracts on issue, from the event sign', () => {
    expect(warehouseTotal(evt({ eventType: 'Receive', quantity: 10 }))).toBe(10);
    expect(warehouseTotal(evt({ eventType: 'Issue', quantity: -4 }))).toBe(-4);
  });

  it('lets an adjustment go either way', () => {
    expect(warehouseTotal(evt({ eventType: 'Adjust', quantity: 3, reason: 'count' }))).toBe(3);
    expect(warehouseTotal(evt({ eventType: 'Adjust', quantity: -3, reason: 'count' }))).toBe(-3);
  });

  it('subtracts on disposal and adds on return', () => {
    expect(warehouseTotal(evt({ eventType: 'Dispose', quantity: -2, reason: 'damaged' }))).toBe(-2);
    expect(warehouseTotal(evt({ eventType: 'Return', quantity: 2, reason: 'customer' }))).toBe(2);
  });

  it('carries the location and lot onto the delta', () => {
    const [delta] = reduceEvent(
      evt({ storeId: 's1', storageUnitId: 'u1', batchId: 'b1' }),
    ).balances;
    expect(delta).toEqual({
      productId: 'p1',
      warehouseId: 'w1',
      storeId: 's1',
      storageUnitId: 'u1',
      batchId: 'b1',
      delta: 10,
    });
  });

  it('uses empty strings, not null, for unassigned location parts', () => {
    // SQLite treats NULLs as distinct in a UNIQUE key, so the projection
    // columns default to ''. The reducer must match or rows duplicate.
    const [delta] = reduceEvent(evt()).balances;
    expect(delta.storeId).toBe('');
    expect(delta.storageUnitId).toBe('');
    expect(delta.batchId).toBe('');
  });

  it('ignores a zero-quantity movement', () => {
    expect(reduceEvent(evt({ quantity: 0 })).balances).toEqual([]);
  });

  it('ignores an event missing the product or warehouse it applies to', () => {
    expect(reduceEvent(evt({ productId: null })).balances).toEqual([]);
    expect(reduceEvent(evt({ warehouseId: null })).balances).toEqual([]);
  });

  it('ignores a NaN quantity rather than poisoning the projection', () => {
    expect(reduceEvent(evt({ quantity: NaN })).balances).toEqual([]);
  });
});

describe('lot picking', () => {
  it('splits an issue across the lots it actually drew from', () => {
    const effect = reduceEvent(
      evt({
        eventType: 'Issue',
        quantity: -25,
        payload: {
          picks: [
            { batchId: 'MID', quantity: 10 },
            { batchId: 'NEW', quantity: 10 },
            { batchId: 'OLD', quantity: 5 },
          ],
        },
      }),
    );
    expect(effect.balances.map((b) => [b.batchId, b.delta])).toEqual([
      ['MID', -10],
      ['NEW', -10],
      ['OLD', -5],
    ]);
  });

  it('keeps the per-lot split summing to the movement total', () => {
    // The invariant that keeps lot balances and warehouse balances agreeing.
    const effect = reduceEvent(
      evt({
        eventType: 'Issue',
        quantity: -25,
        payload: {
          picks: [
            { batchId: 'MID', quantity: 10 },
            { batchId: 'NEW', quantity: 15 },
          ],
        },
      }),
    );
    expect(effect.balances.reduce((sum, b) => sum + b.delta, 0)).toBe(-25);
  });

  it('honours the shelf each pick came off', () => {
    const [first] = reduceEvent(
      evt({
        eventType: 'Issue',
        quantity: -5,
        storeId: 'fallback',
        payload: { picks: [{ batchId: 'B', storeId: 's9', storageUnitId: 'u9', quantity: 5 }] },
      }),
    ).balances;
    expect(first.storeId).toBe('s9');
    expect(first.storageUnitId).toBe('u9');
  });

  it('falls back to the event location for picks that omit one', () => {
    const [first] = reduceEvent(
      evt({
        eventType: 'Issue',
        quantity: -5,
        storeId: 's1',
        payload: { picks: [{ batchId: 'B', quantity: 5 }] },
      }),
    ).balances;
    expect(first.storeId).toBe('s1');
  });

  it('does not apply picks to an inflow', () => {
    // Receiving lands in one lot; a pick list on an inflow would be meaningless.
    const effect = reduceEvent(
      evt({ eventType: 'Receive', quantity: 10, batchId: 'b1', payload: { picks: [] } }),
    );
    expect(effect.balances).toHaveLength(1);
    expect(effect.balances[0].batchId).toBe('b1');
  });
});

describe('transfers and relocations', () => {
  it('moves stock between warehouses without creating or destroying any', () => {
    const effect = reduceEvent(
      evt({ eventType: 'Transfer', quantity: 6, destWarehouseId: 'w2' }),
    );
    const totals = netByWarehouse(effect.balances);
    expect(totals.get('p1|w1')).toBe(-6);
    expect(totals.get('p1|w2')).toBe(6);
    expect(effect.balances.reduce((s, b) => s + b.delta, 0)).toBe(0);
  });

  it('treats transfer quantity as a magnitude, so a stray sign cannot invert it', () => {
    const negative = netByWarehouse(
      reduceEvent(evt({ eventType: 'Transfer', quantity: -6, destWarehouseId: 'w2' })).balances,
    );
    expect(negative.get('p1|w1')).toBe(-6);
    expect(negative.get('p1|w2')).toBe(6);
  });

  it('leaves the warehouse total untouched when relocating inside it', () => {
    const effect = reduceEvent(
      evt({
        eventType: 'Relocate',
        quantity: 4,
        storeId: 's1',
        destStoreId: 's2',
      }),
    );
    expect(netByWarehouse(effect.balances).get('p1|w1')).toBe(0);
    // ...but the two sections do change.
    const bySection = effect.balances.map((b) => [b.storeId, b.delta]);
    expect(bySection).toEqual([
      ['s1', -4],
      ['s2', 4],
    ]);
  });

  it('consolidates a multi-lot pick into one line on arrival', () => {
    // Splitting the destination by the source's lots would invent lot rows in
    // a warehouse that never received those lots separately.
    const effect = reduceEvent(
      evt({
        eventType: 'Transfer',
        quantity: 15,
        destWarehouseId: 'w2',
        payload: {
          picks: [
            { batchId: 'A', quantity: 10 },
            { batchId: 'B', quantity: 5 },
          ],
        },
      }),
    );
    const inbound = effect.balances.filter((b) => b.warehouseId === 'w2');
    expect(inbound).toHaveLength(1);
    expect(inbound[0].delta).toBe(15);
  });
});

describe('reservations', () => {
  it('holds stock without moving it', () => {
    const effect = reduceEvent(evt({ eventType: 'Reserve', quantity: 100 }));
    expect(effect.balances).toEqual([]);
    expect(effect.reservedDelta).toBe(100);
  });

  it('frees the hold on release', () => {
    expect(reduceEvent(evt({ eventType: 'ReleaseReservation', quantity: 100 })).reservedDelta).toBe(
      -100,
    );
  });

  it('deducts stock AND ends the hold on confirmation', () => {
    const effect = reduceEvent(evt({ eventType: 'ConfirmReservation', quantity: 100 }));
    expect(netByWarehouse(effect.balances).get('p1|w1')).toBe(-100);
    expect(effect.reservedDelta).toBe(-100);
  });

  it('nets to nothing when a hold is placed then released', () => {
    const { warehouseTotals, reserved } = foldEvents([
      evt({ eventType: 'Reserve', quantity: 100 }),
      evt({ eventType: 'ReleaseReservation', quantity: 100 }),
    ]);
    expect(reserved).toBe(0);
    expect(warehouseTotals.size).toBe(0);
  });
});

describe('non-quantity events', () => {
  it.each(['Count', 'FreezeStock', 'UnfreezeStock'] as EventType[])(
    '%s records a fact without changing stock',
    (eventType) => {
      expect(reduceEvent(evt({ eventType, quantity: 5, reason: 'x' }))).toEqual({
        balances: [],
        reservedDelta: 0,
      });
    },
  );

  it.each(['SplitLot', 'MergeLot', 'Repack'] as EventType[])(
    '%s is inert until its payload contract exists',
    (eventType) => {
      // Guessing a redistribution would silently corrupt lot balances.
      expect(reduceEvent(evt({ eventType, quantity: 5, reason: 'x' }))).toEqual({
        balances: [],
        reservedDelta: 0,
      });
    },
  );
});

describe('replay', () => {
  it('rebuilds the same total a running balance would have reached', () => {
    // The whole promise of event sourcing: the log alone reproduces the number.
    const { warehouseTotals } = foldEvents([
      evt({ eventType: 'Receive', quantity: 100 }),
      evt({ eventType: 'Issue', quantity: -30 }),
      evt({ eventType: 'Adjust', quantity: -5, reason: 'shrinkage' }),
      evt({ eventType: 'Return', quantity: 10, reason: 'customer' }),
      evt({ eventType: 'Transfer', quantity: 20, destWarehouseId: 'w2' }),
    ]);
    expect(warehouseTotals.get('p1|w1')).toBe(55); // 100-30-5+10-20
    expect(warehouseTotals.get('p1|w2')).toBe(20);
  });

  it('gives the same answer regardless of how many times it is replayed', () => {
    const log = [
      evt({ eventType: 'Receive', quantity: 50 }),
      evt({ eventType: 'Issue', quantity: -20 }),
    ];
    expect(foldEvents(log).warehouseTotals).toEqual(foldEvents(log).warehouseTotals);
  });

  it('skips unconfirmed rows during replay', () => {
    const { warehouseTotals } = foldEvents([
      evt({ eventType: 'Receive', quantity: 100 }),
      evt({ eventType: 'Issue', quantity: -40, status: 'cancelled' }),
      evt({ eventType: 'Issue', quantity: -10 }),
    ]);
    expect(warehouseTotals.get('p1|w1')).toBe(90);
  });

  it('lets a compensating event undo a mistake without editing history', () => {
    const { warehouseTotals } = foldEvents([
      evt({ id: 'bad', eventType: 'Issue', quantity: -1000 }),
      evt({
        id: 'fix',
        eventType: 'Adjust',
        quantity: 1000,
        reason: 'reverses bad',
        reversesEventId: 'bad',
      }),
    ]);
    expect(warehouseTotals.get('p1|w1')).toBe(0);
  });

  it('handles an empty log', () => {
    expect(foldEvents([]).warehouseTotals.size).toBe(0);
  });
});
