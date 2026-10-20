// Adapted in RC4 from the Director's uncommitted test in the main tree (sha256 fa4a1982ab28a393…, left unchanged
// there). Same flow and assertions, ported to the generation-based cache contract (F2): invalidation moves the
// product to a new cache generation instead of deleting keys, so the read after a write uses a new key.
import { StockService } from '../../src/infrastructure/repositories/stock.service';
import { ProductWarehouse } from '../../src/domain/entities/product-warehouse.entity';
import { StockMovement } from '../../src/domain/entities/stock-movement.entity';
import { Product } from '../../src/domain/entities/product.entity';
import { Warehouse } from '../../src/domain/entities/warehouse.entity';
import { RedisService } from '../../src/infrastructure/cache/redis.service';
import Decimal from 'decimal.js';
import { Repository } from 'typeorm';
import { MovementType, ReferenceType } from '@/shared/constants/enums';

describe('StockService - Cache Invalidation Integration', () => {
  let service: StockService;
  let pwRepo: Repository<ProductWarehouse>;
  let movementRepo: Repository<StockMovement>;
  let productRepo: Repository<Product>;
  let warehouseRepo: Repository<Warehouse>;
  let dataSource: any;
  let redisService: RedisService;
  let generation: string;

  const companyId = 'c1';
  const productId = 'p1';
  const warehouseId = 'w1';
  const userId = 'u1';

  beforeEach(() => {
    // Create mock repositories
    pwRepo = {
      findOne: jest.fn(),
      query: jest.fn(),
    } as any;

    movementRepo = {
      find: jest.fn(),
    } as any;

    productRepo = {
      findOne: jest.fn(),
    } as any;

    warehouseRepo = {
      findOne: jest.fn(),
    } as any;

    // Mock DataSource methods
    dataSource = {
      createQueryRunner: jest.fn(),
    } as any;

    // Mock RedisService (current contract: keys carry the product's cache generation)
    generation = 'g1';
    redisService = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      generateKey: jest.fn((prefix: string, ...args: string[]) => [prefix, ...args].join(':')),
      getGeneration: jest.fn(async () => generation),
      bumpGeneration: jest.fn(async () => {
        generation = 'g2';
      }),
    } as any;

    // Create the service instance with our mocks
    service = new StockService(
      pwRepo as any,
      movementRepo as any,
      productRepo as any,
      warehouseRepo as any,
      dataSource,
      redisService as any,
    );

    // Clear call history before each test (implementations are kept)
    jest.clearAllMocks();
  });

  describe('getBalance cache invalidation flow', () => {
    it('should verify DB fallback, cache hit, write operation, and cache invalidation', async () => {
      const keyBefore = `stock:balance:v2:${productId}:g1:${warehouseId}`;
      const keyAfter = `stock:balance:v2:${productId}:g2:${warehouseId}`;

      // === Step 1: Initial state - cache miss, query DB ===
      const balanceOf = (q: string) => ({
        productId, warehouseId, baseQuantity: q, reservedQuantity: '0.000000', availableQuantity: q,
      });
      const initialBalance = balanceOf('10.000000');
      const updatedBalance = balanceOf('60.000000'); // 10 + 50

      // Mock ownership validation for getBalance calls
      (productRepo.findOne as jest.Mock).mockResolvedValueOnce({ id: productId, companyId: companyId });
      (warehouseRepo.findOne as jest.Mock).mockResolvedValueOnce({ id: warehouseId, companyId: companyId });

      // First getBalance: cache miss -> query DB
      (redisService.get as jest.Mock).mockResolvedValueOnce(null);
      (pwRepo.query as jest.Mock).mockResolvedValueOnce([{ base_quantity: '10.000000' }]);

      let result = await service.getBalance(companyId, productId, warehouseId);

      expect(result).toEqual(initialBalance);
      expect(pwRepo.query).toHaveBeenCalledTimes(1);
      expect(redisService.get).toHaveBeenCalledTimes(1);
      expect(redisService.get).toHaveBeenCalledWith(keyBefore);
      expect(redisService.set).toHaveBeenCalledTimes(1);
      expect(redisService.set).toHaveBeenCalledWith(
        keyBefore,
        JSON.stringify(initialBalance),
        60, // TTL from stock.service.ts
      );

      // Reset call counts for next steps
      jest.clearAllMocks();
      // But we need to keep the repository return values for the next getBalance call
      (productRepo.findOne as jest.Mock).mockReturnValueOnce({ id: productId, companyId: companyId });
      (warehouseRepo.findOne as jest.Mock).mockReturnValueOnce({ id: warehouseId, companyId: companyId });

      // === Step 2: Second getBalance - cache hit ===
      (redisService.get as jest.Mock).mockResolvedValueOnce(JSON.stringify(initialBalance));

      result = await service.getBalance(companyId, productId, warehouseId);

      expect(result).toEqual(initialBalance);
      expect(pwRepo.query).not.toHaveBeenCalled(); // Should not hit DB
      expect(redisService.get).toHaveBeenCalledTimes(1);
      expect(redisService.get).toHaveBeenCalledWith(keyBefore);
      expect(redisService.set).not.toHaveBeenCalled(); // Should not set again

      // Reset call counts for the inbound operation
      jest.clearAllMocks();
      // Keep ownership mocks for inbound
      (productRepo.findOne as jest.Mock).mockReturnValue({ id: productId, companyId: companyId });
      (warehouseRepo.findOne as jest.Mock).mockReturnValue({ id: warehouseId, companyId: companyId });

      // === Step 3: Perform inbound operation (add 50) ===
      const inboundDto = { productId: productId, warehouseId: warehouseId, quantity: '50', notes: 'Test inbound' };

      // Mock the private methods used by inbound
      const validateOwnershipSpy = jest.spyOn(service as any, 'validateOwnership');
      const executeMoveSpy = jest.spyOn(service as any, 'executeMovement').mockResolvedValue({} as any);
      const invalidateCacheSpy = jest.spyOn(service as any, 'invalidateStockCache');

      await service.inbound(userId, companyId, inboundDto);

      // Validate ownership was called
      expect(validateOwnershipSpy).toHaveBeenCalledWith(companyId, productId, warehouseId);
      // Ensure executeMovement was called with correct parameters (we check the object roughly)
      expect(executeMoveSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: productId,
          warehouseId: warehouseId,
          userId: userId,
          movementType: MovementType.INBOUND,
          referenceType: ReferenceType.PURCHASE,
          quantityChange: expect.any(Decimal),
          notes: inboundDto.notes,
          autoCreateSlot: true,
        }),
      );
      // Most importantly, verify that cache invalidation was called for the product (all its warehouses)
      expect(invalidateCacheSpy).toHaveBeenCalledWith(productId);

      // Invalidation moves the product to a new cache generation (after the write has completed)
      expect(redisService.bumpGeneration).toHaveBeenCalledWith(`stock:${productId}`);
      expect(executeMoveSpy.mock.invocationCallOrder[0]).toBeLessThan(
        (redisService.bumpGeneration as jest.Mock).mock.invocationCallOrder[0],
      );

      // Reset call counts for the final getBalance
      jest.clearAllMocks();
      // Restore ownership mocks for the final getBalance
      (productRepo.findOne as jest.Mock).mockReturnValueOnce({ id: productId, companyId: companyId });
      (warehouseRepo.findOne as jest.Mock).mockReturnValueOnce({ id: warehouseId, companyId: companyId });

      // === Step 4: Final getBalance - should query DB again (new generation, so the old entry is never read) ===
      (redisService.get as jest.Mock).mockResolvedValueOnce(null);
      (pwRepo.query as jest.Mock).mockResolvedValueOnce([{ base_quantity: '60.000000' }]); // Updated balance

      result = await service.getBalance(companyId, productId, warehouseId);

      expect(result).toEqual(updatedBalance);
      expect(redisService.get).not.toHaveBeenCalledWith(keyBefore);
      expect(redisService.get).toHaveBeenCalledWith(keyAfter);
      expect(pwRepo.query).toHaveBeenCalledTimes(1); // Should hit DB again because cache was invalidated
      expect(redisService.get).toHaveBeenCalledTimes(1);
      expect(redisService.set).toHaveBeenCalledTimes(1);
      expect(redisService.set).toHaveBeenCalledWith(
        keyAfter,
        JSON.stringify(updatedBalance),
        60,
      );
    });
  });
});
