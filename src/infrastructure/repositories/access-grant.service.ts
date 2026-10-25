import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createHash } from 'crypto';
import { AuditLogService } from '../audit/audit-log.service';
import { CapabilityService } from '../security/capability.service';
import { lockMemberExclusive } from '../security/member-lock';
import { can, mayGrantProfile, Principal } from '../../domain/authorization/capability-evaluator';
import {
  capabilityMode, OPERATOR_PROFILE_KEY, SYSTEM_PROFILES, SystemProfile, WAREHOUSE_MANAGER_PROFILE_KEY,
} from '../../shared/constants/capabilities.constant';
import { MemberStatus, UserRole } from '../../shared/constants/enums';
import { PERMISSIONS } from '../../shared/constants/permissions.constant';

type Tx = { query: (sql: string, params?: unknown[]) => Promise<any> };

export interface Assignment {
  warehouseId: string;
  profile: string;
}

export interface AssignmentView extends Assignment {
  warehouseName: string;
  profileVersion: number;
  labelKey: string;
  capabilities: string[];
  source: 'legacy_warehouse_access' | 'access_grant';
}

export type GrantSource = 'api' | 'legacy_api' | 'membership' | 'warehouse_create';

/** The fingerprint a client sends back to say "I edited THIS state": a concurrent change makes it stale (409). */
export function assignmentsVersion(assignments: ReadonlyArray<{ warehouseId: string; profile: string; profileVersion: number }>): string {
  const canon = assignments.map((a) => `${a.warehouseId}:${a.profile}@${a.profileVersion}`).sort().join('|');
  return createHash('sha256').update(canon).digest('hex').slice(0, 24);
}

const profileOf = (key: string): SystemProfile | undefined => SYSTEM_PROFILES.find((p) => p.key === key);

/**
 * Warehouse access administration (Series 10 / S2-D). A member's warehouse access is a set of (warehouse, profile)
 * assignments: `operator` assignments live in the legacy warehouse_access table (so every legacy reader keeps working and
 * nothing is copied), `warehouse_manager` assignments in access_grants.
 *
 * One transaction per change: the target member's row is locked FOR UPDATE first, which also serializes against that
 * member's in-flight stock writes (they hold the same row FOR SHARE), then the change and its evidence
 * (access_grant_events) are written together. Rules enforced here, on top of the endpoint's MANAGE_USERS capability:
 *  - the target must be an active (or suspended) Staff member: Admin and Manager already see every warehouse;
 *  - nobody changes their own access;
 *  - a profile may be handed out only if the grantor holds every capability it carries on that warehouse (no escalation);
 *  - a profile that exists only in the capability model (warehouse_manager) is refused while the engine does not enforce:
 *    a grant that would do nothing is never presented as working;
 *  - an optimistic version (`expectedVersion`) makes concurrent edits of the same member fail visibly instead of silently
 *    overwriting each other.
 */
@Injectable()
export class AccessGrantService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditLogService,
    private readonly capabilities: CapabilityService,
  ) {}

  /** What can be granted, and whether it takes effect right now. */
  listProfiles() {
    const enforced = capabilityMode() === 'enforce';
    return {
      mode: capabilityMode(),
      profiles: SYSTEM_PROFILES.map((p) => ({
        key: p.key, version: p.version, labelKey: p.labelKey, capabilities: [...p.capabilities],
        requiresEnforcement: p.requiresEnforcement, available: !p.requiresEnforcement || enforced,
      })),
    };
  }

  /** The member's current assignments, read with the given runner (a transaction after the member was locked, or the pool). */
  async currentAssignments(runner: Tx, companyId: string, memberId: string): Promise<AssignmentView[]> {
    const rows: Array<{
      warehouse_id: string; warehouse_name: string; key: string; version: number; label_key: string; capabilities: string[];
      source: AssignmentView['source'];
    }> = await runner.query(
      `SELECT wa.warehouse_id, w.name AS warehouse_name, 'operator' AS key, 1 AS version, 'access.profile.operator' AS label_key,
              NULL::text[] AS capabilities, 'legacy_warehouse_access' AS source
         FROM warehouse_access wa JOIN warehouses w ON w.id = wa.warehouse_id AND w.deleted_at IS NULL
        WHERE wa.user_id = $1 AND wa.company_id = $2
       UNION ALL
       SELECT g.scope_id, w.name, p.key, p.version, p.label_key, p.capabilities, 'access_grant'
         FROM access_grants g
         JOIN permission_profiles p ON p.id = g.profile_id
         JOIN warehouses w ON w.id = g.scope_id AND w.deleted_at IS NULL
        WHERE g.user_id = $1 AND g.company_id = $2 AND g.revoked_at IS NULL
          AND g.valid_from <= now() AND (g.valid_until IS NULL OR g.valid_until > now())
        ORDER BY 2, 1`,
      [memberId, companyId],
    );
    const operator = profileOf(OPERATOR_PROFILE_KEY)!;
    return rows.map((r) => ({
      warehouseId: r.warehouse_id, warehouseName: r.warehouse_name, profile: r.key, profileVersion: r.version,
      labelKey: r.label_key, capabilities: r.source === 'legacy_warehouse_access' ? [...operator.capabilities] : r.capabilities ?? [],
      source: r.source,
    }));
  }

  async getMemberAccess(companyId: string, memberId: string) {
    const [m] = await this.dataSource.query(
      `SELECT id, name, email, role::text AS role, status FROM users WHERE id = $1 AND company_id = $2`, [memberId, companyId],
    );
    if (!m) throw new NotFoundException('Member not found');
    const assignments = await this.currentAssignments(this.dataSource, companyId, memberId);
    return {
      memberId: m.id as string, name: m.name as string, email: m.email as string, role: m.role as string, status: m.status as string,
      // Admin and Manager see every warehouse: assignments do not apply to them.
      applicable: m.role === UserRole.STAFF && m.status !== MemberStatus.REMOVED,
      version: assignmentsVersion(assignments),
      assignments,
      ...this.listProfiles(),
    };
  }

  /** Replaces the member's whole assignment set (the same "replace" semantics as the legacy endpoint, with profiles). */
  async setMemberAccess(
    companyId: string, actorId: string, memberId: string, assignments: Assignment[],
    opts: { reason?: string; expectedVersion?: string } = {},
  ) {
    const result = await this.dataSource.transaction((m) =>
      this.applyForMember(m, companyId, actorId, memberId, () => assignments, 'api', opts),
    );
    await this.audit.write({
      actorUserId: actorId, companyId, action: 'ACCESS_ASSIGNMENTS_SET', entityType: 'user', entityId: memberId,
      newValues: { changes: result.changes, version: result.version },
    });
    return result;
  }

  /**
   * The core, inside the caller's transaction. `next` receives the member's current assignments and returns the desired
   * full set. Returns what changed and the new version.
   */
  async applyForMember(
    m: Tx, companyId: string, actorId: string, memberId: string,
    next: (current: AssignmentView[]) => Assignment[], source: GrantSource,
    opts: { reason?: string; expectedVersion?: string } = {},
  ) {
    if (actorId === memberId) {
      throw new ConflictException({ code: 'CANNOT_MODIFY_SELF', message: 'You cannot change your own access' });
    }
    await lockMemberExclusive(m, memberId);
    const [target] = await m.query(
      `SELECT id, role::text AS role, status FROM users WHERE id = $1 AND company_id = $2 FOR UPDATE`, [memberId, companyId],
    );
    if (!target) throw new NotFoundException('Member not found');
    if (target.status === MemberStatus.REMOVED) {
      throw new ConflictException({ code: 'TARGET_NOT_ACTIVE', message: 'A removed member has no access to assign; reactivate first' });
    }
    if (target.role !== UserRole.STAFF) {
      throw new BadRequestException({ code: 'ACCESS_NOT_APPLICABLE', message: 'Admin and Manager have access to every warehouse' });
    }

    const mode = capabilityMode();
    const view = mode === 'enforce' ? 'scoped' : 'legacy';
    const actor = await this.capabilities.loadPrincipal(actorId, companyId, m);
    if (!actor || actor.status !== MemberStatus.ACTIVE || !can(actor, PERMISSIONS.MANAGE_USERS, { view }).allowed) {
      throw new ForbiddenException({ code: 'ACCESS_GRANT_NOT_PERMITTED', message: 'You are not allowed to manage team access' });
    }

    const current = await this.currentAssignments(m, companyId, memberId);
    if (opts.expectedVersion && opts.expectedVersion !== assignmentsVersion(current)) {
      throw new ConflictException({ code: 'ACCESS_VERSION_CONFLICT', message: 'This member\'s access changed since you opened it' });
    }
    const desired = next(current);
    await this.validate(m, companyId, actor, desired, mode, view);

    const byWarehouse = new Map(current.map((c) => [c.warehouseId, c]));
    const wanted = new Map(desired.map((d) => [d.warehouseId, d]));
    const changes: Array<{ warehouseId: string; type: 'grant' | 'revoke' | 'replace'; from: string | null; to: string | null }> = [];
    const reason = opts.reason?.trim() || null;

    for (const wh of new Set([...byWarehouse.keys(), ...wanted.keys()])) {
      const before = byWarehouse.get(wh);
      const after = wanted.get(wh);
      if (before && after && before.profile === after.profile) continue;
      // Remove whatever held before (both stores), then add what is wanted.
      if (before) await this.remove(m, companyId, memberId, wh, actorId, reason ?? 'access changed');
      if (after) await this.add(m, companyId, memberId, wh, after.profile, actorId, reason);
      const type = before && after ? 'replace' : after ? 'grant' : 'revoke';
      changes.push({ warehouseId: wh, type, from: before?.profile ?? null, to: after?.profile ?? null });
      const to = after ? profileOf(after.profile) : undefined;
      await m.query(
        `INSERT INTO access_grant_events (company_id, actor_user_id, target_user_id, warehouse_id, event_type, profile_key,
                                          profile_version, previous_profile_key, source, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [companyId, actorId, memberId, wh, type, after?.profile ?? null, to?.version ?? null, before?.profile ?? null, source, reason],
      );
    }
    const now = await this.currentAssignments(m, companyId, memberId);
    return { memberId, changes, version: assignmentsVersion(now), assignments: now };
  }

  private async validate(m: Tx, companyId: string, actor: Principal, desired: Assignment[], mode: string, view: 'legacy' | 'scoped') {
    const seen = new Set<string>();
    for (const d of desired) {
      if (seen.has(d.warehouseId)) throw new BadRequestException({ code: 'DUPLICATE_WAREHOUSE', message: 'A warehouse can be assigned once' });
      seen.add(d.warehouseId);
      const profile = profileOf(d.profile);
      if (!profile) throw new BadRequestException({ code: 'UNKNOWN_PROFILE', message: 'Unknown access profile' });
      if (profile.requiresEnforcement && mode !== 'enforce') {
        throw new ConflictException({
          code: 'PROFILE_NOT_ENFORCED',
          message: 'This profile has no effect while the capability engine is not enforcing; it was not assigned',
        });
      }
      // No escalation: the grantor must hold every capability of the profile on that warehouse.
      if (!mayGrantProfile(actor, profile.capabilities, d.warehouseId, view)) {
        throw new ForbiddenException({ code: 'GRANT_EXCEEDS_AUTHORITY', message: 'You cannot grant more than you hold' });
      }
    }
    if (seen.size) {
      const [{ n }] = await m.query(
        `SELECT count(*)::int AS n FROM warehouses WHERE company_id = $1 AND deleted_at IS NULL AND id = ANY($2::uuid[])`,
        [companyId, [...seen]],
      );
      if (n !== seen.size) throw new NotFoundException('Warehouse not found or access denied');
    }
  }

  private async remove(m: Tx, companyId: string, memberId: string, warehouseId: string, actorId: string, reason: string) {
    await m.query(`DELETE FROM warehouse_access WHERE user_id = $1 AND company_id = $2 AND warehouse_id = $3`, [memberId, companyId, warehouseId]);
    await m.query(
      `UPDATE access_grants SET revoked_at = now(), revoked_by = $4, revoke_reason = $5
        WHERE user_id = $1 AND company_id = $2 AND scope_id = $3 AND revoked_at IS NULL`,
      [memberId, companyId, warehouseId, actorId, reason],
    );
  }

  private async add(m: Tx, companyId: string, memberId: string, warehouseId: string, profileKey: string, actorId: string, reason: string | null) {
    if (profileKey === OPERATOR_PROFILE_KEY) {
      await m.query(
        `INSERT INTO warehouse_access (company_id, user_id, warehouse_id, granted_by) VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, warehouse_id) DO NOTHING`,
        [companyId, memberId, warehouseId, actorId],
      );
      return;
    }
    const profile = profileOf(profileKey) as SystemProfile;
    const [row] = await m.query(
      `SELECT id FROM permission_profiles WHERE company_id IS NULL AND key = $1 AND version = $2 AND retired_at IS NULL`,
      [profile.key, profile.version],
    );
    if (!row) throw new ConflictException({ code: 'PROFILE_UNAVAILABLE', message: 'That profile version is not available' });
    await m.query(
      `INSERT INTO access_grants (company_id, user_id, profile_id, scope_type, scope_id, granted_by, reason)
       VALUES ($1, $2, $3, 'warehouse', $4, $5, $6)`,
      [companyId, memberId, row.id, warehouseId, actorId, reason],
    );
  }

  /**
   * Membership changes (removal, any role change) end the member's scoped grants in the same transaction, with evidence, so
   * an old grant can never resurface after a later demotion. The legacy warehouse_access rows follow the existing rules.
   */
  async revokeAllScopedGrants(m: Tx, companyId: string, memberId: string, actorId: string, reason: string): Promise<number> {
    const revoked: Array<{ scope_id: string; key: string; version: number }> = (await m.query(
      `UPDATE access_grants g SET revoked_at = now(), revoked_by = $3, revoke_reason = $4
         FROM permission_profiles p
        WHERE g.user_id = $1 AND g.company_id = $2 AND g.revoked_at IS NULL AND p.id = g.profile_id
        RETURNING g.scope_id, p.key, p.version`,
      [memberId, companyId, actorId, reason],
    ))[0];
    for (const r of revoked) {
      await m.query(
        `INSERT INTO access_grant_events (company_id, actor_user_id, target_user_id, warehouse_id, event_type, previous_profile_key, source, reason)
         VALUES ($1, $2, $3, $4, 'revoke', $5, 'membership', $6)`,
        [companyId, actorId, memberId, r.scope_id, r.key, reason],
      );
    }
    return revoked.length;
  }

  /** CP-4: assignments chosen at warehouse creation, in the creation transaction. Nothing is granted unless asked. */
  async assignOnCreate(m: Tx, companyId: string, actorId: string, warehouseId: string, requests: Array<{ userId: string; profile: string }>) {
    // Members are locked in id order, so two warehouse creations naming the same people cannot wait on each other.
    for (const req of [...requests].sort((a, b) => a.userId.localeCompare(b.userId))) {
      await this.applyForMember(
        m, companyId, actorId, req.userId,
        (current) => [...current.filter((c) => c.warehouseId !== warehouseId).map((c) => ({ warehouseId: c.warehouseId, profile: c.profile })), { warehouseId, profile: req.profile }],
        'warehouse_create',
      );
    }
  }

  /** Newest first. */
  async events(companyId: string, memberId: string, limit = 50) {
    const [member] = await this.dataSource.query(`SELECT 1 FROM users WHERE id = $1 AND company_id = $2`, [memberId, companyId]);
    if (!member) throw new NotFoundException('Member not found');
    return this.dataSource.query(
      `SELECT id, event_type AS "eventType", actor_user_id AS "actorUserId", warehouse_id AS "warehouseId", profile_key AS "profileKey",
              previous_profile_key AS "previousProfileKey", source, reason, created_at AS "createdAt"
         FROM access_grant_events WHERE company_id = $1 AND target_user_id = $2 ORDER BY created_at DESC LIMIT $3`,
      [companyId, memberId, Math.min(Math.max(limit, 1), 200)],
    );
  }
}
