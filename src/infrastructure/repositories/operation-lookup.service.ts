import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { WarehouseAccessService } from '../security/warehouse-access.service';
import { OperationRefDto } from '../../application/dtos/stock/operation-lookup.dto';

/**
 * What the CURRENT server history says about one of the caller's own stock operations:
 * - present: the movement is in the ledger now (the caller's own, in a warehouse the caller may use);
 * - absent: neither the ledger nor the idempotency records hold any trace of it for this caller. That does NOT prove
 *   it never happened: a database restore erases the movement and its key record together. A client that holds a
 *   receipt for it must treat it as "history changed", never as unsent;
 * - indeterminate: there is a trace but not enough to tell (a key record without its movement, an unfinished claim,
 *   an operation kind this lookup does not resolve) or the operation was REPLACED by a person after a history change
 *   (reason 'superseded', with the replacement's identity);
 * - unavailable: the movement exists but is in a warehouse the caller may no longer use; nothing more is disclosed.
 *
 * Scope: the caller's company and the caller's own operations only (keys are per user; movements must be the
 * caller's). Another user's key or movement id is reported exactly like an unknown one.
 *
 * Replacement evidence (Series 07): when the caller replaced an operation, the provenance row links the two. If BOTH the
 * original and its replacement are in the ledger (a later restore or an operator re-import brought the original back),
 * the answer is present with reason 'coexisting-replacement' and both identities: the stock was applied twice.
 */
export type OperationStatus = 'present' | 'absent' | 'indeterminate' | 'unavailable';

export interface OperationLookupResult {
  key: string;
  status: OperationStatus;
  reason?:
    | 'receipt-without-movement' | 'in-progress' | 'unsupported-operation' | 'no-access' | 'key-record-missing'
    | 'superseded' | 'coexisting-replacement';
  movement?: {
    id: string;
    warehouseId: string;
    productId: string;
    movementType: string;
    quantityChange: string;
    revision: string | null;
    createdAt: string;
  };
  /** This operation was replaced: the replacement's key and movement, and whether that movement is in the ledger now. */
  replacement?: { key: string; movementId: string; present: boolean };
  /** This operation IS a replacement of an earlier one. */
  replacementOf?: { key: string; movementId: string; originalPresent: boolean };
}

export interface OperationLookupResponse {
  /** The company's current history generation: the answer is about THIS history. */
  generation: string;
  operations: OperationLookupResult[];
}

interface KeyRow {
  key: string;
  movementId: string | null;
  hasResponse: boolean;
  supersededBy: string | null;
  replacementMovementId: string | null;
}

interface MovementRow {
  id: string;
  warehouseId: string;
  productId: string;
  movementType: string;
  quantityChange: string;
  revision: string | null;
  createdAt: Date;
}

interface ProvenanceRow {
  originalKey: string;
  originalMovementId: string;
  replacementKey: string;
  replacementMovementId: string;
}

@Injectable()
export class OperationLookupService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly access: WarehouseAccessService,
  ) {}

  async lookup(userId: string, companyId: string, refs: OperationRefDto[]): Promise<OperationLookupResponse> {
    const scope = await this.access.scope(userId, companyId);
    const allowed = scope === null ? null : new Set(scope);

    // One snapshot: the key records and the movements are read as of the same moment.
    const { generation, keys, movements, provenance } = await this.dataSource.transaction('REPEATABLE READ', async (m) => {
      const [company] = await m.query(`SELECT history_generation::text AS generation FROM companies WHERE id = $1`, [companyId]);
      const keyRows: KeyRow[] = await m.query(
        `SELECT idempotency_key AS key, response->>'id' AS "movementId", (response IS NOT NULL) AS "hasResponse",
                response->>'supersededBy' AS "supersededBy", response->>'replacementMovementId' AS "replacementMovementId"
         FROM stock_idempotency_keys
         WHERE company_id = $1 AND user_id = $2 AND idempotency_key = ANY($3::text[])`,
        [companyId, userId, refs.map((r) => r.key)],
      );
      const byKey = new Map(keyRows.map((k) => [k.key, k]));
      const provRows: ProvenanceRow[] = await m.query(
        `SELECT original_key AS "originalKey", original_movement_id AS "originalMovementId",
                replacement_key AS "replacementKey", replacement_movement_id AS "replacementMovementId"
         FROM stock_replacements
         WHERE company_id = $1 AND actor_user_id = $2 AND (original_key = ANY($3::text[]) OR replacement_key = ANY($3::text[]))`,
        [companyId, userId, refs.map((r) => r.key)],
      );
      const wanted = new Set<string>();
      for (const r of refs) {
        const k = byKey.get(r.key);
        const id = k ? k.movementId : r.movementId;
        if (id && UUID.test(id)) wanted.add(id);
      }
      for (const p of provRows) {
        wanted.add(p.originalMovementId);
        wanted.add(p.replacementMovementId);
      }
      const movementRows: MovementRow[] = wanted.size
        ? await m.query(
            `SELECT sm.id, sm.warehouse_id AS "warehouseId", sm.product_id AS "productId",
                    sm.movement_type AS "movementType", sm.quantity_change::text AS "quantityChange",
                    sm.revision::text AS revision, sm.created_at AS "createdAt"
             FROM stock_movements sm
             JOIN warehouses w ON w.id = sm.warehouse_id
             WHERE sm.id = ANY($1::uuid[]) AND w.company_id = $2 AND sm.user_id = $3`,
            [[...wanted], companyId, userId],
          )
        : [];
      return {
        generation: company.generation as string,
        keys: byKey,
        movements: new Map(movementRows.map((mv) => [mv.id, mv])),
        provenance: provRows,
      };
    });

    const usable = (mv: MovementRow) => !allowed || allowed.has(mv.warehouseId);
    const describe = (key: string, mv: MovementRow, reason?: OperationLookupResult['reason']): OperationLookupResult => {
      if (!usable(mv)) return { key, status: 'unavailable', reason: 'no-access' };
      return {
        key,
        status: 'present',
        ...(reason ? { reason } : {}),
        movement: {
          id: mv.id,
          warehouseId: mv.warehouseId,
          productId: mv.productId,
          movementType: mv.movementType,
          quantityChange: mv.quantityChange,
          revision: mv.revision,
          createdAt: new Date(mv.createdAt).toISOString(),
        },
      };
    };
    // A movement only counts as present for this caller when the caller may use its warehouse.
    const livePresent = (id: string) => {
      const mv = movements.get(id);
      return Boolean(mv && usable(mv));
    };
    const byOriginal = new Map(provenance.map((p) => [p.originalKey, p]));
    const byReplacement = new Map(provenance.map((p) => [p.replacementKey, p]));

    const operations = refs.map((ref): OperationLookupResult => {
      const asOriginal = byOriginal.get(ref.key);
      if (asOriginal) {
        const replacement = {
          key: asOriginal.replacementKey,
          movementId: asOriginal.replacementMovementId,
          present: livePresent(asOriginal.replacementMovementId),
        };
        const original = movements.get(asOriginal.originalMovementId);
        if (original) {
          // The original is back in the ledger. With its replacement also there, stock was applied twice.
          const described = describe(ref.key, original, replacement.present ? 'coexisting-replacement' : undefined);
          return described.status === 'present' ? { ...described, replacement } : described;
        }
        return { key: ref.key, status: 'indeterminate', reason: 'superseded', replacement };
      }

      const k = keys.get(ref.key);
      let result: OperationLookupResult;
      if (k) {
        if (!k.hasResponse) result = { key: ref.key, status: 'indeterminate', reason: 'in-progress' };
        else if (!k.movementId) result = { key: ref.key, status: 'indeterminate', reason: 'unsupported-operation' };
        else {
          const mv = movements.get(k.movementId);
          result = mv ? describe(ref.key, mv) : { key: ref.key, status: 'indeterminate', reason: 'receipt-without-movement' };
        }
      } else {
        // No key record (restored away, or cleaned up): the receipt's movement id is the only other evidence.
        const mv = ref.movementId ? movements.get(ref.movementId) : undefined;
        result = mv ? describe(ref.key, mv, 'key-record-missing') : { key: ref.key, status: 'absent' };
      }

      const asReplacement = byReplacement.get(ref.key);
      if (asReplacement && result.status === 'present') {
        const originalPresent = livePresent(asReplacement.originalMovementId);
        return {
          ...result,
          ...(originalPresent ? { reason: 'coexisting-replacement' as const } : {}),
          replacementOf: { key: asReplacement.originalKey, movementId: asReplacement.originalMovementId, originalPresent },
        };
      }
      return result;
    });
    return { generation, operations };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
