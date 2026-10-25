import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createHash } from 'crypto';
import {
  EffectiveCapabilities, GrantView, Principal,
} from '../../domain/authorization/capability-evaluator';
import { OPERATOR_PROFILE_KEY, SYSTEM_PROFILES } from '../../shared/constants/capabilities.constant';
import { lockMemberShared } from './member-lock';

type Runner = { query: (sql: string, params?: unknown[]) => Promise<any> };

const OPERATOR = SYSTEM_PROFILES.find((p) => p.key === OPERATOR_PROFILE_KEY)!;

// Series 13: the shadow telemetry lives in its own file; re-exported here so existing imports keep working.
export { CapabilityShadowService } from './capability-shadow.service';
export type { ShadowDifference } from './capability-shadow.service';

/**
 * Loads the authorization snapshot of one member (Principal) and the derived values clients use.
 *
 * Everything is read from the database at the moment of the call: the role and status of the member, the legacy role links,
 * the legacy warehouse_access rows (implicit `operator` grants) and the ACTIVE access_grants (not revoked, inside their
 * validity window, profile not retired and not another company's). With `lock`, the member row is share-locked first: any
 * change of the member's role, status or grants takes that row exclusively, so the snapshot cannot be overtaken by a
 * conflicting change before the caller's transaction ends.
 */
@Injectable()
export class CapabilityService {
  constructor(private readonly dataSource: DataSource) {}

  loadPrincipal(userId: string, companyId: string, runner: Runner = this.dataSource, opts: { lock?: boolean } = {}): Promise<Principal | null> {
    return loadPrincipalFrom(runner, userId, companyId, opts);
  }

  /** Per-request memo: the guards and the handler of one request share one snapshot. */
  async principalFor(req: { __principal?: Promise<Principal | null> }, userId: string, companyId: string): Promise<Principal | null> {
    req.__principal ??= this.loadPrincipal(userId, companyId);
    return req.__principal;
  }

  /**
   * An opaque, stable fingerprint of what the member may do. It changes exactly when their authority changes (role, status,
   * any grant or its profile version), so a client can tell "the same authority as before" from "changed" without a counter
   * that could drift. Not a secret and not a credential.
   */
  accessVersion(p: Principal, effective: EffectiveCapabilities): string {
    const canon = JSON.stringify({
      s: p.status, r: p.role, o: p.isOwner,
      org: effective.organization, all: effective.allWarehouses, cost: effective.canViewCost,
      w: effective.warehouses.map((w) => [w.warehouseId, w.capabilities, w.profiles.map((x) => `${x.key}@${x.version}`)]),
    });
    return createHash('sha256').update(canon).digest('hex').slice(0, 24);
  }
}

/**
 * Loads the authorization snapshot of one member. A standalone function so a stock transaction (which has a query runner,
 * not a service) can load it on its own connection, with `lock`: the member row is share-locked first, so any change of the
 * member's role, status or grants (which take that row exclusively) waits for the caller's transaction, or has already
 * committed and is therefore seen.
 */
export async function loadPrincipalFrom(runner: Runner, userId: string, companyId: string, opts: { lock?: boolean } = {}): Promise<Principal | null> {
    if (opts.lock) await lockMemberShared(runner, userId);
    const [u]: Array<{ id: string; company_id: string; role: string; status: string; is_owner: boolean }> = await runner.query(
      `SELECT id, company_id, role::text AS role, status, is_owner FROM users WHERE id = $1 AND company_id = $2${opts.lock ? ' FOR SHARE' : ''}`,
      [userId, companyId],
    );
    if (!u) return null;

    const rows: Array<{ kind: string; warehouse_id: string | null; name: string | null; key: string | null; version: number | null; capabilities: string[] | null; valid_from: string | null; valid_until: string | null }> =
      await runner.query(
        `SELECT 'custom' AS kind, NULL::text AS warehouse_id, p.name AS name, NULL::text AS key, NULL::int AS version, NULL::text[] AS capabilities,
                NULL::text AS valid_from, NULL::text AS valid_until
           FROM user_roles ur
           JOIN role_permissions rp ON rp.role_id = ur.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE ur.user_id = $1
         UNION ALL
         SELECT 'legacy', wa.warehouse_id::text, NULL, NULL, NULL, NULL, NULL, NULL
           FROM warehouse_access wa
          WHERE wa.user_id = $1 AND wa.company_id = $2
         UNION ALL
         SELECT 'grant', g.scope_id::text, NULL, p.key, p.version, p.capabilities, g.valid_from::text, g.valid_until::text
           FROM access_grants g
           JOIN permission_profiles p ON p.id = g.profile_id
          WHERE g.user_id = $1 AND g.company_id = $2
            AND g.revoked_at IS NULL AND g.valid_from <= now() AND (g.valid_until IS NULL OR g.valid_until > now())
            AND p.retired_at IS NULL AND (p.company_id IS NULL OR p.company_id = g.company_id)`,
        [userId, companyId],
      );

    const customCapabilities = [...new Set(rows.filter((r) => r.kind === 'custom').map((r) => r.name as string))];
    const grants: GrantView[] = [];
    for (const r of rows) {
      if (r.kind === 'legacy') {
        grants.push({
          warehouseId: r.warehouse_id as string, profileKey: OPERATOR.key, profileVersion: OPERATOR.version,
          capabilities: OPERATOR.capabilities, source: 'legacy_warehouse_access',
        });
      } else if (r.kind === 'grant') {
        grants.push({
          warehouseId: r.warehouse_id as string, profileKey: r.key as string, profileVersion: r.version as number,
          capabilities: r.capabilities ?? [], source: 'access_grant',
          validFrom: r.valid_from, validUntil: r.valid_until, revokedAt: null,
        });
      }
    }
    return { userId: u.id, companyId: u.company_id, role: u.role, status: u.status, isOwner: u.is_owner, customCapabilities, grants };
}
