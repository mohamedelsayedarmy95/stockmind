import * as Crypto from 'expo-crypto';
import type { Transaction } from '@op-engineering/op-sqlite';
import { getDb, query } from './database';
import { InventoryEvent, StoredInventoryEvent, validateEvent } from '@/domain/events';
import { buildHashInput, GENESIS_HASH, findChainBreaks, ChainBreak } from '@/domain/event-hash';

/**
 * Persistence for the Inventory Event Engine.
 *
 * The log is append-only: this module offers no update and no delete, and the
 * schema has no deleted_at column to soft-delete with. Corrections are made by
 * appending a compensating event that points at what it reverses.
 */

interface EventRow {
  seq: number;
  id: string;
  event_type: string;
  occurred_at: number;
  recorded_at: number;
  product_id: string | null;
  warehouse_id: string | null;
  store_id: string | null;
  storage_unit_id: string | null;
  batch_id: string | null;
  dest_warehouse_id: string | null;
  dest_store_id: string | null;
  dest_storage_unit_id: string | null;
  quantity: number | null;
  reason: string | null;
  reference: string | null;
  created_by: string;
  approved_by: string | null;
  status: string;
  reverses_event_id: string | null;
  cost_impact: number | null;
  financial_impact: number | null;
  payload: string | null;
  prev_hash: string;
  hash: string;
  sync_status: string;
}

function toEvent(r: EventRow): StoredInventoryEvent {
  return {
    seq: r.seq,
    id: r.id,
    eventType: r.event_type as StoredInventoryEvent['eventType'],
    occurredAt: r.occurred_at,
    recordedAt: r.recorded_at,
    productId: r.product_id,
    warehouseId: r.warehouse_id,
    storeId: r.store_id,
    storageUnitId: r.storage_unit_id,
    batchId: r.batch_id,
    destWarehouseId: r.dest_warehouse_id,
    destStoreId: r.dest_store_id,
    destStorageUnitId: r.dest_storage_unit_id,
    quantity: r.quantity,
    reason: r.reason,
    reference: r.reference,
    createdBy: r.created_by,
    approvedBy: r.approved_by,
    status: r.status as StoredInventoryEvent['status'],
    reversesEventId: r.reverses_event_id,
    costImpact: r.cost_impact,
    financialImpact: r.financial_impact,
    payload: r.payload ? (JSON.parse(r.payload) as Record<string, unknown>) : null,
    prevHash: r.prev_hash,
    hash: r.hash,
    syncStatus: r.sync_status as StoredInventoryEvent['syncStatus'],
  };
}

const SELECT_COLUMNS = `seq, id, event_type, occurred_at, recorded_at, product_id, warehouse_id,
  store_id, storage_unit_id, batch_id, dest_warehouse_id, dest_store_id, dest_storage_unit_id,
  quantity, reason, reference, created_by, approved_by, status, reverses_event_id,
  cost_impact, financial_impact, payload, prev_hash, hash, sync_status`;

export async function hashEvent(event: InventoryEvent, prevHash: string): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    buildHashInput(event, prevHash),
  );
}

/** Hash of the newest event, or genesis when the log is empty. */
export async function latestHash(): Promise<string> {
  const rows = await query<{ hash: string }>(
    `SELECT hash FROM inventory_events ORDER BY seq DESC LIMIT 1`,
  );
  return rows[0]?.hash ?? GENESIS_HASH;
}

async function latestHashTx(tx: Transaction): Promise<string> {
  const rows = (
    await tx.execute(`SELECT hash FROM inventory_events ORDER BY seq DESC LIMIT 1`)
  ).rows as unknown as Array<{ hash: string }>;
  return rows[0]?.hash ?? GENESIS_HASH;
}

function insertParams(event: InventoryEvent, prevHash: string, hash: string) {
  return [
    event.id,
    event.eventType,
    event.occurredAt,
    event.recordedAt,
    event.productId,
    event.warehouseId,
    event.storeId,
    event.storageUnitId,
    event.batchId,
    event.destWarehouseId,
    event.destStoreId,
    event.destStorageUnitId,
    event.quantity,
    event.reason,
    event.reference,
    event.createdBy,
    event.approvedBy,
    event.status,
    event.reversesEventId,
    event.costImpact,
    event.financialImpact,
    event.payload ? JSON.stringify(event.payload) : null,
    prevHash,
    hash,
  ];
}

const INSERT_SQL = `INSERT INTO inventory_events (
  id, event_type, occurred_at, recorded_at, product_id, warehouse_id, store_id,
  storage_unit_id, batch_id, dest_warehouse_id, dest_store_id, dest_storage_unit_id,
  quantity, reason, reference, created_by, approved_by, status, reverses_event_id,
  cost_impact, financial_impact, payload, prev_hash, hash, sync_status
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending')`;

/**
 * Appends one event inside the caller's transaction, so the event and the
 * projection updates it causes commit together or not at all.
 *
 * Validation runs first: the log is immutable, so a malformed row written here
 * is permanent.
 */
export async function appendEventTx(tx: Transaction, event: InventoryEvent): Promise<string> {
  const errors = validateEvent(event);
  if (errors.length > 0) {
    throw new Error(`Invalid event (${event.eventType}): ${errors.join('; ')}`);
  }
  const prevHash = await latestHashTx(tx);
  const hash = await hashEvent(event, prevHash);
  await tx.execute(INSERT_SQL, insertParams(event, prevHash, hash));
  return hash;
}

/**
 * Appends many pre-hashed events. Used by the migration backfill, where
 * hashing every row is done up front so the write transaction isn't held open
 * across hundreds of async crypto calls.
 */
export async function appendPreHashedTx(
  tx: Transaction,
  rows: Array<{ event: InventoryEvent; prevHash: string; hash: string }>,
): Promise<void> {
  for (const row of rows) {
    await tx.execute(INSERT_SQL, insertParams(row.event, row.prevHash, row.hash));
  }
}

/** Hashes a run of events into a chain starting from `startHash`. */
export async function buildChain(
  events: InventoryEvent[],
  startHash: string,
): Promise<Array<{ event: InventoryEvent; prevHash: string; hash: string }>> {
  const chained: Array<{ event: InventoryEvent; prevHash: string; hash: string }> = [];
  let prevHash = startHash;
  for (const event of events) {
    const hash = await hashEvent(event, prevHash);
    chained.push({ event, prevHash, hash });
    prevHash = hash;
  }
  return chained;
}

export async function listEvents(limit?: number): Promise<StoredInventoryEvent[]> {
  const rows = await query<EventRow>(
    `SELECT ${SELECT_COLUMNS} FROM inventory_events ORDER BY seq${limit ? ` LIMIT ${limit}` : ''}`,
  );
  return rows.map(toEvent);
}

export async function countEvents(): Promise<number> {
  const rows = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM inventory_events`);
  return rows[0]?.n ?? 0;
}

/** Every event touching one lot, oldest first — the lot-traceability read. */
export async function listEventsForBatch(batchId: string): Promise<StoredInventoryEvent[]> {
  const rows = await query<EventRow>(
    `SELECT ${SELECT_COLUMNS} FROM inventory_events WHERE batch_id = ? ORDER BY seq`,
    [batchId],
  );
  return rows.map(toEvent);
}

/**
 * Verifies the chain links. Reports findings and changes nothing — per UWOS
 * §4, detecting tampering raises an alert; destruction is never an acceptable
 * response to a suspicion.
 */
export async function verifyChain(): Promise<ChainBreak[]> {
  const rows = await query<{ seq: number; prev_hash: string; hash: string }>(
    `SELECT seq, prev_hash, hash FROM inventory_events ORDER BY seq`,
  );
  return findChainBreaks(
    rows.map((r) => ({ seq: r.seq, prevHash: r.prev_hash, hash: r.hash })),
  );
}

export async function getMeta(key: string): Promise<string | null> {
  const rows = await query<{ value: string }>(`SELECT value FROM app_meta WHERE key = ? LIMIT 1`, [
    key,
  ]);
  return rows[0]?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await getDb().execute(
    `INSERT INTO app_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}
