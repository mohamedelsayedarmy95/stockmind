/** Real secure-storage initialization + repositories + sync store + TanStack Query. Native engines/HTTP/account accessor mocked. */
import type { BalanceQueryInput } from './balance-truth';

const mockDisk = new Map<string, string>();
let mockScope: string | null = '127.0.0.1:3000|company-a|staff-a';
let mockServer = 'http://127.0.0.1:3000/api/v1';
let mockKey: string | null = null;
let mockWriteError = false;
const mockOpen = jest.fn();
const mockGet = jest.fn();
const mockNative = {
  getString: (key: string) => mockDisk.get(key),
  set: (key: string, value: string) => { if (mockWriteError) throw new Error('synthetic storage write failure'); mockDisk.set(key, value); },
  delete: (key: string) => { mockDisk.delete(key); },
  getAllKeys: () => [...mockDisk.keys()],
};
jest.mock('react-native-mmkv', () => ({ MMKV: class { constructor(options: unknown) { mockOpen(options); return mockNative; } } }));
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only', getItemAsync: async () => mockKey,
  setItemAsync: async (_alias: string, key: string) => { mockKey = key; },
}));
jest.mock('expo-crypto', () => ({ getRandomBytesAsync: async (n: number) => new Uint8Array(n).fill(7), randomUUID: () => 'synthetic-id' }));
jest.mock('react-native', () => ({ AppState: { addEventListener: jest.fn() } }));
jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('../api/client', () => ({ get BASE_URL() { return mockServer; }, api: { get: (...args: unknown[]) => mockGet(...args) } }));
jest.mock('../sync/account-scope', () => ({ currentScopeKey: () => mockScope }));
jest.mock('../sync/outbox-drain', () => ({ submitIntent: jest.fn() }));

const W = 'warehouse-a'; const P = 'product-a'; const Q = 'product-b';
const snapshot = (warehouseId = W) => ({ warehouseId, mode: 'snapshot', revision: '12', anchor: 'movement-12',
  hasMore: false, movements: [], balances: [P, Q].map((productId) => ({ productId, baseQuantity: '55', reservedQuantity: '0', availableQuantity: '55' })) });
const ok = (productId = P, warehouseId = W) => ({ productId, warehouseId, baseQuantity: '55' });

async function boot() {
  jest.resetModules(); // cold JS runtime; native disk/keystore mocks deliberately survive
  const storage = require('../store/secure-storage') as typeof import('../store/secure-storage');
  await storage.initSecureStorage();
  const sync = require('../sync/warehouse-sync') as typeof import('../sync/warehouse-sync');
  const repositories = (require('../data/api/api-repositories') as typeof import('../data/api/api-repositories')).apiRepositories;
  const balance = require('./balance-truth') as typeof import('./balance-truth');
  const read = (query: BalanceQueryInput = { status: 'pending' }, productId = P) => {
    const entry = sync.useWarehouseSyncStore.getState().entries[W];
    return balance.resolveBalance({ online: true, productId, warehouseId: W,
      sync: entry ? { ...entry, ...entry.sync } : null, query });
  };
  return { storage, sync, repositories, balance, read };
}
type Runtime = Awaited<ReturnType<typeof boot>>;
async function prime(runtime: Runtime) {
  mockGet.mockResolvedValueOnce({ data: snapshot() });
  await runtime.sync.syncWarehouse(W);
  expect(runtime.read()).toEqual({ state: 'confirmed', quantity: 55, source: 'server' });
}
async function offline(runtime: Runtime) {
  mockGet.mockRejectedValueOnce(new Error('offline'));
  await runtime.sync.syncWarehouse(W);
}

beforeEach(() => { mockDisk.clear(); mockKey = null; mockWriteError = false; mockOpen.mockClear(); mockGet.mockReset();
  mockScope = '127.0.0.1:3000|company-a|staff-a'; mockServer = 'http://127.0.0.1:3000/api/v1'; });

it('disk hydration is LAST-KNOWN even while the first poll is pending, and reuses the keystore key', async () => {
  let runtime = await boot(); await prime(runtime);
  const asOf = runtime.sync.useWarehouseSyncStore.getState().entries[W].lastSuccessAt;
  const originalKey = mockKey;
  runtime = await boot();
  expect(mockKey).toBe(originalKey);
  expect(mockOpen.mock.calls[0][0]).toEqual(mockOpen.mock.calls[1][0]);
  let finish!: (value: unknown) => void;
  mockGet.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const polling = runtime.sync.syncWarehouse(W);
  try { expect(runtime.read()).toEqual({ state: 'last-known', quantity: 55, asOf }); }
  finally { finish({ data: snapshot() }); await polling; }
  expect(runtime.read()).toEqual({ state: 'confirmed', quantity: 55, source: 'server' });
});

it.each([403, 404])('observed direct %s stays hidden across a cold runtime and offline restart before a warehouse poll', async (status) => {
  let runtime = await boot(); await prime(runtime);
  const { QueryClient } = require('@tanstack/react-query') as typeof import('@tanstack/react-query');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const queryKey = ['balance', P, W, 'online'];
  try {
    mockGet.mockResolvedValueOnce({ data: ok() });
    await qc.fetchQuery({ queryKey, queryFn: () => runtime.repositories.stock.balance(P, W) });
    mockGet.mockRejectedValueOnce({ response: { status } });
    await expect(qc.fetchQuery({ queryKey, queryFn: () => runtime.repositories.stock.balance(P, W) })).rejects.toMatchObject({ response: { status } });
    expect(runtime.read({ status: 'error', errorStatus: status, data: ok() })).toEqual({ state: 'unknown', reason: 'no-access' });
    // Close before any warehouse poll. React Query memory is intentionally lost, native storage is not.
    qc.clear(); runtime = await boot(); await offline(runtime);
    expect(runtime.read({ status: 'error' })).toEqual({ state: 'unknown', reason: 'no-access' });
    expect(runtime.read({ status: 'error' }, Q).state).toBe('last-known'); // ambiguous product 404 is not warehouse revocation
  } finally { qc.clear(); }
});

it('a warehouse-wide poll refusal remains denied after restart and later network failure', async () => {
  let runtime = await boot(); await prime(runtime);
  mockGet.mockRejectedValueOnce({ response: { status: 404 } });
  await runtime.sync.syncWarehouse(W);
  expect(runtime.read()).toEqual({ state: 'unknown', reason: 'no-access' });
  runtime = await boot(); await offline(runtime);
  expect(runtime.read({ status: 'success', data: ok() })).toEqual({ state: 'unknown', reason: 'no-access' });
  expect(runtime.read({ status: 'pending' }, Q)).toEqual({ state: 'unknown', reason: 'no-access' });
});

it('without observed denial offline cache remains readable and does not change an outbox record', async () => {
  let runtime = await boot(); await prime(runtime);
  mockDisk.set('stockmind-outbox-v1', 'synthetic-pending-intent');
  runtime = await boot(); await offline(runtime);
  expect(runtime.read({ status: 'error' }).state).toBe('last-known');
  expect(mockDisk.get('stockmind-outbox-v1')).toBe('synthetic-pending-intent');
});

it('product denial does not become warehouse revocation or disappear on a successful warehouse poll', async () => {
  const runtime = await boot(); await prime(runtime);
  mockGet.mockRejectedValueOnce({ response: { status: 404 } });
  await expect(runtime.repositories.stock.balance(P, W)).rejects.toMatchObject({ response: { status: 404 } });
  expect(runtime.read({ status: 'success', data: ok() })).toEqual({ state: 'unknown', reason: 'no-access' });
  expect(runtime.read({ status: 'pending' }, Q)).toMatchObject({ quantity: 55 });
  expect(runtime.sync.useWarehouseSyncStore.getState().entries[W].deniedWarehouse).toBe(false);
  mockGet.mockResolvedValueOnce({ data: snapshot() });
  await runtime.sync.syncWarehouse(W);
  expect(runtime.read()).toEqual({ state: 'unknown', reason: 'no-access' });
  expect(runtime.read({ status: 'pending' }, Q)).toEqual({ state: 'confirmed', quantity: 55, source: 'server' });
  const entry = runtime.sync.useWarehouseSyncStore.getState().entries[W];
  expect(runtime.balance.warehouseListState({ ...entry, ...entry.sync })).toBe('rows');
});

it.each([ok(Q), ok(P, 'other-warehouse'), { ...ok(), baseQuantity: '' }, { ...ok(), baseQuantity: 'NaN' }])(
  'a mismatched or invalid success cannot clear product denial: %j', async (response) => {
    let runtime = await boot(); await prime(runtime);
    mockGet.mockRejectedValueOnce({ response: { status: 403 } });
    await expect(runtime.repositories.stock.balance(P, W)).rejects.toBeDefined();
    mockGet.mockResolvedValueOnce({ data: response });
    await runtime.repositories.stock.balance(P, W);
    runtime = await boot(); await offline(runtime);
    expect(runtime.read({ status: 'success', data: ok() })).toEqual({ state: 'unknown', reason: 'no-access' });
  },
);

it('a fresh matching direct success lifts ONLY its product denial and survives another cold runtime', async () => {
  let runtime = await boot(); await prime(runtime);
  for (const productId of [P, Q]) {
    mockGet.mockRejectedValueOnce({ response: { status: 404 } });
    await expect(runtime.repositories.stock.balance(productId, W)).rejects.toBeDefined();
  }
  mockGet.mockResolvedValueOnce({ data: ok() });
  await runtime.repositories.stock.balance(P, W);
  runtime = await boot(); await offline(runtime);
  expect(runtime.read({ status: 'error' })).toMatchObject({ state: 'last-known', quantity: 55 });
  expect(runtime.read({ status: 'error' }, Q)).toEqual({ state: 'unknown', reason: 'no-access' });
});

it('warehouse denial requires a valid warehouse response to recover; network/5xx/mismatched snapshots do not lift it', async () => {
  const runtime = await boot(); await prime(runtime);
  mockGet.mockRejectedValueOnce({ response: { status: 403 } }); await runtime.sync.syncWarehouse(W);
  for (const response of [undefined, 503]) {
    mockGet.mockRejectedValueOnce(response ? { response: { status: response } } : new Error('offline'));
    await runtime.sync.syncWarehouse(W);
    expect(runtime.read()).toEqual({ state: 'unknown', reason: 'no-access' });
  }
  mockGet.mockResolvedValueOnce({ data: snapshot('other-warehouse') }); await runtime.sync.syncWarehouse(W);
  expect(runtime.read()).toEqual({ state: 'unknown', reason: 'no-access' });
  mockGet.mockResolvedValueOnce({ data: snapshot() }); await runtime.sync.syncWarehouse(W);
  expect(runtime.read()).toEqual({ state: 'confirmed', quantity: 55, source: 'server' });
});

it('a direct success started before a newer denial cannot clear its durable marker', async () => {
  let runtime = await boot(); await prime(runtime);
  let finish!: (value: unknown) => void;
  mockGet.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const old = runtime.repositories.stock.balance(P, W);
  mockGet.mockRejectedValueOnce({ response: { status: 404 } });
  await expect(runtime.repositories.stock.balance(P, W)).rejects.toMatchObject({ response: { status: 404 } });
  const rejected = expect(old).rejects.toThrow('STALE_BALANCE_RESPONSE');
  finish({ data: ok() }); await rejected;
  runtime = await boot(); await offline(runtime);
  expect(runtime.read()).toEqual({ state: 'unknown', reason: 'no-access' });
});

it('a poll started before a new direct denial cannot advance the snapshot/time afterwards', async () => {
  const runtime = await boot(); await prime(runtime);
  const before = runtime.sync.useWarehouseSyncStore.getState().entries[W];
  let finish!: (value: unknown) => void;
  mockGet.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const oldPoll = runtime.sync.syncWarehouse(W);
  mockGet.mockRejectedValueOnce({ response: { status: 403 } });
  await expect(runtime.repositories.stock.balance(P, W)).rejects.toBeDefined();
  finish({ data: { ...snapshot(), revision: '13', balances: snapshot().balances.map((b) => ({ ...b, baseQuantity: '99' })) } });
  await oldPoll;
  const after = runtime.sync.useWarehouseSyncStore.getState().entries[W];
  expect(after.sync).toEqual(before.sync);
  expect(after.lastSuccessAt).toBe(before.lastSuccessAt);
  expect(runtime.read()).toEqual({ state: 'unknown', reason: 'no-access' });
});

it.each(['127.0.0.1:3000|company-a|staff-b', '127.0.0.1:3000|company-b|staff-a', '127.0.0.2:3000|company-a|staff-a'])(
  'a new scope cannot inherit stock or denials, and a late response cannot contaminate it: %s', async (nextScope) => {
    const runtime = await boot(); await prime(runtime);
    let finish!: (value: unknown) => void;
    mockGet.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const old = runtime.repositories.stock.balance(P, W);
    mockScope = nextScope;
    await offline(runtime); // ensureScope isolates even without an auth subscription
    const rejected = expect(old).rejects.toThrow('STALE_BALANCE_RESPONSE');
    finish({ data: ok() }); await rejected;
    expect(runtime.read({ status: 'error' })).toEqual({ state: 'unknown', reason: 'unreachable' });
  },
);

it('same-host endpoint changes isolate both live stock and durable denials', async () => {
  const runtime = await boot(); await prime(runtime);
  mockGet.mockRejectedValueOnce({ response: { status: 404 } });
  await expect(runtime.repositories.stock.balance(P, W)).rejects.toBeDefined();
  mockServer = 'http://127.0.0.1:3000/another/api'; await offline(runtime);
  expect(runtime.read({ status: 'error' })).toEqual({ state: 'unknown', reason: 'unreachable' });
  mockServer = 'http://127.0.0.1:3000/api/v1'; await offline(runtime);
  expect(runtime.read()).toEqual({ state: 'unknown', reason: 'no-access' });
});

it('explicit sign-out cache cleanup leaves no stock to revive, and never touches queued operations', async () => {
  let runtime = await boot(); await prime(runtime);
  mockGet.mockRejectedValueOnce({ response: { status: 404 } });
  await expect(runtime.repositories.stock.balance(P, W)).rejects.toBeDefined();
  mockDisk.set('stockmind-outbox-v1', 'synthetic-pending-intent');
  runtime.sync.forgetSyncCache(mockScope); runtime.sync.resetWarehouseSync();
  runtime = await boot(); await offline(runtime);
  expect(runtime.read({ status: 'error' })).toEqual({ state: 'unknown', reason: 'unreachable' });
  expect(mockDisk.get('stockmind-outbox-v1')).toBe('synthetic-pending-intent');
});

it('a write failure during denial removes the old cache document and keeps the live denial', async () => {
  let runtime = await boot(); await prime(runtime);
  mockWriteError = true;
  mockGet.mockRejectedValueOnce({ response: { status: 404 } });
  await expect(runtime.repositories.stock.balance(P, W)).rejects.toThrow('synthetic storage write failure');
  expect(runtime.read()).toEqual({ state: 'unknown', reason: 'no-access' });
  mockWriteError = false; runtime = await boot(); await offline(runtime);
  expect(runtime.read({ status: 'error' })).toEqual({ state: 'unknown', reason: 'unreachable' });
});

it('v1 stock with missing provenance/denial history is not silently migrated, and corrupt v2 denial metadata fails closed', async () => {
  let runtime = await boot(); await prime(runtime);
  const key = [...mockDisk.keys()].find((key) => key.startsWith('stockmind-sync-v2|'))!;
  const document = JSON.parse(mockDisk.get(key)!);
  mockDisk.set(`stockmind-sync-v1|${mockScope}`, JSON.stringify(document)); mockDisk.delete(key);
  runtime = await boot(); await offline(runtime);
  expect(runtime.read({ status: 'error' })).toEqual({ state: 'unknown', reason: 'unreachable' });
  delete document.warehouses[W].deniedProducts;
  mockDisk.set(key, JSON.stringify(document)); runtime = await boot(); await offline(runtime);
  expect(runtime.read({ status: 'error' })).toEqual({ state: 'unknown', reason: 'unreachable' });
});

it('the same visibility rule hides denied stock rows, recent movements and outbox server figures', async () => {
  const runtime = await boot(); await prime(runtime);
  mockGet.mockRejectedValueOnce({ response: { status: 404 } });
  await expect(runtime.repositories.stock.balance(P, W)).rejects.toBeDefined();
  const entry = runtime.sync.useWarehouseSyncStore.getState().entries[W];
  expect([P, Q].filter((id) => runtime.balance.isCachedStockVisible(entry, id))).toEqual([Q]);
  expect(runtime.balance.warehouseListState({ ...entry, ...entry.sync, deniedProducts: [P, Q] })).toBe('unavailable');
  expect([P, Q].filter((id) => runtime.balance.isCachedStockVisible({ ...entry, deniedWarehouse: true }, id))).toEqual([]);
});

it('a late denial from a previous session never creates a tombstone in the new session', async () => {
  const runtime = await boot(); await prime(runtime);
  let refuse!: (error: unknown) => void;
  mockGet.mockImplementationOnce(() => new Promise((_resolve, reject) => { refuse = reject; }));
  const old = runtime.repositories.stock.balance(P, W);
  mockScope = '127.0.0.1:3000|company-b|staff-b'; await offline(runtime);
  const rejected = expect(old).rejects.toMatchObject({ response: { status: 404 } });
  refuse({ response: { status: 404 } }); await rejected;
  const entry = runtime.sync.useWarehouseSyncStore.getState().entries[W];
  expect(entry.deniedProducts).toEqual([]);
  expect(entry.deniedWarehouse).toBe(false);
});

it('reset permits a new account poll immediately; the old poll cannot delete its single-flight tracking', async () => {
  const runtime = await boot(); await prime(runtime);
  let finishOld!: (value: unknown) => void; let finishNew!: (value: unknown) => void;
  mockGet.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
  const old = runtime.sync.syncWarehouse(W);
  mockScope = '127.0.0.1:3000|company-b|staff-b';
  mockGet.mockImplementationOnce(() => new Promise((resolve) => { finishNew = resolve; }));
  const fresh = runtime.sync.syncWarehouse(W);
  finishOld({ data: snapshot() }); await old;
  const coalesced = runtime.sync.syncWarehouse(W);
  expect(coalesced).toBe(fresh);
  mockGet.mockResolvedValueOnce({ data: snapshot() }); // coalescing schedules exactly one follow-up
  finishNew({ data: snapshot() }); await fresh;
  expect(runtime.sync.useWarehouseSyncStore.getState().scope).toBe(mockScope);
  expect(runtime.read()).toEqual({ state: 'confirmed', quantity: 55, source: 'server' });
});
