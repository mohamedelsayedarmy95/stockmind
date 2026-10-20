/**
 * Client side of the backend sync contract (GET /stock/changes/:warehouseId?since=&limit=).
 *
 * The server is the only authority on stock. A client keeps, per warehouse, the last revision it applied and the
 * server's balances; it never computes a balance by adding quantities up. Pushes (FCM) are only hints to call
 * `nextRequest` sooner; missed, duplicated or out-of-order hints and responses cannot corrupt the state because:
 * - a snapshot replaces every balance;
 * - a delta is applied only when it continues exactly from the revision this client holds (`since`); a response to
 *   an older or newer request is discarded and the next poll catches up.
 */

export interface ServerBalance {
  productId: string;
  baseQuantity: string;
  reservedQuantity: string;
  availableQuantity: string;
}

export interface ServerMovement {
  id: string;
  productId: string;
  userId: string;
  movementType: string;
  quantityChange: string;
  runningBalance: string;
  revision: string;
  createdAt: string;
}

export interface ChangesResponse {
  warehouseId: string;
  mode: 'delta' | 'snapshot';
  revision: string;
  hasMore: boolean;
  movements: ServerMovement[];
  balances: ServerBalance[];
}

/** What the UI may honestly say about one warehouse's server data. */
export type SyncStatus = 'never-synced' | 'catching-up' | 'synced';

export interface WarehouseSyncState {
  warehouseId: string;
  /** Last revision applied; null until the first snapshot. */
  revision: string | null;
  balances: Record<string, ServerBalance>;
  /** Recent movements (newest last), deduplicated by id. */
  recent: ServerMovement[];
  status: SyncStatus;
}

const RECENT_LIMIT = 200;

export function initialSyncState(warehouseId: string): WarehouseSyncState {
  return { warehouseId, revision: null, balances: {}, recent: [], status: 'never-synced' };
}

/** Query for the next call: no `since` until a snapshot has been applied. */
export function nextRequest(state: WarehouseSyncState): { since?: string } {
  return state.revision === null ? {} : { since: state.revision };
}

/**
 * Applies one server response. `since` is the cursor the request was sent with (undefined: a snapshot request).
 * Returns the same object when the response is discarded.
 */
export function applyChanges(
  state: WarehouseSyncState,
  since: string | undefined,
  response: ChangesResponse,
): WarehouseSyncState {
  if (response.warehouseId !== state.warehouseId) return state;

  if (response.mode === 'snapshot') {
    // A snapshot answering an older request must not roll back newer data we already hold.
    if (state.revision !== null && BigInt(response.revision) < BigInt(state.revision)) return state;
    return {
      ...state,
      revision: response.revision,
      balances: Object.fromEntries(response.balances.map((b) => [b.productId, b])),
      status: 'synced',
    };
  }

  // A delta only continues the exact cursor it was asked for.
  if (state.revision === null || since !== state.revision) return state;

  const seen = new Set(state.recent.map((m) => m.id));
  const fresh = response.movements.filter((m) => !seen.has(m.id));
  const balances = { ...state.balances };
  for (const b of response.balances) balances[b.productId] = b;
  return {
    ...state,
    revision: response.revision,
    balances,
    recent: [...state.recent, ...fresh].slice(-RECENT_LIMIT),
    status: response.hasMore ? 'catching-up' : 'synced',
  };
}
