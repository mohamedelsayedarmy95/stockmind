import {
  Injectable,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, QueryRunner, In } from 'typeorm';
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
import { createHash, randomUUID } from 'crypto';
import { RedisService } from '../../infrastructure/cache/redis.service';
import { assertActorAuthorized } from '../security/actor-guard';
import { lockMemberShared } from '../security/member-lock';
import { MOVEMENT_CAPABILITY } from '../../shared/constants/capabilities.constant';
import { PERMISSIONS } from '../../shared/constants/permissions.constant';

// v2: entries hold the allowlisted MovementResponseDto. Earlier 'stock:movements'
// entries could hold raw entities with credential columns, so they are never read.
const MOVEMENTS_CACHE_PREFIX = 'stock:movements:v2';
// v2: the contract production serves and the mobile app reads. Earlier 'stock:balance' entries held only
// { runningBalance }, so they are never read.
const BALANCE_CACHE_PREFIX = 'stock:balance:v2';

/** Options of a stock write. A repeated Idempotency-Key replays the first result instead of writing again. */
export interface StockWriteOptions {
  idempotencyKey?: string;
}

/** A write's result as the API returns it; `replayed` marks a response served from an earlier request. */
export type WriteResult<T> = T & { replayed?: true };

/** What one ledger write needs; see StockService.applyMovementInTransaction. */
export interface MovementParams {
  productId: string;
  warehouseId: string;
  userId: string;
  movementType: MovementType;
  referenceType: ReferenceType;
  quantityChange: Decimal;
  notes: string | null;
  autoCreateSlot: boolean;
}

export const requestHash = (kind: string, dto: object) =>
  createHash('sha256')
    .update(JSON.stringify([kind, Object.entries(dto).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : 1))]))
    .digest('hex');

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
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  async inbound(userId: string, companyId: string, dto: InboundDto, options: StockWriteOptions = {}) {
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
      companyId,
      idempotency: this.idempotency(options, 'inbound', dto),
    });
    if (result.replayed) return result;

    // The transaction has committed: retire cached reads of this product
    await this.invalidateStockCache(dto.productId);

    return result;
  }

  async outbound(userId: string, companyId: string, dto: OutboundDto, options: StockWriteOptions = {}) {
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
      companyId,
      idempotency: this.idempotency(options, 'outbound', dto),
    });
    if (result.replayed) return result;

    // The transaction has committed: retire cached reads of this product
    await this.invalidateStockCache(dto.productId);

    return result;
  }

  async adjustment(userId: string, companyId: string, dto: AdjustmentDto, options: StockWriteOptions = {}) {
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
      companyId,
      idempotency: this.idempotency(options, 'adjustment', dto),
    });
    if (result.replayed) return result;

    // The transaction has committed: retire cached reads of this product
    await this.invalidateStockCache(dto.productId);

    return result;
  }

  async transfer(userId: string, companyId: string, dto: TransferDto, options: StockWriteOptions = {}) {
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

    const idempotency = this.idempotency(options, 'transfer', dto);
    let result: WriteResult<{ referenceId: string; out: StockMovement; in: StockMovement }>;
    try {
      await lockMemberShared(qr, userId); // first, as in executeMovement
      if (idempotency) {
        const replay = await this.claimIdempotencyKey(qr, companyId, userId, idempotency);
        if (replay !== undefined) {
          await qr.rollbackTransaction();
          return { ...(replay as typeof result), replayed: true };
        }
      }

      // The actor must still be active AND still hold the transfer capability on BOTH warehouses when this write commits
      // (see assertActorAuthorized); before any warehouse lock.
      await assertActorAuthorized(qr, {
        userId, companyId, capability: PERMISSIONS.STOCK_TRANSFER, warehouseIds: [dto.fromWarehouseId, dto.toWarehouseId],
      });

      // Both warehouses' revisions, in id order like the stock rows below (no lock-order deadlock).
      const revisions = new Map<string, string>();
      for (const id of [dto.fromWarehouseId, dto.toWarehouseId].sort()) {
        revisions.set(id, await this.bumpRevision(qr, id));
      }

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
           (id, product_id, warehouse_id, user_id, movement_type, reference_type, reference_id, quantity_change, running_balance, notes,
            revision)
         VALUES
           (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          dto.productId, dto.fromWarehouseId, userId,
          MovementType.TRANSFER_OUT, ReferenceType.TRANSFER, referenceId,
          qty.neg().toFixed(6), newSrcBalance.toFixed(6),
          dto.notes ?? `Transfer to warehouse ${dto.toWarehouseId}`,
          revisions.get(dto.fromWarehouseId),
        ],
      );

      // Ledger: IN leg
      const inResult = await qr.query(
        `INSERT INTO stock_movements
           (id, product_id, warehouse_id, user_id, movement_type, reference_type, reference_id, quantity_change, running_balance, notes,
            revision)
         VALUES
           (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          dto.productId, dto.toWarehouseId, userId,
          MovementType.TRANSFER_IN, ReferenceType.TRANSFER, referenceId,
          qty.toFixed(6), newDstBalance.toFixed(6),
          dto.notes ?? `Transfer from warehouse ${dto.fromWarehouseId}`,
          revisions.get(dto.toWarehouseId),
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

      result = {
        referenceId,
        out: this.toMovementEntity(outResult[0]),
        in: this.toMovementEntity(inResult[0]),
      };
      if (idempotency) await this.storeIdempotentResponse(qr, companyId, userId, idempotency, result);

      await qr.commitTransaction();
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

  private async executeMovement(params: MovementParams & {
    companyId: string;
    idempotency?: { key: string; hash: string };
  }): Promise<WriteResult<StockMovement>> {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      // The member's authority lock is the FIRST thing this transaction takes (see member-lock.ts): the idempotency insert
      // below key-shares the member's row through its foreign key, and a revocation that already queued for the lock must
      // not be able to wait on that row while we wait on the lock.
      await lockMemberShared(qr, params.userId);
      // Idempotency first: a duplicate waits here for the first request's outcome, then replays it.
      if (params.idempotency) {
        const replay = await this.claimIdempotencyKey(qr, params.companyId, params.userId, params.idempotency);
        if (replay !== undefined) {
          await qr.rollbackTransaction();
          return { ...(replay as StockMovement), replayed: true };
        }
      }

      const movement = await this.applyMovementInTransaction(qr, params);
      if (params.idempotency) {
        await this.storeIdempotentResponse(qr, params.companyId, params.userId, params.idempotency, movement);
      }

      // Step 6: commit
      await qr.commitTransaction();

      return movement;
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  }

  /**
   * The ledger write itself, inside a transaction the CALLER owns (it claims the idempotency key before and stores the
   * response after, and commits or rolls back): revision bump under the warehouse lock, stock-row lock, balance check,
   * immutable ledger row, balance update. The returned movement carries the history generation that was current when it
   * was written, so a client's receipt says which history it was issued in.
   */
  async applyMovementInTransaction(
    qr: QueryRunner,
    params: MovementParams & { companyId: string },
  ): Promise<StockMovement & { historyGeneration: string }> {
    // The actor must still be active AND still hold the capability of this movement on its warehouse when the write
    // commits (see assertActorAuthorized); before any warehouse lock.
    await assertActorAuthorized(qr, {
      userId: params.userId, companyId: params.companyId, capability: MOVEMENT_CAPABILITY[params.movementType] ?? PERMISSIONS.STOCK_ADJUSTMENT,
      warehouseIds: [params.warehouseId],
    });

    // The warehouse's revision is bumped under its row lock, so revisions commit in order (see getChanges).
    const revision = await this.bumpRevision(qr, params.warehouseId);

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
         (id, product_id, warehouse_id, user_id, movement_type, reference_type, quantity_change, running_balance, notes,
          revision)
       VALUES
         (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9)
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
        revision,
      ],
    );

    // Step 5: update ProductWarehouse balance
    await qr.query(
      `UPDATE product_warehouse SET base_quantity = $1
       WHERE product_id = $2 AND warehouse_id = $3`,
      [newBalance.toFixed(6), params.productId, params.warehouseId],
    );

    const [company] = await qr.query(`SELECT history_generation AS generation FROM companies WHERE id = $1`, [params.companyId]);
    const movement = this.toMovementEntity(movementResult[0]) as StockMovement & { historyGeneration: string };
    movement.historyGeneration = company.generation as string;
    return movement;
  }

  /** Retires cached reads of a product; call only after the transaction that changed it has committed. */
  async retireCachedReads(productId: string): Promise<void> {
    await this.invalidateStockCache(productId);
  }

  private idempotency(options: StockWriteOptions, kind: string, dto: object) {
    return options.idempotencyKey ? { key: options.idempotencyKey, hash: requestHash(kind, dto) } : undefined;
  }

  /**
   * Claims an Idempotency-Key inside the write's transaction. undefined: claimed, go ahead. Otherwise the stored
   * response of the first request with this key (that request has committed: a concurrent duplicate waits on the
   * key's unique index until it does). The same key with a different request is refused.
   */
  async claimIdempotencyKey(
    qr: QueryRunner, companyId: string, userId: string, idem: { key: string; hash: string },
  ): Promise<unknown | undefined> {
    const claimed: unknown[] = await qr.query(
      `INSERT INTO stock_idempotency_keys (company_id, user_id, idempotency_key, request_hash)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING request_hash`,
      [companyId, userId, idem.key, idem.hash],
    );
    if (claimed.length) return undefined;
    const [prior] = await qr.query(
      `SELECT request_hash, response FROM stock_idempotency_keys
       WHERE company_id = $1 AND user_id = $2 AND idempotency_key = $3`,
      [companyId, userId, idem.key],
    );
    if (prior.request_hash !== idem.hash) {
      throw new UnprocessableEntityException('This Idempotency-Key was already used for a different request');
    }
    return prior.response;
  }

  async storeIdempotentResponse(
    qr: QueryRunner, companyId: string, userId: string, idem: { key: string; hash: string }, response: unknown,
  ): Promise<void> {
    await qr.query(
      `UPDATE stock_idempotency_keys SET response = $4
       WHERE company_id = $1 AND user_id = $2 AND idempotency_key = $3`,
      [companyId, userId, idem.key, JSON.stringify(response)],
    );
  }

  /** Locks the warehouse row and returns its next stock revision (as a string: bigint). */
  private async bumpRevision(qr: QueryRunner, warehouseId: string): Promise<string> {
    const [rows] = await qr.query(
      `UPDATE warehouses SET stock_revision = stock_revision + 1 WHERE id = $1 RETURNING stock_revision`,
      [warehouseId],
    );
    if (!rows.length) throw new NotFoundException('Warehouse not found or access denied');
    return String(rows[0].stock_revision);
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
    m.revision = (row.revision as string | null) ?? null;
    m.createdAt = row.created_at as Date;
    return m;
  }

  /**
   * Sync contract for a warehouse. Revisions are assigned under the warehouse row lock (bumpRevision), so they
   * commit in order: a client that has applied everything up to revision N can never later meet a write numbered
   * below N. Read in one REPEATABLE READ transaction, so the movements, the balances and the returned cursor come from
   * the same snapshot.
   * - delta: movements with revision > since (oldest first, at most `limit`) and the current balances of the
   *   products they touch; `revision` is the cursor for the next call (hasMore: call again right away).
   * - snapshot: no `since`, or a revision this warehouse never issued: every balance of the warehouse, no movements.
   * Balances are always the server's: a client replaces its copy, it never adds quantities up.
   *
   * Cursor check: every answer carries `anchor`, the id of the movement at its `revision` (null at revision 0). A
   * client that sends it back with `since` proves the revision still names the same history. When it does not (the
   * database was restored or rebuilt, so revision numbers were reused) or `since` is ahead of the warehouse, the answer
   * is a snapshot with `reset: true` and the client must rebuild its state, instead of a delta with a silent gap.
   * Clients that send no anchor keep the old behaviour.
   *
   * History generation (Series 07): every answer carries `generation`, the company's current history generation (an
   * opaque id that changes only when an operator records a restore, see HistoryGenerationService). A client that
   * sends the generation it last saw gets a snapshot with `reset` and `resetReason: 'generation'` when it differs,
   * whatever its cursor says: revision numbers may have been reused, a generation never is. A client that sends none
   * (not upgraded yet) cannot say which history its cursor belongs to, so a cursor below the warehouse's
   * `history_floor_revision` (its revision at the last rotation) is answered with a snapshot and `reset` as well.
   */
  async getChanges(
    companyId: string, warehouseId: string, sinceRaw?: string, limitRaw?: string, anchorRaw?: string,
    generationRaw?: string,
  ) {
    if (sinceRaw !== undefined && sinceRaw !== '' && !/^\d{1,18}$/.test(sinceRaw)) {
      throw new BadRequestException('since must be a non-negative integer revision');
    }
    const anchor = anchorRaw === undefined || anchorRaw === '' ? null : anchorRaw;
    if (anchor !== null && !UUID_PATTERN.test(anchor)) {
      throw new BadRequestException('anchor must be the movement id returned with the cursor');
    }
    const knownGeneration = generationRaw === undefined || generationRaw === '' ? null : generationRaw.toLowerCase();
    if (knownGeneration !== null && !UUID_PATTERN.test(knownGeneration)) {
      throw new BadRequestException('generation must be the history generation id returned with the cursor');
    }
    const parsedLimit = Number.parseInt(limitRaw ?? '', 10);
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 500) : 200;

    return this.dataSource.transaction('REPEATABLE READ', async (m) => {
      const [wh] = await m.query(
        `SELECT w.stock_revision::text AS revision, w.history_floor_revision::text AS floor,
                c.history_generation::text AS generation
         FROM warehouses w JOIN companies c ON c.id = w.company_id
         WHERE w.id = $1 AND w.company_id = $2`,
        [warehouseId, companyId],
      );
      if (!wh) throw new NotFoundException('Warehouse not found or access denied');
      const current = BigInt(wh.revision);
      const floor = BigInt(wh.floor);
      const generation = wh.generation as string;
      const since = sinceRaw ? BigInt(sinceRaw) : null;

      const balances = async (productIds?: string[]) => {
        const rows: Array<{ productId: string; base: string; reserved: string }> = await m.query(
          `SELECT product_id AS "productId", base_quantity AS base, reserved_quantity AS reserved
           FROM product_warehouse
           WHERE warehouse_id = $1 ${productIds ? 'AND product_id = ANY($2::uuid[])' : ''}
           ORDER BY product_id`,
          productIds ? [warehouseId, productIds] : [warehouseId],
        );
        return rows.map((r) => {
          const base = new Decimal(r.base);
          const reserved = new Decimal(r.reserved ?? 0);
          return {
            productId: r.productId,
            baseQuantity: base.toFixed(6),
            reservedQuantity: reserved.toFixed(6),
            availableQuantity: base.minus(reserved).toFixed(6),
          };
        });
      };

      const movementAt = async (revision: bigint): Promise<string | null> => {
        if (revision === 0n) return null;
        const [row] = await m.query(
          `SELECT id FROM stock_movements WHERE warehouse_id = $1 AND revision = $2 LIMIT 1`,
          [warehouseId, revision.toString()],
        );
        return (row?.id as string | undefined) ?? null;
      };

      let resetReason: 'generation' | 'floor' | 'ahead' | 'anchor' | null = null;
      if (since !== null) {
        if (knownGeneration !== null && knownGeneration !== generation) resetReason = 'generation';
        else if (knownGeneration === null && since < floor) resetReason = 'floor';
        else if (since > current) resetReason = 'ahead';
        else if (anchor !== null && since > 0n && (await movementAt(since)) !== anchor) resetReason = 'anchor';
      }
      const reset = resetReason !== null;

      if (since === null || reset) {
        return {
          warehouseId, mode: 'snapshot' as const, generation, revision: current.toString(), anchor: await movementAt(current),
          reset, ...(resetReason ? { resetReason } : {}), hasMore: false, movements: [], balances: await balances(),
        };
      }

      const movements: Array<Record<string, unknown> & { revision: string; productId: string }> = await m.query(
        `SELECT id, product_id AS "productId", user_id AS "userId", movement_type AS "movementType",
                reference_type AS "referenceType", reference_id AS "referenceId",
                quantity_change AS "quantityChange", running_balance AS "runningBalance",
                sm.revision::text AS revision, created_at AS "createdAt"
         FROM stock_movements sm
         WHERE sm.warehouse_id = $1 AND sm.revision > $2
         ORDER BY sm.revision -- the bigint column: the text alias would sort '10' before '9'
         LIMIT $3`,
        [warehouseId, since.toString(), limit + 1],
      );
      const hasMore = movements.length > limit;
      if (hasMore) movements.length = limit;
      const touched = [...new Set(movements.map((mv) => mv.productId))];
      const revision = hasMore ? BigInt(movements[movements.length - 1].revision) : current;
      return {
        warehouseId,
        mode: 'delta' as const,
        generation,
        revision: revision.toString(),
        anchor: await movementAt(revision),
        reset: false,
        hasMore,
        movements,
        balances: touched.length ? await balances(touched) : [],
      };
    });
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
    // null/undefined: every warehouse of the company; otherwise only these (a Staff member's grants).
    allowedWarehouseIds?: string[] | null,
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

    const scoped = Array.isArray(allowedWarehouseIds);
    if (scoped && warehouseId && !allowedWarehouseIds.includes(warehouseId)) {
      throw new NotFoundException('Warehouse not found or access denied');
    }

    // Build cache key: use 'all' if warehouseId is not provided. A scoped list is never cached: the 'all' entry
    // holds every warehouse's movements and must not be served to a member with fewer grants.
    const cacheKey = scoped && !warehouseId
      ? null
      : await this.stockCacheKey(MOVEMENTS_CACHE_PREFIX, productId, warehouseId ?? 'all');
    const cached = cacheKey === null ? null : await this.redisService.get(cacheKey);
    if (cached !== null) {
      return JSON.parse(cached);
    }

    // Cache miss: fetch from DB
    const where: any = { productId };
    if (warehouseId) {
      where.warehouseId = warehouseId;
    } else if (scoped) {
      where.warehouseId = In(allowedWarehouseIds);
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