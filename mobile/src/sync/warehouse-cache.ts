import { BASE_URL } from '@/api/client';
import { getStorage } from '@/store/secure-storage';
import type { WarehouseSyncState } from '@/domain/stock-sync';

/** v2 includes durable resource denials. Bind the full endpoint as well as server/company/user account scope. */
export const warehouseCacheKey = (scope: string): string => `stockmind-sync-v2|${encodeURIComponent(BASE_URL)}|${scope}`;

export interface CachedWarehouse {
  sync: WarehouseSyncState;
  lastSuccessAt: number | null;
  deniedWarehouse: boolean;
  deniedProducts: string[];
}

export function readWarehouseCache(scope: string): Record<string, CachedWarehouse> {
  const raw = getStorage().getString(warehouseCacheKey(scope));
  if (!raw) return {};
  try {
    const doc = JSON.parse(raw) as { warehouses?: Record<string, CachedWarehouse> };
    if (!doc?.warehouses || typeof doc.warehouses !== 'object' || Array.isArray(doc.warehouses)) return {};
    return Object.fromEntries(Object.entries(doc.warehouses).filter(([id, entry]) =>
      entry && typeof entry.deniedWarehouse === 'boolean' && Array.isArray(entry.deniedProducts)
      && entry.deniedProducts.every((productId) => typeof productId === 'string')
      && (entry.lastSuccessAt === null || Number.isFinite(entry.lastSuccessAt))
      && entry.sync?.warehouseId === id && (entry.sync.revision === null || typeof entry.sync.revision === 'string')
      && entry.sync.balances && typeof entry.sync.balances === 'object' && !Array.isArray(entry.sync.balances)
      && Array.isArray(entry.sync.recent)));
  } catch {
    return {}; // unreadable data is unknown, never a quantity or permission grant
  }
}

/** One synchronous encrypted-document write stores stock AND denial state; a restart cannot hydrate stock without its deny. */
export function writeWarehouseCache(scope: string, warehouseId: string, entry: CachedWarehouse) {
  const { sync, lastSuccessAt, deniedWarehouse, deniedProducts } = entry;
  const warehouses = { ...readWarehouseCache(scope), [warehouseId]: { sync, lastSuccessAt, deniedWarehouse, deniedProducts } };
  getStorage().set(warehouseCacheKey(scope), JSON.stringify({ warehouses }));
}

export function forgetWarehouseCache(scope: string | null) {
  if (!scope) return;
  getStorage().delete(warehouseCacheKey(scope));
  // v1 had neither endpoint provenance nor durable denials: do not hydrate it after upgrade.
  getStorage().delete(`stockmind-sync-v1|${scope}`);
}
