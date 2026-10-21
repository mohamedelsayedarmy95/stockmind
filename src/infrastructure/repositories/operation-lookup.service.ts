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
 *   an operation kind this lookup does not resolve);
 * - unavailable: the movement exists but is in a warehouse the caller may no longer use; nothing more is disclosed.
 *
 * Scope: the caller's company and the caller's own operations only (keys are per user; movements must be the
 * caller's). Another user's key or movement id is reported exactly like an unknown one.
 */
export type OperationStatus = 'present' | 'absent' | 'indeterminate' | 'unavailable';

export interface OperationLookupResult {
  key: string;
  status: OperationStatus;
  reason?: 'receipt-without-movement' | 'in-progress' | 'unsupported-operation' | 'no-access' | 'key-record-missing';
  movement?: {
    id: string;
    warehouseId: string;
    productId: string;
    movementType: string;
    quantityChange: string;
    revision: string | null;
    createdAt: string;
  };
}

interface KeyRow {
  key: string;
  movementId: string | null;
  hasResponse: boolean;
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

@Injectable()
export class OperationLookupService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly access: WarehouseAccessService,
  ) {}

  async lookup(userId: string, companyId: string, refs: OperationRefDto[]): Promise<OperationLookupResult[]> {
    const scope = await this.access.scope(userId, companyId);
    const allowed = scope === null ? null : new Set(scope);

    // One snapshot: the key records and the movements are read as of the same moment.
    const { keys, movements } = await this.dataSource.transaction('REPEATABLE READ', async (m) => {
      const keyRows: KeyRow[] = await m.query(
        `SELECT idempotency_key AS key, response->>'id' AS "movementId", (response IS NOT NULL) AS "hasResponse"
         FROM stock_idempotency_keys
         WHERE company_id = $1 AND user_id = $2 AND idempotency_key = ANY($3::text[])`,
        [companyId, userId, refs.map((r) => r.key)],
      );
      const byKey = new Map(keyRows.map((k) => [k.key, k]));
      const wanted = new Set<string>();
      for (const r of refs) {
        const k = byKey.get(r.key);
        const id = k ? k.movementId : r.movementId;
        if (id && UUID.test(id)) wanted.add(id);
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
      return { keys: byKey, movements: new Map(movementRows.map((mv) => [mv.id, mv])) };
    });

    const describe = (key: string, mv: MovementRow, reason?: OperationLookupResult['reason']): OperationLookupResult => {
      if (allowed && !allowed.has(mv.warehouseId)) return { key, status: 'unavailable', reason: 'no-access' };
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

    return refs.map((ref): OperationLookupResult => {
      const k = keys.get(ref.key);
      if (k) {
        if (!k.hasResponse) return { key: ref.key, status: 'indeterminate', reason: 'in-progress' };
        if (!k.movementId) return { key: ref.key, status: 'indeterminate', reason: 'unsupported-operation' };
        const mv = movements.get(k.movementId);
        return mv ? describe(ref.key, mv) : { key: ref.key, status: 'indeterminate', reason: 'receipt-without-movement' };
      }
      // No key record (restored away, or cleaned up): the receipt's movement id is the only other evidence.
      const mv = ref.movementId ? movements.get(ref.movementId) : undefined;
      return mv ? describe(ref.key, mv, 'key-record-missing') : { key: ref.key, status: 'absent' };
    });
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
