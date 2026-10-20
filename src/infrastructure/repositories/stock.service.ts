import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, QueryRunner } from 'typeorm';
import Decimal from 'decimal.js';
import { ProductWarehouse } from '../../domain/entities/product-warehouse.entity';
import { StockMovement } from '../../domain/entities/stock-movement.entity';
import { Product } from '../../domain/entities/product.entity';
import { Warehouse } from '../../domain/entities/warehouse.entity';
import { MovementType, ReferenceType } from '../../shared/constants/enums';
import { InboundDto } from '../../application/dtos/stock/inbound.dto';
import { OutboundDto } from '../../application/dtos/stock/outbound.dto';
import { AdjustmentDto } from '../../application/dtos/stock/adjustment.dto';
import { TransferDto } from '../../application/dtos/stock/transfer.dto';
import {
  MovementResponseDto,
  toMovementResponse,
} from '../../application/dtos/stock/movement-response.dto';
import { randomUUID } from 'crypto';
import { RedisService } from '../../infrastructure/cache/redis.service';

// v2: entries hold the allowlisted MovementResponseDto. Earlier 'stock:movements'
// entries could hold raw entities with credential columns, so they are never read.
const MOVEMENTS_CACHE_PREFIX = 'stock:movements:v2';
// v2: the contract production serves and the mobile app reads. Earlier 'stock:balance' entries held only
// { runningBalance }, so they are never read.
const BALANCE_CACHE_PREFIX = 'stock:balance:v2';

export interface StockBalance {
  productId: string;
  warehouseId: string;
  baseQuantity: string;
  reservedQuantity: string;
  availableQuantity: string;
}

// Consistency model: no read that starts after a stock write has been acknowledged returns pre-write data.
// Cached balances and movement lists are keyed by the product's cache generation, which a reader fetches BEFORE
// it reads the database. A write moves the product to a new generation only after its transaction commits and
// before it returns. A value read before that commit can therefore only be stored under the old generation, which
// is never read again; if the generation cannot be moved, RedisService stops using the cache altogether.
const stockCacheScope = (productId: string) => `stock:${productId}`;

@Injectable()
export class StockService {
  constructor(
    @InjectRepository(ProductWarehouse)
    private readonly pwRepo: Repository<ProductWarehouse>,
    @InjectRepository(StockMovement)
    private readonly movementRepo: Repository<StockMovement>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(Warehouse)
    private readonly warehouseRepo: Repository<Warehouse>,
    private readonly dataSource: DataSource,
    private readonly redisService: RedisService,
  ) {}

  private async validateOwnership(
    companyId: string,
    productId: string,
    warehouseId: string,
  ) {
    // Validate product belongs to company
    const product = await this.productRepo.findOne({
      where: { id: productId, companyId },
    });
    if (!product) {
      throw new NotFoundException('Product not found or access denied');
    }

    // Validate warehouse belongs to company
    const warehouse = await this.warehouseRepo.findOne({
      where: { id: warehouseId, companyId },
    });
    if (!warehouse) {
      throw new NotFoundException('Warehouse not found or access denied');
    }
  }

  // Call only after the write's transaction has committed (see the consistency model above). It retires every
  // cached balance and movement list of the product, across all warehouses.
  private async invalidateStockCache(productId: string) {
    await this.redisService.bumpGeneration(stockCacheScope(productId));
  }

  // Null when the cache is unavailable for this read: the caller then neither reads nor writes an entry.
  private async stockCacheKey(prefix: string, productId: string, subKey: string): Promise<string | null> {
    const generation = await this.redisService.getGeneration(stockCacheScope(productId));
    return generation === null ? null : this.redisService.generateKey(prefix, productId, generation, subKey);
  }

  async inbound(userId: string, companyId: string, dto: InboundDto) {
    await this.validateOwnership(companyId, dto.productId, dto.warehouseId);

    const qty = new Decimal(dto.quantity);
    if (qty.lte(0)) {
      throw new ConflictException('Quantity must be greater than zero');
    }

    const result = await this.executeMovement({
      productId: dto.productId,
      warehouseId: dto.warehouseId,
      userId,
      movementType: MovementType.INBOUND,
      referenceType: ReferenceType.PURCHASE,
      quantityChange: qty,
      notes: dto.notes ?? null,
      autoCreateSlot: true,
    });

    // The transaction has committed: retire cached reads of this product
    await this.invalidateStockCache(dto.productId);

    return result;
  }

  async outbound(userId: string, companyId: string, dto: OutboundDto) {
    await this.validateOwnership(companyId, dto.productId, dto.warehouseId);

    const qty = new Decimal(dto.quantity);
    if (qty.lte(0)) {
      throw new ConflictException('Quantity must be greater than zero');
    }

    const result = await this.executeMovement({
      productId: dto.productId,
      warehouseId: dto.warehouseId,
      userId,
      movementType: MovementType.OUTBOUND,
      referenceType: ReferenceType.SALE,
      quantityChange: qty.neg(),
      notes: dto.notes ?? null,
      autoCreateSlot: false,
    });

    // The transaction has committed: retire cached reads of this product
    await this.invalidateStockCache(dto.productId);

    return result;
  }

  async adjustment(userId: string, companyId: string, dto: AdjustmentDto) {
    await this.validateOwnership(companyId, dto.productId, dto.warehouseId);

    const qty = new Decimal(dto.quantity);
    if (qty.isZero()) {
      throw new ConflictException('Adjustment quantity cannot be zero');
    }

    const result = await this.executeMovement({
      productId: dto.productId,
      warehouseId: dto.warehouseId,
      userId,
      movementType: MovementType.ADJUSTMENT,
      referenceType: ReferenceType.COUNT,
      quantityChange: qty,
      notes: dto.reason,
      autoCreateSlot: true,
    });

    // The transaction has committed: retire cached reads of this product
    await this.invalidateStockCache(dto.productId);

    return result;
  }

  async transfer(userId: string, companyId: string, dto: TransferDto) {
    if (dto.fromWarehouseId === dto.toWarehouseId) {
      throw new ConflictException('Source and destination warehouses must differ');
    }
    await this.validateOwnership(companyId, dto.productId, dto.fromWarehouseId);
    await this.validateOwnership(companyId, dto.productId, dto.toWarehouseId);

    const qty = new Decimal(dto.quantity);
    if (qty.lte(0)) {
      throw new ConflictException('Quantity must be greater than zero');
    }

    const referenceId = randomUUID();
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    let result: { referenceId: string; out: StockMovement; in: StockMovement };
    try {
      // Ensure destination slot exists
      await qr.query(
        `INSERT INTO product_warehouse (id, product_id, warehouse_id, base_quantity, reserved_quantity)
         VALUES (gen_random_uuid(), $1, $2, 0, 0)
         ON CONFLICT (product_id, warehouse_id) DO NOTHING`,
        [dto.productId, dto.toWarehouseId],
      );

      // Lock BOTH rows in deterministic order to avoid deadlocks
      const [srcId, dstId] =
        dto.fromWarehouseId < dto.toWarehouseId
          ? [dto.fromWarehouseId, dto.toWarehouseId]
          : [dto.toWarehouseId, dto.fromWarehouseId];

      await qr.query(
        `SELECT id FROM product_warehouse
         WHERE product_id = $1 AND warehouse_id IN ($2, $3)
         ORDER BY warehouse_id
         FOR UPDATE`,
        [dto.productId, srcId, dstId],
      );

      // Read source balance
      const srcRows: Array<Record<string, unknown>> = await qr.query(
        `SELECT base_quantity FROM product_warehouse
         WHERE product_id = $1 AND warehouse_id = $2`,
        [dto.productId, dto.fromWarehouseId],
      );
      if (!srcRows.length) throw new NotFoundException('Source stock row missing');
      const srcBalance = new Decimal(srcRows[0].base_quantity as string);
      const newSrcBalance = srcBalance.minus(qty);
      if (newSrcBalance.lt(0)) throw new ConflictException('Insufficient stock');

      // Read destination balance
      const dstRows: Array<Record<string, unknown>> = await qr.query(
        `SELECT base_quantity FROM product_warehouse
         WHERE product_id = $1 AND warehouse_id = $2`,
        [dto.productId, dto.toWarehouseId],
      );
      const dstBalance = new Decimal(dstRows[0].base_quantity as string);
      const newDstBalance = dstBalance.plus(qty);

      // Ledger: OUT leg
      const outResult = await qr.query(
        `INSERT INTO stock_movements
           (id, product_id, warehouse_id, user_id, movement_type, reference_type, reference_id, quantity_change, running_balance, notes)
         VALUES
           (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          dto.productId, dto.fromWarehouseId, userId,
          MovementType.TRANSFER_OUT, ReferenceType.TRANSFER, referenceId,
          qty.neg().toFixed(6), newSrcBalance.toFixed(6),
          dto.notes ?? `Transfer to warehouse ${dto.toWarehouseId}`,
        ],
      );

      // Ledger: IN leg
      const inResult = await qr.query(
        `INSERT INTO stock_movements
           (id, product_id, warehouse_id, user_id, movement_type, reference_type, reference_id, quantity_change, running_balance, notes)
         VALUES
           (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          dto.productId, dto.toWarehouseId, userId,
          MovementType.TRANSFER_IN, ReferenceType.TRANSFER, referenceId,
          qty.toFixed(6), newDstBalance.toFixed(6),
          dto.notes ?? `Transfer from warehouse ${dto.fromWarehouseId}`,
        ],
      );

      // Update balances
      await qr.query(
        `UPDATE product_warehouse SET base_quantity = $1
         WHERE product_id = $2 AND warehouse_id = $3`,
        [newSrcBalance.toFixed(6), dto.productId, dto.fromWarehouseId],
      );
      await qr.query(
        `UPDATE product_warehouse SET base_quantity = $1
         WHERE product_id = $2 AND warehouse_id = $3`,
        [newDstBalance.toFixed(6), dto.productId, dto.toWarehouseId],
      );

      await qr.commitTransaction();

      result = {
        referenceId,
        out: this.toMovementEntity(outResult[0]),
        in: this.toMovementEntity(inResult[0]),
      };
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }

    // The transaction has committed: retire cached reads of this product (both warehouses)
    await this.invalidateStockCache(dto.productId);
    return result;
  }

  // ──────────────────────────────────────────────────────────────
  //  Atomic Ledger Engine — the sacred transaction
  // ──────────────────────────────────────────────────────────────

  private async executeMovement(params: {
    productId: string;
    warehouseId: string;
    userId: string;
    movementType: MovementType;
    referenceType: ReferenceType;
    quantityChange: Decimal;
    notes: string | null;
    autoCreateSlot: boolean;
  }): Promise<StockMovement> {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      // Step 0: auto-create ProductWarehouse row if needed (atomic upsert)
      if (params.autoCreateSlot) {
        await qr.query(
          `INSERT INTO product_warehouse (id, product_id, warehouse_id, base_quantity, reserved_quantity)
           VALUES (gen_random_uuid(), $1, $2, 0, 0)
           ON CONFLICT (product_id, warehouse_id) DO NOTHING`,
          [params.productId, params.warehouseId],
        );
      }

      // Step 1: SELECT FOR UPDATE — pessimistic lock on the inventory row
      const rows: Array<Record<string, unknown>> = await qr.query(
        `SELECT * FROM product_warehouse
         WHERE product_id = $1 AND warehouse_id = $2
         FOR UPDATE`,
        [params.productId, params.warehouseId],
      );

      if (!rows.length) {
        throw new NotFoundException('Product is not registered in this warehouse');
      }

      const pw = rows[0];
      const currentBalance = new Decimal(pw.base_quantity as string);

      // Step 2: calculate new balance
      const newBalance = currentBalance.plus(params.quantityChange);

      // Step 3: enforce non-negative constraint
      if (newBalance.lt(0)) {
        throw new ConflictException('Insufficient stock');
      }

      // Step 4: insert immutable ledger entry
      const movementResult = await qr.query(
        `INSERT INTO stock_movements
           (id, product_id, warehouse_id, user_id, movement_type, reference_type, quantity_change, running_balance, notes)
         VALUES
           (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          params.productId,
          params.warehouseId,
          params.userId,
          params.movementType,
          params.referenceType,
          params.quantityChange.toFixed(6),
          newBalance.toFixed(6),
          params.notes,
        ],
      );

      // Step 5: update ProductWarehouse balance
      await qr.query(
        `UPDATE product_warehouse SET base_quantity = $1
         WHERE product_id = $2 AND warehouse_id = $3`,
        [newBalance.toFixed(6), params.productId, params.warehouseId],
      );

      // Step 6: commit
      await qr.commitTransaction();

      return this.toMovementEntity(movementResult[0]);
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  }

  private toMovementEntity(row: Record<string, unknown>): StockMovement {
    const m = new StockMovement();
    m.id = row.id as string;
    m.productId = row.product_id as string;
    m.warehouseId = row.warehouse_id as string;
    m.userId = row.user_id as string;
    m.movementType = row.movement_type as MovementType;
    m.referenceType = row.reference_type as ReferenceType;
    m.quantityChange = row.quantity_change as string;
    m.runningBalance = row.running_balance as string;
    m.notes = row.notes as string | null;
    m.createdAt = row.created_at as Date;
    return m;
  }

  // Cache methods for stock data
  async getBalance(
    companyId: string,
    productId: string,
    warehouseId: string,
  ): Promise<StockBalance> {
    // Validate ownership
    await this.validateOwnership(companyId, productId, warehouseId);

    // Try to get from cache (the key carries the generation, fetched before the database read)
    const cacheKey = await this.stockCacheKey(BALANCE_CACHE_PREFIX, productId, warehouseId);
    const cached = cacheKey === null ? null : await this.redisService.get(cacheKey);
    if (cached !== null) {
      return JSON.parse(cached);
    }

    // Cache miss: fetch from DB. No stock row in this warehouse yet means a zero balance, not an error.
    const rows: Array<Record<string, unknown>> = await this.pwRepo.query(
      `SELECT base_quantity, reserved_quantity FROM product_warehouse
       WHERE product_id = $1 AND warehouse_id = $2`,
      [productId, warehouseId],
    );
    const base = new Decimal((rows[0]?.base_quantity as string | undefined) ?? 0);
    const reserved = new Decimal((rows[0]?.reserved_quantity as string | undefined) ?? 0);
    const result: StockBalance = {
      productId,
      warehouseId,
      baseQuantity: base.toFixed(6),
      reservedQuantity: reserved.toFixed(6),
      availableQuantity: base.minus(reserved).toFixed(6),
    };

    // Save to cache with TTL 60 seconds
    if (cacheKey !== null) {
      await this.redisService.set(cacheKey, JSON.stringify(result), 60);
    }

    return result;
  }

  async getMovements(
    companyId: string,
    productId: string,
    warehouseId?: string,
  ): Promise<MovementResponseDto[]> {
    // The product must belong to the caller's company; the warehouse is checked
    // only when the caller filters by one.
    const product = await this.productRepo.findOne({
      where: { id: productId, companyId },
    });
    if (!product) {
      throw new NotFoundException('Product not found or access denied');
    }
    if (warehouseId) {
      const warehouse = await this.warehouseRepo.findOne({
        where: { id: warehouseId, companyId },
      });
      if (!warehouse) {
        throw new NotFoundException('Warehouse not found or access denied');
      }
    }

    // Build cache key: use 'all' if warehouseId is not provided
    const cacheKey = await this.stockCacheKey(MOVEMENTS_CACHE_PREFIX, productId, warehouseId ?? 'all');
    const cached = cacheKey === null ? null : await this.redisService.get(cacheKey);
    if (cached !== null) {
      return JSON.parse(cached);
    }

    // Cache miss: fetch from DB
    const where: any = { productId };
    if (warehouseId) {
      where.warehouseId = warehouseId;
    }
    const movements = await this.movementRepo.find({
      where,
      order: { createdAt: 'DESC' },
      relations: ['warehouse', 'user'],
      // Never read credential or contact columns of the acting user.
      select: {
        id: true,
        productId: true,
        warehouseId: true,
        userId: true,
        movementType: true,
        referenceType: true,
        referenceId: true,
        quantityChange: true,
        runningBalance: true,
        notes: true,
        createdAt: true,
        warehouse: { id: true, name: true },
        user: { id: true, name: true },
      },
    });
    const result = movements.map(toMovementResponse);

    // Save to cache with TTL 30 seconds (only the allowlisted DTO is cached)
    if (cacheKey !== null) {
      await this.redisService.set(cacheKey, JSON.stringify(result), 30);
    }

    return result;
  }
}