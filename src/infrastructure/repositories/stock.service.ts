import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
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
import { randomUUID } from 'crypto';

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
  ) {}

  async inbound(userId: string, companyId: string, dto: InboundDto) {
    await this.validateOwnership(companyId, dto.productId, dto.warehouseId);

    const qty = new Decimal(dto.quantity);
    if (qty.lte(0)) {
      throw new ConflictException('Quantity must be greater than zero');
    }

    return this.executeMovement({
      productId: dto.productId,
      warehouseId: dto.warehouseId,
      userId,
      movementType: MovementType.INBOUND,
      referenceType: ReferenceType.PURCHASE,
      quantityChange: qty,
      notes: dto.notes ?? null,
      autoCreateSlot: true,
    });
  }

  async outbound(userId: string, companyId: string, dto: OutboundDto) {
    await this.validateOwnership(companyId, dto.productId, dto.warehouseId);

    const qty = new Decimal(dto.quantity);
    if (qty.lte(0)) {
      throw new ConflictException('Quantity must be greater than zero');
    }

    return this.executeMovement({
      productId: dto.productId,
      warehouseId: dto.warehouseId,
      userId,
      movementType: MovementType.OUTBOUND,
      referenceType: ReferenceType.SALE,
      quantityChange: qty.neg(),
      notes: dto.notes ?? null,
      autoCreateSlot: false,
    });
  }

  async adjustment(userId: string, companyId: string, dto: AdjustmentDto) {
    await this.validateOwnership(companyId, dto.productId, dto.warehouseId);

    const qty = new Decimal(dto.quantity);
    if (qty.isZero()) {
      throw new ConflictException('Adjustment quantity cannot be zero');
    }

    return this.executeMovement({
      productId: dto.productId,
      warehouseId: dto.warehouseId,
      userId,
      movementType: MovementType.ADJUSTMENT,
      referenceType: ReferenceType.COUNT,
      quantityChange: qty,
      notes: dto.reason,
      autoCreateSlot: true,
    });
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

      return {
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
  }

  async getBalance(companyId: string, productId: string, warehouseId: string) {
    await this.validateOwnership(companyId, productId, warehouseId);

    const pw = await this.pwRepo.findOne({
      where: { productId, warehouseId },
    });

    if (!pw) {
      return {
        productId,
        warehouseId,
        baseQuantity: '0.000000',
        reservedQuantity: '0.000000',
        availableQuantity: '0.000000',
      };
    }

    const base = new Decimal(pw.baseQuantity);
    const reserved = new Decimal(pw.reservedQuantity);

    return {
      productId,
      warehouseId,
      baseQuantity: base.toFixed(6),
      reservedQuantity: reserved.toFixed(6),
      availableQuantity: base.minus(reserved).toFixed(6),
    };
  }

  async getMovements(companyId: string, productId: string) {
    const product = await this.productRepo.findOne({
      where: { id: productId, companyId },
    });
    if (!product) throw new NotFoundException('Product not found');

    return this.movementRepo.find({
      where: { productId },
      order: { createdAt: 'DESC' },
      relations: ['warehouse', 'user'],
    });
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

  private async validateOwnership(
    companyId: string,
    productId: string,
    warehouseId: string,
  ) {
    const [product, warehouse] = await Promise.all([
      this.productRepo.findOne({ where: { id: productId, companyId } }),
      this.warehouseRepo.findOne({ where: { id: warehouseId, companyId } }),
    ]);
    if (!product) throw new NotFoundException('Product not found');
    if (!warehouse) throw new NotFoundException('Warehouse not found');
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
}
