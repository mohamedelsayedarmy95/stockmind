import type { PollError } from './sync-runner';
import type { SyncStatus } from './stock-sync';

/**
 * Series 13 / R-37: what the app may say about a stock balance. An unknown balance is NOT a zero balance.
 *
 * The stock screens used to fall back to the number 0 whenever no figure had arrived: the online Receive screen said
 * "Current balance: 0" while the server could not be reached. The figure on screen is now one of
 *  - confirmed:  the server's figure (or, offline mode, the device's own ledger), current as far as the app knows;
 *                a confirmed 0 is a real zero;
 *  - last-known: the server's figure from the last successful sync, which may be out of date (labelled with its time);
 *  - loading:    nothing has arrived yet and nothing has failed;
 *  - unknown:    the figure cannot be known right now (the server is unreachable, the member has no access to this
 *                warehouse, or what arrived does not belong to this product and warehouse).
 * Pure; the screens only translate the result.
 */
export type BalanceTruth =
  | { state: 'confirmed'; quantity: number; source: 'server' | 'device' }
  | { state: 'last-known'; quantity: number; asOf: number | null }
  | { state: 'loading' }
  | { state: 'unknown'; reason: UnknownReason };

export type UnknownReason = 'unreachable' | 'no-access' | 'mismatch' | 'invalid' | 'no-warehouse';

/** The reconciled online sync state of ONE warehouse (warehouse-sync.ts), as far as the balance needs it. */
export interface SyncBalanceInput {
  warehouseId: string;
  /** Null until the first snapshot: until then the sync state knows nothing about any product. */
  revision: string | null;
  status: SyncStatus;
  balances: Readonly<Record<string, { baseQuantity: string }>>;
  lastError: PollError | null;
  lastSuccessAt: number | null;
  deniedProducts?: readonly string[];
  deniedWarehouse?: boolean;
}

/** The direct balance request for ONE product in ONE warehouse (online: the server; offline mode: the device ledger). */
export interface BalanceQueryInput {
  status: 'pending' | 'error' | 'success';
  data?: { productId: string; warehouseId: string; baseQuantity: string };
  /** HTTP status of a failed request; undefined when no response arrived (offline, timeout). */
  errorStatus?: number;
}

export interface BalanceInput {
  online: boolean;
  productId: string;
  warehouseId: string | null | undefined;
  sync?: SyncBalanceInput | null;
  query: BalanceQueryInput;
}

const parse = (raw: unknown): number | null => {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.floor(n) : null;
};

/** Shared by scalar balances, stock rows, recent movements and the outbox review's cached server figure. */
export function isCachedStockVisible(sync: Pick<SyncBalanceInput, 'lastError' | 'deniedWarehouse' | 'deniedProducts'>, productId: string): boolean {
  return sync.lastError !== 'denied' && !sync.deniedWarehouse && !sync.deniedProducts?.includes(productId);
}

export function resolveBalance(input: BalanceInput): BalanceTruth {
  const { productId, warehouseId, sync, query } = input;
  if (!warehouseId) return { state: 'unknown', reason: 'no-warehouse' };

  // A fresh direct refusal outranks every cached figure, even before the independent warehouse poll sees it.
  if (query.status === 'error' && (query.errorStatus === 403 || query.errorStatus === 404)) {
    return { state: 'unknown', reason: 'no-access' };
  }

  if (input.online && sync && sync.warehouseId === warehouseId) {
    // The member lost access to this warehouse: never show its figure, not even the cached one.
    if (!isCachedStockVisible(sync, productId)) return { state: 'unknown', reason: 'no-access' };
    // After a snapshot every inventory row of the warehouse is known: a product without one has none of it (0) as of that
    // snapshot, unless the direct request (below) answered for exactly this product, which is then the fresher figure.
    const row = sync.balances[productId];
    const directAnswered = query.status === 'success' && query.data?.productId === productId && query.data?.warehouseId === warehouseId;
    if (sync.revision !== null && (row || !directAnswered)) {
      const quantity = parse(row?.baseQuantity ?? '0');
      if (quantity === null) return { state: 'unknown', reason: 'invalid' };
      const current = sync.lastError === null && sync.status === 'synced';
      return current ? { state: 'confirmed', quantity, source: 'server' } : { state: 'last-known', quantity, asOf: sync.lastSuccessAt };
    }
  }

  if (query.status === 'success') {
    const d = query.data;
    // A figure for another product or warehouse (a stale or misrouted answer) is never shown as this one's.
    if (!d || d.productId !== productId || d.warehouseId !== warehouseId) return { state: 'unknown', reason: 'mismatch' };
    const quantity = parse(d.baseQuantity);
    if (quantity === null) return { state: 'unknown', reason: 'invalid' };
    return { state: 'confirmed', quantity, source: input.online ? 'server' : 'device' };
  }
  if (query.status === 'pending') {
    // Online with a failed first sync: nothing is coming from the sync state either.
    if (input.online && sync && sync.warehouseId === warehouseId && sync.lastError) return { state: 'unknown', reason: 'unreachable' };
    return { state: 'loading' };
  }
  return { state: 'unknown', reason: 'unreachable' };
}

/** The quantity a write may rely on: a confirmed or last-known figure; nothing (null) when the balance is not known. */
export function knownQuantity(t: BalanceTruth): number | null {
  return t.state === 'confirmed' || t.state === 'last-known' ? t.quantity : null;
}

/**
 * Online: how much a dispatch may take. Only from a KNOWN balance (unknown allows nothing), and this account's queued
 * dispatches reduce it while queued receipts never raise it (they are not stock until the server confirms them).
 */
export function issuableOnline(t: BalanceTruth, pendingSigned: number): number {
  const known = knownQuantity(t);
  return known === null ? 0 : Math.max(0, known + Math.min(0, pendingSigned));
}

/** The copy for a balance line: a translation key and its parameters (the screen formats the time). */
export function balanceLine(t: BalanceTruth, formatTime: (epochMs: number) => string): { key: string; params?: Record<string, string | number> } {
  switch (t.state) {
    case 'confirmed':
      return { key: 'balance.confirmed', params: { qty: t.quantity } };
    case 'last-known':
      return t.asOf === null
        ? { key: 'balance.lastKnown', params: { qty: t.quantity } }
        : { key: 'balance.lastKnownAt', params: { qty: t.quantity, time: formatTime(t.asOf) } };
    case 'loading':
      return { key: 'balance.loading' };
    case 'unknown':
      return { key: `balance.unknown.${t.reason}` };
  }
}

export const BALANCE_LINE_KEYS = [
  'balance.confirmed', 'balance.lastKnown', 'balance.lastKnownAt', 'balance.loading',
  'balance.unknown.unreachable', 'balance.unknown.no-access', 'balance.unknown.mismatch', 'balance.unknown.invalid',
  'balance.unknown.no-warehouse',
] as const;

/**
 * What the online stock list of one warehouse may say when it has no rows to show: "loading" only while nothing has
 * failed, "unknown" when the first sync failed, "empty" only after a snapshot said so.
 */
export function warehouseListState(sync: SyncBalanceInput | null | undefined): 'loading' | 'unreachable' | 'no-access' | 'unavailable' | 'empty' | 'empty-last-known' | 'rows' {
  if (!sync) return 'loading';
  if (sync.lastError === 'denied' || sync.deniedWarehouse) return 'no-access';
  if (sync.revision === null) return sync.lastError ? 'unreachable' : 'loading';
  if (Object.keys(sync.balances).some((id) => !sync.deniedProducts?.includes(id))) return 'rows';
  if (sync.deniedProducts?.length) return 'unavailable';
  return sync.lastError === null && sync.status === 'synced' ? 'empty' : 'empty-last-known';
}
