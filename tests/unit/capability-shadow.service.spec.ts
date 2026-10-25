/**
 * Series 11 / F11-04: the shadow telemetry service and the guard wiring around it. Missing evidence is never parity, a
 * failing evaluation is an error, an expected difference needs an explicit active grant, and the diagnostics carry
 * identifiers only.
 */
import { Logger } from '@nestjs/common';
import { CapabilityShadowService } from '../../src/infrastructure/security/capability.service';
import { PermissionsGuard } from '../../src/presentation/guards/permissions.guard';
import { GrantView, Principal } from '../../src/domain/authorization/capability-evaluator';
import { SYSTEM_PROFILES } from '../../src/shared/constants/capabilities.constant';
import { PERMISSIONS } from '../../src/shared/constants/permissions.constant';

const COMPANY = 'c-1';
const W1 = 'w-1'; const W2 = 'w-2';
const OPERATOR = SYSTEM_PROFILES.find((p) => p.key === 'operator')!;
const WM = SYSTEM_PROFILES.find((p) => p.key === 'warehouse_manager')!;
const op = (warehouseId: string): GrantView => ({ warehouseId, profileKey: 'operator', profileVersion: 1, capabilities: OPERATOR.capabilities, source: 'legacy_warehouse_access' });
const wm = (warehouseId: string, extra: Partial<GrantView> = {}): GrantView => ({ warehouseId, profileKey: 'warehouse_manager', profileVersion: 1, capabilities: WM.capabilities, source: 'access_grant', ...extra });
const staff = (grants: GrantView[], over: Partial<Principal> = {}): Principal => ({ userId: 'u-1', companyId: COMPANY, role: 'Staff', status: 'active', isOwner: false, customCapabilities: [], grants, ...over });

describe('CapabilityShadowService', () => {
  let shadow: CapabilityShadowService;
  let warn: jest.SpyInstance;
  beforeEach(() => {
    shadow = new CapabilityShadowService();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  const observe = (principal: Principal | null, legacyAllowed: boolean, caps: string[] = [PERMISSIONS.STOCK_ADJUSTMENT], ids: string[] = [W1], company = COMPANY) =>
    shadow.observePermission({ route: 'StockController.adjust', userId: 'u-1', requestCompanyId: company, principal, capabilities: caps, warehouseIds: ids, legacyAllowed });

  it("7. a missing principal (model not wired, member not found) is INCOMPLETE evidence: it is not compared and not counted as parity", () => {
    observe(null, true);
    shadow.observeScope({ route: 'WarehouseAccessService.scope', userId: 'u-1', requestCompanyId: COMPANY, principal: undefined, legacy: [W1], scoped: [W1] });
    expect(shadow.snapshot()).toMatchObject({ compared: 0, equal: 0, incomplete: 2, unexpectedDifferences: 0, expectedDifferences: 0 });
  });

  it("an evaluation error is counted as an error, not as a comparison", () => {
    shadow.error();
    expect(shadow.snapshot()).toMatchObject({ errors: 1, compared: 0, equal: 0 });
  });

  it("equal decisions are counted as equal; a grant-explained widening as expected, naming the grant", () => {
    observe(staff([op(W1)]), false); // adjustment denied by both
    observe(staff([op(W2), wm(W1)]), false); // the new model allows it on W1 through the warehouse_manager grant
    const snap = shadow.snapshot();
    expect(snap).toMatchObject({ compared: 2, equal: 1, expectedDifferences: 1, unexpectedDifferences: 0 });
    expect(snap.recent[0]).toMatchObject({ verdict: 'expected', reason: 'justified-by-grant' });
    expect(snap.recent[0].justifiedBy).toEqual([{ warehouseId: W1, profileKey: 'warehouse_manager', profileVersion: 1, capability: PERMISSIONS.STOCK_ADJUSTMENT }]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("3. a permission lost by the new model is UNEXPECTED even when the member holds a grant, and is logged", () => {
    observe(staff([wm(W1)]), true, [PERMISSIONS.STOCK_OUTBOUND], [W2]); // legacy said yes, the member has no access to W2 in the new model
    expect(shadow.snapshot()).toMatchObject({ unexpectedDifferences: 1, expectedDifferences: 0 });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("5. a cross-tenant decision is unexpected; 4. an unknown capability is unexpected", () => {
    observe(staff([wm(W1)], { companyId: 'c-other' }), false);
    observe(staff([wm(W1)]), false, ['NOT_A_CAPABILITY']);
    expect(shadow.snapshot()).toMatchObject({ unexpectedDifferences: 2, expectedDifferences: 0 });
    expect(shadow.snapshot().recent.map((d) => d.reason)).toEqual(['cross-tenant', 'unknown-capability']);
  });

  it("6. an expired grant does not turn a widening into an expected difference", () => {
    observe(staff([wm(W1, { validUntil: '2000-01-01T00:00:00Z' })]), false);
    expect(shadow.snapshot()).toMatchObject({ unexpectedDifferences: 1, expectedDifferences: 0 });
  });

  it("scope differences are classified the same way (an extra warehouse needs a grant ON it)", () => {
    const p = staff([op(W2), wm(W1)]);
    shadow.observeScope({ route: 'scope', userId: 'u-1', requestCompanyId: COMPANY, principal: p, legacy: [W2], scoped: [W1, W2] }); // explained
    shadow.observeScope({ route: 'scope', userId: 'u-1', requestCompanyId: COMPANY, principal: p, legacy: [W2], scoped: ['w-9', W1, W2] }); // w-9 is not
    expect(shadow.snapshot()).toMatchObject({ expectedDifferences: 1, unexpectedDifferences: 1 });
  });

  it("9. diagnostics carry identifiers only: no token, no body, no value can reach the ring or the log line", () => {
    observe(staff([wm(W1, { validUntil: '2000-01-01T00:00:00Z' })]), false);
    const entry = shadow.snapshot().recent[0];
    expect(Object.keys(entry).sort()).toEqual(
      ['at', 'capabilities', 'justifiedBy', 'kind', 'legacy', 'reason', 'route', 'scoped', 'unexplained', 'userId', 'verdict', 'warehouseIds'].sort(),
    );
    const logged = String(warn.mock.calls[0][0]);
    // Series 13: plus the instance and window ids the line belongs to (random correlation ids, not data)
    expect(Object.keys(JSON.parse(logged)).sort()).toEqual(['capabilities', 'event', 'instance', 'kind', 'reason', 'route', 'unexplained', 'window'].sort());
    for (const secret of ['Bearer', 'password', 'costPrice', 'authorization']) {
      expect(JSON.stringify(shadow.snapshot())).not.toContain(secret);
      expect(logged).not.toContain(secret);
    }
  });

  it("the ring keeps only the latest 50 differences, the counters keep counting (memory only, per process)", () => {
    for (let i = 0; i < 60; i++) observe(staff([wm(W1, { validUntil: '2000-01-01T00:00:00Z' })]), false);
    const snap = shadow.snapshot();
    expect(snap.recent).toHaveLength(50);
    expect(snap.unexpectedDifferences).toBe(60);
    shadow.reset();
    expect(shadow.snapshot()).toMatchObject({ compared: 0, incomplete: 0, recent: [] });
  });
});

describe('PermissionsGuard in shadow mode', () => {
  const saved = process.env.CAPABILITY_MODE;
  beforeAll(() => { process.env.CAPABILITY_MODE = 'shadow'; });
  afterAll(() => { if (saved === undefined) delete process.env.CAPABILITY_MODE; else process.env.CAPABILITY_MODE = saved; });
  const ctx = (user: object) => ({ switchToHttp: () => ({ getRequest: () => ({ user }) }), getHandler: () => ({}), getClass: () => ({}) } as never);
  const permissions = { hasAll: jest.fn(async () => true) };
  const reflector = { getAllAndOverride: jest.fn(() => [PERMISSIONS.VIEW_PRODUCT]), get: jest.fn(() => []) };

  it("Series 13: every guarded request is counted by mode, so a window partly decided outside shadow is never CLEAN", async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const shadow = new CapabilityShadowService();
    const guard = new PermissionsGuard(reflector as never, permissions as never, undefined as never, shadow as never);
    await guard.canActivate(ctx({ sub: 'u', role: 'Staff', companyId: COMPANY })); // shadow (incomplete: no model)
    process.env.CAPABILITY_MODE = 'off';
    try { await guard.canActivate(ctx({ sub: 'u', role: 'Staff', companyId: COMPANY })); } finally { process.env.CAPABILITY_MODE = 'shadow'; }
    const r = shadow.report();
    expect(r.modes.guardedByMode).toEqual({ shadow: 1, off: 1 });
    expect(r.judgement.reasons).toContain('requests-outside-shadow:1');
    expect(r.incompleteByReason).toEqual({ 'model-not-wired': 1 });
    warn.mockRestore();
  });

  it("7. with no capability model wired, the legacy answer is unchanged and the comparison is counted as incomplete", async () => {
    const shadow = new CapabilityShadowService();
    const guard = new PermissionsGuard(reflector as never, permissions as never, undefined as never, shadow as never);
    await expect(guard.canActivate(ctx({ sub: 'u', role: 'Staff', companyId: COMPANY }))).resolves.toBe(true);
    expect(shadow.snapshot()).toMatchObject({ incomplete: 1, compared: 0, equal: 0 });
  });

  it("a token without a company is incomplete evidence, not parity", async () => {
    const shadow = new CapabilityShadowService();
    const capabilities = { principalFor: jest.fn() };
    const guard = new PermissionsGuard(reflector as never, permissions as never, capabilities as never, shadow as never);
    await expect(guard.canActivate(ctx({ sub: 'u', role: 'Staff' }))).resolves.toBe(true);
    expect(shadow.snapshot()).toMatchObject({ incomplete: 1, compared: 0 });
    expect(capabilities.principalFor).not.toHaveBeenCalled();
  });

  it("a model that fails does not change the answer and is counted as an error", async () => {
    const shadow = new CapabilityShadowService();
    const capabilities = { principalFor: jest.fn(async () => { throw new Error('boom'); }) };
    const guard = new PermissionsGuard(reflector as never, permissions as never, capabilities as never, shadow as never);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await expect(guard.canActivate(ctx({ sub: 'u', role: 'Staff', companyId: COMPANY }))).resolves.toBe(true);
    expect(shadow.snapshot()).toMatchObject({ errors: 1, compared: 0 });
  });

  it("an unresolved principal (member not found) is incomplete evidence", async () => {
    const shadow = new CapabilityShadowService();
    const capabilities = { principalFor: jest.fn(async () => null) };
    const reflector2 = reflector;
    const guard = new PermissionsGuard(reflector2 as never, permissions as never, capabilities as never, shadow as never);
    await expect(guard.canActivate(ctx({ sub: 'u', role: 'Staff', companyId: COMPANY }))).resolves.toBe(true);
    expect(shadow.snapshot()).toMatchObject({ incomplete: 1, compared: 0, equal: 0 });
  });
});
