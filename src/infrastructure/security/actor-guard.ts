import { QueryRunner, EntityManager } from 'typeorm';
import { accessRevoked } from '../jwt.strategy';

/**
 * In-transaction check that the acting member is still active (Series 09 / S1).
 *
 * The request guard already refused suspended members, but a suspension can commit between that check and the moment a
 * write commits. Taking `FOR SHARE` on the member's row INSIDE the write's transaction closes that window: a suspension
 * (which needs the row exclusively) either committed first, so this read sees it and the write is refused, or waits until
 * the write commits, so the write happened strictly before the suspension. Either way no write is ordered after it.
 *
 * Lock order used across the codebase: company row, then user rows (id order), then warehouses (id order). This takes only
 * a user row, and always before any warehouse lock.
 */
export async function assertActorActive(
  runner: Pick<QueryRunner, 'query'> | Pick<EntityManager, 'query'>,
  userId: string,
  companyId: string,
): Promise<void> {
  const rows: Array<{ ok: number }> = await runner.query(
    `SELECT 1 AS ok FROM users WHERE id = $1 AND company_id = $2 AND status = 'active' FOR SHARE`,
    [userId, companyId],
  );
  if (!rows.length) throw accessRevoked();
}
