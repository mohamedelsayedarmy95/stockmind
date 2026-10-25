import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditLogService } from '../audit/audit-log.service';
import { EntitlementsService } from '../billing/entitlements.service';
import { AccessGrantService } from './access-grant.service';
import { lockMemberExclusive } from '../security/member-lock';
import {
  decideMembershipAction,
  MEMBERSHIP_ERROR_STATUS,
  MembershipAction,
  MembershipInput,
  MembershipPolicyError,
} from '../../domain/membership/membership-policy';
import { MemberStatus, UserRole } from '../../shared/constants/enums';

export interface MembershipChange {
  id: string;
  email: string;
  role: UserRole;
  status: MemberStatus;
  isOwner: boolean;
  sessionsRevoked: boolean;
}

interface Row {
  id: string; company_id: string; email: string; name: string; role: UserRole; status: MemberStatus; is_owner: boolean;
}

/**
 * Applies a membership action (suspend, reactivate, remove, role change, revoke sessions) in ONE transaction:
 *   1. the company row is locked (serializes concurrent membership changes of the company, and with it the owner count);
 *   2. the actor and the target are locked and re-read INSIDE the transaction, so the decision is made on committed truth;
 *   3. the pure policy decides; the row is updated (and token_version bumped / refresh hash cleared when it must);
 *   4. a membership_events row records who did what to whom and why.
 * Lock order is company, then users by id; stock writes take a user FOR SHARE only (no company lock), so no cycle exists.
 * The database trigger `users_guard_last_owner` is the backstop behind the policy's own last-owner rule.
 */
@Injectable()
export class MembershipService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditLogService,
    private readonly entitlements: EntitlementsService,
    private readonly access: AccessGrantService,
  ) {}

  async apply(
    companyId: string,
    actorId: string,
    targetId: string,
    action: MembershipAction,
    input: MembershipInput & { reason?: string } = {},
  ): Promise<MembershipChange> {
    let change: MembershipChange;
    try {
      change = await this.dataSource.transaction(async (m) => {
        await m.query(`SELECT 1 FROM companies WHERE id = $1 FOR UPDATE`, [companyId]);
        await lockMemberExclusive(m, targetId); // fair queue behind/ahead of the member's own writes (see member-lock.ts)
        const ids = [...new Set([actorId, targetId])].sort();
        const rows: Row[] = await m.query(
          `SELECT id, company_id, email, name, role::text AS role, status, is_owner
           FROM users WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
          [ids],
        );
        const actor = rows.find((r) => r.id === actorId);
        const target = rows.find((r) => r.id === targetId);
        // The other company's member and a missing id answer the same 404 (no cross-tenant probing).
        if (!target || target.company_id !== companyId) throw new NotFoundException('Member not found');
        if (!actor || actor.company_id !== companyId) throw new ForbiddenException({ code: 'ACTOR_NOT_ACTIVE', message: 'Your own access is not active' });

        const [{ n }] = await m.query(
          `SELECT count(*)::int AS n FROM users WHERE company_id = $1 AND is_owner AND status = 'active'`,
          [companyId],
        );
        const effects = decideMembershipAction(
          action,
          { id: actor.id, companyId: actor.company_id, role: actor.role, status: actor.status, isOwner: actor.is_owner },
          { id: target.id, companyId: target.company_id, role: target.role, status: target.status, isOwner: target.is_owner },
          { activeOwners: n },
          input,
        );

        // Returning to active from `removed` takes a seat again (a suspended member kept theirs).
        if (action === 'reactivate' && target.status === MemberStatus.REMOVED) {
          await this.entitlements.assertSeatAvailable(companyId, m);
        }

        const statusChanged = effects.toStatus !== target.status;
        await m.query(
          `UPDATE users SET
             status = $2, role = $3,
             token_version = token_version + $4::int,
             refresh_token_hash = CASE WHEN $5::boolean THEN NULL ELSE refresh_token_hash END,
             status_changed_at = CASE WHEN $6::boolean THEN now() ELSE status_changed_at END,
             status_changed_by = CASE WHEN $6::boolean THEN $7::uuid ELSE status_changed_by END
           WHERE id = $1`,
          [target.id, effects.toStatus, effects.toRole, effects.bumpTokenVersion ? 1 : 0, effects.clearRefreshToken, statusChanged, actor.id],
        );
        if (effects.clearWarehouseGrants) {
          await m.query(`DELETE FROM warehouse_access WHERE user_id = $1 AND company_id = $2`, [target.id, companyId]);
        }
        if (effects.revokeScopedGrants) {
          await this.access.revokeAllScopedGrants(m, companyId, target.id, actor.id, `membership ${effects.eventType}`);
        }
        if (effects.clearCustomRoles) {
          await m.query(`DELETE FROM user_roles WHERE user_id = $1`, [target.id]);
        }
        await m.query(
          `INSERT INTO membership_events
             (company_id, actor_user_id, target_user_id, target_email, event_type, from_status, to_status, from_role, to_role,
              sessions_revoked, reason, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`,
          [
            companyId, actor.id, target.id, target.email, effects.eventType, target.status, effects.toStatus,
            target.role, effects.toRole, effects.bumpTokenVersion, input.reason?.trim() || null,
            JSON.stringify({
              grantsCleared: effects.clearWarehouseGrants,
              customRolesCleared: effects.clearCustomRoles,
              companyWideAcknowledged: input.acknowledgeCompanyWideAccess === true,
            }),
          ],
        );
        return {
          id: target.id, email: target.email, role: effects.toRole, status: effects.toStatus, isOwner: target.is_owner,
          sessionsRevoked: effects.bumpTokenVersion,
        };
      });
    } catch (err) {
      throw this.translate(err);
    }

    // After commit; the audit write never fails the request. membership_events (above) is the durable record.
    await this.audit.write({
      actorUserId: actorId, companyId, action: `MEMBER_${action.toUpperCase()}`, entityType: 'user', entityId: targetId,
      newValues: { status: change.status, role: change.role, sessionsRevoked: change.sessionsRevoked },
    });
    return change;
  }

  /** Newest first; the Team screen shows a member's last changes. */
  async events(companyId: string, memberId: string, limit = 50) {
    const [member] = await this.dataSource.query(`SELECT 1 FROM users WHERE id = $1 AND company_id = $2`, [memberId, companyId]);
    if (!member) throw new NotFoundException('Member not found');
    return this.dataSource.query(
      `SELECT id, event_type AS "eventType", actor_user_id AS "actorUserId", from_status AS "fromStatus", to_status AS "toStatus",
              from_role AS "fromRole", to_role AS "toRole", sessions_revoked AS "sessionsRevoked", reason, created_at AS "createdAt"
       FROM membership_events WHERE company_id = $1 AND target_user_id = $2
       ORDER BY created_at DESC LIMIT $3`,
      [companyId, memberId, Math.min(Math.max(limit, 1), 200)],
    );
  }

  private translate(err: unknown): Error {
    if (err instanceof HttpException) return err;
    if (err instanceof MembershipPolicyError) {
      const body = { code: err.code, message: err.message };
      switch (MEMBERSHIP_ERROR_STATUS[err.code]) {
        case 403: return new ForbiddenException(body);
        case 400: return new BadRequestException(body);
        default: return new ConflictException(body);
      }
    }
    // The database trigger is the backstop for the same rule, e.g. if a concurrent path ever bypassed the policy.
    if (err instanceof Error && /last_active_owner/.test(err.message)) {
      return new ConflictException({ code: 'LAST_OWNER', message: 'The last active owner cannot be suspended, removed or demoted' });
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}
