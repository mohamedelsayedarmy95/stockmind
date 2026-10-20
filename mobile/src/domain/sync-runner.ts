/**
 * Drives the `stock-sync` reducer against `GET /stock/changes/:warehouseId` and decides what the screen may say.
 *
 * Only four states are ever shown, and each one is true when shown:
 * - Synced: the last poll finished and the server had nothing more;
 * - Catching up: no snapshot yet, a page is in flight, or the server said there is more;
 * - Offline: the last poll got no usable answer (no network, timeout, 5xx); the figures are the last synced ones;
 * - Rejected: the server refused this user's write (409/422) or this warehouse (403/404).
 */
import { applyChanges, ChangesResponse, nextRequest, WarehouseSyncState } from './stock-sync';
import { WriteRejection } from './idempotent-write';

export type PollError = 'network' | 'server' | 'denied' | 'auth';

export function pollErrorOf(status: number | undefined): PollError {
  if (status === undefined) return 'network';
  if (status === 401) return 'auth';
  if (status === 403 || status === 404) return 'denied';
  return 'server';
}

export interface PollResult {
  state: WarehouseSyncState;
  pages: number;
  error: PollError | null;
}

export interface PollOptions {
  /** Page size sent as `limit` (the server caps it at 500). */
  limit?: number;
  /** Pages fetched per poll; the rest is left for the next poll (status stays catching-up). */
  maxPages?: number;
  statusOf: (err: unknown) => number | undefined;
}

/** Fetches pages from the state's cursor until the server has nothing more, maxPages is reached, or an error. */
export async function pollWarehouse(
  initial: WarehouseSyncState,
  fetchPage: (query: { since?: string; limit: number }) => Promise<ChangesResponse>,
  { limit = 200, maxPages = 5, statusOf }: PollOptions,
): Promise<PollResult> {
  let state = initial;
  let pages = 0;
  while (pages < maxPages) {
    const { since } = nextRequest(state);
    let response: ChangesResponse;
    try {
      response = await fetchPage(since === undefined ? { limit } : { since, limit });
    } catch (err) {
      return { state, pages, error: pollErrorOf(statusOf(err)) };
    }
    pages++;
    const next = applyChanges(state, since, response);
    // A discarded answer cannot advance the cursor: stop instead of asking the same question again.
    if (next === state) break;
    state = next;
    if (!response.hasMore) break;
  }
  return { state, pages, error: null };
}

export type SyncDisplay = 'synced' | 'catching-up' | 'offline' | 'rejected';

export interface SyncView {
  sync: WarehouseSyncState;
  inFlight: boolean;
  lastError: PollError | null;
  rejection: WriteRejection | null;
}

export type RejectionReason = WriteRejection | 'no-access';

export function syncDisplay(view: SyncView): { display: SyncDisplay; reason: RejectionReason | null } {
  if (view.rejection) return { display: 'rejected', reason: view.rejection };
  if (view.lastError === 'denied') return { display: 'rejected', reason: 'no-access' };
  if (view.lastError) return { display: 'offline', reason: null };
  if (view.inFlight || view.sync.status !== 'synced') return { display: 'catching-up', reason: null };
  return { display: 'synced', reason: null };
}
