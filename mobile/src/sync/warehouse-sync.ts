import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { create } from 'zustand';
import { api } from '@/api/client';
import { httpStatusOf } from '@/domain/auth-flow';
import { WriteRejection } from '@/domain/idempotent-write';
import { ChangesResponse, initialSyncState, WarehouseSyncState } from '@/domain/stock-sync';
import { PollError, pollWarehouse, syncDisplay } from '@/domain/sync-runner';

/**
 * Online stock state per warehouse, reconciled from GET /stock/changes/:warehouseId. In memory only: the server is the
 * authority, so a cold start begins with a snapshot. Polls run on app foreground, after the user's own write, and on
 * an interval while a stock screen is focused (see useWarehouseSync).
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

function entryOf(warehouseId: string): WarehouseSyncEntry {
  return (
    useWarehouseSyncStore.getState().entries[warehouseId] ?? {
      sync: initialSyncState(warehouseId),
      inFlight: false,
      lastError: null,
      lastSuccessAt: null,
      rejection: null,
    }
  );
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
  patch(warehouseId, { inFlight: true });
  const result = await pollWarehouse(
    entryOf(warehouseId).sync,
    async ({ since, limit }) => {
      const { data } = await api.get<ChangesResponse>(`/stock/changes/${warehouseId}`, {
        params: since === undefined ? { limit } : { since, limit },
      });
      return data;
    },
    { statusOf: httpStatusOf },
  );
  if (gen !== generation) return;
  patch(warehouseId, {
    sync: result.state,
    inFlight: false,
    lastError: result.error,
    ...(result.error ? {} : { lastSuccessAt: Date.now() }),
  });
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
