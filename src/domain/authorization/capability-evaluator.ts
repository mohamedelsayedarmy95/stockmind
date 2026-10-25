import { MemberStatus, UserRole } from '../../shared/constants/enums';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS } from '../../shared/constants/permissions.constant';
import {
  KNOWN_CAPABILITIES, NEVER_FROM_A_GRANT, WAREHOUSE_SCOPED_CAPABILITIES,
} from '../../shared/constants/capabilities.constant';

/**
 * The effective-capability evaluator (Series 10 / S2). Pure: no database, no framework. The service loads a Principal
 * (one consistent snapshot of the member, their grants and their legacy role links) and asks questions of it.
 *
 * Two VIEWS of the same principal exist, on purpose:
 *  - `legacy`: exactly the decision the application made before Series 10 (role defaults, legacy custom roles, and the
 *    warehouse_access list as the warehouse scope). Used while the engine is off/shadow, and as the reference the parity
 *    tests compare against.
 *  - `scoped`: the new model. Warehouse capabilities come from GRANTS (warehouse_access rows are implicit `operator`
 *    grants), organization capabilities from the role. Used only when the engine enforces.
 *
 * Default deny everywhere: an unknown capability, a revoked/expired/foreign/retired grant, an inactive member, an
 * unrecognised role, a missing warehouse in the scope: all answer "no".
 */
export type EvaluationView = 'legacy' | 'scoped';

export interface GrantView {
  warehouseId: string;
  profileKey: string;
  profileVersion: number;
  /** As stored on the profile; filtered through the catalog by the evaluator, never trusted as is. */
  capabilities: readonly string[];
  /** `warehouse_access` rows (implicit operator grants of the legacy model) or `access_grants` rows. */
  source: 'legacy_warehouse_access' | 'access_grant';
  /**
   * The grant's validity window and revocation, when known (the loader fills them for access_grants). The evaluator itself does
   * not use them: the loader only returns ACTIVE grants. They exist so the shadow comparison can re-verify, at the moment it
   * explains a difference, that the grant it cites is really active.
   */
  validFrom?: string | null;
  validUntil?: string | null;
  revokedAt?: string | null;
}

export interface Principal {
  userId: string;
  companyId: string;
  role: string;
  status: string;
  isOwner: boolean;
  /** Permissions linked through the legacy roles tables (user_roles → role_permissions): kept as they always worked. */
  customCapabilities: readonly string[];
  /** ACTIVE grants only (the loader drops revoked, not-yet-valid, expired and retired-profile ones). */
  grants: readonly GrantView[];
}

export interface Decision {
  allowed: boolean;
  /** Why, for diagnostics and tests only; never sent to clients as prose. */
  reason:
    | 'inactive' | 'unknown-capability' | 'admin' | 'role' | 'custom-role' | 'grant' | 'no-grant' | 'out-of-scope' | 'not-held';
}

const FULL_ACCESS_ROLES: ReadonlySet<string> = new Set([UserRole.ADMIN, UserRole.MANAGER]);

const roleDefaults = (role: string): ReadonlySet<string> => new Set(DEFAULT_ROLE_PERMISSIONS[role] ?? []);
const custom = (p: Principal): ReadonlySet<string> => new Set(p.customCapabilities.filter((c) => KNOWN_CAPABILITIES.has(c)));

/** Capabilities a grant really carries: only known, warehouse-level ones (a stored profile cannot smuggle in more). */
export function grantCapabilities(g: GrantView): ReadonlySet<string> {
  return new Set(g.capabilities.filter((c) => KNOWN_CAPABILITIES.has(c) && !NEVER_FROM_A_GRANT.has(c)));
}

/** null = every warehouse of the company; otherwise the ids this member may use. */
export function warehouseScope(p: Principal, view: EvaluationView): string[] | null {
  if (p.status !== MemberStatus.ACTIVE) return [];
  if (FULL_ACCESS_ROLES.has(p.role)) return null;
  const ids = p.grants
    .filter((g) => view === 'scoped' || g.source === 'legacy_warehouse_access')
    .map((g) => g.warehouseId);
  return [...new Set(ids)];
}

/** Warehouse-scoped capabilities this member holds on ONE warehouse. */
function heldOnWarehouse(p: Principal, warehouseId: string, view: EvaluationView): Set<string> {
  const out = new Set<string>();
  if (view === 'legacy') {
    for (const c of roleDefaults(p.role)) out.add(c);
  } else {
    for (const g of p.grants) {
      if (g.warehouseId === warehouseId) for (const c of grantCapabilities(g)) out.add(c);
    }
  }
  for (const c of custom(p)) out.add(c);
  return out;
}

export function can(
  p: Principal,
  capability: string,
  ctx: { warehouseId?: string; view: EvaluationView },
): Decision {
  if (!KNOWN_CAPABILITIES.has(capability)) return { allowed: false, reason: 'unknown-capability' };
  if (p.status !== MemberStatus.ACTIVE) return { allowed: false, reason: 'inactive' };
  if (p.role === UserRole.ADMIN) return { allowed: true, reason: 'admin' };

  const base = roleDefaults(p.role);
  const extra = custom(p);

  // Organization-level capability (or a warehouse capability asked without naming a warehouse, e.g. a list endpoint):
  if (ctx.warehouseId === undefined || !WAREHOUSE_SCOPED_CAPABILITIES.has(capability)) {
    if (base.has(capability)) return { allowed: true, reason: 'role' };
    if (extra.has(capability)) return { allowed: true, reason: 'custom-role' };
    // A warehouse capability without a named warehouse: held through ANY grant (the data is filtered by scope afterwards).
    if (
      ctx.view === 'scoped' && WAREHOUSE_SCOPED_CAPABILITIES.has(capability) &&
      p.grants.some((g) => grantCapabilities(g).has(capability))
    ) {
      return { allowed: true, reason: 'grant' };
    }
    return { allowed: false, reason: 'not-held' };
  }

  // A warehouse capability on a named warehouse: the warehouse must be in scope AND the capability held THERE.
  const scope = warehouseScope(p, ctx.view);
  if (scope !== null && !scope.includes(ctx.warehouseId)) return { allowed: false, reason: 'out-of-scope' };
  if (FULL_ACCESS_ROLES.has(p.role)) {
    // Manager: company-wide by design (unchanged semantics); the capability comes from the role or a legacy custom role.
    return base.has(capability) || extra.has(capability)
      ? { allowed: true, reason: base.has(capability) ? 'role' : 'custom-role' }
      : { allowed: false, reason: 'not-held' };
  }
  const held = heldOnWarehouse(p, ctx.warehouseId, ctx.view);
  if (held.has(capability)) {
    return { allowed: true, reason: ctx.view === 'scoped' && !extra.has(capability) ? 'grant' : 'role' };
  }
  return { allowed: false, reason: scope && scope.includes(ctx.warehouseId) ? 'not-held' : 'no-grant' };
}

/** The same question for several warehouses (a transfer): every one must pass, and one failure names no other. */
export function canAll(
  p: Principal,
  capability: string,
  warehouseIds: readonly string[],
  view: EvaluationView,
): Decision {
  if (!warehouseIds.length) return can(p, capability, { view });
  for (const warehouseId of new Set(warehouseIds)) {
    const d = can(p, capability, { warehouseId, view });
    if (!d.allowed) return d;
  }
  return { allowed: true, reason: 'role' };
}

/** What a member may do, for /me/capabilities and the parity tests. */
export interface EffectiveCapabilities {
  organization: string[];
  warehouses: Array<{ warehouseId: string; capabilities: string[]; profiles: Array<{ key: string; version: number }> }>;
  allWarehouses: boolean;
  canViewCost: boolean;
}

export function effectiveCapabilities(p: Principal, view: EvaluationView, warehouseIds: readonly string[]): EffectiveCapabilities {
  const organization = [...new Set(
    [...KNOWN_CAPABILITIES].filter((c) => !WAREHOUSE_SCOPED_CAPABILITIES.has(c) && can(p, c, { view }).allowed),
  )].sort();
  const scope = warehouseScope(p, view);
  const visible = scope === null ? [...warehouseIds] : warehouseIds.filter((id) => scope.includes(id));
  const warehouses = visible.map((warehouseId) => ({
    warehouseId,
    capabilities: [...WAREHOUSE_SCOPED_CAPABILITIES].filter((c) => can(p, c, { warehouseId, view }).allowed).sort(),
    profiles: p.grants
      .filter((g) => g.warehouseId === warehouseId && (view === 'scoped' || g.source === 'legacy_warehouse_access'))
      .map((g) => ({ key: g.profileKey, version: g.profileVersion })),
  }));
  return {
    organization,
    warehouses,
    allWarehouses: scope === null,
    canViewCost: can(p, PERMISSIONS.VIEW_COST, { view }).allowed,
  };
}

/**
 * Anti-escalation (A4): a grantor may hand out a profile on a warehouse only if the grantor holds EVERY capability of that
 * profile there already (an Admin holds all). Combined with the endpoint's own administrative capability this means
 * nobody delegates beyond their own authority, whatever the profile.
 */
export function mayGrantProfile(
  grantor: Principal,
  profileCapabilities: readonly string[],
  warehouseId: string,
  view: EvaluationView,
): boolean {
  if (grantor.status !== MemberStatus.ACTIVE) return false;
  const carried = [...grantCapabilities({ warehouseId, profileKey: '', profileVersion: 0, capabilities: profileCapabilities, source: 'access_grant' })];
  if (carried.length === 0) return false; // nothing to grant is not a grant
  return carried.every((c) => can(grantor, c, { warehouseId, view }).allowed);
}
