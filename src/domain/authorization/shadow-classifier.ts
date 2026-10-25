import { KNOWN_CAPABILITIES, WAREHOUSE_SCOPED_CAPABILITIES } from '../../shared/constants/capabilities.constant';
import { PERMISSIONS } from '../../shared/constants/permissions.constant';
import {
  can, canAll, grantCapabilities, GrantView, Principal,
} from './capability-evaluator';

/**
 * Series 11 / F11-04: how a difference between the legacy decision and the capability model is judged while the engine
 * runs in shadow. Pure.
 *
 * A difference is EXPECTED only when it is the precise, intended effect of an explicit grant: the new model allows
 * something the legacy model denied, on warehouse W, for capability C, and an ACTIVE access_grant on exactly W carries
 * exactly C. Everything else is UNEXPECTED, and a rollout decision needs zero of those:
 *  - the new model takes away something the legacy model allowed;
 *  - the new model allows something no grant explains (another warehouse, another capability, an organization-level or
 *    financial capability, a role-based widening);
 *  - the capability asked about is not in the catalog;
 *  - the member the decision was made for does not belong to the company of the request.
 * Holding "some" grant never explains anything by itself.
 */
export type ShadowVerdict = 'equal' | 'expected' | 'unexpected';
export type ShadowReason =
  | 'same'
  | 'justified-by-grant'
  | 'legacy-allowed-scoped-denied'
  | 'unjustified-expansion'
  | 'unknown-capability'
  | 'cross-tenant'
  | 'unexplained';

export interface Justification { warehouseId: string; profileKey: string; profileVersion: number; capability: string }
export interface Unexplained { capability: string | null; warehouseId: string | null }

export interface ShadowClassification {
  verdict: ShadowVerdict;
  reason: ShadowReason;
  /** Which grants explain the (expected) difference. */
  justifiedBy: Justification[];
  /** Which (capability, warehouse) pairs the new model allows without any grant explaining them. */
  unexplained: Unexplained[];
}

/** A grant that is usable right now (the loader already drops the others; this re-checks, so a stale principal cannot justify). */
export function grantIsActive(g: GrantView, now: Date): boolean {
  if (g.source !== 'access_grant') return false;
  if (g.revokedAt) return false;
  if (g.validFrom && new Date(g.validFrom).getTime() > now.getTime()) return false;
  if (g.validUntil && new Date(g.validUntil).getTime() <= now.getTime()) return false;
  return true;
}

const equal = (): ShadowClassification => ({ verdict: 'equal', reason: 'same', justifiedBy: [], unexplained: [] });
const unexpected = (reason: ShadowReason, unexplained: Unexplained[] = []): ShadowClassification =>
  ({ verdict: 'unexpected', reason, justifiedBy: [], unexplained });

/** The grant (if any) that gives exactly `capability` on exactly `warehouseId`. */
function justifyingGrant(p: Principal, capability: string, warehouseId: string, now: Date): GrantView | undefined {
  if (!WAREHOUSE_SCOPED_CAPABILITIES.has(capability)) return undefined; // organization-level and financial capabilities never come from a grant
  return p.grants.find((g) => grantIsActive(g, now) && g.warehouseId === warehouseId && grantCapabilities(g).has(capability));
}

export interface PermissionInput {
  principal: Principal;
  /** The company of the authenticated request. */
  requestCompanyId: string;
  /** Everything the guard required (all of it must hold). */
  capabilities: readonly string[];
  /** The warehouses the request names (empty: an organization-level or list request). */
  warehouseIds: readonly string[];
  /** What the application actually decided (legacy guard + legacy scope). */
  legacyAllowed: boolean;
  now?: Date;
}

export function classifyPermission(input: PermissionInput): ShadowClassification {
  const { principal, requestCompanyId, capabilities, warehouseIds, legacyAllowed } = input;
  const now = input.now ?? new Date();
  if (principal.companyId !== requestCompanyId) return unexpected('cross-tenant');
  if (capabilities.some((c) => !KNOWN_CAPABILITIES.has(c))) return unexpected('unknown-capability');

  const scopedAllowed = capabilities.every((c) => canAll(principal, c, warehouseIds, 'scoped').allowed);
  if (legacyAllowed === scopedAllowed) return equal();
  if (legacyAllowed && !scopedAllowed) return unexpected('legacy-allowed-scoped-denied');

  // The new model allows what the legacy model denied: every such (capability, warehouse) pair needs its own grant.
  const justified: Justification[] = [];
  const unexplained: Unexplained[] = [];
  let newlyAllowedPairs = 0;
  for (const capability of capabilities) {
    const targets: Array<string | null> = warehouseIds.length ? [...new Set(warehouseIds)] : [null];
    for (const warehouseId of targets) {
      const ctx = warehouseId === null ? { view: 'scoped' as const } : { warehouseId, view: 'scoped' as const };
      const legacyCtx = warehouseId === null ? { view: 'legacy' as const } : { warehouseId, view: 'legacy' as const };
      if (!can(principal, capability, ctx).allowed) continue; // not allowed by the new model either: not a widening
      if (can(principal, capability, legacyCtx).allowed) continue; // already allowed before: not new
      newlyAllowedPairs += 1;
      const grant = warehouseId === null ? undefined : justifyingGrant(principal, capability, warehouseId, now);
      if (grant) justified.push({ warehouseId: grant.warehouseId, profileKey: grant.profileKey, profileVersion: grant.profileVersion, capability });
      else unexplained.push({ capability, warehouseId });
    }
  }
  if (newlyAllowedPairs === 0) return unexpected('unexplained'); // the two models disagree for a reason this module cannot see
  if (unexplained.length) return unexpected('unjustified-expansion', unexplained);
  return { verdict: 'expected', reason: 'justified-by-grant', justifiedBy: justified, unexplained: [] };
}

export interface ScopeInput {
  principal: Principal;
  requestCompanyId: string;
  /** The legacy scope (null: every warehouse) and the new model's scope. */
  legacy: readonly string[] | null;
  scoped: readonly string[] | null;
  now?: Date;
}

export function classifyScope(input: ScopeInput): ShadowClassification {
  const { principal, requestCompanyId, legacy, scoped } = input;
  const now = input.now ?? new Date();
  if (principal.companyId !== requestCompanyId) return unexpected('cross-tenant');
  const key = (s: readonly string[] | null) => (s === null ? '*' : [...new Set(s)].sort().join(','));
  if (key(legacy) === key(scoped)) return equal();
  if (legacy === null) return unexpected('legacy-allowed-scoped-denied'); // had every warehouse, now fewer
  if (scoped === null) return unexpected('unjustified-expansion', [{ capability: null, warehouseId: null }]); // role widening, never a grant
  const lost = legacy.filter((id) => !scoped.includes(id));
  if (lost.length) return unexpected('legacy-allowed-scoped-denied', lost.map((warehouseId) => ({ capability: null, warehouseId })));
  const justified: Justification[] = [];
  const unexplained: Unexplained[] = [];
  for (const warehouseId of scoped.filter((id) => !legacy.includes(id))) {
    const grant = justifyingGrant(principal, PERMISSIONS.VIEW_WAREHOUSE, warehouseId, now);
    if (grant) justified.push({ warehouseId, profileKey: grant.profileKey, profileVersion: grant.profileVersion, capability: PERMISSIONS.VIEW_WAREHOUSE });
    else unexplained.push({ capability: null, warehouseId });
  }
  if (unexplained.length) return unexpected('unjustified-expansion', unexplained);
  return { verdict: 'expected', reason: 'justified-by-grant', justifiedBy: justified, unexplained: [] };
}
