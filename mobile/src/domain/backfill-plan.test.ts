import {
  planBackfill,
  verifyPlan,
  pairKey,
  BalanceSnapshotRow,
  MovementRecord,
  BackfillDeps,
} from './backfill-plan';
import { netByWarehouse, reduceEvent } from './event-reducer';
import { validateEvent } from './events';

let counter = 0;
const deps: BackfillDeps = {
  newId: () => `id-${++counter}`,
  now: () => 1_800_000_000_000,
  createdBy: 'user-1',
};

beforeEach(() => {
  counter = 0;
});

const T = 1_700_000_000_000;

function move(over: Partial<MovementRecord> = {}): MovementRecord {
  return {
    id: `m${Math.random()}`,
    productId: 'p1',
    warehouseId: 'w1',
    storeId: null,
    storageUnitId: null,
    batchId: null,
    type: 'inbound',
    quantity: 10,
    notes: null,
    pickStrategy: null,
    createdAt: T,
    ...over,
  };
}

const replayTotal = (plan: ReturnType<typeof planBackfill>, pair: string) =>
  netByWarehouse(plan.events.flatMap((e) => reduceEvent(e).balances)).get(pair) ?? 0;

describe('planBackfill — the data-loss case this exists to prevent', () => {
  it('reconciles stock that has no movement history behind it', () => {
    // The whole reason for opening balances: seeded stock predates a complete
    // movements ledger. Replaying movements alone would land on 0 and look,
    // to the owner, exactly like their inventory was deleted.
    const snapshot: BalanceSnapshotRow[] = [{ productId: 'p1', warehouseId: 'w1', quantity: 120 }];
    const plan = planBackfill(snapshot, [], deps);

    expect(plan.openingBalanceCount).toBe(1);
    expect(replayTotal(plan, 'p1|w1')).toBe(120);
    expect(verifyPlan(plan)).toEqual([]);
  });

  it('reconciles only the unexplained part when history is partial', () => {
    // 120 on hand, but only 40 of it is accounted for by movements.
    const snapshot: BalanceSnapshotRow[] = [{ productId: 'p1', warehouseId: 'w1', quantity: 120 }];
    const movements = [move({ quantity: 40, createdAt: T })];
    const plan = planBackfill(snapshot, movements, deps);

    const opening = plan.events.filter((e) => e.eventType === 'Adjust');
    expect(opening).toHaveLength(1);
    expect(opening[0].quantity).toBe(80);
    expect(replayTotal(plan, 'p1|w1')).toBe(120);
  });

  it('adds no opening balance when movements already explain everything', () => {
    const snapshot: BalanceSnapshotRow[] = [{ productId: 'p1', warehouseId: 'w1', quantity: 70 }];
    const movements = [
      move({ id: 'a', quantity: 100, createdAt: T }),
      move({ id: 'b', type: 'outbound', quantity: 30, createdAt: T + 1 }),
    ];
    const plan = planBackfill(snapshot, movements, deps);

    expect(plan.openingBalanceCount).toBe(0);
    expect(replayTotal(plan, 'p1|w1')).toBe(70);
    expect(verifyPlan(plan)).toEqual([]);
  });

  it('handles history that over-explains the balance with a negative opening', () => {
    // Movements say +100 but only 60 is on hand — something was removed
    // outside the ledger. The gap gets recorded, not swallowed.
    const snapshot: BalanceSnapshotRow[] = [{ productId: 'p1', warehouseId: 'w1', quantity: 60 }];
    const plan = planBackfill(snapshot, [move({ quantity: 100 })], deps);

    const opening = plan.events.filter((e) => e.eventType === 'Adjust');
    expect(opening[0].quantity).toBe(-40);
    expect(verifyPlan(plan)).toEqual([]);
  });

  it('covers a pair that exists only in movement history', () => {
    // No balance row, but movements reference the pair. Replay must land on 0,
    // and the pair must be verified rather than silently skipped.
    const plan = planBackfill([], [move({ productId: 'ghost', quantity: 25 })], deps);

    expect(replayTotal(plan, 'ghost|w1')).toBe(0);
    expect(plan.expected.get('ghost|w1')).toBe(0);
    expect(verifyPlan(plan)).toEqual([]);
  });
});

describe('planBackfill — fidelity of converted movements', () => {
  it('maps inbound to a positive Receive and outbound to a negative Issue', () => {
    const plan = planBackfill(
      [],
      [
        move({ id: 'a', type: 'inbound', quantity: 10 }),
        move({ id: 'b', type: 'outbound', quantity: 4, createdAt: T + 1 }),
      ],
      deps,
    );
    const converted = plan.events.filter((e) => e.eventType !== 'Adjust');
    expect(converted.map((e) => [e.eventType, e.quantity])).toEqual([
      ['Receive', 10],
      ['Issue', -4],
    ]);
  });

  it('normalises a stored outbound magnitude regardless of its sign', () => {
    // The CRUD ledger stored magnitudes; a negative would double-negate.
    const plan = planBackfill([], [move({ type: 'outbound', quantity: -7 })], deps);
    const issue = plan.events.find((e) => e.eventType === 'Issue');
    expect(issue?.quantity).toBe(-7);
  });

  it('carries section, unit and lot onto the event', () => {
    const plan = planBackfill(
      [],
      [move({ storeId: 's1', storageUnitId: 'u1', batchId: 'b1' })],
      deps,
    );
    const receive = plan.events.find((e) => e.eventType === 'Receive');
    expect(receive).toMatchObject({ storeId: 's1', storageUnitId: 'u1', batchId: 'b1' });
  });

  it('keeps a trail back to the row it came from', () => {
    const plan = planBackfill([], [move({ id: 'mv-42', notes: 'hello' })], deps);
    const receive = plan.events.find((e) => e.eventType === 'Receive');
    expect(receive?.payload).toMatchObject({ migratedFromMovementId: 'mv-42', notes: 'hello' });
  });

  it('preserves the original timestamps rather than stamping migration time', () => {
    const plan = planBackfill([], [move({ createdAt: T })], deps);
    const receive = plan.events.find((e) => e.eventType === 'Receive');
    expect(receive?.occurredAt).toBe(T);
  });

  it('emits only events that pass validation, since the log is immutable', () => {
    const snapshot: BalanceSnapshotRow[] = [{ productId: 'p1', warehouseId: 'w1', quantity: 120 }];
    const plan = planBackfill(snapshot, [move({ quantity: 40 })], deps);
    for (const event of plan.events) {
      expect(validateEvent(event)).toEqual([]);
    }
  });
});

describe('planBackfill — ordering', () => {
  it('puts opening balances before any movement', () => {
    const plan = planBackfill(
      [{ productId: 'p1', warehouseId: 'w1', quantity: 200 }],
      [move({ quantity: 40 })],
      deps,
    );
    expect(plan.events[0].eventType).toBe('Adjust');
    expect(plan.events[0].occurredAt).toBeLessThan(plan.events[1].occurredAt);
  });

  it('replays movements oldest first regardless of input order', () => {
    const plan = planBackfill(
      [],
      [
        move({ id: 'later', quantity: 5, createdAt: T + 100 }),
        move({ id: 'earlier', quantity: 10, createdAt: T }),
      ],
      deps,
    );
    const times = plan.events.filter((e) => e.eventType !== 'Adjust').map((e) => e.occurredAt);
    expect(times).toEqual([T, T + 100]);
  });

  it('breaks timestamp ties deterministically, so two runs agree', () => {
    const rows = [
      move({ id: 'b', quantity: 1, createdAt: T }),
      move({ id: 'a', quantity: 2, createdAt: T }),
    ];
    const first = planBackfill([], rows, deps).events.map((e) => e.payload?.migratedFromMovementId);
    counter = 0;
    const second = planBackfill([], [...rows].reverse(), deps).events.map(
      (e) => e.payload?.migratedFromMovementId,
    );
    expect(first).toEqual(second);
  });
});

describe('planBackfill — realistic multi-entity state', () => {
  it('reconciles several products across several warehouses at once', () => {
    const snapshot: BalanceSnapshotRow[] = [
      { productId: 'coffee', warehouseId: 'main', quantity: 120 },
      { productId: 'coffee', warehouseId: 'depot', quantity: 30 },
      { productId: 'ammo', warehouseId: 'main', quantity: 88 },
      { productId: 'spares', warehouseId: 'main', quantity: 0 },
    ];
    const movements = [
      move({ id: 'm1', productId: 'coffee', warehouseId: 'main', quantity: 100, createdAt: T }),
      move({
        id: 'm2',
        productId: 'coffee',
        warehouseId: 'main',
        type: 'outbound',
        quantity: 30,
        createdAt: T + 10,
      }),
      move({ id: 'm3', productId: 'ammo', warehouseId: 'main', quantity: 88, createdAt: T + 20 }),
    ];

    const plan = planBackfill(snapshot, movements, deps);
    expect(verifyPlan(plan)).toEqual([]);
    expect(replayTotal(plan, pairKey('coffee', 'main'))).toBe(120);
    expect(replayTotal(plan, pairKey('coffee', 'depot'))).toBe(30);
    expect(replayTotal(plan, pairKey('ammo', 'main'))).toBe(88);
  });

  it('needs no opening balance for a pair sitting at zero', () => {
    const plan = planBackfill([{ productId: 'p1', warehouseId: 'w1', quantity: 0 }], [], deps);
    expect(plan.openingBalanceCount).toBe(0);
    expect(verifyPlan(plan)).toEqual([]);
  });

  it('reconciles fractional quantities without float drift tripping the check', () => {
    const plan = planBackfill(
      [{ productId: 'p1', warehouseId: 'w1', quantity: 0.3 }],
      [
        move({ id: 'a', quantity: 0.1, createdAt: T }),
        move({ id: 'b', quantity: 0.2, createdAt: T + 1 }),
      ],
      deps,
    );
    // 0.1 + 0.2 !== 0.3 in binary floating point — the epsilon exists for this.
    expect(verifyPlan(plan)).toEqual([]);
  });

  it('produces nothing at all for a brand-new install', () => {
    const plan = planBackfill([], [], deps);
    expect(plan.events).toEqual([]);
    expect(verifyPlan(plan)).toEqual([]);
  });
});

describe('verifyPlan — catches a broken plan', () => {
  it('reports a pair whose replay misses its expected figure', () => {
    const plan = planBackfill([{ productId: 'p1', warehouseId: 'w1', quantity: 100 }], [], deps);
    // Corrupt the plan the way a mapping bug would.
    plan.expected.set('p1|w1', 999);
    expect(verifyPlan(plan)).toEqual([{ pair: 'p1|w1', expected: 999, replayed: 100 }]);
  });

  it('reports stock the replay invents that was never in the snapshot', () => {
    const plan = planBackfill([{ productId: 'p1', warehouseId: 'w1', quantity: 100 }], [], deps);
    plan.expected.delete('p1|w1');
    expect(verifyPlan(plan)).toEqual([{ pair: 'p1|w1', expected: 0, replayed: 100 }]);
  });
});
