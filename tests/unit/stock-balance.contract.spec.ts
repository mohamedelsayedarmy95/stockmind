/**
 * GET /stock/balance/:productId/:warehouseId keeps the contract that production serves and the mobile app reads
 * (mobile/src/api/types.ts BalanceResponse): base, reserved and available quantity with 6 decimals, and zeros (not
 * 404) when the product has no stock row in that warehouse. The Redis caching change had replaced it with
 * { runningBalance }, which the app shows as NaN.
 */
import { StockService } from '../../src/infrastructure/repositories/stock.service';

const COMPANY = 'c1';
const PRODUCT = 'p1';
const WAREHOUSE = 'w1';

function setup(rows: Array<Record<string, string>>, cached: string | null = null) {
  const pwRepo = { query: jest.fn().mockResolvedValue(rows) };
  const redis = {
    get: jest.fn().mockResolvedValue(cached),
    set: jest.fn(),
    getGeneration: jest.fn().mockResolvedValue('g1'),
    generateKey: jest.fn((...parts: string[]) => parts.join(':')),
  };
  const owned = { findOne: jest.fn().mockResolvedValue({ id: 'x', companyId: COMPANY }) };
  const service = new StockService(pwRepo as never, {} as never, owned as never, owned as never, {} as never,
    redis as never);
  return { service, pwRepo, redis };
}

describe('stock balance contract', () => {
  it('returns base, reserved and available quantity for the product and warehouse', async () => {
    const { service } = setup([{ base_quantity: '12.500000', reserved_quantity: '2.000000' }]);
    await expect(service.getBalance(COMPANY, PRODUCT, WAREHOUSE)).resolves.toEqual({
      productId: PRODUCT,
      warehouseId: WAREHOUSE,
      baseQuantity: '12.500000',
      reservedQuantity: '2.000000',
      availableQuantity: '10.500000',
    });
  });

  it('returns zeros, not 404, when the product has no stock in that warehouse', async () => {
    const { service } = setup([]);
    await expect(service.getBalance(COMPANY, PRODUCT, WAREHOUSE)).resolves.toEqual({
      productId: PRODUCT,
      warehouseId: WAREHOUSE,
      baseQuantity: '0.000000',
      reservedQuantity: '0.000000',
      availableQuantity: '0.000000',
    });
  });

  it('caches under a versioned key, so entries in the old { runningBalance } shape are never served', async () => {
    const { service, redis } = setup([{ base_quantity: '1.000000', reserved_quantity: '0.000000' }]);
    await service.getBalance(COMPANY, PRODUCT, WAREHOUSE);
    const key = redis.set.mock.calls[0][0] as string;
    expect(key.startsWith('stock:balance:v2:')).toBe(true);
    expect(redis.get).toHaveBeenCalledWith(key);
  });
});
