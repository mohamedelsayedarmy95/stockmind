/**
 * Series 13 / N-2 on a real PostgreSQL, over real HTTP: the shadow evidence a local rehearsal can read from OUTSIDE the
 * process, and what it may conclude.
 *
 *  - The diagnostics route exists only for the operator of this machine: off unless SHADOW_DIAGNOSTICS_TOKEN is set, only on a
 *    loopback connection, only with the token; every refusal is the router's 404, and a tenant's JWT (even the owner's) is not
 *    a way in. The evidence spans every company of the process, so no tenant role may read it.
 *  - A window of legacy traffic is CLEAN; a scoped grant is an EXPECTED difference and leaves it CLEAN; an unexplained widening
 *    fails it; a missing principal or a failing evaluation makes it INCONCLUSIVE. Answers never change (the legacy model decides).
 *  - The report carries identifiers only: no member id, e-mail, JWT, diagnostics token or cost.
 *  - scripts/shadow-evidence.mjs captures a window end to end and refuses to trust it across a restart.
 *
 * Observations are appended to $S13_EVIDENCE_FILE when it is set.
 */
import { Test } from '@nestjs/testing';
import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import * as request from 'supertest';
import { execFile } from 'child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { AppModule } from '@/app.module';
import { CapabilityService } from '@/infrastructure/security/capability.service';
import { Principal } from '@/domain/authorization/capability-evaluator';

const RUN = Boolean(process.env.DB_HOST && process.env.JWT_ACCESS_SECRET && process.env.JWT_REFRESH_SECRET);
const TAG = randomBytes(4).toString('hex');
const TOKEN = randomBytes(24).toString('hex'); // 48 characters, this run only
const password = () => `Aa1!${randomBytes(8).toString('hex')}`;
const SCRIPT = path.join(__dirname, '../../scripts/shadow-evidence.mjs');
const ROUTE = '/api/v1/internal/capability-shadow';

const note = (scenario: string, data: Record<string, unknown>) => {
  const file = process.env.S13_EVIDENCE_FILE;
  if (file) appendFileSync(file, `${JSON.stringify({ spec: 'shadow-observability', scenario, at: new Date().toISOString(), ...data })}\n`);
};

interface Member { id: string; email: string; token: string }

(RUN ? describe : describe.skip)('N-2 shadow observability (PostgreSQL, HTTP, operator diagnostics)', () => {
  jest.setTimeout(240_000);
  const savedMode = process.env.CAPABILITY_MODE;
  let app: INestApplication;
  let db: DataSource;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const diag = { 'x-shadow-diagnostics-token': TOKEN };
  let owner: Member; let staff: Member; let granted: Member;
  let w1: string; let w2: string; let product: string;
  let seq = 0;

  const boot = async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    const a = moduleRef.createNestApplication();
    a.setGlobalPrefix('api/v1');
    a.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await a.listen(0, '127.0.0.1');
    return a;
  };
  const baseOf = (a: INestApplication) => `http://127.0.0.1:${(a.getHttpServer().address() as { port: number }).port}/api/v1`;
  const join = async (role: 'Staff', warehouseIds: string[]): Promise<Member> => {
    const email = `so.${role.toLowerCase()}.${++seq}.${TAG}@example.test`;
    const invite = await http().post('/api/v1/team/invitations').set(auth(owner.token)).send({ email, role, warehouseIds }).expect(201);
    const joined = await http().post('/api/v1/auth/accept-invitation').send({ token: invite.body.token, name: `${role} ${seq}`, password: password() }).expect(201);
    return { id: joined.body.user.id, email, token: joined.body.accessToken };
  };
  /** Legacy traffic of one member: reads, writes, a refused write, a refused warehouse. Status codes in order. */
  const traffic = async (m: Member) => {
    const key = () => randomUUID();
    const calls = [
      http().get('/api/v1/products').set(auth(m.token)),
      http().get('/api/v1/warehouses').set(auth(m.token)),
      http().get(`/api/v1/warehouses/${w1}`).set(auth(m.token)),
      http().get(`/api/v1/warehouses/${w2}`).set(auth(m.token)),
      http().get(`/api/v1/stock/balance/${product}/${w1}`).set(auth(m.token)),
      http().get(`/api/v1/stock/changes/${w1}`).set(auth(m.token)),
      http().post('/api/v1/stock/inbound').set(auth(m.token)).set('Idempotency-Key', key()).send({ productId: product, warehouseId: w1, quantity: '1' }),
      http().post('/api/v1/stock/adjustment').set(auth(m.token)).set('Idempotency-Key', key()).send({ productId: product, warehouseId: w1, quantity: '1', reason: 'count' }),
      http().get('/api/v1/team/members').set(auth(m.token)),
    ];
    const out: number[] = [];
    for (const c of calls) out.push((await c).status);
    return out;
  };
  const report = async () => (await http().get(ROUTE).set(diag).expect(200)).body;
  const roll = async (label: string) => (await http().post(`${ROUTE}/window`).set(diag).send({ label }).expect(200)).body;
  const runScript = (args: string[], base: string, out: string) => new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(process.execPath, [SCRIPT, ...args, '--base', base, '--out', out], { env: { ...process.env, SHADOW_DIAGNOSTICS_TOKEN: TOKEN } },
      (err, stdout, stderr) => resolve({ code: err ? (err as { code?: number }).code ?? 1 : 0, stdout, stderr }));
  });

  beforeAll(async () => {
    process.env.CAPABILITY_MODE = 'shadow';
    process.env.SHADOW_DIAGNOSTICS_TOKEN = TOKEN;
    app = await boot();
    db = app.get(DataSource);
    const reg = await http().post('/api/v1/auth/register').send({ companyName: `Observe ${TAG}`, name: 'Owner', email: `so.owner.${TAG}@example.test`, password: password() }).expect(201);
    owner = { id: reg.body.user.id, email: `so.owner.${TAG}@example.test`, token: reg.body.accessToken }; w1 = reg.body.defaultWarehouse.id;
    w2 = (await http().post('/api/v1/warehouses').set(auth(owner.token)).send({ name: 'Second' }).expect(201)).body.id;
    product = (await http().post('/api/v1/products').set(auth(owner.token)).send({ name: 'Rivet', sku: `SO-${TAG}`, costPrice: '7319.47' }).expect(201)).body.id;
    await http().post('/api/v1/stock/inbound').set(auth(owner.token)).set('Idempotency-Key', randomUUID()).send({ productId: product, warehouseId: w1, quantity: '100' }).expect(201);
    staff = await join('Staff', [w1]);
    granted = await join('Staff', [w1]);
  });
  afterAll(async () => {
    delete process.env.SHADOW_DIAGNOSTICS_TOKEN;
    if (savedMode === undefined) delete process.env.CAPABILITY_MODE; else process.env.CAPABILITY_MODE = savedMode;
    await app?.close();
  });

  it('the route answers only the local operator: off without a token, a wrong token, or a tenant JWT, all the router\'s 404', async () => {
    const unknown = await http().get('/api/v1/internal/no-such-route').set(diag);
    delete process.env.SHADOW_DIAGNOSTICS_TOKEN;
    const disabled = await http().get(ROUTE).set(diag);
    process.env.SHADOW_DIAGNOSTICS_TOKEN = TOKEN;
    const wrong = await http().get(ROUTE).set({ 'x-shadow-diagnostics-token': `${TOKEN}0` });
    const ownerJwt = await http().get(ROUTE).set(auth(owner.token));
    const rollAsOwner = await http().post(`${ROUTE}/window`).set(auth(owner.token)).send({ label: 'x' });
    const ok = await http().get(ROUTE).set(diag);
    note('access', { unknown: unknown.status, disabled: disabled.status, wrongToken: wrong.status, ownerJwt: ownerJwt.status, rollAsOwner: rollAsOwner.status, operator: ok.status });
    for (const [r, line] of [[disabled, `GET ${ROUTE}`], [wrong, `GET ${ROUTE}`], [ownerJwt, `GET ${ROUTE}`], [rollAsOwner, `POST ${ROUTE}/window`]] as const) {
      expect(r.status).toBe(404);
      expect(r.body.message).toBe(`Cannot ${line}`); // the same shape as a route that does not exist
    }
    expect(unknown.status).toBe(404);
    expect(unknown.body.message).toBe('Cannot GET /api/v1/internal/no-such-route');
    expect(ok.status).toBe(200);
    expect(ok.headers['cache-control']).toBe('no-store');
    expect((await http().post(`${ROUTE}/window`).set(diag).send({ label: 'has spaces' })).status).toBe(400);
  });

  it('a window of legacy traffic is CLEAN, with exact counters, in one identified process and window', async () => {
    const { opened } = await roll('legacy-traffic');
    const answers = { owner: await traffic(owner), staff: await traffic(staff) };
    const r = await report();
    note('legacy-window', { answers, instance: r.instance.id, window: r.window, counters: r.counters, judgement: r.judgement, modes: r.modes });
    expect(r.instance.id).toBe(opened.instanceId);
    expect(r.window).toMatchObject({ id: opened.windowId, label: 'legacy-traffic', openedBy: 'operator', closedAt: null });
    expect(r.counters.compared).toBeGreaterThan(10);
    expect(r.counters).toMatchObject({ unexpectedDifferences: 0, expectedDifferences: 0, errors: 0, incomplete: 0 });
    expect(r.judgement).toEqual({ verdict: 'CLEAN', reasons: [], parityObserved: true });
    expect(r.modes.guardedOutsideShadow).toBe(0);
    expect(answers.staff.slice(2, 4)).toEqual([200, 404]); // the legacy answers (the scope still decides)
  });

  it('a scoped grant is an EXPECTED difference, names its grant, changes no answer, and the window stays CLEAN', async () => {
    const [wm] = await db.query(`SELECT id FROM permission_profiles WHERE key = 'warehouse_manager'`);
    await db.query(`INSERT INTO access_grants (company_id, user_id, profile_id, scope_id) SELECT company_id, id, $2, $3 FROM users WHERE id = $1`, [granted.id, wm.id, w1]);
    await roll('scoped-grant');
    const adjust = await http().post('/api/v1/stock/adjustment').set(auth(granted.token)).set('Idempotency-Key', randomUUID())
      .send({ productId: product, warehouseId: w1, quantity: '1', reason: 'count' });
    const r = await report();
    note('expected-difference-window', { adjustStatus: adjust.status, counters: r.counters, judgement: r.judgement, expectedByRoute: r.expectedByRoute, sample: r.samples.expected[0] });
    expect(adjust.status).toBe(403); // legacy Staff: still refused
    expect(r.counters.expectedDifferences).toBeGreaterThanOrEqual(1);
    expect(r.counters.unexpectedDifferences).toBe(0);
    expect(r.samples.expected[0].justifiedBy).toEqual([{ warehouseId: w1, profileKey: 'warehouse_manager', profileVersion: 1, capability: 'STOCK_ADJUSTMENT' }]);
    expect(r.judgement.verdict).toBe('CLEAN');
    await db.query(`UPDATE access_grants SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [granted.id]);
  });

  describe('when the model misbehaves (the capability loader is replaced for one window)', () => {
    let caps: CapabilityService;
    let original: CapabilityService['loadPrincipal'];
    beforeEach(() => { caps = app.get(CapabilityService); original = caps.loadPrincipal.bind(caps); });
    afterEach(() => { (caps as any).loadPrincipal = original; });

    it('an unexplained widening (a Staff member judged as a Manager) fails the window; the answers stay the legacy ones', async () => {
      (caps as any).loadPrincipal = async (userId: string, companyId: string, ...rest: unknown[]) => {
        const p = await original(userId, companyId, ...(rest as []));
        return p && p.userId === staff.id ? ({ ...p, role: 'Manager' } as Principal) : p;
      };
      await roll('widening');
      const answers = await traffic(staff);
      const r = await report();
      note('unexpected-window', { answers, counters: r.counters, judgement: r.judgement, unexpectedByReason: r.unexpectedByReason, unexpectedByRoute: r.unexpectedByRoute });
      expect(r.judgement.verdict).toBe('UNEXPECTED_DIFFERENCES');
      expect(r.unexpectedByReason['unjustified-expansion']).toBeGreaterThan(0);
      expect(r.samples.unexpected.length).toBe(Math.min(r.counters.unexpectedDifferences, 100));
      expect(answers.slice(2, 4)).toEqual([200, 404]);
      expect(answers[7]).toBe(403); // adjustment: legacy Staff, the widening never reached a decision
    });

    it('a missing principal is INCOMPLETE and an evaluation failure is an ERROR: the window is INCONCLUSIVE, never CLEAN', async () => {
      (caps as any).loadPrincipal = async () => null;
      await roll('missing-principal');
      await traffic(staff);
      const missing = await report();
      (caps as any).loadPrincipal = async () => { throw Object.assign(new Error(`boom for ${staff.email}`), { code: 'XX000' }); };
      await roll('failing-model');
      const answers = await traffic(staff);
      const failing = await report();
      note('inconclusive-windows', {
        missing: { counters: missing.counters, judgement: missing.judgement, incompleteByReason: missing.incompleteByReason },
        failing: { answers, counters: failing.counters, judgement: failing.judgement, errorsBySource: failing.errorsBySource },
      });
      expect(missing.judgement.verdict).toBe('INCONCLUSIVE');
      expect(missing.incompleteByReason['no-principal']).toBeGreaterThan(0);
      expect(missing.counters.compared).toBe(0);
      expect(failing.judgement.verdict).toBe('INCONCLUSIVE');
      expect(failing.counters.errors).toBeGreaterThan(0);
      expect(JSON.stringify(failing)).not.toContain(staff.email); // the error's message (which echoed input) is not recorded
      expect(answers.slice(2, 4)).toEqual([200, 404]);
    });
  });

  it('privacy: the report carries no member id, e-mail, JWT, diagnostics token or cost value', async () => {
    const r = await report();
    const raw = JSON.stringify(r);
    for (const secret of [owner.id, staff.id, granted.id, owner.email, staff.email, owner.token, staff.token, TOKEN, '7319.47', 'costPrice']) {
      expect(raw).not.toContain(secret);
    }
    expect(r.previousWindows.length).toBeGreaterThan(0); // the earlier windows (including the failed one) are still listed
    expect(r.previousWindows.map((w: { verdict: string }) => w.verdict)).toContain('UNEXPECTED_DIFFERENCES');
  });

  it('scripts/shadow-evidence.mjs captures a window end to end, and refuses to trust a window across a restart', async () => {
    const out = mkdtempSync(path.join(tmpdir(), 's13-shadow-'));
    const base = baseOf(app);
    const opened = await runScript(['open', 's13-script'], base, out);
    expect(opened.code).toBe(0);
    await traffic(owner);
    const closed = await runScript(['close'], base, out);
    const result = JSON.parse(closed.stdout);
    const file = readFileSync(result.file, 'utf8');
    expect(closed.code).toBe(0);
    expect(result).toMatchObject({ trusted: true, verdict: 'CLEAN', label: 's13-script' });
    expect(createHash('sha256').update(file).digest('hex')).toBe(result.sha256);
    expect(readFileSync(`${result.file}.sha256`, 'utf8')).toContain(result.sha256);
    expect(file).not.toContain(TOKEN);

    // a restart between "open" and "close": the closing report comes from another process, so it is not trusted
    await runScript(['open', 's13-restart'], base, out);
    const log = jest.spyOn(Logger.prototype, 'log');
    await app.close();
    const shutdownLine = log.mock.calls.map((c) => String(c[0])).find((l) => l.includes('capability-shadow-window-closed') && l.includes('"closeReason":"shutdown"'));
    log.mockRestore();
    app = await boot();
    db = app.get(DataSource);
    const afterRestart = await runScript(['close'], baseOf(app), out);
    const restart = JSON.parse(afterRestart.stdout);
    note('evidence-script', {
      clean: { code: closed.code, verdict: result.verdict, sha256: result.sha256 },
      restart: { code: afterRestart.code, problem: restart.problem, expectedInstance: restart.expected.instanceId, gotInstance: restart.got.instance, gotSequence: restart.got.sequence },
      shutdownLineLogged: Boolean(shutdownLine),
      files: readdirSync(out).sort(),
    });
    expect(shutdownLine).toBeDefined(); // the window that was open when the process ended is on record
    expect(afterRestart.code).toBe(3);
    expect(restart).toMatchObject({ trusted: false, problem: 'RESTART_DETECTED' });
    expect(restart.got.instance).not.toBe(restart.expected.instanceId);
    expect(restart.got.sequence).toBe(1);
    expect(existsSync(restart.file)).toBe(true);

    const refused = await runScript(['read'], 'http://192.0.2.10:3000/api/v1', out);
    expect(refused.code).toBe(64); // the script will not send the token to a non-loopback host
  });
});
