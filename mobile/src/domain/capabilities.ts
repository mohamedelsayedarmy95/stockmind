/**
 * What the signed-in member may do, as the SERVER described it (GET /me/capabilities), and the pure rules the app uses to
 * decide what to SHOW (Series 10 / S2, ADR-H). Nothing here authorizes anything: every endpoint decides for itself, so a stale,
 * missing or tampered snapshot can hide or show a control but never grant access. The snapshot lives in memory only, is
 * dropped at sign-out and account switch, and is refreshed on foreground and whenever the server answers "denied".
 */
export const CAP = {
  VIEW_PRODUCT: 'VIEW_PRODUCT',
  CREATE_PRODUCT: 'CREATE_PRODUCT',
  UPDATE_PRODUCT: 'UPDATE_PRODUCT',
  DELETE_PRODUCT: 'DELETE_PRODUCT',
  VIEW_WAREHOUSE: 'VIEW_WAREHOUSE',
  CREATE_WAREHOUSE: 'CREATE_WAREHOUSE',
  UPDATE_WAREHOUSE: 'UPDATE_WAREHOUSE',
  DELETE_WAREHOUSE: 'DELETE_WAREHOUSE',
  STOCK_INBOUND: 'STOCK_INBOUND',
  STOCK_OUTBOUND: 'STOCK_OUTBOUND',
  STOCK_ADJUSTMENT: 'STOCK_ADJUSTMENT',
  STOCK_TRANSFER: 'STOCK_TRANSFER',
  VIEW_BALANCE: 'VIEW_BALANCE',
  VIEW_MOVEMENTS: 'VIEW_MOVEMENTS',
  MANAGE_USERS: 'MANAGE_USERS',
  VIEW_COST: 'item.view_cost',
} as const;

/** Capabilities held per warehouse (everything else is organization-level). Mirrors the server's catalogue. */
export const WAREHOUSE_LEVEL: ReadonlySet<string> = new Set([
  CAP.VIEW_WAREHOUSE, CAP.UPDATE_WAREHOUSE, CAP.DELETE_WAREHOUSE, CAP.STOCK_INBOUND, CAP.STOCK_OUTBOUND,
  CAP.STOCK_ADJUSTMENT, CAP.STOCK_TRANSFER, CAP.VIEW_BALANCE, CAP.VIEW_MOVEMENTS,
]);

export interface WarehouseCapabilities {
  id: string;
  name: string;
  capabilities: string[];
  profiles: Array<{ key: string; version: number }>;
}

export interface CapabilitySnapshot {
  engine: { mode: 'off' | 'shadow' | 'enforce'; enforced: boolean; version: number };
  /** Changes exactly when the member's authority changes. */
  accessVersion: string;
  ttlSeconds: number;
  membership: { status: string; role: string; isOwner: boolean };
  capabilities: { organization: string[]; financial: { viewCost: boolean }; team: { manage: boolean } };
  warehouses: { all: boolean; items: WarehouseCapabilities[] };
  /** Client-side: when this copy was fetched (ms). */
  fetchedAt: number;
  /** 'server' normally; 'role-fallback' when only the signed-in role is known (nothing was fetched yet). */
  source: 'server' | 'role-fallback';
  /** Fallback only: what a role-wide member can do on any warehouse. */
  anyWarehouse?: string[];
}

export function isActive(s: CapabilitySnapshot | null): s is CapabilitySnapshot {
  return !!s && s.membership.status === 'active';
}

/** True when the member (per this copy) holds `capability`, on `warehouseId` when it is a warehouse-level one. */
export function can(s: CapabilitySnapshot | null, capability: string, warehouseId?: string): boolean {
  if (!isActive(s)) return false;
  if (capability === CAP.VIEW_COST) return s.capabilities.financial.viewCost;
  if (capability === CAP.MANAGE_USERS) return s.capabilities.team.manage;
  if (!WAREHOUSE_LEVEL.has(capability)) return s.capabilities.organization.includes(capability);
  if (warehouseId) {
    const w = s.warehouses.items.find((i) => i.id === warehouseId);
    if (w) return w.capabilities.includes(capability);
    return s.warehouses.all && (s.anyWarehouse ?? []).includes(capability);
  }
  return s.warehouses.items.some((i) => i.capabilities.includes(capability)) || (s.warehouses.all && (s.anyWarehouse ?? []).includes(capability));
}

export interface NavigationFlags {
  scan: boolean;
  warehouses: boolean;
  analytics: boolean;
  team: boolean;
}

/**
 * Which destinations exist for this member. The dashboard and Settings always exist. A destination whose every action the
 * server would refuse is not shown; the warehouse list stays (with an explanation) when the member simply has no warehouse yet.
 */
export function navigationFor(s: CapabilitySnapshot | null): NavigationFlags {
  if (!isActive(s)) return { scan: false, warehouses: false, analytics: false, team: false };
  return {
    scan: can(s, CAP.VIEW_PRODUCT) || can(s, CAP.STOCK_INBOUND) || can(s, CAP.STOCK_OUTBOUND),
    warehouses: true,
    analytics: can(s, CAP.VIEW_BALANCE) || can(s, CAP.VIEW_MOVEMENTS),
    team: can(s, CAP.MANAGE_USERS),
  };
}

export function isStale(s: CapabilitySnapshot | null, now: number): boolean {
  return !s || s.ttlSeconds <= 0 || now - s.fetchedAt > s.ttlSeconds * 1000;
}

/** Why a member sees an empty warehouse list: nothing assigned (guidance) versus an access problem. */
export function warehouseEmptyReason(s: CapabilitySnapshot | null): 'loading' | 'none-assigned' | 'inactive' | null {
  if (!s) return 'loading';
  if (!isActive(s)) return 'inactive';
  return !s.warehouses.all && s.warehouses.items.length === 0 ? 'none-assigned' : null;
}

/**
 * Used only until the server's answer arrives (or when it cannot be reached): what the member's ROLE implied before Series 10.
 * Conservative for Staff (nothing per warehouse until granted). The server still decides every request.
 */
export function roleFallback(role: string, now: number): CapabilitySnapshot {
  const staff = [CAP.VIEW_PRODUCT];
  const manager = [
    CAP.VIEW_PRODUCT, CAP.CREATE_PRODUCT, CAP.UPDATE_PRODUCT, CAP.DELETE_PRODUCT, CAP.CREATE_WAREHOUSE,
  ];
  const admin = [...manager, CAP.MANAGE_USERS];
  const warehouseWide = [
    CAP.VIEW_WAREHOUSE, CAP.STOCK_INBOUND, CAP.STOCK_OUTBOUND, CAP.VIEW_BALANCE, CAP.VIEW_MOVEMENTS,
    CAP.STOCK_ADJUSTMENT, CAP.STOCK_TRANSFER, CAP.UPDATE_WAREHOUSE,
  ];
  const wide = role === 'Admin' || role === 'Manager';
  return {
    engine: { mode: 'off', enforced: false, version: 0 },
    accessVersion: 'fallback',
    ttlSeconds: 0,
    membership: { status: 'active', role, isOwner: false },
    capabilities: {
      organization: role === 'Admin' ? admin : role === 'Manager' ? manager : staff,
      financial: { viewCost: role === 'Admin' },
      team: { manage: role === 'Admin' },
    },
    warehouses: { all: wide, items: [] },
    anyWarehouse: wide ? (role === 'Admin' ? [...warehouseWide, CAP.DELETE_WAREHOUSE] : warehouseWide) : [],
    fetchedAt: now,
    source: 'role-fallback',
  };
}

/** Human-readable effect of a profile, as message keys (the screen translates them): one line per thing it allows. */
export function profileEffectKeys(capabilities: readonly string[]): string[] {
  const has = (c: string) => capabilities.includes(c);
  const keys: string[] = [];
  if (has(CAP.VIEW_BALANCE) || has(CAP.VIEW_MOVEMENTS)) keys.push('access.effect.view');
  if (has(CAP.STOCK_INBOUND)) keys.push('access.effect.receive');
  if (has(CAP.STOCK_OUTBOUND)) keys.push('access.effect.issue');
  if (has(CAP.STOCK_ADJUSTMENT)) keys.push('access.effect.adjust');
  if (has(CAP.STOCK_TRANSFER)) keys.push('access.effect.transfer');
  if (has(CAP.UPDATE_WAREHOUSE)) keys.push('access.effect.editWarehouse');
  return keys;
}

/** Server refusal codes of the access endpoints → message keys. */
const ACCESS_ERRORS: Record<string, string> = {
  ACCESS_VERSION_CONFLICT: 'access.error.conflict',
  PROFILE_NOT_ENFORCED: 'access.error.notEnforced',
  GRANT_EXCEEDS_AUTHORITY: 'access.error.exceeds',
  ACCESS_NOT_APPLICABLE: 'access.error.notApplicable',
  ACCESS_GRANT_NOT_PERMITTED: 'access.error.notPermitted',
  TARGET_NOT_ACTIVE: 'access.error.inactive',
  CANNOT_MODIFY_SELF: 'access.error.self',
  DUPLICATE_WAREHOUSE: 'access.error.generic',
  UNKNOWN_PROFILE: 'access.error.generic',
};
export const ACCESS_ERROR_CODES = Object.keys(ACCESS_ERRORS);

export function accessErrorKey(status: number | undefined, code: string | undefined): string {
  if (status === undefined) return 'access.error.network';
  if (code && ACCESS_ERRORS[code]) return ACCESS_ERRORS[code];
  if (status === 403) return 'access.error.forbidden';
  if (status === 404) return 'access.error.notFound';
  return 'access.error.generic';
}

// ── Warehouse access assignments (Team → a member's access) ─────────────────────────────────────────────────────────────

export interface AccessProfileInfo {
  key: string;
  version: number;
  labelKey: string;
  capabilities: string[];
  requiresEnforcement: boolean;
  /** False when the server would store the assignment but it would do nothing (the engine does not enforce it). */
  available: boolean;
}

export interface AssignmentInfo {
  warehouseId: string;
  warehouseName: string;
  profile: string;
  profileVersion: number;
  capabilities: string[];
}

export type Choice = string | 'none';

export interface AccessChange {
  warehouseId: string;
  type: 'grant' | 'revoke' | 'replace';
  from: string | null;
  to: string | null;
}

/** What saving would do: the same classification the server records (grant / revoke / replace). Used to explain before saving. */
export function diffAssignments(current: readonly AssignmentInfo[], desired: Readonly<Record<string, Choice>>): AccessChange[] {
  const before = new Map(current.map((c) => [c.warehouseId, c.profile]));
  const out: AccessChange[] = [];
  const ids = new Set([...before.keys(), ...Object.keys(desired)]);
  for (const warehouseId of ids) {
    const from = before.get(warehouseId) ?? null;
    const wanted = desired[warehouseId];
    const to = wanted === undefined ? from : wanted === 'none' ? null : wanted;
    if (from === to) continue;
    out.push({ warehouseId, type: from && to ? 'replace' : to ? 'grant' : 'revoke', from, to });
  }
  return out.sort((a, b) => a.warehouseId.localeCompare(b.warehouseId));
}

/** The request body for a full replacement of the member's access. */
export function toAssignments(current: readonly AssignmentInfo[], desired: Readonly<Record<string, Choice>>): Array<{ warehouseId: string; profile: string }> {
  const merged: Record<string, Choice> = Object.fromEntries(current.map((c) => [c.warehouseId, c.profile]));
  for (const [id, choice] of Object.entries(desired)) merged[id] = choice;
  return Object.entries(merged).filter(([, v]) => v !== 'none').map(([warehouseId, profile]) => ({ warehouseId, profile }));
}

/** Which choices a warehouse row offers: "none" always; a profile only if the server says it takes effect. */
export function offeredChoices(profiles: readonly AccessProfileInfo[]): Array<{ key: Choice; available: boolean; labelKey: string }> {
  return [
    { key: 'none', available: true, labelKey: 'access.choice.none' },
    ...profiles.map((p) => ({ key: p.key, available: p.available, labelKey: p.labelKey })),
  ];
}
