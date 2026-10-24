import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import Decimal from 'decimal.js';
import { createHash } from 'crypto';
import { MovementType, ReferenceType } from '../../shared/constants/enums';
import { ReplaceOperationDto } from '../../application/dtos/stock/replace-operation.dto';
import { StockService, requestHash } from './stock.service';
import { WarehouseAccessService } from '../security/warehouse-access.service';

export type ReplacementKind = 'inbound' | 'outbound';

/** Structured, stable reasons a replacement is refused. Every one of them leaves the database exactly as it was. */
export type ReplacementBlock =
  | 'stale-generation' // the history generation changed since the user looked: re-sync and look again
  | 'original-present' // the original operation is in the current history: nothing to replace
  | 'original-indeterminate' // a trace exists but not enough to decide (partial record, unfinished claim)
  | 'original-unavailable' // the original exists in a warehouse the caller may no longer use
  | 'already-replaced' // this operation already has a replacement in this history
  | 'insufficient-stock' // an outbound replacement the stock cannot cover now
  | 'in-progress'; // this replacement key has no stored outcome

/** The success body (also what a repeated request replays, with `replayed: true`). */
export interface ReplacementResult {
  outcome: 'replaced';
  id: string;
  productId: string;
  warehouseId: string;
  userId: string;
  movementType: MovementType;
  referenceType: ReferenceType;
  quantityChange: string;
  runningBalance: string;
  notes: string | null;
  revision: string | null;
  createdAt: Date;
  historyGeneration: string;
  replacement: { originalKey: string; originalMovementId: string; generationAtDecision: string; decidedAt: Date };
  replayed?: true;
}

const blocked = (code: ReplacementBlock, message: string, details: Record<string, unknown> = {}) =>
  new ConflictException({ message, code, details });

/**
 * Server-enforced replacement of an operation that a history change erased (Series 07, S1).
 *
 * The decision is made INSIDE one transaction, not by a lookup the client did earlier:
 *  1. the replacement's own Idempotency-Key is claimed (a repeated or concurrent request replays the stored outcome);
 *  2. warehouse access is re-checked under a share lock on the caller's grant (a concurrent revocation waits for this
 *     transaction or is seen by it);
 *  3. the company's history generation is read under a share lock and must equal the one the user reviewed (a rotation
 *     takes the same row exclusively);
 *  4. the ORIGINAL key is fenced: a tombstone row is inserted into stock_idempotency_keys. The unique key makes this the
 *     atomic test-and-set: if the original request ever committed, the insert conflicts and its record is evaluated
 *     (present / indeterminate / unavailable → refused); if it did not, the tombstone now blocks any later request that
 *     reuses that key (it fails as "key already used for a different request");
 *  5. the ledger is checked for the receipt's movement id (a key record that was cleaned up while the movement stayed);
 *  6. the movement is written by the same routine as every other stock write (revision under the warehouse lock, stock
 *     row lock, balance check), then the provenance row and the stored response are written, and everything commits.
 *
 * Guarantee, precisely: within ONE database history, an original operation is replaced at most once, never when it is
 * present, never twice by concurrent requests, never by repeating a request. It does NOT, and cannot, protect against a
 * later restore that brings back the original while the replacement survives or the other way round; that is detected
 * and flagged by the operations lookup (coexisting-replacement) and handled by operators (runbook).
 */
@Injectable()
export class StockReplacementService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly stock: StockService,
    private readonly access: WarehouseAccessService,
  ) {}

  async replace(
    actorUserId: string, companyId: string, kind: ReplacementKind, replacementKey: string, dto: ReplaceOperationDto,
  ): Promise<ReplacementResult> {
    const qty = new Decimal(dto.quantity);
    if (!qty.isFinite() || qty.lte(0)) throw new BadRequestException('Quantity must be greater than zero');
    if (dto.originalKey === replacementKey) throw new BadRequestException('The replacement needs its own Idempotency-Key');

    const hash = requestHash(`replace-${kind}`, dto);
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      // 1. The replacement's own key. A repeat (a retry after a lost response, a double tap) replays the stored outcome.
      const replay = await this.stock.claimIdempotencyKey(qr, companyId, actorUserId, { key: replacementKey, hash });
      if (replay !== undefined) {
        await qr.rollbackTransaction();
        if (!replay) throw blocked('in-progress', 'This replacement has no stored outcome');
        return { ...(replay as ReplacementResult), replayed: true as const };
      }

      await this.assertOwnership(qr, companyId, dto.productId, dto.warehouseId);

      // 2. Access, re-read in this transaction: Staff need a grant, and the grant row is share-locked until we commit.
      await this.assertAccess(qr, actorUserId, companyId, dto.warehouseId);

      // 3. The generation the person reviewed must still be the current one.
      const [company] = await qr.query(
        `SELECT history_generation::text AS generation FROM companies WHERE id = $1 FOR SHARE`, [companyId],
      );
      if (!company) throw new NotFoundException('Company not found');
      if (company.generation !== dto.expectedGeneration.toLowerCase()) {
        throw blocked('stale-generation', 'The server history changed since this was reviewed. Refresh and review again.', {
          currentGeneration: company.generation,
        });
      }

      // 4. Fence the original key. The tombstone's hash differs from any real request's, so a later request with this
      //    key is refused as "key reused" instead of being applied.
      const fence = await qr.query(
        `INSERT INTO stock_idempotency_keys (company_id, user_id, idempotency_key, request_hash, response)
         VALUES ($1, $2, $3, $4, $5::jsonb) ON CONFLICT DO NOTHING RETURNING idempotency_key`,
        [
          companyId, actorUserId, dto.originalKey,
          createHash('sha256').update(`superseded:${replacementKey}`).digest('hex'),
          JSON.stringify({ supersededBy: replacementKey }),
        ],
      );
      if (!fence.length) await this.explainExistingKey(qr, actorUserId, companyId, dto);

      // 5. The ledger itself, by the receipt's movement id.
      await this.assertNotInLedger(qr, actorUserId, companyId, dto.originalMovementId);

      // 6. The write, the provenance, the stored outcome.
      const isInbound = kind === 'inbound';
      let movement;
      try {
        movement = await this.stock.applyMovementInTransaction(qr, {
          companyId,
          productId: dto.productId,
          warehouseId: dto.warehouseId,
          userId: actorUserId,
          movementType: isInbound ? MovementType.INBOUND : MovementType.OUTBOUND,
          referenceType: isInbound ? ReferenceType.PURCHASE : ReferenceType.SALE,
          quantityChange: isInbound ? qty : qty.neg(),
          notes: `Replacement of action ${dto.originalKey.slice(0, 8)} (absent from server history after a restore)`,
          autoCreateSlot: isInbound,
        });
      } catch (err) {
        if (err instanceof ConflictException && err.message === 'Insufficient stock') {
          throw blocked('insufficient-stock', 'The stock cannot cover this replacement now');
        }
        throw err;
      }

      const [prov] = await qr.query(
        `INSERT INTO stock_replacements
           (company_id, warehouse_id, actor_user_id, original_key, original_movement_id, original_claim,
            replacement_key, replacement_movement_id, generation_at_decision, original_status, reason)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, 'absent', $10)
         RETURNING created_at AS "decidedAt"`,
        [
          companyId, dto.warehouseId, actorUserId, dto.originalKey, dto.originalMovementId,
          JSON.stringify({
            kind, productId: dto.productId, warehouseId: dto.warehouseId, quantity: dto.quantity,
            receiptRevision: dto.receiptRevision ?? null, receiptConfirmedAt: dto.receiptConfirmedAt ?? null,
            receiptGeneration: dto.receiptGeneration ?? null, claimedByClient: true,
          }),
          replacementKey, movement.id, company.generation,
          'absent-from-current-history; person acknowledged that the original may not have been undone',
        ],
      );
      await qr.query(
        `UPDATE stock_idempotency_keys SET response = $4::jsonb
         WHERE company_id = $1 AND user_id = $2 AND idempotency_key = $3`,
        [companyId, actorUserId, dto.originalKey, JSON.stringify({
          supersededBy: replacementKey, replacementMovementId: movement.id, decidedAt: prov.decidedAt,
        })],
      );

      const response: ReplacementResult = {
        outcome: 'replaced',
        id: movement.id,
        productId: movement.productId,
        warehouseId: movement.warehouseId,
        userId: movement.userId,
        movementType: movement.movementType,
        referenceType: movement.referenceType,
        quantityChange: movement.quantityChange,
        runningBalance: movement.runningBalance,
        notes: movement.notes,
        revision: movement.revision,
        createdAt: movement.createdAt,
        historyGeneration: movement.historyGeneration,
        replacement: {
          originalKey: dto.originalKey,
          originalMovementId: dto.originalMovementId,
          generationAtDecision: company.generation as string,
          decidedAt: prov.decidedAt as Date,
        },
      };
      await this.stock.storeIdempotentResponse(qr, companyId, actorUserId, { key: replacementKey, hash }, response);
      await qr.commitTransaction();
      await this.stock.retireCachedReads(dto.productId);
      return response;
    } catch (err) {
      if (qr.isTransactionActive) await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  }

  private async assertOwnership(qr: QueryRunner, companyId: string, productId: string, warehouseId: string) {
    const [p] = await qr.query(`SELECT 1 AS ok FROM products WHERE id = $1 AND company_id = $2`, [productId, companyId]);
    if (!p) throw new NotFoundException('Product not found or access denied');
    const [w] = await qr.query(`SELECT 1 AS ok FROM warehouses WHERE id = $1 AND company_id = $2`, [warehouseId, companyId]);
    if (!w) throw new NotFoundException('Warehouse not found or access denied');
  }

  private async assertAccess(qr: QueryRunner, userId: string, companyId: string, warehouseId: string) {
    const [u] = await qr.query(`SELECT role FROM users WHERE id = $1 AND company_id = $2`, [userId, companyId]);
    if (!u) throw new NotFoundException('Warehouse not found or access denied');
    if (this.access.hasFullAccess(u.role)) return;
    const grant = await qr.query(
      `SELECT 1 FROM warehouse_access WHERE company_id = $1 AND user_id = $2 AND warehouse_id = $3 FOR SHARE`,
      [companyId, userId, warehouseId],
    );
    if (!grant.length) throw new NotFoundException('Warehouse not found or access denied');
  }

  /** Whether the caller may see/use this warehouse right now (read in the replacement's transaction). */
  private async mayUse(qr: QueryRunner, userId: string, companyId: string, warehouseId: string): Promise<boolean> {
    const [u] = await qr.query(`SELECT role FROM users WHERE id = $1 AND company_id = $2`, [userId, companyId]);
    if (!u) return false;
    if (this.access.hasFullAccess(u.role)) return true;
    const grant = await qr.query(
      `SELECT 1 FROM warehouse_access WHERE company_id = $1 AND user_id = $2 AND warehouse_id = $3`,
      [companyId, userId, warehouseId],
    );
    return grant.length > 0;
  }

  /** The original key already has a record: say exactly why that stops the replacement. Always throws. */
  private async explainExistingKey(qr: QueryRunner, userId: string, companyId: string, dto: ReplaceOperationDto): Promise<never> {
    const [rec] = await qr.query(
      `SELECT response FROM stock_idempotency_keys WHERE company_id = $1 AND user_id = $2 AND idempotency_key = $3`,
      [companyId, userId, dto.originalKey],
    );
    const response = rec?.response as Record<string, unknown> | null | undefined;
    if (!response) {
      throw blocked('original-indeterminate', 'A request with the original key has not finished', { reason: 'in-progress' });
    }
    if (typeof response.supersededBy === 'string') {
      throw blocked('already-replaced', 'This operation was already replaced', {
        replacementKey: response.supersededBy, replacementMovementId: response.replacementMovementId ?? null,
      });
    }
    if (typeof response.id !== 'string') {
      throw blocked('original-indeterminate', 'The original key belongs to an operation this check cannot resolve', {
        reason: 'unsupported-operation',
      });
    }
    const [mv] = await qr.query(
      `SELECT sm.warehouse_id AS "warehouseId" FROM stock_movements sm JOIN warehouses w ON w.id = sm.warehouse_id
       WHERE sm.id = $1 AND w.company_id = $2 AND sm.user_id = $3`,
      [response.id, companyId, userId],
    );
    if (!mv) {
      throw blocked('original-indeterminate', 'A record of the original exists but its movement does not', {
        reason: 'receipt-without-movement',
      });
    }
    if (!(await this.mayUse(qr, userId, companyId, mv.warehouseId))) {
      throw blocked('original-unavailable', 'The original is in a warehouse you can no longer use');
    }
    throw blocked('original-present', 'The original operation is in the current history', { movementId: response.id });
  }

  private async assertNotInLedger(qr: QueryRunner, userId: string, companyId: string, movementId: string) {
    const [mv] = await qr.query(
      `SELECT sm.warehouse_id AS "warehouseId" FROM stock_movements sm JOIN warehouses w ON w.id = sm.warehouse_id
       WHERE sm.id = $1 AND w.company_id = $2 AND sm.user_id = $3`,
      [movementId, companyId, userId],
    );
    if (!mv) return;
    if (!(await this.mayUse(qr, userId, companyId, mv.warehouseId))) {
      throw blocked('original-unavailable', 'The original is in a warehouse you can no longer use');
    }
    throw blocked('original-present', 'The original operation is in the current history', { movementId });
  }
}
