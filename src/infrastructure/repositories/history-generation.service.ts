import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * The history generation of a company: an opaque id that names the history its clients are synchronising with.
 *
 * Trust model (read this before relying on it):
 * - The generation is stored in the same database as the ledger, so a point-in-time restore rewinds it together with
 *   the ledger. A database-only marker therefore CANNOT detect, by itself, that a restore happened.
 * - What it does provide is an explicit, audited way to say so: after a restore, BEFORE the API is opened to users,
 *   an operator rotates the generation. The new id is random (gen_random_uuid()), so it cannot equal any id that exists
 *   in any older image, and every client that saw another generation is told to rebuild from the server and to
 *   re-check its receipts, even if revision numbers were reused.
 * - If the operator step is omitted, clients fall back to the pre-existing detection (cursor/anchor mismatch and the
 *   start-up receipt re-check) and the Series 07 replacement still refuses anything the current ledger or key records
 *   show as present. Nothing here detects an omitted rotation.
 * - A restore to an image that predates an earlier rotation brings back that earlier id; clients that saw the later one
 *   see a different id and rebuild (equality, not ordering, is what is compared).
 *
 * Rotation is authenticated (company Admin), disabled unless RECOVERY_OPERATIONS_ENABLED=true, requires a written
 * reason, serialises with replacements on the company row, and appends an immutable event.
 */
@Injectable()
export class HistoryGenerationService {
  constructor(private readonly dataSource: DataSource) {}

  /** Operator procedures stay off unless the deployment turned them on on purpose (fail closed). */
  assertEnabled(): void {
    if (process.env.RECOVERY_OPERATIONS_ENABLED !== 'true') {
      throw new ForbiddenException({
        message: 'Recovery operations are disabled on this deployment',
        code: 'recovery-disabled',
      });
    }
  }

  async current(companyId: string): Promise<string> {
    const [row] = await this.dataSource.query(`SELECT history_generation::text AS generation FROM companies WHERE id = $1`, [companyId]);
    if (!row) throw new NotFoundException('Company not found');
    return row.generation as string;
  }

  async events(companyId: string, limit = 20) {
    const rows: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT e.id, e.kind, e.previous_generation::text AS "previousGeneration", e.new_generation::text AS "newGeneration",
              e.actor_user_id AS "actorUserId", e.reason, e.warehouse_floors AS "warehouseFloors", e.created_at AS "createdAt"
       FROM history_generation_events e WHERE e.company_id = $1 ORDER BY e.created_at DESC, e.id LIMIT $2`,
      [companyId, Math.min(Math.max(limit, 1), 100)],
    );
    return rows;
  }

  /**
   * Starts a new history generation for the company. One transaction: the company row is locked (replacements share-lock
   * it, so none runs across the switch), every warehouse of the company is locked in id order (the order stock writes
   * lock them in) and its revision is recorded as the floor, the generation changes, the event is appended.
   */
  async rotate(companyId: string, actorUserId: string, reason: string) {
    this.assertEnabled();
    return this.dataSource.transaction(async (m) => {
      const [company] = await m.query(
        `SELECT history_generation::text AS generation FROM companies WHERE id = $1 FOR UPDATE`, [companyId],
      );
      if (!company) throw new NotFoundException('Company not found');
      const warehouses: Array<{ id: string; revision: string }> = await m.query(
        `SELECT id, stock_revision::text AS revision FROM warehouses WHERE company_id = $1 ORDER BY id FOR UPDATE`, [companyId],
      );
      const floors = Object.fromEntries(warehouses.map((w) => [w.id, w.revision]));
      await m.query(
        `UPDATE warehouses SET history_floor_revision = stock_revision WHERE company_id = $1`, [companyId],
      );
      // (TypeORM answers UPDATE ... RETURNING with [rows, affected].)
      const [updated] = await m.query(
        `UPDATE companies SET history_generation = gen_random_uuid() WHERE id = $1 RETURNING history_generation::text AS generation`,
        [companyId],
      );
      const generation = updated[0].generation as string;
      await m.query(
        `INSERT INTO history_generation_events (company_id, previous_generation, new_generation, actor_user_id, reason, warehouse_floors)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [companyId, company.generation, generation, actorUserId, reason, JSON.stringify(floors)],
      );
      return { previousGeneration: company.generation as string, generation: generation as string, warehouseFloors: floors };
    });
  }
}
