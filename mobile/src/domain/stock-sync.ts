/**
 * Client side of the backend sync contract (GET /stock/changes/:warehouseId?since=&anchor=&limit=).
 *
 * The server is the only authority on stock. A client keeps, per warehouse, the last revision it applied (with its
 * anchor: the id of the movement at that revision) and the server's balances; it never computes a balance by adding
 * quantities up. Pushes (FCM) are only hints to call `nextRequest` sooner; missed, duplicated or out-of-order hints
 * and responses cannot corrupt the state because:
 * - a snapshot replaces every balance;
 * - a delta is applied only when it continues exactly from the revision this client holds (`since`); a response to
 *   an older or newer request is discarded and the next poll catches up;
 * - a snapshot that answers a delta request means the server no longer recognises the cursor (`reset`: its history
 *   was restored or rebuilt): the client rebases on it, even when its revision is lower than the one held.
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
  /** Id of the movement at `revision` (null at revision 0). Absent from servers older than the cursor check. */
  anchor?: string | null;
  /** The server did not recognise the cursor and sent the full state instead. */
  reset?: boolean;
  /** Why (Series 07): 'generation' (the history generation changed), 'floor', 'ahead' or 'anchor'. */
  resetReason?: string;
  /**
   * The company's history generation (Series 07): an opaque id that changes only when an operator records a restore.
   * Absent from servers older than Series 07. Compared for equality only; never ordered.
   */
  generation?: string;
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
  /** Movement id at `revision`, sent back so the server can check the cursor. */
  anchor: string | null;
  /** The history generation this cursor and these balances belong to (null until a Series 07 server told us). */
  generation: string | null;
  balances: Record<string, ServerBalance>;
  /** Recent movements (newest last), deduplicated by id. */
  recent: ServerMovement[];
  status: SyncStatus;
  /** How many times the server reset this cursor (shown to the user; never silent). */
  resets: number;
}

const RECENT_LIMIT = 200;

export function initialSyncState(warehouseId: string): WarehouseSyncState {
  return { warehouseId, revision: null, anchor: null, generation: null, balances: {}, recent: [], status: 'never-synced', resets: 0 };
}

/**
 * Query for the next call: no `since` until a snapshot has been applied; the anchor and the history generation travel
 * with the cursor, so the server can tell this cursor belongs to another history even when revision numbers repeat.
 */
export function nextRequest(state: WarehouseSyncState): { since?: string; anchor?: string; generation?: string } {
  const generation = state.generation ? { generation: state.generation } : {};
  if (state.revision === null) return generation;
  return { since: state.revision, ...(state.anchor ? { anchor: state.anchor } : {}), ...generation };
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

  // Another history generation than the one this cursor and these balances belong to: whatever the revision numbers
  // say, they describe a different history. Never ordered, only compared; a server without generations sends none.
  const incoming = response.generation ?? null;
  const generationChanged = state.generation !== null && incoming !== null && state.generation !== incoming;

  if (response.mode === 'snapshot') {
    const reset = since !== undefined || generationChanged;
    if (since !== undefined) {
      // A snapshot answering a delta request: the server rejected that cursor. Only the current cursor's answer
      // counts; a late answer to an older request is discarded like any stale reply.
      if (since !== state.revision) return state;
    } else if (!generationChanged && state.revision !== null && BigInt(response.revision) < BigInt(state.revision)) {
      // An older answer to a snapshot request must not roll back newer data we already hold. (Not across a
      // generation change: a restored history may legitimately have a lower revision.)
      return state;
    }
    return {
      ...state,
      revision: response.revision,
      anchor: response.anchor ?? null,
      generation: incoming ?? state.generation,
      balances: Object.fromEntries(response.balances.map((b) => [b.productId, b])),
      // After a reset the old movement list describes a history the server no longer has.
      recent: reset ? [] : state.recent,
      status: 'synced',
      resets: reset ? state.resets + 1 : state.resets,
    };
  }

  // A delta only continues the exact cursor it was asked for.
  if (state.revision === null || since !== state.revision) return state;
  // The server answers a changed generation with a snapshot. A delta that names another generation is never applied:
  // drop the cursor and everything built on it, count the reset, and take a snapshot next.
  if (generationChanged) {
    return { ...state, revision: null, anchor: null, generation: incoming, balances: {}, recent: [], status: 'catching-up', resets: state.resets + 1 };
  }

  const seen = new Set(state.recent.map((m) => m.id));
  const fresh = response.movements.filter((m) => !seen.has(m.id));
  const balances = { ...state.balances };
  for (const b of response.balances) balances[b.productId] = b;
  return {
    ...state,
    revision: response.revision,
    // An older server sends no anchor: forget ours rather than send back one that names an earlier revision.
    anchor: response.anchor ?? null,
    generation: incoming ?? state.generation,
    balances,
    recent: [...state.recent, ...fresh].slice(-RECENT_LIMIT),
    status: response.hasMore ? 'catching-up' : 'synced',
  };
}
