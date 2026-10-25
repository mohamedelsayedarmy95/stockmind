import {
  ACCESS_ERROR_CODES, accessErrorKey, can, CAP, CapabilitySnapshot, diffAssignments, isStale, navigationFor, offeredChoices,
  profileEffectKeys, roleFallback, toAssignments, warehouseEmptyReason,
} from './capabilities';
import { onCapabilityRefresh, resetCapabilitySignal, signalCapabilityRefresh } from './capability-signal';

const W1 = 'w1'; const W2 = 'w2'; const W3 = 'w3';
const base = (over: Partial<CapabilitySnapshot> = {}): CapabilitySnapshot => ({
  engine: { mode: 'enforce', enforced: true, version: 1 }, accessVersion: 'v', ttlSeconds: 300,
  membership: { status: 'active', role: 'Staff', isOwner: false },
  capabilities: { organization: ['VIEW_PRODUCT'], financial: { viewCost: false }, team: { manage: false } },
  warehouses: { all: false, items: [] }, fetchedAt: 1000, source: 'server', ...over,
});
const operator = ['VIEW_WAREHOUSE', 'STOCK_INBOUND', 'STOCK_OUTBOUND', 'VIEW_BALANCE', 'VIEW_MOVEMENTS'];
const wm = [...operator, 'STOCK_ADJUSTMENT', 'STOCK_TRANSFER', 'UPDATE_WAREHOUSE'];
const item = (id: string, capabilities: string[]) => ({ id, name: id, capabilities, profiles: [] });

const staff = base({ warehouses: { all: false, items: [item(W1, operator)] } });
const scoped = base({ warehouses: { all: false, items: [item(W1, wm), item(W3, wm)] } });
const manager = base({
  membership: { status: 'active', role: 'Manager', isOwner: false },
  capabilities: { organization: ['VIEW_PRODUCT', 'CREATE_PRODUCT', 'UPDATE_PRODUCT', 'DELETE_PRODUCT', 'CREATE_WAREHOUSE'], financial: { viewCost: false }, team: { manage: false } },
  warehouses: { all: true, items: [item(W1, wm), item(W2, wm), item(W3, wm)] },
});
const owner = base({
  membership: { status: 'active', role: 'Admin', isOwner: true },
  capabilities: { organization: ['VIEW_PRODUCT', 'CREATE_PRODUCT', 'MANAGE_USERS'], financial: { viewCost: true }, team: { manage: true } },
  warehouses: { all: true, items: [item(W1, wm)] },
});

describe('what the app shows follows the server snapshot', () => {
  it('a scoped warehouse manager can adjust and transfer on its warehouses only', () => {
    expect(can(scoped, CAP.STOCK_ADJUSTMENT, W1)).toBe(true);
    expect(can(scoped, CAP.STOCK_TRANSFER, W3)).toBe(true);
    expect(can(scoped, CAP.STOCK_ADJUSTMENT, W2)).toBe(false);
    expect(can(scoped, CAP.STOCK_ADJUSTMENT)).toBe(true); // somewhere
  });
  it('an operator gets receive and issue, not adjust or transfer, and nothing on another warehouse', () => {
    expect(can(staff, CAP.STOCK_INBOUND, W1)).toBe(true);
    expect(can(staff, CAP.STOCK_ADJUSTMENT, W1)).toBe(false);
    expect(can(staff, CAP.STOCK_TRANSFER)).toBe(false);
    expect(can(staff, CAP.STOCK_INBOUND, W2)).toBe(false);
  });
  it('organization-level controls come from the organization list, never from a warehouse grant', () => {
    expect(can(scoped, CAP.CREATE_PRODUCT)).toBe(false);
    expect(can(scoped, CAP.CREATE_WAREHOUSE)).toBe(false);
    expect(can(manager, CAP.CREATE_PRODUCT)).toBe(true);
    expect(can(manager, CAP.MANAGE_USERS)).toBe(false);
    expect(can(owner, CAP.MANAGE_USERS)).toBe(true);
  });
  it('financial visibility is its own flag: warehouse management never implies it', () => {
    expect(can(scoped, CAP.VIEW_COST)).toBe(false);
    expect(can(manager, CAP.VIEW_COST)).toBe(false);
    expect(can(owner, CAP.VIEW_COST)).toBe(true);
  });
  it('no snapshot, or an inactive member, can do nothing (the safe default is to hide)', () => {
    expect(can(null, CAP.VIEW_PRODUCT)).toBe(false);
    expect(can(base({ membership: { status: 'suspended', role: 'Staff', isOwner: false } }), CAP.VIEW_PRODUCT)).toBe(false);
    expect(navigationFor(null)).toEqual({ scan: false, warehouses: false, analytics: false, team: false });
  });
});

describe('navigation', () => {
  it('Owner and Manager see everything they can use; only the owner sees Team', () => {
    expect(navigationFor(owner)).toEqual({ scan: true, warehouses: true, analytics: true, team: true });
    expect(navigationFor(manager)).toEqual({ scan: true, warehouses: true, analytics: true, team: false });
  });
  it('Staff and the scoped manager never see Team', () => {
    expect(navigationFor(staff).team).toBe(false);
    expect(navigationFor(scoped).team).toBe(false);
  });
  it('analytics needs a balance or movement capability somewhere; a member without any warehouse does not get it', () => {
    expect(navigationFor(base()).analytics).toBe(false);
    expect(navigationFor(staff).analytics).toBe(true);
  });
  it('a member with no warehouse yet still has the list, with an explanation instead of a blank screen', () => {
    expect(navigationFor(base()).warehouses).toBe(true);
    expect(warehouseEmptyReason(base())).toBe('none-assigned');
    expect(warehouseEmptyReason(staff)).toBeNull();
    expect(warehouseEmptyReason(manager)).toBeNull();
    expect(warehouseEmptyReason(null)).toBe('loading');
    expect(warehouseEmptyReason(base({ membership: { status: 'removed', role: 'Staff', isOwner: false } }))).toBe('inactive');
  });
});

describe('freshness and fallback', () => {
  it('a copy is stale after its ttl, and a missing one always is', () => {
    expect(isStale(staff, 1000 + 299_000)).toBe(false);
    expect(isStale(staff, 1000 + 301_000)).toBe(true);
    expect(isStale(null, 0)).toBe(true);
  });
  it('the role fallback is conservative for Staff and keeps Admin/Manager company-wide, and is marked as a fallback', () => {
    const s = roleFallback('Staff', 5);
    expect(s.source).toBe('role-fallback');
    expect(can(s, CAP.STOCK_INBOUND, W1)).toBe(false);
    expect(can(s, CAP.VIEW_PRODUCT)).toBe(true);
    const m = roleFallback('Manager', 5);
    expect(can(m, CAP.STOCK_TRANSFER, W2)).toBe(true);
    expect(can(m, CAP.MANAGE_USERS)).toBe(false);
    expect(can(m, CAP.VIEW_COST)).toBe(false);
    const a = roleFallback('Admin', 5);
    expect(can(a, CAP.MANAGE_USERS)).toBe(true);
    expect(can(a, CAP.VIEW_COST)).toBe(true);
    expect(isStale(a, 5)).toBe(true); // ttl 0: replaced by the server's answer as soon as it arrives
  });
});

describe('profile explanations and errors', () => {
  it('every capability a profile carries produces a line, in a stable order, and nothing is invented', () => {
    expect(profileEffectKeys(operator)).toEqual(['access.effect.view', 'access.effect.receive', 'access.effect.issue']);
    expect(profileEffectKeys(wm)).toEqual([
      'access.effect.view', 'access.effect.receive', 'access.effect.issue', 'access.effect.adjust', 'access.effect.transfer', 'access.effect.editWarehouse',
    ]);
    expect(profileEffectKeys([])).toEqual([]);
  });
  it('every refusal code the access endpoints can send maps to a message key', () => {
    for (const code of ACCESS_ERROR_CODES) expect(accessErrorKey(409, code)).toMatch(/^access\.error\./);
    expect(accessErrorKey(undefined, undefined)).toBe('access.error.network');
    expect(accessErrorKey(403, 'NEW_CODE')).toBe('access.error.forbidden');
    expect(accessErrorKey(404, undefined)).toBe('access.error.notFound');
    expect(accessErrorKey(500, undefined)).toBe('access.error.generic');
  });
});

describe('assignments: explain before saving', () => {
  const current = [
    { warehouseId: 'w1', warehouseName: 'W1', profile: 'operator', profileVersion: 1, capabilities: operator },
    { warehouseId: 'w3', warehouseName: 'W3', profile: 'warehouse_manager', profileVersion: 1, capabilities: wm },
  ];
  it('classifies each change the way the server records it: grant, replace, revoke; unchanged rows are not changes', () => {
    expect(diffAssignments(current, { w1: 'operator', w2: 'operator', w3: 'none' })).toEqual([
      { warehouseId: 'w2', type: 'grant', from: null, to: 'operator' },
      { warehouseId: 'w3', type: 'revoke', from: 'warehouse_manager', to: null },
    ]);
    expect(diffAssignments(current, { w1: 'warehouse_manager' })).toEqual([
      { warehouseId: 'w1', type: 'replace', from: 'operator', to: 'warehouse_manager' },
    ]);
    expect(diffAssignments(current, {})).toEqual([]);
    expect(diffAssignments(current, { w9: 'none' })).toEqual([]); // choosing "none" for something never assigned is nothing
  });
  it('the request replaces the whole set: untouched rows are kept, "none" rows are dropped', () => {
    expect(toAssignments(current, { w2: 'operator', w3: 'none' }).sort((a, b) => a.warehouseId.localeCompare(b.warehouseId))).toEqual([
      { warehouseId: 'w1', profile: 'operator' }, { warehouseId: 'w2', profile: 'operator' },
    ]);
    expect(toAssignments([], {})).toEqual([]);
  });
  it('a profile the server will not enforce is shown but cannot be chosen (no phantom controls)', () => {
    const profiles = [
      { key: 'operator', version: 1, labelKey: 'access.profile.operator', capabilities: operator, requiresEnforcement: false, available: true },
      { key: 'warehouse_manager', version: 1, labelKey: 'access.profile.warehouse_manager', capabilities: wm, requiresEnforcement: true, available: false },
    ];
    expect(offeredChoices(profiles)).toEqual([
      { key: 'none', available: true, labelKey: 'access.choice.none' },
      { key: 'operator', available: true, labelKey: 'access.profile.operator' },
      { key: 'warehouse_manager', available: false, labelKey: 'access.profile.warehouse_manager' },
    ]);
  });
});

describe('capability refresh signal', () => {
  it('coalesces a burst of server refusals into one refresh and lets a later one through', () => {
    resetCapabilitySignal();
    let calls = 0;
    const off = onCapabilityRefresh(() => { calls += 1; });
    expect(signalCapabilityRefresh(2000, 10_000)).toBe(true);
    expect(signalCapabilityRefresh(2000, 10_500)).toBe(false);
    expect(signalCapabilityRefresh(2000, 11_999)).toBe(false);
    expect(signalCapabilityRefresh(2000, 12_001)).toBe(true);
    off();
    expect(signalCapabilityRefresh(2000, 20_000)).toBe(true);
    expect(calls).toBe(2);
    resetCapabilitySignal();
  });
});
