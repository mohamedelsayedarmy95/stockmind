import type { Transaction } from '@op-engineering/op-sqlite';
import { getDb, query } from './database';
import { newId, now } from './util';
import { reduceEvent, netByWarehouse, BalanceDelta } from '@/domain/event-reducer';
import { GENESIS_HASH } from '@/domain/event-hash';
import {
  planBackfill,
  verifyPlan,
  BalanceSnapshotRow,
  MovementRecord,
  EPSILON,
} from '@/domain/backfill-plan';
import { buildChain, appendPreHashedTx } from './event-store';

/**
 * Executes the CRUD → event-log backfill (docs/event-schema.md §8).
 *
 * All the *decisions* live in domain/backfill-plan, which is pure and heavily
 * tested. This module only reads rows, runs the plan, writes, and verifies —
 * so there is exactly one implementation of "what events reproduce this
 * inventory", not one here and one under test.
 *
 * Failure mode is "nothing happened, app still works". A mismatch throws
 * inside the transaction, which rolls back the events AND the rebuilt
 * balances, leaving the device exactly as it was.
 *
 * Scope: only `stock_balances` (the authoritative warehouse level) is rebuilt
 * and asserted. Per-section and per-lot projections keep their current values,
 * because historical movements don't carry enough location detail to reproduce
 * them faithfully — and inventing that detail would be worse than leaving it.
 * New events maintain all three from here on.
 */

export const MIGRATION_KEY = 'events.backfill.v7';

interface MovementRow {
  id: string;
  product_id: string;
  warehouse_id: string;
  store_id: string | null;
  storage_unit_id: string | null;
  batch_id: string | null;
  type: string;
  quantity: number;
  notes: string | null;
  pick_strategy: string | null;
  created_at: number;
}

async function currentUserId(): Promise<string> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM local_users WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`,
  );
  return rows[0]?.id ?? 'migration';
}

/** Replays a delta list into the warehouse-level projection table. */
async function rebuildWarehouseBalancesTx(
  tx: Transaction,
  deltas: BalanceDelta[],
  ts: number,
): Promise<Map<string, number>> {
  const totals = netByWarehouse(deltas);

  await tx.execute(`DELETE FROM stock_balances`);
  for (const [key, quantity] of totals) {
    const separator = key.indexOf('|');
    const productId = key.slice(0, separator);
    const warehouseId = key.slice(separator + 1);
    await tx.execute(
      `INSERT INTO stock_balances (id, product_id, warehouse_id, quantity, created_at, updated_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [newId(), productId, warehouseId, quantity, ts, ts],
    );
  }
  return totals;
}

export interface MigrationOutcome {
  status: 'skipped' | 'migrated';
  eventsWritten: number;
  openingBalances: number;
  pairsVerified: number;
}

export async function runEventBackfill(): Promise<MigrationOutcome> {
  const already = await query<{ value: string }>(
    `SELECT value FROM app_meta WHERE key = ? LIMIT 1`,
    [MIGRATION_KEY],
  );
  if (already[0]) {
    return { status: 'skipped', eventsWritten: 0, openingBalances: 0, pairsVerified: 0 };
  }

  const createdBy = await currentUserId();

  const snapshot = await query<BalanceSnapshotRow>(
    `SELECT product_id AS productId, warehouse_id AS warehouseId, quantity
     FROM stock_balances WHERE deleted_at IS NULL`,
  );

  const movementRows = await query<MovementRow>(
    `SELECT id, product_id, warehouse_id, store_id, storage_unit_id, batch_id,
            type, quantity, notes, pick_strategy, created_at
     FROM stock_movements WHERE deleted_at IS NULL`,
  );
  const movements: MovementRecord[] = movementRows.map((r) => ({
    id: r.id,
    productId: r.product_id,
    warehouseId: r.warehouse_id,
    storeId: r.store_id,
    storageUnitId: r.storage_unit_id,
    batchId: r.batch_id,
    type: r.type,
    quantity: r.quantity,
    notes: r.notes,
    pickStrategy: r.pick_strategy,
    createdAt: r.created_at,
  }));

  const plan = planBackfill(snapshot, movements, { newId, now, createdBy });

  // Dry run before touching anything: if the plan can't reproduce the
  // snapshot, there is no point opening a write transaction at all.
  const planFailures = verifyPlan(plan);
  if (planFailures.length > 0) {
    const detail = planFailures
      .map((f) => `${f.pair}: expected ${f.expected}, replays to ${f.replayed}`)
      .join('; ');
    throw new Error(`Event backfill plan rejected before any write — ${detail}`);
  }

  const ts = now();

  if (plan.events.length === 0) {
    await getDb().execute(`INSERT INTO app_meta (key, value) VALUES (?, ?)`, [
      MIGRATION_KEY,
      String(ts),
    ]);
    return { status: 'migrated', eventsWritten: 0, openingBalances: 0, pairsVerified: 0 };
  }

  // Hash outside the transaction so a write lock isn't held across hundreds of
  // async crypto calls.
  const chained = await buildChain(plan.events, GENESIS_HASH);
  const deltas = plan.events.flatMap((e) => reduceEvent(e).balances);

  await getDb().transaction(async (tx) => {
    await appendPreHashedTx(tx, chained);
    const rebuilt = await rebuildWarehouseBalancesTx(tx, deltas, ts);

    // The acceptance test, now against what SQLite actually stored rather than
    // what we computed in memory.
    for (const [pair, expectedQty] of plan.expected) {
      const actual = rebuilt.get(pair) ?? 0;
      if (Math.abs(expectedQty - actual) > EPSILON) {
        throw new Error(
          `Event backfill aborted: ${pair} was ${expectedQty} but replays to ${actual}. ` +
            'No data was changed.',
        );
      }
    }

    await tx.execute(`INSERT INTO app_meta (key, value) VALUES (?, ?)`, [
      MIGRATION_KEY,
      String(ts),
    ]);
  });

  return {
    status: 'migrated',
    eventsWritten: plan.events.length,
    openingBalances: plan.openingBalanceCount,
    pairsVerified: plan.expected.size,
  };
}
