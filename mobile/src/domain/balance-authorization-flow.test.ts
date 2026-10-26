/** Production sync store/cache + TanStack Query + resolver. Platform, storage, current-account accessor and HTTP are mocked. */
import { QueryClient } from '@tanstack/react-query';
import { scopeKey } from './session-scope';
import { httpStatusOf } from './auth-flow';
import { resolveBalance } from './balance-truth';
import type { BalanceResponse } from '../api/types';

const mockDisk = new Map<string, string>();
let mockScope: string | null;
const mockGet = jest.fn();
jest.mock('react-native', () => ({ AppState: { addEventListener: jest.fn() } }));
jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('../api/client', () => ({ api: { get: (...args: unknown[]) => mockGet(...args) } }));
jest.mock('../sync/account-scope', () => ({ currentScopeKey: () => mockScope }));
jest.mock('../store/secure-storage', () => ({ getStorage: () => ({
  getString: (key: string) => mockDisk.get(key),
  set: (key: string, value: string) => mockDisk.set(key, value),
  delete: (key: string) => mockDisk.delete(key),
}) }));

import { forgetSyncCache, resetWarehouseSync, syncWarehouse, useWarehouseSyncStore } from '../sync/warehouse-sync';

const P = 'p'; const W = 'w';
const A = scopeKey({ api: '127.0.0.1', companyId: 'tenant-a', userId: 'staff-a' });
const B = scopeKey({ api: '127.0.0.1', companyId: 'tenant-b', userId: 'staff-b' });
const snapshot = {
  warehouseId: W, mode: 'snapshot', revision: '1', anchor: 'm1', hasMore: false, movements: [],
  balances: [{ productId: P, baseQuantity: '55', reservedQuantity: '0', availableQuantity: '55' }],
};
const cache = (scope: string) => JSON.parse(mockDisk.get(`stockmind-sync-v1|${scope}`) ?? '{}');
const syncInput = () => {
  const e = useWarehouseSyncStore.getState().entries[W];
  return e ? { ...e.sync, lastError: e.lastError, lastSuccessAt: e.lastSuccessAt } : null;
};
const prime = async () => {
  mockGet.mockResolvedValueOnce({ data: snapshot });
  await syncWarehouse(W);
  expect(cache(A).warehouses[W].sync.balances[P].baseQuantity).toBe('55');
};

beforeEach(() => { resetWarehouseSync(); mockScope = A; mockDisk.clear(); mockGet.mockReset(); });
afterEach(() => resetWarehouseSync());

it.each([403, 404])('direct %s is visible before a poll; the later poll purges this warehouse from memory/disk', async (status) => {
  await prime();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const queryKey = ['balance', P, W, 'online'];
  try {
    await qc.fetchQuery({ queryKey, queryFn: async (): Promise<BalanceResponse> => ({ productId: P, warehouseId: W, baseQuantity: '55' }) });
    await expect(qc.fetchQuery({ queryKey, queryFn: async () => { throw { response: { status } }; } })).rejects.toMatchObject({ response: { status } });
    const state = qc.getQueryState<BalanceResponse>(queryKey)!;
    expect(state.data?.baseQuantity).toBe('55');
    expect(useWarehouseSyncStore.getState().entries[W].lastError).toBeNull();
    expect(resolveBalance({ online: true, productId: P, warehouseId: W, sync: syncInput(),
      query: { status: state.status, data: state.data, errorStatus: httpStatusOf(state.error) } }))
      .toEqual({ state: 'unknown', reason: 'no-access' });

    mockGet.mockRejectedValueOnce({ response: { status } });
    await syncWarehouse(W);
    expect(syncInput()).toMatchObject({ balances: {}, revision: null, lastError: 'denied', lastSuccessAt: null });
    expect(cache(A).warehouses[W]).toBeUndefined();
  } finally { qc.clear(); }
});

it('poll denial is retained as no-access even when a direct query still has successful data', async () => {
  await prime();
  mockGet.mockRejectedValueOnce({ response: { status: 404 } });
  await syncWarehouse(W);
  expect(resolveBalance({ online: true, productId: P, warehouseId: W, sync: syncInput(),
    query: { status: 'success', data: { productId: P, warehouseId: W, baseQuantity: '55' } } }))
    .toEqual({ state: 'unknown', reason: 'no-access' });
  expect(cache(A).warehouses).toEqual({});
});

it('relaunch without network hydrates the last-known figure and preserves its confirmation time', async () => {
  await prime();
  const asOf = syncInput()!.lastSuccessAt;
  resetWarehouseSync();
  mockGet.mockRejectedValueOnce(new Error('offline'));
  await syncWarehouse(W);
  expect(resolveBalance({ online: true, productId: P, warehouseId: W, sync: syncInput(), query: { status: 'error' } }))
    .toEqual({ state: 'last-known', quantity: 55, asOf });
  expect(cache(A).warehouses[W].lastSuccessAt).toBe(asOf);
});

it('account/tenant reset does not hydrate another scope, and sign-out deletes only that account cache', async () => {
  await prime();
  resetWarehouseSync(); mockScope = B;
  mockGet.mockRejectedValueOnce(new Error('offline'));
  await syncWarehouse(W);
  expect(syncInput()).toMatchObject({ balances: {}, revision: null, lastError: 'network' });
  expect(resolveBalance({ online: true, productId: P, warehouseId: W, sync: syncInput(), query: { status: 'error' } }))
    .toEqual({ state: 'unknown', reason: 'unreachable' });
  expect(cache(A).warehouses[W].sync.balances[P].baseQuantity).toBe('55');
  forgetSyncCache(B);
  expect(cache(A).warehouses[W]).toBeDefined();
  forgetSyncCache(A);
  expect(mockDisk.has(`stockmind-sync-v1|${A}`)).toBe(false);
});

it('a poll in flight before a tenant switch cannot repopulate the new account state or cache', async () => {
  let finish!: (value: { data: typeof snapshot }) => void;
  mockGet.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const inFlight = syncWarehouse(W);
  resetWarehouseSync(); mockScope = B;
  finish({ data: snapshot });
  await inFlight;
  expect(useWarehouseSyncStore.getState().entries).toEqual({});
  expect(mockDisk.size).toBe(0);
});
