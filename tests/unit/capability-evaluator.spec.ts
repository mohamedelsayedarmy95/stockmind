/**
 * Series 10 / S2: the pure capability evaluator. Invariants A1 (default deny), A2/A8 (legacy parity), A3 (scope), A4 (no
 * escalation), A7 (financial separation) are pinned here without a database; the PostgreSQL specs prove the wiring.
 */
import {
  can, canAll, effectiveCapabilities, GrantView, mayGrantProfile, Principal, warehouseScope,
} from '../../src/domain/authorization/capability-evaluator';
import {
  KNOWN_CAPABILITIES, SYSTEM_PROFILES, WAREHOUSE_SCOPED_CAPABILITIES, capabilityMode,
} from '../../src/shared/constants/capabilities.constant';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS } from '../../src/shared/constants/permissions.constant';

const W1 = '00000000-0000-4000-8000-000000000001';
const W2 = '00000000-0000-4000-8000-000000000002';
const W3 = '00000000-0000-4000-8000-000000000003';
const OTHER = '00000000-0000-4000-8000-0000000000ff';
const operator = SYSTEM_PROFILES.find((p) => p.key === 'operator')!;
const wm = SYSTEM_PROFILES.find((p) => p.key === 'warehouse_manager')!;

const legacyGrant = (warehouseId: string): GrantView => ({
  warehouseId, profileKey: 'operator', profileVersion: 1, capabilities: operator.capabilities, source: 'legacy_warehouse_access',
});
const scopedGrant = (warehouseId: string, caps: readonly string[] = wm.capabilities): GrantView => ({
  warehouseId, profileKey: 'warehouse_manager', profileVersion: 1, capabilities: caps, source: 'access_grant',
});
const principal = (over: Partial<Principal> = {}): Principal => ({
  userId: 'u', companyId: 'c', role: 'Staff', status: 'active', isOwner: false, customCapabilities: [], grants: [], ...over,
});

/** The decision the application made before Series 10, written out independently of the evaluator. */
function legacyReference(p: Principal, capability: string, warehouseId?: string): boolean {
  if (p.status !== 'active') return false;
  const permitted = (DEFAULT_ROLE_PERMISSIONS[p.role] ?? []).includes(capability as never) || p.customCapabilities.includes(capability);
  if (!permitted) return false;
  if (warehouseId === undefined) return true;
  if (p.role === 'Admin' || p.role === 'Manager') return true;
  return p.grants.some((g) => g.source === 'legacy_warehouse_access' && g.warehouseId === warehouseId);
}

describe('system profiles', () => {
  it('operator is EXACTLY what Staff could already do on a granted warehouse (every warehouse-level default of Staff)', () => {
    const staffWarehouse = DEFAULT_ROLE_PERMISSIONS.Staff.filter((c) => WAREHOUSE_SCOPED_CAPABILITIES.has(c)).sort();
    expect([...operator.capabilities].sort()).toEqual(staffWarehouse);
  });
  it('warehouse_manager adds adjustment, transfer and warehouse editing, and nothing financial, administrative or destructive', () => {
    const extra = wm.capabilities.filter((c) => !operator.capabilities.includes(c)).sort();
    expect(extra).toEqual([PERMISSIONS.STOCK_ADJUSTMENT, PERMISSIONS.STOCK_TRANSFER, PERMISSIONS.UPDATE_WAREHOUSE].sort());
    for (const never of [PERMISSIONS.VIEW_COST, PERMISSIONS.MANAGE_USERS, PERMISSIONS.MANAGE_ROLES, PERMISSIONS.MANAGE_RECOVERY,
      PERMISSIONS.CREATE_WAREHOUSE, PERMISSIONS.DELETE_WAREHOUSE, PERMISSIONS.CREATE_PRODUCT, PERMISSIONS.VIEW_AUDIT_LOG]) {
      expect(wm.capabilities).not.toContain(never);
    }
  });
  it('only the operator profile works without the engine enforcing', () => {
    expect(SYSTEM_PROFILES.map((p) => [p.key, p.requiresEnforcement])).toEqual([['operator', false], ['warehouse_manager', true]]);
  });
});

describe('A2/A8: the new model gives exactly the legacy answer to every legacy persona', () => {
  const personas: Array<[string, Principal]> = [
    ['Admin', principal({ role: 'Admin', isOwner: true })],
    ['Manager', principal({ role: 'Manager' })],
    ['Staff with W1', principal({ grants: [legacyGrant(W1)] })],
    ['Staff with W1+W3', principal({ grants: [legacyGrant(W1), legacyGrant(W3)] })],
    ['Staff without grants', principal()],
    ['Staff with a legacy custom role (cost)', principal({ grants: [legacyGrant(W1)], customCapabilities: [PERMISSIONS.VIEW_COST] })],
    ['Staff with a legacy custom role (adjust)', principal({ grants: [legacyGrant(W1)], customCapabilities: [PERMISSIONS.STOCK_ADJUSTMENT] })],
    ['Manager with a custom role', principal({ role: 'Manager', customCapabilities: [PERMISSIONS.VIEW_COST] })],
    ['suspended Staff', principal({ status: 'suspended', grants: [legacyGrant(W1)] })],
    ['removed Manager', principal({ role: 'Manager', status: 'removed' })],
  ];
  const caps = [...KNOWN_CAPABILITIES];
  const warehouses: Array<string | undefined> = [undefined, W1, W2, W3, OTHER];

  it.each(personas)('%s: legacy view = reference, scoped view = reference, for every capability and warehouse', (_name, p) => {
    for (const c of caps) {
      // A warehouse is only part of the question for warehouse-level capabilities (no endpoint combines the two otherwise).
      for (const w of WAREHOUSE_SCOPED_CAPABILITIES.has(c) ? warehouses : [undefined]) {
        const ref = legacyReference(p, c, w);
        expect({ c, w, legacy: can(p, c, { warehouseId: w, view: 'legacy' }).allowed }).toEqual({ c, w, legacy: ref });
        expect({ c, w, scoped: can(p, c, { warehouseId: w, view: 'scoped' }).allowed }).toEqual({ c, w, scoped: ref });
      }
    }
  });

  it('the legacy warehouse scope is the same in both views for legacy personas', () => {
    for (const [, p] of personas) expect(warehouseScope(p, 'scoped')).toEqual(warehouseScope(p, 'legacy'));
  });
});

describe('A3: scope', () => {
  const sm = principal({ grants: [scopedGrant(W1), scopedGrant(W3)] });
  it('a scoped warehouse manager acts on its warehouses only', () => {
    expect(can(sm, PERMISSIONS.STOCK_ADJUSTMENT, { warehouseId: W1, view: 'scoped' }).allowed).toBe(true);
    expect(can(sm, PERMISSIONS.STOCK_ADJUSTMENT, { warehouseId: W3, view: 'scoped' }).allowed).toBe(true);
    const out = can(sm, PERMISSIONS.STOCK_ADJUSTMENT, { warehouseId: W2, view: 'scoped' });
    expect(out).toEqual({ allowed: false, reason: 'out-of-scope' });
    expect(can(sm, PERMISSIONS.VIEW_BALANCE, { warehouseId: W2, view: 'scoped' }).allowed).toBe(false);
  });
  it('a transfer needs the capability on BOTH ends', () => {
    expect(canAll(sm, PERMISSIONS.STOCK_TRANSFER, [W1, W3], 'scoped').allowed).toBe(true);
    expect(canAll(sm, PERMISSIONS.STOCK_TRANSFER, [W1, W2], 'scoped').allowed).toBe(false);
    expect(canAll(sm, PERMISSIONS.STOCK_TRANSFER, [W2, W1], 'scoped').allowed).toBe(false);
  });
  it('the scoped model is the ONLY place a scoped grant counts: the legacy view ignores it', () => {
    expect(warehouseScope(sm, 'legacy')).toEqual([]);
    expect(can(sm, PERMISSIONS.STOCK_ADJUSTMENT, { warehouseId: W1, view: 'legacy' }).allowed).toBe(false);
  });
  it('a warehouse capability without a named warehouse (a list) is held through any grant, otherwise by the role base', () => {
    expect(can(sm, PERMISSIONS.STOCK_TRANSFER, { view: 'scoped' }).allowed).toBe(true);
    expect(can(principal(), PERMISSIONS.STOCK_TRANSFER, { view: 'scoped' }).allowed).toBe(false);
    expect(can(principal(), PERMISSIONS.VIEW_WAREHOUSE, { view: 'scoped' }).allowed).toBe(true); // Staff base: unchanged
  });
  it('a scoped warehouse manager keeps the Staff base: it is not a global Manager', () => {
    for (const c of [PERMISSIONS.CREATE_PRODUCT, PERMISSIONS.UPDATE_PRODUCT, PERMISSIONS.DELETE_PRODUCT, PERMISSIONS.CREATE_WAREHOUSE,
      PERMISSIONS.DELETE_WAREHOUSE, PERMISSIONS.MANAGE_USERS, PERMISSIONS.MANAGE_RECOVERY, PERMISSIONS.VIEW_AUDIT_LOG]) {
      expect({ c, a: can(sm, c, { view: 'scoped' }).allowed }).toEqual({ c, a: false });
    }
    expect(effectiveCapabilities(sm, 'scoped', [W1, W2, W3]).warehouses.map((w) => w.warehouseId)).toEqual([W1, W3]);
    expect(effectiveCapabilities(sm, 'scoped', [W1, W2, W3]).allWarehouses).toBe(false);
  });
});

describe('A1/A7: default deny and financial separation', () => {
  it('an unknown capability is never allowed, for anyone', () => {
    for (const role of ['Admin', 'Manager', 'Staff']) {
      expect(can(principal({ role }), 'item.set_cost', { view: 'scoped' })).toEqual({ allowed: false, reason: 'unknown-capability' });
      expect(can(principal({ role }), 'made.up', { warehouseId: W1, view: 'legacy' }).allowed).toBe(false);
    }
  });
  it('an unrecognised role or an inactive member has nothing', () => {
    expect(can(principal({ role: 'Superuser', grants: [scopedGrant(W1)] }), PERMISSIONS.VIEW_PRODUCT, { view: 'scoped' }).allowed).toBe(false);
    expect(can(principal({ status: 'suspended', grants: [scopedGrant(W1)] }), PERMISSIONS.VIEW_BALANCE, { warehouseId: W1, view: 'scoped' }))
      .toEqual({ allowed: false, reason: 'inactive' });
  });
  it('a stored profile cannot smuggle in capabilities a warehouse grant must never carry', () => {
    const tampered = principal({ grants: [scopedGrant(W1, [...wm.capabilities, PERMISSIONS.VIEW_COST, PERMISSIONS.MANAGE_USERS, 'item.set_cost', 'bogus'])] });
    expect(can(tampered, PERMISSIONS.VIEW_COST, { view: 'scoped' }).allowed).toBe(false);
    expect(can(tampered, PERMISSIONS.MANAGE_USERS, { view: 'scoped' }).allowed).toBe(false);
    expect(can(tampered, 'bogus', { warehouseId: W1, view: 'scoped' }).allowed).toBe(false);
    expect(effectiveCapabilities(tampered, 'scoped', [W1]).canViewCost).toBe(false);
  });
  it('operational access never implies cost visibility (not for a warehouse manager, not for a Manager)', () => {
    expect(effectiveCapabilities(principal({ grants: [scopedGrant(W1)] }), 'scoped', [W1]).canViewCost).toBe(false);
    expect(effectiveCapabilities(principal({ role: 'Manager' }), 'scoped', [W1]).canViewCost).toBe(false);
    expect(effectiveCapabilities(principal({ role: 'Admin' }), 'scoped', [W1]).canViewCost).toBe(true);
    expect(effectiveCapabilities(principal({ role: 'Manager', customCapabilities: [PERMISSIONS.VIEW_COST] }), 'scoped', [W1]).canViewCost).toBe(true);
  });
});

describe('A4: no privilege escalation', () => {
  const admin = principal({ role: 'Admin' });
  const operatorHolder = principal({ grants: [legacyGrant(W1)] });
  const wmHolder = principal({ grants: [scopedGrant(W1)] });
  it('an Admin may grant any profile on any warehouse', () => {
    expect(mayGrantProfile(admin, wm.capabilities, W2, 'scoped')).toBe(true);
    expect(mayGrantProfile(admin, operator.capabilities, W2, 'legacy')).toBe(true);
  });
  it('a grantor cannot hand out more than it holds, nor on a warehouse it cannot use', () => {
    expect(mayGrantProfile(operatorHolder, operator.capabilities, W1, 'scoped')).toBe(true);
    expect(mayGrantProfile(operatorHolder, wm.capabilities, W1, 'scoped')).toBe(false);
    expect(mayGrantProfile(operatorHolder, operator.capabilities, W2, 'scoped')).toBe(false);
    expect(mayGrantProfile(wmHolder, wm.capabilities, W1, 'scoped')).toBe(true);
    expect(mayGrantProfile(wmHolder, wm.capabilities, W3, 'scoped')).toBe(false);
  });
  it('an inactive grantor and an empty profile grant nothing', () => {
    expect(mayGrantProfile(principal({ role: 'Admin', status: 'suspended' }), wm.capabilities, W1, 'scoped')).toBe(false);
    expect(mayGrantProfile(admin, [], W1, 'scoped')).toBe(false);
    expect(mayGrantProfile(admin, [PERMISSIONS.VIEW_COST], W1, 'scoped')).toBe(false); // org-level capability: not grantable per warehouse
  });
});

describe('engine mode', () => {
  it('defaults to shadow; recognises off/shadow/enforce; anything else means off (no new behaviour)', () => {
    expect(capabilityMode({} as NodeJS.ProcessEnv)).toBe('shadow');
    expect(capabilityMode({ CAPABILITY_MODE: 'ENFORCE' } as unknown as NodeJS.ProcessEnv)).toBe('enforce');
    expect(capabilityMode({ CAPABILITY_MODE: 'off' } as unknown as NodeJS.ProcessEnv)).toBe('off');
    expect(() => capabilityMode({ CAPABILITY_MODE: 'yes' } as unknown as NodeJS.ProcessEnv)).toThrow(); // Series 11: an invalid value is refused, never turned into off
    expect(capabilityMode({ CAPABILITY_MODE: '' } as unknown as NodeJS.ProcessEnv)).toBe('shadow');
  });
});

describe('A9: the mobile app only names capabilities the server knows', () => {
  it('every value of the CAP table of the app is in the server catalogue (a renamed or invented capability fails here)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs'); const path = require('path');
    const text: string = fs.readFileSync(path.join(__dirname, '..', '..', 'mobile', 'src', 'domain', 'capabilities.ts'), 'utf8');
    const block = text.slice(text.indexOf('export const CAP = {'), text.indexOf('} as const;', text.indexOf('export const CAP = {')));
    const values = [...block.matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(values.length).toBeGreaterThan(10);
    for (const v of values) expect({ v, known: KNOWN_CAPABILITIES.has(v) }).toEqual({ v, known: true });
  });
});
