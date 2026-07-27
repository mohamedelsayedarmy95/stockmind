import { InventoryEvent } from './events';
import { reduceEvent, netByWarehouse } from './event-reducer';

/**
 * Plans the CRUD → event-log backfill (docs/event-schema.md §8).
 *
 * Pure and dependency-injected so the riskiest decision in the project — what
 * events to synthesize from a user's existing inventory — can be tested
 * exhaustively in Node instead of only being discovered on a real device with
 * real stock on it. The db layer executes this plan; it makes none of the
 * decisions itself.
 */

export interface BalanceSnapshotRow {
  productId: string;
  warehouseId: string;
  quantity: number;
}

export interface MovementRecord {
  id: string;
  productId: string;
  warehouseId: string;
  storeId: string | null;
  storageUnitId: string | null;
  batchId: string | null;
  type: string;
  quantity: number;
  notes: string | null;
  pickStrategy: string | null;
  createdAt: number;
}

export interface BackfillDeps {
  newId: () => string;
  now: () => number;
  createdBy: string;
}

export interface BackfillPlan {
  /** Events to append, in order. Opening balances first. */
  events: InventoryEvent[];
  /** Balance each (product|warehouse) pair must still show afterwards. */
  expected: Map<string, number>;
  openingBalanceCount: number;
}

/** Quantities are REAL, so exact equality is the wrong comparison. */
export const EPSILON = 1e-9;

export function pairKey(productId: string, warehouseId: string): string {
  return `${productId}|${warehouseId}`;
}

export function movementToEvent(row: MovementRecord, deps: BackfillDeps): InventoryEvent {
  const isInbound = row.type === 'inbound';
  const magnitude = Math.abs(row.quantity);

  return {
    id: deps.newId(),
    eventType: isInbound ? 'Receive' : 'Issue',
    occurredAt: row.createdAt,
    recordedAt: row.createdAt,
    productId: row.productId,
    warehouseId: row.warehouseId,
    storeId: row.storeId,
    storageUnitId: row.storageUnitId,
    batchId: row.batchId,
    destWarehouseId: null,
    destStoreId: null,
    destStorageUnitId: null,
    // Signed delta, per the engine's convention.
    quantity: isInbound ? magnitude : -magnitude,
    reason: null,
    reference: null,
    createdBy: deps.createdBy,
    approvedBy: null,
    status: 'confirmed',
    reversesEventId: null,
    costImpact: null,
    financialImpact: null,
    payload: {
      migratedFromMovementId: row.id,
      ...(row.notes ? { notes: row.notes } : {}),
      ...(row.pickStrategy ? { pickStrategy: row.pickStrategy } : {}),
    },
  };
}

function openingBalanceEvent(
  productId: string,
  warehouseId: string,
  quantity: number,
  occurredAt: number,
  deps: BackfillDeps,
): InventoryEvent {
  return {
    id: deps.newId(),
    eventType: 'Adjust',
    occurredAt,
    recordedAt: deps.now(),
    productId,
    warehouseId,
    storeId: null,
    storageUnitId: null,
    batchId: null,
    destWarehouseId: null,
    destStoreId: null,
    destStorageUnitId: null,
    quantity,
    reason: 'opening balance (migration v7)',
    reference: null,
    createdBy: deps.createdBy,
    approvedBy: null,
    status: 'confirmed',
    reversesEventId: null,
    costImpact: null,
    financialImpact: null,
    payload: { migration: 'events.backfill.v7' },
  };
}

/**
 * Builds the event set that reproduces today's balances exactly.
 *
 * The opening-balance events are the crux: stock that predates a complete
 * movements ledger has no history behind it, so replaying movements alone
 * would land on a smaller number than the owner sees — indistinguishable from
 * losing their data. One reconciling `Adjust` per pair absorbs that gap and is
 * labelled as such in the ledger rather than hidden.
 */
export function planBackfill(
  snapshot: BalanceSnapshotRow[],
  movements: MovementRecord[],
  deps: BackfillDeps,
): BackfillPlan {
  const expected = new Map<string, number>();
  for (const row of snapshot) {
    expected.set(pairKey(row.productId, row.warehouseId), row.quantity);
  }

  const ordered = [...movements].sort((a, b) =>
    a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt - b.createdAt,
  );
  const movementEvents = ordered.map((m) => movementToEvent(m, deps));

  const fromMovements = netByWarehouse(movementEvents.flatMap((e) => reduceEvent(e).balances));

  const allPairs = new Set<string>([...expected.keys(), ...fromMovements.keys()]);
  // Opening balances predate the first movement so the ledger reads the way an
  // accountant expects: opening → receipts → issues → closing.
  const openedAt = ordered.length > 0 ? ordered[0].createdAt - 1 : deps.now();

  const openingEvents: InventoryEvent[] = [];
  for (const key of allPairs) {
    const [productId, warehouseId] = key.split('|');
    const difference = (expected.get(key) ?? 0) - (fromMovements.get(key) ?? 0);
    if (Math.abs(difference) > EPSILON) {
      openingEvents.push(
        openingBalanceEvent(productId, warehouseId, difference, openedAt, deps),
      );
    }
    // Pairs that only exist in the movement history still belong in `expected`
    // (at 0), or verification would silently skip them.
    if (!expected.has(key)) expected.set(key, 0);
  }

  return {
    events: [...openingEvents, ...movementEvents],
    expected,
    openingBalanceCount: openingEvents.length,
  };
}

export interface VerificationFailure {
  pair: string;
  expected: number;
  replayed: number;
}

/**
 * Replays a plan and reports every pair that doesn't land on its expected
 * figure. An empty result is the migration's go/no-go signal.
 */
export function verifyPlan(plan: BackfillPlan): VerificationFailure[] {
  const replayed = netByWarehouse(plan.events.flatMap((e) => reduceEvent(e).balances));
  const failures: VerificationFailure[] = [];

  for (const [pair, expectedQty] of plan.expected) {
    const actual = replayed.get(pair) ?? 0;
    if (Math.abs(expectedQty - actual) > EPSILON) {
      failures.push({ pair, expected: expectedQty, replayed: actual });
    }
  }

  // A pair the replay invents but the snapshot never had is just as wrong.
  for (const [pair, actual] of replayed) {
    if (!plan.expected.has(pair) && Math.abs(actual) > EPSILON) {
      failures.push({ pair, expected: 0, replayed: actual });
    }
  }

  return failures;
}
