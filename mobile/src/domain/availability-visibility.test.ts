/** Execute the production hook with mocked React hooks; retained data comes from a real TanStack QueryClient. No mounted UI. */
import { useQuery } from '@tanstack/react-query';
import { useAvailability } from '../query/useStock';

let mockSource: 'online' | 'offline' = 'online';
let mockScope = 'server|company-a|staff-a';
let mockEntry: { lastError: null; deniedWarehouse: boolean; deniedProducts: string[] };
jest.mock('@tanstack/react-query', () => ({ ...jest.requireActual('@tanstack/react-query'), useQuery: jest.fn() }));
jest.mock('../data/repository-provider', () => ({ activeSource: () => mockSource, getRepositories: jest.fn() }));
jest.mock('../sync/account-scope', () => ({ useCurrentScopeKey: () => mockScope }));
jest.mock('../sync/warehouse-sync', () => ({ useWarehouseEntry: () => mockEntry, onOwnWriteRejected: jest.fn(), onOwnWriteSucceeded: jest.fn() }));
jest.mock('../api/client', () => ({ BASE_URL: 'http://127.0.0.1:3000/api/v1' }));

beforeEach(() => {
  jest.mocked(useQuery).mockReset(); mockSource = 'online'; mockScope = 'server|company-a|staff-a';
  mockEntry = { lastError: null, deniedWarehouse: false, deniedProducts: [] };
});

async function retainFailedRefetch() {
  const { QueryClient, QueryObserver } = jest.requireActual('@tanstack/react-query') as typeof import('@tanstack/react-query');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const queryKey = ['availability', 'p', 'w', 'online'];
  await qc.fetchQuery({ queryKey, queryFn: async () => ({ onHand: 55, reserved: 0, available: 55 }) });
  await expect(qc.fetchQuery({ queryKey, queryFn: async () => { throw { response: { status: 404 } }; } })).rejects.toMatchObject({ response: { status: 404 } });
  const result = new QueryObserver(qc, { queryKey, enabled: false }).getCurrentResult();
  expect(result.data).toEqual({ onHand: 55, reserved: 0, available: 55 });
  jest.mocked(useQuery).mockReturnValue(result);
  return qc;
}

it.each(['product', 'warehouse'])('known %s denial hides retained availability quantities', async (kind) => {
  const qc = await retainFailedRefetch();
  try {
    if (kind === 'product') mockEntry.deniedProducts = ['p']; else mockEntry.deniedWarehouse = true;
    expect(useAvailability('p', 'w').data).toBeUndefined();
  } finally { qc.clear(); }
});

it('authorized cached availability stays usable after a transient refetch failure', async () => {
  const qc = await retainFailedRefetch();
  try { expect(useAvailability('p', 'w').data).toEqual({ onHand: 55, reserved: 0, available: 55 }); }
  finally { qc.clear(); }
});

it('offline device availability ignores the online denial overlay', async () => {
  const qc = await retainFailedRefetch();
  try {
    mockSource = 'offline'; mockEntry.deniedWarehouse = true;
    expect(useAvailability('p', 'w').data).toEqual({ onHand: 55, reserved: 0, available: 55 });
  } finally { qc.clear(); }
});

it('availability query identity includes account and full endpoint, so another company cannot reuse it', async () => {
  const qc = await retainFailedRefetch();
  try {
    useAvailability('p', 'w');
    const first = jest.mocked(useQuery).mock.calls[0][0].queryKey;
    mockScope = 'server|company-b|staff-a'; useAvailability('p', 'w');
    const next = jest.mocked(useQuery).mock.calls[1][0].queryKey;
    expect(first).not.toEqual(next);
    expect(next).toContain('http://127.0.0.1:3000/api/v1');
  } finally { qc.clear(); }
});
