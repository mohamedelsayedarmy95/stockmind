/**
 * Inventory Event Engine — types (UWOS Master Spec §0, docs/event-schema.md).
 *
 * Pure type + policy module: no SQL, no React Native. The data layer persists
 * these; the reducer derives projections from them.
 */

/**
 * Every movement type the spec defines.
 *
 * `WIRED_EVENT_TYPES` below records which of these the app can actually emit
 * today. The rest are declared so the schema and reducer are complete and
 * don't need migrating later — but nothing in the UI produces them yet, and
 * nothing pretends otherwise.
 */
export type EventType =
  | 'Receive'
  | 'Issue'
  | 'Transfer'
  | 'Relocate'
  | 'Reserve'
  | 'ReleaseReservation'
  | 'ConfirmReservation'
  | 'Adjust'
  | 'Count'
  | 'Dispose'
  | 'Return'
  | 'SplitLot'
  | 'MergeLot'
  | 'Repack'
  | 'FreezeStock'
  | 'UnfreezeStock';

/** Event types some screen can genuinely produce right now. */
export const WIRED_EVENT_TYPES: readonly EventType[] = [
  'Receive',
  'Issue',
  'Transfer',
  'Reserve',
  'ReleaseReservation',
  'ConfirmReservation',
  'Adjust',
] as const;

/** Declared and reduced, but no UI emits them yet. */
export const UNWIRED_EVENT_TYPES: readonly EventType[] = [
  'Relocate',
  'Count',
  'Dispose',
  'Return',
  'SplitLot',
  'MergeLot',
  'Repack',
  'FreezeStock',
  'UnfreezeStock',
] as const;

export type EventStatus = 'pending' | 'confirmed' | 'cancelled' | 'reversed';

/**
 * Types that MUST carry a reason. Adjustments and destructive corrections are
 * exactly where an unexplained number destroys an audit later.
 */
export const REASON_REQUIRED: readonly EventType[] = [
  'Adjust',
  'Dispose',
  'Return',
  'SplitLot',
  'MergeLot',
  'Repack',
  'FreezeStock',
  'UnfreezeStock',
] as const;

export function requiresReason(type: EventType): boolean {
  return REASON_REQUIRED.includes(type);
}

/**
 * Types whose `quantity` moves on-hand stock.
 *
 * Note what is absent: Reserve/Release only change what's *available*, and
 * Relocate/Repack move stock between locations or packaging without changing
 * how much exists. Treating either as a quantity change is the classic way an
 * inventory ledger starts double-counting.
 */
export const QUANTITY_AFFECTING: readonly EventType[] = [
  'Receive',
  'Issue',
  'Transfer',
  'ConfirmReservation',
  'Adjust',
  'Dispose',
  'Return',
] as const;

export function affectsQuantity(type: EventType): boolean {
  return QUANTITY_AFFECTING.includes(type);
}

/** The event envelope, mirroring the columns in docs/event-schema.md §2. */
export interface InventoryEvent {
  id: string;
  eventType: EventType;
  occurredAt: number;
  recordedAt: number;
  productId: string | null;
  warehouseId: string | null;
  storeId: string | null;
  storageUnitId: string | null;
  batchId: string | null;
  destWarehouseId: string | null;
  destStoreId: string | null;
  destStorageUnitId: string | null;
  /** Signed delta, always in the product's BASE unit. */
  quantity: number | null;
  reason: string | null;
  reference: string | null;
  createdBy: string;
  approvedBy: string | null;
  status: EventStatus;
  reversesEventId: string | null;
  costImpact: number | null;
  financialImpact: number | null;
  /** Type-specific extras; must be canonical-JSON serializable. */
  payload: Record<string, unknown> | null;
}

/** A stored event, with the chain fields the database assigns. */
export interface StoredInventoryEvent extends InventoryEvent {
  seq: number;
  prevHash: string;
  hash: string;
  syncStatus: 'pending' | 'synced' | 'conflict';
}

/**
 * Rejects an event that could never be reduced correctly. Called before the
 * event is hashed and appended — once written it is immutable, so a bad row
 * is permanent.
 */
export function validateEvent(event: InventoryEvent): string[] {
  const errors: string[] = [];

  if (!event.id) errors.push('id is required');
  if (!event.createdBy) errors.push('createdBy is required');
  if (!Number.isFinite(event.occurredAt)) errors.push('occurredAt must be a finite timestamp');
  if (!Number.isFinite(event.recordedAt)) errors.push('recordedAt must be a finite timestamp');

  if (requiresReason(event.eventType) && !event.reason?.trim()) {
    errors.push(`${event.eventType} requires a reason`);
  }

  if (affectsQuantity(event.eventType)) {
    if (event.quantity == null || !Number.isFinite(event.quantity)) {
      errors.push(`${event.eventType} requires a finite quantity`);
    } else if (event.quantity === 0) {
      // A zero-delta movement is always a bug upstream, and it pollutes the
      // ledger with rows that mean nothing.
      errors.push(`${event.eventType} quantity must not be zero`);
    }
    if (!event.productId) errors.push(`${event.eventType} requires a productId`);
    if (!event.warehouseId) errors.push(`${event.eventType} requires a warehouseId`);
  }

  if (event.eventType === 'Transfer' && !event.destWarehouseId && !event.destStoreId) {
    errors.push('Transfer requires a destination');
  }

  if (event.reversesEventId && event.status !== 'confirmed') {
    errors.push('a reversing event must be confirmed to take effect');
  }

  return errors;
}
