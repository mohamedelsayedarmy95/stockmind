import { InventoryEvent, EventType } from './events';

/**
 * The projection reducer (docs/event-schema.md §6).
 *
 * Pure: an event in, location deltas out. No SQL, no I/O. This is deliberately
 * the ONLY place that decides what an event does to stock — the live write
 * path and the full rebuild both call it, so they cannot drift apart. Two
 * implementations of "apply an event" is how event-sourced systems start
 * lying about their own history.
 *
 * One delta list feeds all three quantity projections: the applier groups by
 * (product, warehouse), by (product, warehouse, store), or by
 * (batch, warehouse, store, unit) as needed.
 */

/** Empty string means "not assigned to one", matching the DB's NOT NULL '' default. */
export interface BalanceDelta {
  productId: string;
  warehouseId: string;
  storeId: string;
  storageUnitId: string;
  batchId: string;
  delta: number;
}

export interface ReducedEffect {
  balances: BalanceDelta[];
  /** Change to the actively-reserved quantity. Does not move on-hand stock. */
  reservedDelta: number;
}

const NO_EFFECT: ReducedEffect = { balances: [], reservedDelta: 0 };

/**
 * Types that carry a POSITIVE magnitude and move it between two locations,
 * rather than a signed delta applied at one. Everything else carries its own
 * sign (Receive positive, Issue negative, Adjust either).
 */
const TWO_SIDED: readonly EventType[] = ['Transfer', 'Relocate'] as const;

export function isTwoSided(type: EventType): boolean {
  return TWO_SIDED.includes(type);
}

/** A pick line from an Issue/Transfer payload: which lot the stock came from. */
interface PickLine {
  batchId?: string | null;
  storeId?: string | null;
  storageUnitId?: string | null;
  quantity: number;
}

function readPicks(event: InventoryEvent): PickLine[] | null {
  const raw = event.payload?.picks;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  return raw as PickLine[];
}

/**
 * Splits a movement into per-lot deltas when the payload records which lots
 * were drawn from, otherwise a single delta at the event's own location.
 *
 * `sign` is +1 for the receiving side and -1 for the giving side, so one
 * helper serves both halves of a transfer.
 */
function locationDeltas(
  event: InventoryEvent,
  sign: 1 | -1,
  magnitude: number,
  location: { warehouseId: string; storeId: string | null; storageUnitId: string | null },
  usePicks: boolean,
): BalanceDelta[] {
  const productId = event.productId as string;
  const picks = usePicks ? readPicks(event) : null;

  if (picks) {
    return picks.map((pick) => ({
      productId,
      warehouseId: location.warehouseId,
      // A pick knows exactly which shelf it came off; fall back to the
      // event's location when it doesn't say.
      storeId: pick.storeId ?? location.storeId ?? '',
      storageUnitId: pick.storageUnitId ?? location.storageUnitId ?? '',
      batchId: pick.batchId ?? '',
      delta: sign * Math.abs(pick.quantity),
    }));
  }

  return [
    {
      productId,
      warehouseId: location.warehouseId,
      storeId: location.storeId ?? '',
      storageUnitId: location.storageUnitId ?? '',
      batchId: event.batchId ?? '',
      delta: sign * magnitude,
    },
  ];
}

/**
 * What one event does to the projections.
 *
 * Only `confirmed` events count. Pending ones haven't happened yet, cancelled
 * ones never did, and reversed ones are neutralised by their own compensating
 * event rather than by rewriting history.
 */
export function reduceEvent(event: InventoryEvent): ReducedEffect {
  if (event.status !== 'confirmed') return NO_EFFECT;

  const quantity = event.quantity ?? 0;
  if (!Number.isFinite(quantity)) return NO_EFFECT;

  switch (event.eventType) {
    // ── Single-location, signed quantity ────────────────────────────────
    case 'Receive':
    case 'Return':
    case 'Issue':
    case 'Dispose':
    case 'Adjust': {
      if (!event.productId || !event.warehouseId || quantity === 0) return NO_EFFECT;
      return {
        balances: locationDeltas(
          event,
          quantity >= 0 ? 1 : -1,
          Math.abs(quantity),
          {
            warehouseId: event.warehouseId,
            storeId: event.storeId,
            storageUnitId: event.storageUnitId,
          },
          // Only outflows are satisfied from specific lots.
          quantity < 0,
        ),
        reservedDelta: 0,
      };
    }

    // Turns a hold into a real deduction: stock leaves AND the hold ends.
    case 'ConfirmReservation': {
      if (!event.productId || !event.warehouseId || quantity === 0) return NO_EFFECT;
      const magnitude = Math.abs(quantity);
      return {
        balances: locationDeltas(
          event,
          -1,
          magnitude,
          {
            warehouseId: event.warehouseId,
            storeId: event.storeId,
            storageUnitId: event.storageUnitId,
          },
          true,
        ),
        reservedDelta: -magnitude,
      };
    }

    // ── Two-location, positive magnitude ────────────────────────────────
    // Warehouse totals net to zero for Relocate (same warehouse both sides),
    // and shift between warehouses for Transfer — with no special-casing,
    // because both sides are expressed as ordinary deltas.
    case 'Transfer':
    case 'Relocate': {
      if (!event.productId || !event.warehouseId || quantity === 0) return NO_EFFECT;
      const magnitude = Math.abs(quantity);
      const out = locationDeltas(
        event,
        -1,
        magnitude,
        {
          warehouseId: event.warehouseId,
          storeId: event.storeId,
          storageUnitId: event.storageUnitId,
        },
        true,
      );
      const inbound = locationDeltas(
        event,
        1,
        magnitude,
        {
          warehouseId: event.destWarehouseId ?? event.warehouseId,
          storeId: event.destStoreId,
          storageUnitId: event.destStorageUnitId,
        },
        // The destination receives one consolidated lot line, not the source's
        // pick split — otherwise a multi-lot pick would invent lots on arrival.
        false,
      );
      return { balances: [...out, ...inbound], reservedDelta: 0 };
    }

    // ── Availability only, no stock movement ────────────────────────────
    case 'Reserve':
      return { balances: [], reservedDelta: Math.abs(quantity) };

    case 'ReleaseReservation':
      return { balances: [], reservedDelta: -Math.abs(quantity) };

    // ── Observations and state flags: no quantity effect by definition ───
    case 'Count':
    case 'FreezeStock':
    case 'UnfreezeStock':
      return NO_EFFECT;

    // ── Declared but not reduced yet ─────────────────────────────────────
    // Split/Merge/Repack conserve total stock while redistributing it across
    // lots or pack sizes. Their payload contract isn't designed yet and no UI
    // emits them, so they are explicitly inert rather than guessed at — a
    // wrong redistribution would silently corrupt lot balances.
    case 'SplitLot':
    case 'MergeLot':
    case 'Repack':
      return NO_EFFECT;
  }
}

/** Nets a delta list down to one entry per (product, warehouse). */
export function netByWarehouse(deltas: BalanceDelta[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const d of deltas) {
    const key = `${d.productId}|${d.warehouseId}`;
    totals.set(key, (totals.get(key) ?? 0) + d.delta);
  }
  return totals;
}

/** Replays many events into net per-warehouse totals — the rebuild core. */
export function foldEvents(events: InventoryEvent[]): {
  warehouseTotals: Map<string, number>;
  reserved: number;
} {
  const all: BalanceDelta[] = [];
  let reserved = 0;
  for (const event of events) {
    const effect = reduceEvent(event);
    all.push(...effect.balances);
    reserved += effect.reservedDelta;
  }
  return { warehouseTotals: netByWarehouse(all), reserved };
}
