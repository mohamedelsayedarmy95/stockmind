import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { create } from 'zustand';
import { api } from '@/api/client';
import { getStorage } from '@/store/secure-storage';
import { httpStatusOf } from '@/domain/auth-flow';
import { WriteRejection } from '@/domain/idempotent-write';
import { ChangesResponse, initialSyncState, WarehouseSyncState } from '@/domain/stock-sync';
import { PollError, pollWarehouse, syncDisplay } from '@/domain/sync-runner';
import { currentScopeKey } from './account-scope';

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
}

interface SyncStore {
  entries: Record<string, WarehouseSyncEntry>;
}

export const useWarehouseSyncStore = create<SyncStore>(() => ({ entries: {} }));

/** 30–60 s per the backend contract; polling (not sockets) because the free backend instance sleeps. */
export const STOCK_SCREEN_POLL_MS = 45_000;

// ── Per-account cache ────────────────────────────────────────────────────────
const CACHE_PREFIX = 'stockmind-sync-v1|';

interface CachedWarehouse {
  sync: WarehouseSyncState;
  lastSuccessAt: number;
}

function readCache(scope: string): Record<string, CachedWarehouse> {
  try {
    const raw = getStorage().getString(CACHE_PREFIX + scope);
    const doc = raw ? (JSON.parse(raw) as { warehouses?: Record<string, CachedWarehouse> }) : null;
    return doc?.warehouses ?? {};
  } catch {
    return {}; // a cache is disposable: the next poll rebuilds it from the server
  }
}

function writeCache(scope: string, warehouseId: string, entry: CachedWarehouse) {
  const warehouses = { ...readCache(scope), [warehouseId]: entry };
  getStorage().set(CACHE_PREFIX + scope, JSON.stringify({ warehouses }));
}

function dropCached(scope: string, warehouseId: string) {
  const { [warehouseId]: _dropped, ...rest } = readCache(scope);
  getStorage().set(CACHE_PREFIX + scope, JSON.stringify({ warehouses: rest }));
}

/** On an explicit sign-out: the figures can be fetched again; they should not stay on the device. */
export function forgetSyncCache(scope: string | null) {
  if (scope) getStorage().delete(CACHE_PREFIX + scope);
}

function entryOf(warehouseId: string): WarehouseSyncEntry {
  const live = useWarehouseSyncStore.getState().entries[warehouseId];
  if (live) return live;
  const scope = currentScopeKey();
  const cached = scope ? readCache(scope)[warehouseId] : undefined;
  return {
    // Older caches lack fields added since; fill them from the initial state.
    sync: cached ? { ...initialSyncState(warehouseId), ...cached.sync } : initialSyncState(warehouseId),
    inFlight: false,
    lastError: null,
    lastSuccessAt: cached?.lastSuccessAt ?? null,
    rejection: null,
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
  useWarehouseSyncStore.setState((s) => ({ entries: { ...s.entries, [warehouseId]: entry } }));
}

const running = new Map<string, Promise<void>>();
const again = new Set<string>();
/** Bumped on sign-out so a poll that was in flight cannot write the previous user's data back. */
let generation = 0;

async function runOnce(warehouseId: string, gen: number) {
  const scope = currentScopeKey();
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
  if (gen !== generation || scope !== currentScopeKey()) return;
  const now = Date.now();
  if (result.error === 'denied') {
    // Access revoked (or warehouse gone): its figures must not stay readable on this device.
    patch(warehouseId, { sync: initialSyncState(warehouseId), inFlight: false, lastError: 'denied', lastSuccessAt: null });
    if (scope) dropCached(scope, warehouseId);
    return;
  }
  patch(warehouseId, {
    sync: result.state,
    inFlight: false,
    lastError: result.error,
    ...(result.error ? {} : { lastSuccessAt: now }),
  });
  if (!result.error && scope) {
    writeCache(scope, warehouseId, { sync: result.state, lastSuccessAt: now });
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
      running.delete(warehouseId);
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
  useWarehouseSyncStore.setState({ entries: {} });
}

/**
 * Keeps one warehouse fresh while its stock screen is focused: a poll on focus, every STOCK_SCREEN_POLL_MS, and when
 * the app returns to the foreground. Pass enabled=false (offline mode) to do nothing.
 */
export function useWarehouseSync(warehouseId: string | undefined, enabled: boolean) {
  const entry = useWarehouseSyncStore((s) => (warehouseId ? s.entries[warehouseId] : undefined));
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

  const view = entry ?? (warehouseId ? entryOf(warehouseId) : null);
  return {
    entry: view,
    status: view ? syncDisplay(view) : null,
    refresh: () => (warehouseId ? syncWarehouse(warehouseId) : Promise.resolve()),
  };
}
