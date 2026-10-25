/**
 * Series 13 / N-2: the shadow evidence WINDOW of one process. What a rehearsal reads must say which process and which window
 * it covers, must count every comparison that could not be made, must never lose an unexpected difference silently, and must
 * carry identifiers only (the member as a per-process pseudonym).
 */
import { Logger, NotFoundException } from '@nestjs/common';
import {
  CapabilityShadowService, sanitizeWindowLabel, SHADOW_REPORT_SCHEMA, shadowReportIntervalMs,
} from '../../src/infrastructure/security/capability-shadow.service';
import { ShadowDiagnosticsGuard, shadowDiagnosticsAllowed } from '../../src/presentation/guards/shadow-diagnostics.guard';
import { GrantView, Principal } from '../../src/domain/authorization/capability-evaluator';
import { SYSTEM_PROFILES } from '../../src/shared/constants/capabilities.constant';
import { PERMISSIONS } from '../../src/shared/constants/permissions.constant';

const COMPANY = 'c-1';
const W1 = 'w-1'; const W2 = 'w-2';
const MEMBER = '3f8a2c9e-0000-4000-8000-00000000abcd'; // a sentinel id that must never leave the process
const OPERATOR = SYSTEM_PROFILES.find((p) => p.key === 'operator')!;
const WM = SYSTEM_PROFILES.find((p) => p.key === 'warehouse_manager')!;
const op = (warehouseId: string): GrantView => ({ warehouseId, profileKey: 'operator', profileVersion: 1, capabilities: OPERATOR.capabilities, source: 'legacy_warehouse_access' });
const wm = (warehouseId: string, extra: Partial<GrantView> = {}): GrantView => ({ warehouseId, profileKey: 'warehouse_manager', profileVersion: 1, capabilities: WM.capabilities, source: 'access_grant', ...extra });
const staff = (grants: GrantView[], over: Partial<Principal> = {}): Principal => ({ userId: MEMBER, companyId: COMPANY, role: 'Staff', status: 'active', isOwner: false, customCapabilities: [], grants, ...over });
const EXPIRED = { validUntil: '2000-01-01T00:00:00Z' };

describe('CapabilityShadowService windows (Series 13)', () => {
  const savedMode = process.env.CAPABILITY_MODE;
  let shadow: CapabilityShadowService;
  let warn: jest.SpyInstance; let log: jest.SpyInstance;
  beforeEach(() => {
    process.env.CAPABILITY_MODE = 'shadow';
    shadow = new CapabilityShadowService();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    warn.mockRestore(); log.mockRestore();
    if (savedMode === undefined) delete process.env.CAPABILITY_MODE; else process.env.CAPABILITY_MODE = savedMode;
  });

  const observe = (principal: Principal | null, legacyAllowed: boolean, caps: string[] = [PERMISSIONS.STOCK_ADJUSTMENT], ids: string[] = [W1], route = 'StockController.adjust') =>
    shadow.observePermission({ route, userId: MEMBER, requestCompanyId: COMPANY, principal, capabilities: caps, warehouseIds: ids, legacyAllowed });
  const loggedEvents = (spy: jest.SpyInstance) => spy.mock.calls.map((c) => JSON.parse(String(c[0])));

  it('identifies the process and the window; a fresh process starts at window 1, "process-start"', () => {
    const r = shadow.report();
    expect(r.schema).toBe(SHADOW_REPORT_SCHEMA);
    expect(r.instance.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.instance.pid).toBe(process.pid);
    expect(r.window).toMatchObject({ sequence: 1, openedBy: 'process-start', closedAt: null, label: null });
    expect(r.judgement.verdict).toBe('NO_EVIDENCE');
  });

  it('a restart is detectable: another process has another instance id and starts again at window 1', () => {
    const before = shadow.report();
    const restarted = new CapabilityShadowService();
    const after = restarted.report();
    expect(after.instance.id).not.toBe(before.instance.id);
    expect(after.window).toMatchObject({ sequence: 1, openedBy: 'process-start' });
    expect(after.window.id).not.toBe(before.window.id);
  });

  it('equal and grant-explained decisions: CLEAN with exact counters; the guarded requests are all in shadow', () => {
    shadow.noteGuardedRequest('shadow'); observe(staff([op(W1)]), false); // denied by both
    shadow.noteGuardedRequest('shadow'); observe(staff([op(W2), wm(W1)]), false); // explained by the warehouse_manager grant on W1
    const r = shadow.report();
    expect(r.counters).toEqual({ compared: 2, equal: 1, expectedDifferences: 1, unexpectedDifferences: 0, errors: 0, incomplete: 0 });
    expect(r.judgement).toEqual({ verdict: 'CLEAN', reasons: [], parityObserved: true });
    expect(r.expectedByRoute).toEqual({ 'StockController.adjust': 1 });
    expect(r.samples.expected[0]).toMatchObject({ verdict: 'expected', reason: 'justified-by-grant' });
    expect(r.modes).toMatchObject({ atOpen: 'shadow', now: 'shadow', guardedOutsideShadow: 0, guardedByMode: { shadow: 2 } });
  });

  it('an unexplained widening is UNEXPECTED, counted by reason and route, sampled and logged', () => {
    observe(staff([wm(W1, EXPIRED)]), false); // the grant expired: nothing explains the widening
    const r = shadow.report();
    expect(r.judgement.verdict).toBe('UNEXPECTED_DIFFERENCES');
    expect(r.unexpectedByReason).toEqual({ 'unjustified-expansion': 1 });
    expect(r.unexpectedByRoute).toEqual({ 'StockController.adjust': 1 });
    expect(r.samples.unexpected).toHaveLength(1);
    expect(loggedEvents(warn).map((e) => e.event)).toEqual(['capability-shadow-unexpected']);
  });

  it('a missing principal, and a member who is no longer active, are INCOMPLETE (by reason), never parity', () => {
    observe(null, true);
    observe(staff([op(W1)], { status: 'suspended' }), true);
    shadow.observeScope({ route: 'WarehouseAccessService.scope', userId: MEMBER, requestCompanyId: COMPANY, principal: staff([], { status: 'removed' }), legacy: [W1], scoped: null });
    shadow.incomplete('no-company', 'X.y');
    const r = shadow.report();
    expect(r.counters).toMatchObject({ compared: 0, incomplete: 4, unexpectedDifferences: 0 });
    expect(r.incompleteByReason).toEqual({ 'no-principal': 1, 'principal-not-active': 2, 'no-company': 1 });
    expect(r.judgement.verdict).toBe('INCONCLUSIVE');
    expect(loggedEvents(warn).filter((e) => e.event === 'capability-shadow-incomplete')).toHaveLength(4);
  });

  it('an unknown capability is unexpected; an evaluation error is counted with its class and code only (never its message)', () => {
    observe(staff([op(W1)]), false, ['NOT_A_CAPABILITY']);
    const boom = Object.assign(new Error(`invalid input syntax for type uuid: "${MEMBER}"`), { code: '22P02' });
    shadow.error('scope', boom, 'WarehouseAccessService.scope');
    const r = shadow.report();
    expect(r.unexpectedByReason).toEqual({ 'unknown-capability': 1 });
    expect(r.errorsBySource).toEqual({ scope: 1 });
    expect(r.judgement.reasons).toEqual(['unexpected-differences:1', 'errors:1']);
    const errorLine = loggedEvents(warn).find((e) => e.event === 'capability-shadow-error');
    expect(errorLine).toMatchObject({ source: 'scope', error: 'Error', code: '22P02', route: 'WarehouseAccessService.scope' });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(MEMBER);
  });

  it('requests decided outside shadow during the window make it INCONCLUSIVE, even after the engine is back in shadow', () => {
    shadow.noteGuardedRequest('shadow'); observe(staff([op(W1)]), false);
    shadow.noteGuardedRequest('off');
    const r = shadow.report();
    expect(r.judgement.verdict).toBe('INCONCLUSIVE');
    expect(r.judgement.reasons).toContain('requests-outside-shadow:1');
  });

  it('a window opened while the engine was not in shadow is never CLEAN', () => {
    process.env.CAPABILITY_MODE = 'off';
    const fresh = new CapabilityShadowService();
    process.env.CAPABILITY_MODE = 'shadow';
    fresh.observePermission({ route: 'r', userId: MEMBER, requestCompanyId: COMPANY, principal: staff([op(W1)]), capabilities: [PERMISSIONS.STOCK_ADJUSTMENT], warehouseIds: [W1], legacyAllowed: false });
    expect(fresh.report().judgement.reasons).toContain('mode-not-shadow:off->shadow');
  });

  it('reset and operator windows are recorded: the closed window is logged and summarized, the next one starts empty', () => {
    observe(staff([wm(W1, EXPIRED)]), false);
    const first = shadow.report().window;
    shadow.reset();
    const { closed, opened } = shadow.openWindow('rehearsal-step:2');
    const r = shadow.report();
    expect(r.instance.resets).toBe(1);
    expect(r.window).toMatchObject({ sequence: 3, openedBy: 'operator', label: 'rehearsal-step:2' });
    expect(opened).toMatchObject({ instanceId: r.instance.id, windowId: r.window.id, sequence: 3 });
    expect(closed.window).toMatchObject({ sequence: 2, openedBy: 'reset', closeReason: 'rolled' });
    expect(r.previousWindows.map((w) => [w.sequence, w.closeReason, w.verdict])).toEqual([[1, 'reset', 'UNEXPECTED_DIFFERENCES'], [2, 'rolled', 'NO_EVIDENCE']]);
    expect(r.previousWindows[0].id).toBe(first.id);
    expect(r.counters.compared).toBe(0);
    const closedLines = loggedEvents(log).filter((e) => e.event === 'capability-shadow-window-closed');
    expect(closedLines.map((e) => e.window.sequence)).toEqual([1, 2]);
    expect(closedLines[0].judgement.verdict).toBe('UNEXPECTED_DIFFERENCES'); // the inconvenient window is on record, not erased
  });

  it('shutdown closes the window and logs its final report (the durable record of a process that ends)', () => {
    observe(staff([op(W1)]), false);
    shadow.onApplicationShutdown();
    const line = loggedEvents(log).find((e) => e.event === 'capability-shadow-window-closed');
    expect(line).toMatchObject({ window: { sequence: 1, closeReason: 'shutdown' }, counters: { compared: 1, equal: 1 } });
  });

  it('nothing is dropped silently: the first unexpected samples are kept, the rest counted; expected keep the latest; log lines are budgeted and counted', () => {
    for (let i = 0; i < 130; i++) observe(staff([wm(W1, EXPIRED)]), false, [PERMISSIONS.STOCK_ADJUSTMENT], [W1], `R.${i}`);
    for (let i = 0; i < 60; i++) observe(staff([op(W2), wm(W1)]), false, [PERMISSIONS.STOCK_ADJUSTMENT], [W1], `E.${i}`);
    const r = shadow.report();
    expect(r.counters.unexpectedDifferences).toBe(130);
    expect(r.samples.unexpected).toHaveLength(100);
    expect(r.samples.unexpected[0].route).toBe('R.0'); // the earliest evidence stays
    expect(r.samples.unexpectedDropped).toBe(30);
    expect(r.samples.expected).toHaveLength(50);
    expect(r.samples.expected[49].route).toBe('E.59');
    expect(r.samples.expectedDropped).toBe(10);
    expect(Object.keys(r.unexpectedByRoute)).toHaveLength(130); // exact per route, nothing lost
    expect(r.logging.written['capability-shadow-unexpected']).toBe(100);
    expect(r.logging.suppressed['capability-shadow-unexpected']).toBe(30);
    expect(warn).toHaveBeenCalledTimes(100);
  });

  it('privacy: the report carries no member id (a per-process pseudonym instead), no request value, no credential', () => {
    observe(staff([wm(W1, EXPIRED)]), false);
    observe(staff([wm(W1, EXPIRED)]), false);
    const r = shadow.report();
    const raw = JSON.stringify(r);
    expect(raw).not.toContain(MEMBER);
    for (const secret of ['Bearer', 'password', 'costPrice', 'authorization', 'email']) expect(raw).not.toContain(secret);
    const [a, b] = r.samples.unexpected;
    expect(a.subject).toMatch(/^[0-9a-f]{16}$/);
    expect(a.subject).toBe(b.subject); // stable inside one process, so a rehearsal can group by member
    expect(Object.keys(a).sort()).toEqual(
      ['at', 'capabilities', 'justifiedBy', 'kind', 'legacy', 'reason', 'route', 'scoped', 'subject', 'unexplained', 'verdict', 'warehouseIds'].sort(),
    );
    const other = new CapabilityShadowService();
    other.observePermission({ route: 'r', userId: MEMBER, requestCompanyId: COMPANY, principal: staff([wm(W1, EXPIRED)]), capabilities: [PERMISSIONS.STOCK_ADJUSTMENT], warehouseIds: [W1], legacyAllowed: false });
    expect(other.report().samples.unexpected[0].subject).not.toBe(a.subject); // not linkable across processes
    for (const line of [...warn.mock.calls, ...log.mock.calls]) expect(String(line[0])).not.toContain(MEMBER);
  });

  it('window labels are short identifiers only; the report interval is bounded', () => {
    expect(sanitizeWindowLabel('step-1')).toBe('step-1');
    for (const bad of ['', 'a b', 'x'.repeat(65), '<script>', 42, null]) expect(sanitizeWindowLabel(bad)).toBeNull();
    expect(shadowReportIntervalMs({})).toBe(900_000);
    expect(shadowReportIntervalMs({ CAPABILITY_SHADOW_REPORT_INTERVAL_MS: '0' })).toBe(0);
    expect(shadowReportIntervalMs({ CAPABILITY_SHADOW_REPORT_INTERVAL_MS: '60000' })).toBe(60_000);
    expect(shadowReportIntervalMs({ CAPABILITY_SHADOW_REPORT_INTERVAL_MS: '5' })).toBe(900_000);
    expect(shadowReportIntervalMs({ CAPABILITY_SHADOW_REPORT_INTERVAL_MS: 'soon' })).toBe(900_000);
  });
});

describe('shadow diagnostics access (operator, loopback, token)', () => {
  const TOKEN = 'k'.repeat(40);
  const env = { SHADOW_DIAGNOSTICS_TOKEN: TOKEN } as NodeJS.ProcessEnv;

  it('off unless a token of at least 32 characters is configured', () => {
    expect(shadowDiagnosticsAllowed('127.0.0.1', TOKEN, {})).toBe(false);
    expect(shadowDiagnosticsAllowed('127.0.0.1', 'short', { SHADOW_DIAGNOSTICS_TOKEN: 'short' })).toBe(false);
  });

  it('only from the loopback socket, with the exact token', () => {
    for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) expect(shadowDiagnosticsAllowed(ip, TOKEN, env)).toBe(true);
    for (const ip of ['10.0.0.5', '::ffff:10.0.0.5', '192.168.1.20', '0.0.0.0', '', undefined]) expect(shadowDiagnosticsAllowed(ip, TOKEN, env)).toBe(false);
    for (const t of [undefined, '', `${TOKEN}x`, TOKEN.slice(1), [TOKEN], TOKEN.toUpperCase()]) expect(shadowDiagnosticsAllowed('127.0.0.1', t, env)).toBe(false);
  });

  it('the guard answers the router\'s own 404 and trusts the socket, never X-Forwarded-For', () => {
    const saved = process.env.SHADOW_DIAGNOSTICS_TOKEN;
    process.env.SHADOW_DIAGNOSTICS_TOKEN = TOKEN;
    try {
      const ctx = (remoteAddress: string, headers: Record<string, string>) => ({
        switchToHttp: () => ({ getRequest: () => ({ method: 'GET', originalUrl: '/api/v1/internal/capability-shadow', socket: { remoteAddress }, ip: '127.0.0.1', headers }) }),
      } as never);
      const guard = new ShadowDiagnosticsGuard();
      expect(guard.canActivate(ctx('127.0.0.1', { 'x-shadow-diagnostics-token': TOKEN }))).toBe(true);
      expect(() => guard.canActivate(ctx('10.1.2.3', { 'x-shadow-diagnostics-token': TOKEN, 'x-forwarded-for': '127.0.0.1' }))).toThrow(NotFoundException);
      try { guard.canActivate(ctx('127.0.0.1', {})); } catch (e) {
        expect((e as NotFoundException).getResponse()).toMatchObject({ statusCode: 404, message: 'Cannot GET /api/v1/internal/capability-shadow' });
      }
    } finally {
      if (saved === undefined) delete process.env.SHADOW_DIAGNOSTICS_TOKEN; else process.env.SHADOW_DIAGNOSTICS_TOKEN = saved;
    }
  });
});
