import { StockService } from '../../src/infrastructure/repositories/stock.service';
import { ProductWarehouse } from '../../src/domain/entities/product-warehouse.entity';
import { StockMovement } from '../../src/domain/entities/stock-movement.entity';
import { Product } from '../../src/domain/entities/product.entity';
import { Warehouse } from '../../src/domain/entities/warehouse.entity';
import { RedisService } from '../../src/infrastructure/cache/redis.service';
import { ConflictException, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { Repository } from 'typeorm';
import { MovementType, ReferenceType } from '@/shared/constants/enums';

describe('StockService', () => {
  let service: StockService;
  let pwRepo: Repository<ProductWarehouse>;
  let movementRepo: Repository<StockMovement>;
  let productRepo: Repository<Product>;
  let warehouseRepo: Repository<Warehouse>;
  let dataSource: any; // We'll mock the DataSource methods we need
  let redisService: RedisService;

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

    // Mock RedisService
    redisService = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      generateKey: jest.fn(),
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

    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  describe('getBalance', () => {
    it('should return cached balance if available', async () => {
      const cachedBalance = { runningBalance: '10.000000' };
      // Mock ownership validation to pass
      (productRepo.findOne as jest.Mock).mockResolvedValueOnce({ id: 'p1', companyId: 'c1' });
      (warehouseRepo.findOne as jest.Mock).mockResolvedValueOnce({ id: 'w1', companyId: 'c1' });

      (redisService.get as jest.Mock).mockResolvedValueOnce(JSON.stringify(cachedBalance));
      (redisService.generateKey as jest.Mock).mockReturnValueOnce('mock-key');

      const result = await service.getBalance('c1', 'p1', 'w1');

      expect(result).toEqual(cachedBalance);
      expect(redisService.get).toHaveBeenCalledWith('mock-key');
      expect(pwRepo.query).not.toHaveBeenCalled();
    });

    it('should fetch from DB and cache when cache miss', async () => {
      const dbBalance = { runningBalance: '5.000000' };
      // Mock ownership validation to pass
      (productRepo.findOne as jest.Mock).mockResolvedValueOnce({ id: 'p1', companyId: 'c1' });
      (warehouseRepo.findOne as jest.Mock).mockResolvedValueOnce({ id: 'w1', companyId: 'c1' });

      (redisService.get as jest.Mock).mockResolvedValueOnce(null);
      (pwRepo.query as jest.Mock).mockResolvedValueOnce([{ base_quantity: '5.000000' }]);
      (redisService.generateKey as jest.Mock).mockReturnValueOnce('mock-key');

      const result = await service.getBalance('c1', 'p1', 'w1');

      expect(result).toEqual(dbBalance);
      expect(pwRepo.query).toHaveBeenCalledWith(
        `SELECT base_quantity FROM product_warehouse
       WHERE product_id = $1 AND warehouse_id = $2`,
        ['p1', 'w1'],
      );
      expect(redisService.set).toHaveBeenCalledWith(
        'mock-key',
        JSON.stringify(dbBalance),
        60,
      );
    });

    it('should throw NotFoundException if stock record not found', async () => {
      // Mock ownership validation to pass (so we can test the stock record not found case)
      (productRepo.findOne as jest.Mock).mockResolvedValueOnce({ id: 'p1', companyId: 'c1' });
      (warehouseRepo.findOne as jest.Mock).mockResolvedValueOnce({ id: 'w1', companyId: 'c1' });

      (redisService.get as jest.Mock).mockResolvedValueOnce(null);
      (pwRepo.query as jest.Mock).mockResolvedValueOnce([]);

      await expect(service.getBalance('c1', 'p1', 'w1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getMovements', () => {
    it('should return cached movements if available', async () => {
      const cachedMoves = [{ id: '1' }];
      (productRepo.findOne as jest.Mock).mockResolvedValueOnce({ id: 'p1', companyId: 'c1' });

      (redisService.get as jest.Mock).mockResolvedValueOnce(JSON.stringify(cachedMoves));
      (redisService.generateKey as jest.Mock).mockReturnValueOnce('mock-key');

      const result = await service.getMovements('c1', 'p1');

      expect(result).toEqual(cachedMoves);
      expect(redisService.generateKey).toHaveBeenCalledWith('stock:movements:v2', 'p1', 'all');
      expect(redisService.get).toHaveBeenCalledWith('mock-key');
      expect(warehouseRepo.findOne).not.toHaveBeenCalled();
      expect(movementRepo.find).not.toHaveBeenCalled();
    });

    it('should fetch from DB and cache only the allowlisted DTO when cache miss', async () => {
      const dbMoves = [
        {
          id: '1',
          productId: 'p1',
          warehouseId: 'w1',
          userId: 'u1',
          movementType: MovementType.INBOUND,
          referenceType: ReferenceType.PURCHASE,
          referenceId: null,
          quantityChange: '5.000000',
          runningBalance: '5.000000',
          notes: null,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          warehouse: { id: 'w1', name: 'Main', address: 'private' },
          user: { id: 'u1', name: 'Alice', email: 'a@x.test', passwordHash: 'secret-hash' },
        },
      ];
      (redisService.get as jest.Mock).mockResolvedValueOnce(null);
      (productRepo.findOne as jest.Mock).mockResolvedValueOnce({ id: 'p1', companyId: 'c1' });
      (movementRepo.find as jest.Mock).mockResolvedValueOnce(dbMoves);
      (redisService.generateKey as jest.Mock).mockReturnValueOnce('mock-key');

      const result = await service.getMovements('c1', 'p1');

      expect(result[0].user).toEqual({ id: 'u1', name: 'Alice' });
      expect(result[0].warehouse).toEqual({ id: 'w1', name: 'Main' });
      expect(warehouseRepo.findOne).not.toHaveBeenCalled();
      expect(movementRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { productId: 'p1' },
          order: { createdAt: 'DESC' },
          relations: ['warehouse', 'user'],
          select: expect.objectContaining({ user: { id: true, name: true }, warehouse: { id: true, name: true } }),
        }),
      );
      expect(redisService.set).toHaveBeenCalledWith('mock-key', JSON.stringify(result), 30);
      const cachedPayload = (redisService.set as jest.Mock).mock.calls[0][1] as string;
      expect(cachedPayload).not.toContain('secret-hash');
      expect(cachedPayload).not.toContain('a@x.test');
      expect(cachedPayload).not.toContain('private');
    });

    it('should filter by warehouseId when provided', async () => {
      (redisService.get as jest.Mock).mockResolvedValueOnce(null);

      // Mock ownership validation to pass
      (productRepo.findOne as jest.Mock).mockResolvedValueOnce({ id: 'p1', companyId: 'c1' });
      (warehouseRepo.findOne as jest.Mock).mockResolvedValueOnce({ id: 'w1', companyId: 'c1' });

      (movementRepo.find as jest.Mock).mockResolvedValueOnce([]);
      (redisService.generateKey as jest.Mock).mockImplementation((prefix, productId, warehouseId) => {
        return `${prefix}:${productId}:${warehouseId}`;
      });

      await service.getMovements('c1', 'p1', 'w1');

      expect(warehouseRepo.findOne).toHaveBeenCalledWith({ where: { id: 'w1', companyId: 'c1' } });
      expect(redisService.get).toHaveBeenCalledWith('stock:movements:v2:p1:w1');
      expect(movementRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { productId: 'p1', warehouseId: 'w1' },
          order: { createdAt: 'DESC' },
          relations: ['warehouse', 'user'],
        }),
      );
    });

    it('should reject a warehouse filter outside the caller company', async () => {
      (productRepo.findOne as jest.Mock).mockResolvedValueOnce({ id: 'p1', companyId: 'c1' });
      (warehouseRepo.findOne as jest.Mock).mockResolvedValueOnce(null);

      await expect(service.getMovements('c1', 'p1', 'w-other')).rejects.toThrow(NotFoundException);
      expect(redisService.get).not.toHaveBeenCalled();
      expect(movementRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('inbound', () => {
    const userId = 'u1';
    const companyId = 'c1';
    const dto = { productId: 'p1', warehouseId: 'w1', quantity: '10', notes: 'Test inbound' };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should throw ConflictException if quantity <= 0', async () => {
      // Mock ownership validation to pass
      (productRepo.findOne as jest.Mock).mockResolvedValueOnce({ id: 'p1', companyId: 'c1' });
      (warehouseRepo.findOne as jest.Mock).mockResolvedValueOnce({ id: 'w1', companyId: 'c1' });

      await expect(
        service.inbound(userId, companyId, { ...dto, quantity: '0' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should call validateOwnership and executeMovement', async () => {
      // Mock ownership validation to pass
      (productRepo.findOne as jest.Mock).mockResolvedValueOnce({ id: 'p1', companyId: 'c1' });
      (warehouseRepo.findOne as jest.Mock).mockResolvedValueOnce({ id: 'w1', companyId: 'c1' });

      // Mock the private methods
      const validateOwnershipSpy = jest.spyOn(
        service as any,
        'validateOwnership',
      );
      const executeMoveSpy = jest.spyOn(
        service as any,
        'executeMovement',
      ).mockResolvedValue({} as any);

      await service.inbound(userId, companyId, dto);

      expect(validateOwnershipSpy).toHaveBeenCalledWith(
        companyId,
        dto.productId,
        dto.warehouseId,
      );
      expect(executeMoveSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: dto.productId,
          warehouseId: dto.warehouseId,
          userId,
          movementType: MovementType.INBOUND,
          referenceType: ReferenceType.PURCHASE,
          quantityChange: expect.any(Decimal),
          notes: dto.notes,
          autoCreateSlot: true,
        }),
      );
    });

    it('should invalidate cache after successful execution', async () => {
      // Mock ownership validation to pass
      (productRepo.findOne as jest.Mock).mockResolvedValueOnce({ id: 'p1', companyId: 'c1' });
      (warehouseRepo.findOne as jest.Mock).mockResolvedValueOnce({ id: 'w1', companyId: 'c1' });

      // Mock the private methods
      const validateOwnershipSpy = jest.spyOn(
        service as any,
        'validateOwnership',
      );
      const executeMoveSpy = jest.spyOn(
        service as any,
        'executeMovement',
      ).mockResolvedValue({} as any);
      const invalidateCacheSpy = jest.spyOn(
        service as any,
        'invalidateStockCache',
      );

      await service.inbound(userId, companyId, dto);

      expect(validateOwnershipSpy).toHaveBeenCalledWith(
        companyId,
        dto.productId,
        dto.warehouseId,
      );
      expect(executeMoveSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: dto.productId,
          warehouseId: dto.warehouseId,
          userId,
          movementType: MovementType.INBOUND,
          referenceType: ReferenceType.PURCHASE,
          quantityChange: expect.any(Decimal),
          notes: dto.notes,
          autoCreateSlot: true,
        }),
      );
      expect(invalidateCacheSpy).toHaveBeenCalledWith(
        dto.productId,
        [dto.warehouseId],
      );
    });
  });
});