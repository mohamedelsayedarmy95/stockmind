import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { create } from 'zustand';
import { api, BASE_URL } from '@/api/client';
import type { BalanceResponse } from '@/api/types';
import { httpStatusOf } from '@/domain/auth-flow';
import { WriteRejection } from '@/domain/idempotent-write';
import { ChangesResponse, initialSyncState, WarehouseSyncState } from '@/domain/stock-sync';
import { PollError, pollWarehouse, syncDisplay } from '@/domain/sync-runner';
import { currentScopeKey, useCurrentScopeKey } from './account-scope';
import { forgetWarehouseCache, readWarehouseCache, writeWarehouseCache } from './warehouse-cache';

/**
 * Online stock state per warehouse, reconciled from GET /stock/changes/:warehouseId. Polls run on app foreground,
 * after the user's own write, and on an interval while a stock screen is focused (see useWarehouseSync).
 *
 * The last confirmed state is also cached per account (encrypted MMKV), so a relaunch without network shows the
 * last synced figures - labelled Offline with their time - and resumes from the same cursor. The server stays the
 * authority: the cache only replaces "nothing" until the next poll, and an explicit sign-out deletes it.
 */
export interface WarehouseSyncEntry {
  sync: WarehouseSyncState;
  inFlight: boolean;
  lastError: PollError | null;
  /** When the last poll completed without error (epoch ms). */
  lastSuccessAt: number | null;
  rejection: WriteRejection | null;
  deniedWarehouse: boolean;
  deniedProducts: string[];
}

interface SyncStore {
  scope: string | null;
  server: string;
  entries: Record<string, WarehouseSyncEntry>;
}

export const useWarehouseSyncStore = create<SyncStore>(() => ({ scope: null, server: BASE_URL, entries: {} }));

/** 30–60 s per the backend contract; polling (not sockets) because the free backend instance sleeps. */
export const STOCK_SCREEN_POLL_MS = 45_000;

/** On an explicit sign-out: the figures can be fetched again; they should not stay on the device. */
export const forgetSyncCache = forgetWarehouseCache;

function entryOf(warehouseId: string): WarehouseSyncEntry {
  const scope = currentScopeKey();
  const store = useWarehouseSyncStore.getState();
  const live = store.scope === scope && store.server === BASE_URL ? store.entries[warehouseId] : undefined;
  if (live) return live;
  const cached = scope ? readWarehouseCache(scope)[warehouseId] : undefined;
  return {
    // A previous runtime's snapshot is last-known until THIS runtime receives a valid server poll.
    sync: cached ? { ...cached.sync, status: 'catching-up' } : initialSyncState(warehouseId),
    inFlight: false,
    lastError: cached?.deniedWarehouse ? 'denied' : null,
    lastSuccessAt: cached?.lastSuccessAt ?? null,
    rejection: null,
    deniedWarehouse: cached?.deniedWarehouse ?? false,
    deniedProducts: cached?.deniedProducts ?? [],
  };
}

const pollListeners = new Set<() => void>();
const resetListeners = new Set<(warehouseId: string) => void>();
const POLL_TIMEOUT_MS = 60_000;

/** Called after every poll that reached the server: proof the network works (the outbox drains on it). */
export function onPollSucceeded(listener: () => void): () => void {
  pollListeners.add(listener);
  return () => pollListeners.delete(listener);
}

/** Called when the server answers a warehouse's cursor with a reset (its history was restored or rebuilt). */
export function onHistoryReset(listener: (warehouseId: string) => void): () => void {
  resetListeners.add(listener);
  return () => resetListeners.delete(listener);
}

function patch(warehouseId: string, change: Partial<WarehouseSyncEntry>) {
  const entry = { ...entryOf(warehouseId), ...change };
  const scope = currentScopeKey();
  useWarehouseSyncStore.setState((s) => ({ scope, server: BASE_URL, entries: { ...(s.scope === scope && s.server === BASE_URL ? s.entries : {}), [warehouseId]: entry } }));
}

function persist(warehouseId: string) {
  const scope = currentScopeKey();
  if (!scope) return;
  try {
    writeWarehouseCache(scope, warehouseId, entryOf(warehouseId));
  } catch (err) {
    // If a deny cannot be written, discard the old stock document instead of leaving an unmarked snapshot to revive.
    forgetWarehouseCache(scope);
    throw err;
  }
}

const running = new Map<string, Promise<void>>();
const again = new Set<string>();
/** Bumped on sign-out so a poll that was in flight cannot write the previous user's data back. */
let generation = 0;
const accessVersions = new Map<string, number>();

function ensureScope() {
  const store = useWarehouseSyncStore.getState();
  if (store.scope !== currentScopeKey() || store.server !== BASE_URL) resetWarehouseSync();
}

/** Direct 403/404 is ambiguous: durably deny just this product/warehouse, never infer warehouse-wide revocation. */
export async function fetchWarehouseBalance(productId: string, warehouseId: string, fetch: () => Promise<BalanceResponse>): Promise<BalanceResponse> {
  ensureScope();
  const scope = currentScopeKey();
  if (!scope) throw new Error('NO_ONLINE_SESSION');
  const gen = generation;
  const server = BASE_URL;
  const version = accessVersions.get(warehouseId) ?? 0;
  patch(warehouseId, {}); // hydrate/publish before a request: disk state is last-known even while it waits
  const sameSession = () => gen === generation && scope === currentScopeKey() && server === BASE_URL;
  try {
    const data = await fetch();
    if (!sameSession() || version !== (accessVersions.get(warehouseId) ?? 0)) throw new Error('STALE_BALANCE_RESPONSE');
    // Only a matching, usable server success can lift a product denial. A warehouse denial needs a valid poll snapshot.
    if (data.productId === productId && data.warehouseId === warehouseId && data.baseQuantity.trim() !== '' && Number.isFinite(Number(data.baseQuantity))) {
      const entry = entryOf(warehouseId);
      if (entry.deniedProducts.includes(productId)) {
        patch(warehouseId, { deniedProducts: entry.deniedProducts.filter((id) => id !== productId), sync: { ...entry.sync, status: 'catching-up' } });
        persist(warehouseId);
      }
    }
    return data;
  } catch (err) {
    const status = httpStatusOf(err);
    if (sameSession() && (status === 403 || status === 404)) {
      accessVersions.set(warehouseId, (accessVersions.get(warehouseId) ?? 0) + 1);
      const entry = entryOf(warehouseId);
      patch(warehouseId, { deniedProducts: [...new Set([...entry.deniedProducts, productId])] });
      persist(warehouseId);
    }
    throw err;
  }
}

async function runOnce(warehouseId: string, gen: number) {
  const scope = currentScopeKey();
  const server = BASE_URL;
  if (!scope) return;
  const version = accessVersions.get(warehouseId) ?? 0;
  patch(warehouseId, { inFlight: true });
  const before = entryOf(warehouseId).sync;
  const result = await pollWarehouse(
    before,
    async (query) => {
      // A free-tier backend can take ~40 s to wake; a poll that waits is cheaper than one that fails and repeats.
      const { data } = await api.get<ChangesResponse>(`/stock/changes/${warehouseId}`, {
        params: query,
        timeout: POLL_TIMEOUT_MS,
      });
      return data;
    },
    { statusOf: httpStatusOf },
  );
  if (gen !== generation || scope !== currentScopeKey() || server !== BASE_URL) return;
  if (version !== (accessVersions.get(warehouseId) ?? 0)) {
    patch(warehouseId, { inFlight: false }); // a poll started before a new denial cannot undo it
    return;
  }
  const now = Date.now();
  if (result.error === 'denied') {
    // Access revoked (or warehouse gone): its figures must not stay readable on this device.
    accessVersions.set(warehouseId, version + 1);
    patch(warehouseId, { sync: initialSyncState(warehouseId), inFlight: false, lastError: 'denied', lastSuccessAt: null, deniedWarehouse: true });
    persist(warehouseId); // keep the deny even after stock itself has been purged
    return;
  }
  const deniedWarehouse = entryOf(warehouseId).deniedWarehouse && (result.error !== null || result.state.revision === null);
  patch(warehouseId, {
    sync: result.state,
    inFlight: false,
    lastError: deniedWarehouse ? 'denied' : result.error,
    deniedWarehouse,
    ...(result.error ? {} : { lastSuccessAt: now }),
  });
  if (!result.error && scope) {
    persist(warehouseId);
    // The server rejected our cursor: what we once saw confirmed in this warehouse must be re-checked.
    if (result.state.resets > before.resets) for (const listener of resetListeners) listener(warehouseId);
    for (const listener of pollListeners) listener();
  }
}

/**
 * Polls one warehouse. Single-flight: a request made while a poll runs schedules exactly one more poll afterwards,
 * so a write that lands mid-poll is still picked up.
 */
export function syncWarehouse(warehouseId: string): Promise<void> {
  ensureScope();
  const current = running.get(warehouseId);
  if (current) {
    again.add(warehouseId);
    return current;
  }
  const gen = generation;
  const task = (async () => {
    try {
      do {
        again.delete(warehouseId);
        await runOnce(warehouseId, gen);
      } while (again.has(warehouseId) && gen === generation);
    } finally {
      if (gen === generation) running.delete(warehouseId);
    }
  })();
  running.set(warehouseId, task);
  return task;
}

/** After the user's own successful write: the rejection (if any) is resolved and the warehouse is re-polled. */
export function onOwnWriteSucceeded(warehouseId: string) {
  patch(warehouseId, { rejection: null });
  void syncWarehouse(warehouseId);
}

export function onOwnWriteRejected(warehouseId: string, rejection: WriteRejection) {
  patch(warehouseId, { rejection });
  // The refusal may mean our figures are stale (someone else dispatched first): catch up.
  void syncWarehouse(warehouseId);
}

export function dismissRejection(warehouseId: string) {
  patch(warehouseId, { rejection: null });
}

/** On sign-in/sign-out: forget every warehouse so one user's figures never show for another. */
export function resetWarehouseSync() {
  generation++;
  again.clear();
  running.clear();
  accessVersions.clear();
  useWarehouseSyncStore.setState({ scope: currentScopeKey(), server: BASE_URL, entries: {} });
}

/** Cache-only reactive view, also used by screens that do not own a warehouse poll. No cross-account live entry reuse. */
export function useWarehouseEntry(warehouseId: string | undefined, enabled = true) {
  const scope = useCurrentScopeKey();
  const entry = useWarehouseSyncStore((s) => (enabled && scope && s.scope === scope && s.server === BASE_URL && warehouseId ? s.entries[warehouseId] : undefined));
  return entry ?? (enabled && scope && warehouseId ? entryOf(warehouseId) : undefined);
}

/**
 * Keeps one warehouse fresh while its stock screen is focused: a poll on focus, every STOCK_SCREEN_POLL_MS, and when
 * the app returns to the foreground. Pass enabled=false (offline mode) to do nothing.
 */
export function useWarehouseSync(warehouseId: string | undefined, enabled: boolean) {
  const entry = useWarehouseEntry(warehouseId, enabled);
  const focused = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (!enabled || !warehouseId) return undefined;
      focused.current = true;
      void syncWarehouse(warehouseId);
      const timer = setInterval(() => void syncWarehouse(warehouseId), STOCK_SCREEN_POLL_MS);
      return () => {
        focused.current = false;
        clearInterval(timer);
      };
    }, [enabled, warehouseId]),
  );

  useEffect(() => {
    if (!enabled || !warehouseId) return undefined;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && focused.current) void syncWarehouse(warehouseId);
    });
    return () => sub.remove();
  }, [enabled, warehouseId]);

  const view = entry ?? (enabled && currentScopeKey() && warehouseId ? entryOf(warehouseId) : null);
  return {
    entry: view,
    status: view ? syncDisplay(view) : null,
    refresh: () => (warehouseId ? syncWarehouse(warehouseId) : Promise.resolve()),
  };
}
