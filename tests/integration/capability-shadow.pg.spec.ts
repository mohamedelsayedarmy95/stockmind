/**
 * Series 10 / S2 on a real PostgreSQL: the rollout path of the capability engine. The mode is read on every request, so one
 * app walks through shadow → off → enforce → shadow and every step is observed.
 *
 *  - shadow: the legacy decision decides; the new model is computed beside it. Legacy personas must show ZERO unexpected
 *    differences; a scoped grant (created directly, the API refuses it while the engine does not enforce) shows up as an
 *    EXPECTED difference and changes no answer.
 *  - off: nothing new runs at all.
 *  - a failing evaluation never changes a shadow answer, and denies (fail closed) when the engine enforces.
 *  - going back from enforce to shadow loses no data and removes no access that the legacy model granted.
 */
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import * as request from 'supertest';
import { randomBytes, randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { AppModule } from '@/app.module';
import { CapabilityService, CapabilityShadowService } from '@/infrastructure/security/capability.service';

const RUN = Boolean(process.env.DB_HOST && process.env.JWT_ACCESS_SECRET && process.env.JWT_REFRESH_SECRET);
const TAG = randomBytes(4).toString('hex');
const password = () => `Aa1!${randomBytes(8).toString('hex')}`;
const setMode = (m: string) => { process.env.CAPABILITY_MODE = m; };

interface Member { id: string; token: string }

(RUN ? describe : describe.skip)('capability engine rollout: shadow, off, enforce (PostgreSQL)', () => {
  jest.setTimeout(240_000);
  let app: INestApplication;
  let db: DataSource;
  let shadow: CapabilityShadowService;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  let owner: Member; let manager: Member; let staff: Member; let bare: Member; let granted: Member;
  let w1: string; let w2: string; let w3: string; let product: string;
  let seq = 0;

  const join = async (role: 'Manager' | 'Staff', warehouseIds: string[] = [w1]): Promise<Member> => {
    const email = `sh.${role.toLowerCase()}.${++seq}.${TAG}@example.test`;
    const invite = await http().post('/api/v1/team/invitations').set(auth(owner.token))
      .send(role === 'Staff' ? { email, role, warehouseIds } : { email, role }).expect(201);
    const joined = await http().post('/api/v1/auth/accept-invitation').send({ token: invite.body.token, name: `${role} ${seq}`, password: password() }).expect(201);
    return { id: joined.body.user.id, token: joined.body.accessToken };
  };

  /** A broad, realistic request mix for one persona. Returns the status codes in order. */
  const traffic = async (m: Member): Promise<number[]> => {
    const key = () => randomUUID();
    const calls = [
      http().get('/api/v1/products').set(auth(m.token)),
      http().get('/api/v1/warehouses').set(auth(m.token)),
      http().get(`/api/v1/warehouses/${w1}`).set(auth(m.token)),
      http().get(`/api/v1/warehouses/${w2}`).set(auth(m.token)),
      http().get(`/api/v1/stock/balance/${product}/${w1}`).set(auth(m.token)),
      http().get(`/api/v1/stock/balance/${product}/${w2}`).set(auth(m.token)),
      http().get(`/api/v1/stock/changes/${w1}`).set(auth(m.token)),
      http().get(`/api/v1/stock/changes/${w3}`).set(auth(m.token)),
      http().get(`/api/v1/stock/movements/${product}`).set(auth(m.token)),
      http().post('/api/v1/stock/operations/lookup').set(auth(m.token)).send({ operations: [{ key: randomUUID() }] }),
      http().post('/api/v1/stock/inbound').set(auth(m.token)).set('Idempotency-Key', key()).send({ productId: product, warehouseId: w1, quantity: '1' }),
      http().post('/api/v1/stock/outbound').set(auth(m.token)).set('Idempotency-Key', key()).send({ productId: product, warehouseId: w1, quantity: '1' }),
      http().post('/api/v1/stock/inbound').set(auth(m.token)).set('Idempotency-Key', key()).send({ productId: product, warehouseId: w2, quantity: '1' }),
      http().post('/api/v1/stock/adjustment').set(auth(m.token)).set('Idempotency-Key', key()).send({ productId: product, warehouseId: w1, quantity: '1', reason: 'count' }),
      http().post('/api/v1/stock/transfer').set(auth(m.token)).set('Idempotency-Key', key()).send({ productId: product, fromWarehouseId: w1, toWarehouseId: w3, quantity: '1' }),
      http().post('/api/v1/products').set(auth(m.token)).send({ name: 'x', sku: `SH-${key()}` }),
      http().get('/api/v1/team/members').set(auth(m.token)),
      http().get('/api/v1/me/capabilities').set(auth(m.token)),
    ];
    const out: number[] = [];
    for (const c of calls) out.push((await c).status); // sequential: the throttle and ordering stay simple
    return out;
  };

  beforeAll(async () => {
    setMode('shadow');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
    shadow = app.get(CapabilityShadowService);

    const pw = password();
    const reg = await http().post('/api/v1/auth/register').send({ companyName: `Shadow ${TAG}`, name: 'Owner', email: `sh.owner.${TAG}@example.test`, password: pw }).expect(201);
    owner = { id: reg.body.user.id, token: reg.body.accessToken }; w1 = reg.body.defaultWarehouse.id;
    w2 = (await http().post('/api/v1/warehouses').set(auth(owner.token)).send({ name: 'Second' }).expect(201)).body.id;
    w3 = (await http().post('/api/v1/warehouses').set(auth(owner.token)).send({ name: 'Third' }).expect(201)).body.id;
    product = (await http().post('/api/v1/products').set(auth(owner.token)).send({ name: 'Bolt', sku: `SH-${TAG}` }).expect(201)).body.id;
    for (const w of [w1, w2, w3]) {
      await http().post('/api/v1/stock/inbound').set(auth(owner.token)).set('Idempotency-Key', randomUUID()).send({ productId: product, warehouseId: w, quantity: '500' }).expect(201);
    }
    manager = await join('Manager');
    staff = await join('Staff', [w1, w3]);
    bare = await join('Staff', [w1]);
    await db.query(`DELETE FROM warehouse_access WHERE user_id = $1`, [bare.id]); // a Staff member with no warehouse at all
    granted = await join('Staff', [w1]);
  });

  afterAll(async () => { setMode('shadow'); await app?.close(); });

  it('shadow: the legacy personas show ZERO unexpected differences across a broad request mix, and the answers are the legacy ones', async () => {
    setMode('shadow');
    shadow.reset();
    const answers: Record<string, number[]> = {};
    for (const [name, m] of [['owner', owner], ['manager', manager], ['staff', staff], ['bare', bare]] as const) answers[name] = await traffic(m);
    const snap = shadow.snapshot();
    expect(snap.compared).toBeGreaterThan(40);
    expect(snap.unexpectedDifferences).toBe(0);
    expect(snap.errors).toBe(0);
    expect(snap.expectedDifferences).toBe(0); // nobody holds a scoped grant yet
    // spot-check that these really are the legacy answers (the traffic order is fixed above)
    expect(answers.staff.slice(0, 16)).toEqual([200, 200, 200, 404, 200, 404, 200, 200, 200, 200, 201, 201, 404, 403, 403, 403]);
    expect(answers.bare.slice(1, 3)).toEqual([200, 404]); // lists as empty, no warehouse readable
    expect(answers.manager.slice(0, 16)).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 201, 201, 201, 201, 201, 201]);
    expect(answers.owner.slice(13, 16)).toEqual([201, 201, 201]);
  });

  it('shadow: a scoped grant is an EXPECTED difference and changes no answer (the legacy model still decides)', async () => {
    const [wm] = await db.query(`SELECT id FROM permission_profiles WHERE key = 'warehouse_manager'`);
    await db.query(`INSERT INTO access_grants (company_id, user_id, profile_id, scope_id) SELECT company_id, id, $2, $3 FROM users WHERE id = $1`, [granted.id, wm.id, w1]);
    shadow.reset();
    const adjust = await http().post('/api/v1/stock/adjustment').set(auth(granted.token)).set('Idempotency-Key', randomUUID())
      .send({ productId: product, warehouseId: w1, quantity: '1', reason: 'count' });
    expect(adjust.status).toBe(403); // legacy: Staff cannot adjust, whatever the engine would say
    const snap = shadow.snapshot();
    expect(snap.unexpectedDifferences).toBe(0);
    expect(snap.expectedDifferences).toBeGreaterThanOrEqual(1);
    expect(snap.recent[0]).toMatchObject({ kind: 'permission', legacy: false, scoped: true, expected: true });
    // and /me/capabilities does not promise it: while the engine does not enforce it reports the legacy authority
    const me = (await http().get('/api/v1/me/capabilities').set(auth(granted.token)).expect(200)).body;
    expect(me.engine).toMatchObject({ mode: 'shadow', enforced: false });
    expect(me.warehouses.items[0].capabilities).not.toContain('STOCK_ADJUSTMENT');
  });

  it('shadow/off: the API refuses to hand out a profile that would do nothing; operator assignments keep working', async () => {
    for (const mode of ['shadow', 'off']) {
      setMode(mode);
      const profiles = (await http().get('/api/v1/team/access-profiles').set(auth(owner.token)).expect(200)).body;
      expect(profiles.mode).toBe(mode);
      expect(Object.fromEntries(profiles.profiles.map((p: { key: string; available: boolean }) => [p.key, p.available]))).toEqual({ operator: true, warehouse_manager: false });
      const refused = await http().put(`/api/v1/team/members/${bare.id}/access`).set(auth(owner.token)).send({ assignments: [{ warehouseId: w1, profile: 'warehouse_manager' }] });
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('PROFILE_NOT_ENFORCED');
      expect(await db.query(`SELECT 1 FROM access_grants WHERE user_id = $1`, [bare.id])).toEqual([]);
      await http().put(`/api/v1/team/members/${bare.id}/access`).set(auth(owner.token)).send({ assignments: [{ warehouseId: w1, profile: 'operator' }] }).expect(200);
      await http().put(`/api/v1/team/members/${bare.id}/access`).set(auth(owner.token)).send({ assignments: [] }).expect(200);
    }
    setMode('shadow');
  });

  it('off: nothing of the new model runs and an existing scoped grant has no effect', async () => {
    setMode('off');
    shadow.reset();
    const status = await traffic(granted);
    expect(shadow.snapshot().compared).toBe(0);
    expect(status[13]).toBe(403); // adjustment: legacy Staff, grant ignored
    setMode('shadow');
  });

  it('shadow: a failing evaluation cannot change an answer; enforce: it denies (fail closed)', async () => {
    const caps = app.get(CapabilityService);
    const original = caps.loadPrincipal.bind(caps);
    try {
      (caps as any).loadPrincipal = async () => { throw new Error('boom'); };
      setMode('shadow');
      shadow.reset();
      expect((await http().get('/api/v1/warehouses').set(auth(staff.token))).status).toBe(200);
      expect((await http().get(`/api/v1/stock/changes/${w2}`).set(auth(staff.token))).status).toBe(404); // the legacy scope still answers
      expect(shadow.snapshot().errors).toBeGreaterThan(0);
      setMode('enforce');
      expect((await http().get('/api/v1/warehouses').set(auth(staff.token))).status).toBeGreaterThanOrEqual(403);
    } finally {
      (caps as any).loadPrincipal = original;
      setMode('shadow');
    }
  });

  it('enforce: the same legacy personas get the same answers as in shadow; the scoped grant now works; rolling back removes nothing legacy', async () => {
    setMode('shadow');
    const legacyAnswers = { staff: await traffic(staff), manager: await traffic(manager), owner: await traffic(owner) };
    setMode('enforce');
    const enforced = { staff: await traffic(staff), manager: await traffic(manager), owner: await traffic(owner) };
    expect(enforced).toEqual(legacyAnswers); // A2: no persona sees a difference when the engine takes over
    const adjust = () => http().post('/api/v1/stock/adjustment').set(auth(granted.token)).set('Idempotency-Key', randomUUID())
      .send({ productId: product, warehouseId: w1, quantity: '1', reason: 'count' });
    expect((await adjust()).status).toBe(201); // the scoped grant takes effect only now
    expect((await http().get('/api/v1/me/capabilities').set(auth(granted.token)).expect(200)).body.warehouses.items[0].capabilities).toContain('STOCK_ADJUSTMENT');
    setMode('shadow'); // rollback: flag only
    expect((await adjust()).status).toBe(403);
    expect(await db.query(`SELECT 1 FROM access_grants WHERE user_id = $1 AND revoked_at IS NULL`, [granted.id])).toHaveLength(1); // data kept
    expect((await http().get('/api/v1/warehouses').set(auth(staff.token)).expect(200)).body.map((w: { id: string }) => w.id).sort()).toEqual([w1, w3].sort());
  });
});
