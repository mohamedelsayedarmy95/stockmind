import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { QueryRunner, EntityManager } from 'typeorm';
import { accessRevoked } from '../jwt.strategy';
import { loadPrincipalFrom } from './capability.service';
import { lockMemberShared } from './member-lock';
import { canAll, Decision } from '../../domain/authorization/capability-evaluator';
import { capabilityMode } from '../../shared/constants/capabilities.constant';

type Runner = Pick<QueryRunner, 'query'> | Pick<EntityManager, 'query'>;

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
export async function assertActorActive(runner: Runner, userId: string, companyId: string): Promise<void> {
  await lockMemberShared(runner, userId);
  const rows: Array<{ ok: number }> = await runner.query(
    `SELECT 1 AS ok FROM users WHERE id = $1 AND company_id = $2 AND status = 'active' FOR SHARE`,
    [userId, companyId],
  );
  if (!rows.length) throw accessRevoked();
}

/**
 * In-transaction authorization (Series 10 / S2): the member is still active AND still holds `capability` on every named
 * warehouse, judged by the model that is deciding right now (the capability model when the engine enforces, otherwise the
 * legacy one).
 *
 * Why this is enough to close the window left by Series 09: every change of a member's role, status or grants (the
 * membership actions, the access administration, the legacy warehouse endpoint) takes the member's row FOR UPDATE; this
 * function share-locks the same row before reading role and grants. So a conflicting change either committed before (and
 * is seen here: the write is refused) or waits until the write's transaction ends (the write is ordered before it).
 * Operations already committed before a revocation are not undone; operations still in flight cannot commit after it.
 *
 * Refusals mirror the request guards: a warehouse the member may not use is a 404 (as if it did not exist), a capability
 * the member no longer holds a 403, an inactive member the ACCESS_REVOKED 401.
 */
export async function assertActorAuthorized(
  runner: Runner,
  args: { userId: string; companyId: string; capability: string; warehouseIds?: string[] },
): Promise<void> {
  const principal = await loadPrincipalFrom(runner as any, args.userId, args.companyId, { lock: true });
  if (!principal || principal.status !== 'active') throw accessRevoked();
  const view = capabilityMode() === 'enforce' ? 'scoped' : 'legacy';
  const decision: Decision = canAll(principal, args.capability, args.warehouseIds ?? [], view);
  if (decision.allowed) return;
  if (decision.reason === 'out-of-scope' || decision.reason === 'no-grant') {
    throw new NotFoundException('Warehouse not found or access denied');
  }
  throw new ForbiddenException({ code: 'CAPABILITY_REVOKED', message: `Missing required permission: ${args.capability}` });
}
