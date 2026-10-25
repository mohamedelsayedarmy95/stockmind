/**
 * Series 10 / S2 on a real PostgreSQL, over real HTTP, with the capability engine ENFORCING (CAPABILITY_MODE=enforce).
 *
 * Personas (synthetic): Owner/Admin, an existing global Manager, Staff with an operator grant, and a SCOPED WAREHOUSE
 * MANAGER (base role Staff + a warehouse_manager grant on W1 and W3 only).
 *
 * Invariants exercised: A1 default deny · A2 legacy compatibility · A3 real scope enforcement (lists, ids, stock, sync,
 * lookup, transfers, replacement) · A4 no escalation · A5 revocation · A6 transaction correctness (a revocation that commits
 * while a write waits on the member's row refuses the write) · A7 financial separation · A9 /me/capabilities describes only
 * what the server enforces · A10 pending offline work is re-judged by the server.
 */
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { randomBytes, randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { AppModule } from '@/app.module';

process.env.CAPABILITY_MODE = 'enforce';
process.env.RECOVERY_OPERATIONS_ENABLED = 'true';

const RUN = Boolean(process.env.DB_HOST && process.env.JWT_ACCESS_SECRET && process.env.JWT_REFRESH_SECRET);
const TAG = randomBytes(4).toString('hex');
const password = () => `Aa1!${randomBytes(8).toString('hex')}`;
const COST = '4242.42';

interface Member { id: string; email: string; password: string; token: string }

(RUN ? describe : describe.skip)('scoped access (PostgreSQL, CAPABILITY_MODE=enforce)', () => {
  jest.setTimeout(240_000);
  let app: INestApplication;
  let db: DataSource;
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let owner: Member; let companyId: string;
  let w1: string; let w2: string; let w3: string;
  let product: string;
  let manager: Member; let s1: Member; let sm: Member;
  let other: Member; let otherCompanyId: string; let otherWarehouse: string;
  let seq = 0;

  const names: Record<string, string> = {};

  const join = async (role: 'Manager' | 'Staff', warehouseIds: string[] = [w1]): Promise<Member> => {
    const email = `sa.${role.toLowerCase()}.${++seq}.${TAG}@example.test`;
    const invite = await http().post('/api/v1/team/invitations').set(auth(owner.token))
      .send(role === 'Staff' ? { email, role, warehouseIds } : { email, role }).expect(201);
    const pw = password();
    const joined = await http().post('/api/v1/auth/accept-invitation').send({ token: invite.body.token, name: `${role} ${seq}`, password: pw }).expect(201);
    return { id: joined.body.user.id, email, password: pw, token: joined.body.accessToken };
  };
  const access = (actor: Member, memberId: string, assignments: Array<{ warehouseId: string; profile: string }>, extra: object = {}) =>
    http().put(`/api/v1/team/members/${memberId}/access`).set(auth(actor.token)).send({ assignments, ...extra });
  const getAccess = (actor: Member, memberId: string) => http().get(`/api/v1/team/members/${memberId}/access`).set(auth(actor.token));
  const caps = (m: Member) => http().get('/api/v1/me/capabilities').set(auth(m.token));
  const adjust = (m: Member, warehouseId: string, quantity = '1') =>
    http().post('/api/v1/stock/adjustment').set(auth(m.token)).set('Idempotency-Key', randomUUID()).send({ productId: product, warehouseId, quantity, reason: 'count' });
  const inbound = (m: Member, warehouseId: string, quantity = '1', key = randomUUID()) =>
    http().post('/api/v1/stock/inbound').set(auth(m.token)).set('Idempotency-Key', key).send({ productId: product, warehouseId, quantity });
  const transfer = (m: Member, from: string, to: string) =>
    http().post('/api/v1/stock/transfer').set(auth(m.token)).set('Idempotency-Key', randomUUID()).send({ productId: product, fromWarehouseId: from, toWarehouseId: to, quantity: '1' });
  const movementCount = async (warehouseId: string) =>
    (await db.query(`SELECT count(*)::int AS n FROM stock_movements WHERE warehouse_id = $1`, [warehouseId]))[0].n as number;
  const untilLockWait = async () => {
    for (let i = 0; i < 60; i++) {
      const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()`);
      if (n > 0) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('no backend ever waited on a lock');
  };

  beforeAll(async () => {
    // The 100/min/route throttle is not under test and would turn the concurrency stress into 429s.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);

    const register = async (name: string) => {
      const pw = password();
      const email = `sa.${name}.${TAG}@example.test`;
      const reg = await http().post('/api/v1/auth/register').send({ companyName: `Scoped ${name} ${TAG}`, name, email, password: pw }).expect(201);
      const company = (await db.query(`SELECT company_id FROM users WHERE id = $1`, [reg.body.user.id]))[0].company_id as string;
      return { m: { id: reg.body.user.id, email, password: pw, token: reg.body.accessToken } as Member, company, warehouse: reg.body.defaultWarehouse.id as string };
    };
    const a = await register('owner');
    owner = a.m; companyId = a.company; w1 = a.warehouse;
    const b = await register('other');
    other = b.m; otherCompanyId = b.company; otherWarehouse = b.warehouse;
    const mk = async (name: string) => {
      const res = await http().post('/api/v1/warehouses').set(auth(owner.token)).send({ name }).expect(201);
      names[res.body.id] = name;
      return res.body.id as string;
    };
    names[w1] = 'Main Warehouse';
    w2 = await mk(`Secret Warehouse ${TAG}`);
    w3 = await mk(`Third Warehouse ${TAG}`);
    product = (await http().post('/api/v1/products').set(auth(owner.token)).send({ name: 'Bolt', sku: `SA-${TAG}`, costPrice: COST }).expect(201)).body.id;
    for (const w of [w1, w2, w3]) await inbound(owner, w, '100').expect(201);

    manager = await join('Manager');
    s1 = await join('Staff', [w1]);
    sm = await join('Staff', [w1]);
    await access(owner, sm.id, [{ warehouseId: w1, profile: 'warehouse_manager' }, { warehouseId: w3, profile: 'warehouse_manager' }]).expect(200);
  });

  afterAll(async () => { await app?.close(); });

  // ------------------------------------------------------------------------------------ the profile catalogue

  it('offers both profiles, available because the engine enforces; the scoped one carries no financial or administrative capability', async () => {
    const res = await http().get('/api/v1/team/access-profiles').set(auth(owner.token)).expect(200);
    expect(res.body.mode).toBe('enforce');
    const byKey = Object.fromEntries(res.body.profiles.map((p: { key: string }) => [p.key, p]));
    expect(byKey.operator.available).toBe(true);
    expect(byKey.warehouse_manager.available).toBe(true);
    expect(byKey.warehouse_manager.capabilities).toEqual(expect.arrayContaining(['STOCK_ADJUSTMENT', 'STOCK_TRANSFER', 'UPDATE_WAREHOUSE']));
    for (const never of ['item.view_cost', 'MANAGE_USERS', 'CREATE_PRODUCT', 'DELETE_WAREHOUSE', 'MANAGE_RECOVERY']) {
      expect(byKey.warehouse_manager.capabilities).not.toContain(never);
    }
  });

  // --------------------------------------------------------------------------------------- A3: scope (reads)

  it('A3: the scoped manager sees only W1 and W3: list, direct id, balance, sync, movements, lookup, even by guessing', async () => {
    const list = await http().get('/api/v1/warehouses').set(auth(sm.token)).expect(200);
    expect(list.body.map((w: { id: string }) => w.id).sort()).toEqual([w1, w3].sort());
    expect(JSON.stringify(list.body)).not.toContain(names[w2]);
    await http().get(`/api/v1/warehouses/${w1}`).set(auth(sm.token)).expect(200);
    const hidden = await http().get(`/api/v1/warehouses/${w2}`).set(auth(sm.token));
    const nonexistent = await http().get(`/api/v1/warehouses/${randomUUID()}`).set(auth(sm.token));
    expect(hidden.status).toBe(404);
    expect(hidden.body.message).toBe(nonexistent.body.message); // indistinguishable from a warehouse that does not exist
    await http().get(`/api/v1/stock/balance/${product}/${w3}`).set(auth(sm.token)).expect(200);
    await http().get(`/api/v1/stock/balance/${product}/${w2}`).set(auth(sm.token)).expect(404);
    await http().get(`/api/v1/stock/changes/${w1}`).set(auth(sm.token)).expect(200);
    await http().get(`/api/v1/stock/changes/${w2}`).set(auth(sm.token)).expect(404);
    const history = await http().get(`/api/v1/stock/movements/${product}`).set(auth(sm.token)).expect(200);
    const seen = new Set(history.body.map((m: { warehouseId: string }) => m.warehouseId));
    expect(seen.has(w2)).toBe(false);
    expect(seen.has(w1) && seen.has(w3)).toBe(true);
  });

  it('A3: operations lookup and replacement cannot reach a warehouse outside the scope', async () => {
    // the owner records an operation in W2; the scoped manager asks about it by id
    const key = randomUUID();
    const sent = await inbound(owner, w2, '2', key).expect(201);
    const lookup = await http().post('/api/v1/stock/operations/lookup').set(auth(sm.token)).send({ operations: [{ key, movementId: sent.body.id }] }).expect(200);
    expect(JSON.stringify(lookup.body)).not.toContain(w2);
    const replace = await http().post('/api/v1/stock/replacements/inbound').set(auth(sm.token)).set('Idempotency-Key', randomUUID())
      .send({ originalKey: randomUUID(), originalMovementId: randomUUID(), productId: product, warehouseId: w2, quantity: '1',
        expectedGeneration: randomUUID(), acknowledge: true, receiptRevision: '1', receiptConfirmedAt: '2026-10-24T20:00:00.000Z', receiptGeneration: randomUUID() });
    expect(replace.status).toBe(404);
  });

  // ---------------------------------------------------------------------------------- A3: scope (writes) and capabilities

  it('the scoped manager adjusts and transfers inside its warehouses; both ends of a transfer must be granted', async () => {
    await adjust(sm, w1, '3').expect(201);
    await adjust(sm, w3, '-1').expect(201);
    await transfer(sm, w1, w3).expect(201);
    const before2 = await movementCount(w2);
    for (const attempt of [adjust(sm, w2), inbound(sm, w2), transfer(sm, w1, w2), transfer(sm, w2, w1)]) {
      expect((await attempt).status).toBe(404);
    }
    expect(await movementCount(w2)).toBe(before2); // nothing reached the ledger of W2
    const destination = await transfer(sm, w1, w2);
    const ghost = await transfer(sm, w1, randomUUID());
    expect(destination.body.message).toBe(ghost.body.message); // the destination's existence is not confirmed
  });

  it('A4: a plain operator cannot adjust or transfer, and nobody gains a capability by having a grant elsewhere', async () => {
    expect((await adjust(s1, w1)).status).toBe(403);
    expect((await transfer(s1, w1, w3)).status).toBe(403); // no transfer capability: refused as before, whatever the destination
    await inbound(s1, w1).expect(201); // what an operator could always do
  });

  it('the scoped manager is NOT a global Manager: no catalog writes, no warehouse creation or deletion, no team, no recovery, no audit', async () => {
    await http().post('/api/v1/products').set(auth(sm.token)).send({ name: 'x', sku: `SA-X-${TAG}` }).expect(403);
    await http().patch(`/api/v1/products/${product}`).set(auth(sm.token)).send({ name: 'renamed' }).expect(403);
    await http().post('/api/v1/warehouses').set(auth(sm.token)).send({ name: 'mine' }).expect(403);
    await http().delete(`/api/v1/warehouses/${w1}`).set(auth(sm.token)).expect(403);
    await http().get('/api/v1/team/members').set(auth(sm.token)).expect(403);
    await http().post('/api/v1/recovery/history-generation/rotate').set(auth(sm.token)).send({ reason: 'x'.repeat(40), confirm: 'ROTATE_HISTORY_GENERATION' }).expect(403);
    // but it may edit the warehouses it manages
    await http().patch(`/api/v1/warehouses/${w1}`).set(auth(sm.token)).send({ address: 'Dock 4' }).expect(200);
    await http().patch(`/api/v1/warehouses/${w2}`).set(auth(sm.token)).send({ address: 'Dock 9' }).expect(404);
  });

  it('A2: the global Manager and the Staff operator behave exactly as before', async () => {
    const all = await http().get('/api/v1/warehouses').set(auth(manager.token)).expect(200);
    expect(all.body.length).toBeGreaterThanOrEqual(3);
    await adjust(manager, w2).expect(201);
    await transfer(manager, w1, w2).expect(201);
    await http().post('/api/v1/products').set(auth(manager.token)).send({ name: 'm-item', sku: `SA-M-${TAG}`, costPrice: COST }).expect(201); // write-at-create compatibility
    const staffList = await http().get('/api/v1/warehouses').set(auth(s1.token)).expect(200);
    expect(staffList.body.map((w: { id: string }) => w.id)).toEqual([w1]);
  });

  // ----------------------------------------------------------------------------------------- A7 financial separation

  it('A7: warehouse access never implies cost visibility, in any response; a financial grant is a separate, company-wide, role-level act', async () => {
    for (const m of [sm, s1, manager]) {
      const list = await http().get('/api/v1/products').set(auth(m.token)).expect(200);
      expect(JSON.stringify(list.body)).not.toContain(COST);
      expect(list.body.some((p: Record<string, unknown>) => 'costPrice' in p)).toBe(false);
      expect((await caps(m).expect(200)).body.capabilities.financial.viewCost).toBe(false);
    }
    expect((await caps(owner).expect(200)).body.capabilities.financial.viewCost).toBe(true);
    // An explicit delegation (legacy custom role carrying item.view_cost) IS honoured, and /me/capabilities says so truthfully.
    const [{ id: roleId }] = await db.query(`INSERT INTO roles (company_id, name, description, is_system) VALUES ($1, $2, 'finance (test)', false) RETURNING id`, [companyId, `fin_${TAG}`]);
    const [{ id: permId }] = await db.query(`INSERT INTO permissions (name, description) VALUES ('item.view_cost', 'view cost') ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`);
    await db.query(`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)`, [roleId, permId]);
    await db.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [sm.id, roleId]);
    expect((await caps(sm).expect(200)).body.capabilities.financial.viewCost).toBe(true);
    const granted = await http().get(`/api/v1/products/${product}`).set(auth(sm.token)).expect(200);
    expect(granted.body.costPrice).toBe(COST);
    await db.query(`DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2`, [sm.id, roleId]);
    expect('costPrice' in (await http().get(`/api/v1/products/${product}`).set(auth(sm.token)).expect(200)).body).toBe(false);
  });

  // ------------------------------------------------------------------------------------------------- /me/capabilities

  it('A9: /me/capabilities describes exactly what the server enforces, per persona, without leaking anything else', async () => {
    const o = (await caps(owner).expect(200)).body;
    expect(o.engine).toMatchObject({ mode: 'enforce', enforced: true });
    expect(o.warehouses.all).toBe(true);
    expect(o.capabilities.team.manage).toBe(true);
    expect(o.membership).toMatchObject({ status: 'active', role: 'Admin', isOwner: true });

    const m = (await caps(manager).expect(200)).body;
    expect(m.warehouses.all).toBe(true);
    expect(m.capabilities.team.manage).toBe(false);
    expect(m.capabilities.organization).toEqual(expect.arrayContaining(['CREATE_PRODUCT', 'CREATE_WAREHOUSE']));
    expect(m.capabilities.organization).not.toContain('item.view_cost');

    const st = await caps(s1).expect(200);
    expect(st.body.warehouses.all).toBe(false);
    expect(st.body.warehouses.items.map((w: { id: string }) => w.id)).toEqual([w1]);
    expect(st.body.warehouses.items[0].capabilities).not.toContain('STOCK_ADJUSTMENT');

    const s = await caps(sm).expect(200);
    expect(s.headers['cache-control']).toBe('no-store');
    expect(String(s.headers['vary'])).toMatch(/authorization/i);
    expect(s.body.warehouses.items.map((w: { id: string }) => w.id).sort()).toEqual([w1, w3].sort());
    expect(s.body.warehouses.items[0].capabilities).toEqual(expect.arrayContaining(['STOCK_ADJUSTMENT', 'STOCK_TRANSFER']));
    expect(s.body.warehouses.items[0].profiles).toEqual([{ key: 'warehouse_manager', version: 1 }]);
    expect(s.body.capabilities.team.manage).toBe(false);
    const text = JSON.stringify(s.body);
    expect(text).not.toContain(names[w2]);
    expect(text).not.toContain(w2);
    expect(text).not.toContain(COST);
    expect(text).not.toMatch(/token|password|hash/i);
    // an unauthenticated or foreign caller gets nothing of ours
    await http().get('/api/v1/me/capabilities').expect(401);
    const foreign = (await caps(other).expect(200)).body;
    expect(JSON.stringify(foreign)).not.toContain(w1);
    expect(foreign.warehouses.items.map((w: { id: string }) => w.id)).toEqual([otherWarehouse]);
  });

  it('A5/A9: accessVersion changes exactly when authority changes, and a conditional request cannot hide a revocation', async () => {
    const v0 = (await caps(s1).expect(200)).body.accessVersion;
    expect((await caps(s1).expect(200)).body.accessVersion).toBe(v0); // stable while nothing changes
    const first = await caps(s1).expect(200);
    const etag = first.headers['etag'];
    if (etag) await http().get('/api/v1/me/capabilities').set(auth(s1.token)).set('If-None-Match', etag).expect(304); // identical body: honest 304
    await access(owner, s1.id, [{ warehouseId: w1, profile: 'operator' }, { warehouseId: w3, profile: 'operator' }]).expect(200);
    const after = await http().get('/api/v1/me/capabilities').set(auth(s1.token)).set('If-None-Match', etag ?? 'none').expect(200); // changed: never a 304
    expect(after.body.accessVersion).not.toBe(v0);
    expect(after.body.warehouses.items.map((w: { id: string }) => w.id).sort()).toEqual([w1, w3].sort());
    await access(owner, s1.id, [{ warehouseId: w1, profile: 'operator' }]).expect(200); // back
    expect((await caps(s1).expect(200)).body.accessVersion).toBe(v0);
  });

  // ------------------------------------------------------------------------------------ A5: revocation and grants

  it('A5: granting W2 makes it usable on the next request; revoking it denies the next request; W4 is never granted automatically', async () => {
    const staff = await join('Staff', [w1]);
    await http().get(`/api/v1/stock/changes/${w2}`).set(auth(staff.token)).expect(404);
    const granted = await access(owner, staff.id, [{ warehouseId: w1, profile: 'operator' }, { warehouseId: w2, profile: 'operator' }], { reason: 'covering' }).expect(200);
    expect(granted.body.changes).toEqual([{ warehouseId: w2, type: 'grant', from: null, to: 'operator' }]);
    await http().get(`/api/v1/stock/changes/${w2}`).set(auth(staff.token)).expect(200);
    await inbound(staff, w2).expect(201);
    await access(owner, staff.id, [{ warehouseId: w1, profile: 'operator' }]).expect(200);
    await http().get(`/api/v1/stock/changes/${w2}`).set(auth(staff.token)).expect(404);
    expect((await inbound(staff, w2)).status).toBe(404);

    // CP-4: a warehouse created later is visible to nobody who was not given it
    const w4 = (await http().post('/api/v1/warehouses').set(auth(manager.token)).send({ name: `Fourth ${TAG}` }).expect(201)).body.id as string;
    expect(await db.query(`SELECT 1 FROM warehouse_access WHERE warehouse_id = $1 UNION ALL SELECT 1 FROM access_grants WHERE scope_id = $1`, [w4])).toEqual([]);
    for (const m of [staff, s1, sm]) {
      expect((await http().get('/api/v1/warehouses').set(auth(m.token)).expect(200)).body.map((w: { id: string }) => w.id)).not.toContain(w4);
      await http().get(`/api/v1/warehouses/${w4}`).set(auth(m.token)).expect(404);
    }
    expect((await http().get('/api/v1/warehouses').set(auth(manager.token)).expect(200)).body.map((w: { id: string }) => w.id)).toContain(w4); // company-wide semantics unchanged
  });

  it('A5: revoking the scoped grant denies the scoped manager at once; role changes end scoped grants with evidence', async () => {
    const mgr = await join('Staff', [w1]);
    await access(owner, mgr.id, [{ warehouseId: w1, profile: 'warehouse_manager' }]).expect(200);
    await adjust(mgr, w1).expect(201);
    const events = () => db.query(`SELECT event_type, profile_key, previous_profile_key, source FROM access_grant_events WHERE target_user_id = $1 ORDER BY created_at`, [mgr.id]);
    await access(owner, mgr.id, [{ warehouseId: w1, profile: 'operator' }]).expect(200); // replace
    expect((await adjust(mgr, w1)).status).toBe(403);
    await access(owner, mgr.id, [{ warehouseId: w1, profile: 'warehouse_manager' }]).expect(200);
    await adjust(mgr, w1).expect(201);
    // promotion to Manager ends the scoped grant: it must not resurface after a later demotion
    await http().patch(`/api/v1/team/members/${mgr.id}/role`).set(auth(owner.token)).send({ role: 'Manager', acknowledgeCompanyWideAccess: true }).expect(200);
    expect(await db.query(`SELECT 1 FROM access_grants WHERE user_id = $1 AND revoked_at IS NULL`, [mgr.id])).toEqual([]);
    await http().patch(`/api/v1/team/members/${mgr.id}/role`).set(auth(owner.token)).send({ role: 'Staff' }).expect(200);
    const login = await http().post('/api/v1/auth/login').send({ email: mgr.email, password: mgr.password }).expect(200);
    mgr.token = login.body.accessToken;
    expect((await adjust(mgr, w1)).status).toBe(404); // demoted: no grants at all, nothing came back
    expect((await events()).map((e: { event_type: string; source: string }) => `${e.event_type}:${e.source}`)).toEqual([
      'replace:api', 'replace:api', 'replace:api', 'revoke:membership', // (the invitation made it an operator first)
    ]);
  });

  it('A1: expired, not-yet-valid, retired-profile and revoked grants fail closed', async () => {
    const staff = await join('Staff', [w1]);
    const [wm] = await db.query(`SELECT id FROM permission_profiles WHERE key = 'warehouse_manager'`);
    const insert = async (validFrom: string, validUntil: string | null) => (await db.query(
      `INSERT INTO access_grants (company_id, user_id, profile_id, scope_id, valid_from, valid_until) VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz) RETURNING id`,
      [companyId, staff.id, wm.id, w3, validFrom, validUntil]))[0].id as string;
    const probe = async () => (await adjust(staff, w3)).status;
    const expired = await insert(new Date(Date.now() - 7200_000).toISOString(), new Date(Date.now() - 3600_000).toISOString());
    expect(await probe()).toBe(404);
    await db.query(`UPDATE access_grants SET revoked_at = now() WHERE id = $1`, [expired]);
    const future = await insert(new Date(Date.now() + 3600_000).toISOString(), null);
    expect(await probe()).toBe(404);
    await db.query(`UPDATE access_grants SET revoked_at = now() WHERE id = $1`, [future]);
    const live = await insert(new Date(Date.now() - 1000).toISOString(), new Date(Date.now() + 3600_000).toISOString());
    expect(await probe()).toBe(201);
    await db.query(`UPDATE permission_profiles SET retired_at = now() WHERE id = $1`, [wm.id]); // a retired profile version grants nothing
    expect(await probe()).toBe(404);
    await db.query(`UPDATE permission_profiles SET retired_at = NULL WHERE id = $1`, [wm.id]);
    expect(await probe()).toBe(201);
    await db.query(`UPDATE access_grants SET revoked_at = now() WHERE id = $1`, [live]);
    expect(await probe()).toBe(404);
  });

  // ------------------------------------------------------------------------------------------------- A4: escalation

  it('A4: Staff, the scoped manager and the global Manager cannot issue grants; nobody changes their own access', async () => {
    const victim = await join('Staff', [w1]);
    for (const actor of [s1, sm, manager]) {
      expect((await access(actor, victim.id, [{ warehouseId: w1, profile: 'warehouse_manager' }])).status).toBe(403);
      expect((await getAccess(actor, victim.id)).status).toBe(403);
    }
    expect((await access(sm, sm.id, [{ warehouseId: w1, profile: 'warehouse_manager' }, { warehouseId: w2, profile: 'warehouse_manager' }])).status).toBe(403);
    const self = await access(owner, owner.id, []);
    expect(self.status).toBe(409);
    expect(self.body.code).toBe('CANNOT_MODIFY_SELF');
    expect(await db.query(`SELECT 1 FROM access_grants WHERE user_id = $1 AND scope_id = $2 AND revoked_at IS NULL`, [sm.id, w2])).toEqual([]);
  });

  it('A4: someone who may manage the team (explicit delegation) still cannot grant more than they hold, or on warehouses they cannot use', async () => {
    const delegate = await join('Staff', [w1]);
    const target = await join('Staff', [w1]);
    const [{ id: roleId }] = await db.query(`INSERT INTO roles (company_id, name, description, is_system) VALUES ($1, $2, 'team delegate (test)', false) RETURNING id`, [companyId, `deleg_${TAG}_${seq}`]);
    const [{ id: permId }] = await db.query(`INSERT INTO permissions (name, description) VALUES ('MANAGE_USERS', 'manage users') ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`);
    await db.query(`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)`, [roleId, permId]);
    await db.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [delegate.id, roleId]);
    const ok = await access(delegate, target.id, [{ warehouseId: w1, profile: 'operator' }]); // exactly what the delegate itself holds on W1
    expect(ok.status).toBe(200);
    const more = await access(delegate, target.id, [{ warehouseId: w1, profile: 'warehouse_manager' }]);
    expect(more.status).toBe(403);
    expect(more.body.code).toBe('GRANT_EXCEEDS_AUTHORITY');
    const elsewhere = await access(delegate, target.id, [{ warehouseId: w1, profile: 'operator' }, { warehouseId: w2, profile: 'operator' }]);
    expect(elsewhere.status).toBe(403);
    expect(elsewhere.body.code).toBe('GRANT_EXCEEDS_AUTHORITY');
    expect(await db.query(`SELECT 1 FROM access_grants WHERE user_id = $1 AND revoked_at IS NULL`, [target.id])).toEqual([]);
    expect((await db.query(`SELECT warehouse_id FROM warehouse_access WHERE user_id = $1`, [target.id])).map((r: { warehouse_id: string }) => r.warehouse_id)).toEqual([w1]);
  });

  it('assignment rules: Admin/Manager targets, removed members, unknown profiles/warehouses, duplicates and stale versions are refused without changing anything', async () => {
    const staff = await join('Staff', [w1]);
    const state = async () => JSON.stringify([
      await db.query(`SELECT warehouse_id FROM warehouse_access WHERE user_id = $1 ORDER BY 1`, [staff.id]),
      await db.query(`SELECT scope_id FROM access_grants WHERE user_id = $1 AND revoked_at IS NULL ORDER BY 1`, [staff.id]),
      await db.query(`SELECT count(*)::int FROM access_grant_events WHERE target_user_id = $1`, [staff.id]),
    ]);
    const before = await state();
    expect((await access(owner, manager.id, [{ warehouseId: w1, profile: 'operator' }])).body.code).toBe('ACCESS_NOT_APPLICABLE');
    expect((await access(owner, staff.id, [{ warehouseId: w1, profile: 'root' }])).body.code).toBe('UNKNOWN_PROFILE');
    expect((await access(owner, staff.id, [{ warehouseId: randomUUID(), profile: 'operator' }])).status).toBe(404);
    expect((await access(owner, staff.id, [{ warehouseId: otherWarehouse, profile: 'operator' }])).status).toBe(404);
    expect((await access(owner, staff.id, [{ warehouseId: w1, profile: 'operator' }, { warehouseId: w1, profile: 'warehouse_manager' }])).body.code).toBe('DUPLICATE_WAREHOUSE');
    const stale = await access(owner, staff.id, [{ warehouseId: w1, profile: 'operator' }, { warehouseId: w2, profile: 'operator' }], { expectedVersion: 'stale' });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('ACCESS_VERSION_CONFLICT');
    expect(await state()).toBe(before);
    // a removed member has nothing to assign
    await http().post(`/api/v1/team/members/${staff.id}/remove`).set(auth(owner.token)).send({ confirm: true }).expect(200);
    expect((await access(owner, staff.id, [{ warehouseId: w1, profile: 'operator' }])).body.code).toBe('TARGET_NOT_ACTIVE');
  });

  it('concurrent edits of one member: with the version they read, exactly one wins and the other is told to reload', async () => {
    const staff = await join('Staff', [w1]);
    const read = (await getAccess(owner, staff.id).expect(200)).body;
    expect(read.applicable).toBe(true);
    const a = access(owner, staff.id, [{ warehouseId: w1, profile: 'operator' }, { warehouseId: w2, profile: 'operator' }], { expectedVersion: read.version });
    const b = access(owner, staff.id, [{ warehouseId: w1, profile: 'operator' }, { warehouseId: w3, profile: 'operator' }], { expectedVersion: read.version });
    const [ra, rb] = await Promise.all([a, b]);
    expect([ra.status, rb.status].sort()).toEqual([200, 409]);
    const final = (await getAccess(owner, staff.id).expect(200)).body.assignments.map((x: { warehouseId: string }) => x.warehouseId).sort();
    expect(final).toEqual(ra.status === 200 ? [w1, w2].sort() : [w1, w3].sort()); // never a mixture
  });

  // ------------------------------------------------------------------------------------------- tenants and legacy API

  it('tenant separation: no enumeration of another company\'s members, grants or warehouses, in either direction', async () => {
    const staff = await join('Staff', [w1]);
    expect((await getAccess(other, staff.id)).status).toBe(404);
    expect((await access(other, staff.id, [{ warehouseId: otherWarehouse, profile: 'operator' }])).status).toBe(404);
    expect((await getAccess(owner, other.id)).status).toBe(404);
    expect((await access(owner, staff.id, [{ warehouseId: otherWarehouse, profile: 'operator' }])).status).toBe(404);
    expect((await http().get(`/api/v1/team/members/${staff.id}/access/events`).set(auth(other.token))).status).toBe(404);
    await http().get(`/api/v1/warehouses/${w1}`).set(auth(other.token)).expect(404);
    await http().get(`/api/v1/stock/changes/${w1}`).set(auth(other.token)).expect(404);
  });

  it('A2: the legacy warehouse endpoint and invitations still work, leave evidence, and do not duplicate a scoped assignment', async () => {
    const staff = await join('Staff', [w1]);
    await http().put(`/api/v1/team/members/${staff.id}/warehouses`).set(auth(owner.token)).send({ warehouseIds: [w1, w2] }).expect(200);
    expect((await caps(staff).expect(200)).body.warehouses.items.map((w: { id: string }) => w.id).sort()).toEqual([w1, w2].sort());
    await access(owner, staff.id, [{ warehouseId: w1, profile: 'operator' }, { warehouseId: w2, profile: 'warehouse_manager' }]).expect(200);
    await http().put(`/api/v1/team/members/${staff.id}/warehouses`).set(auth(owner.token)).send({ warehouseIds: [w1, w2, w3] }).expect(200);
    const rows = (await getAccess(owner, staff.id).expect(200)).body.assignments as Array<{ warehouseId: string; profile: string }>;
    expect(rows.filter((r) => r.warehouseId === w2)).toEqual([expect.objectContaining({ profile: 'warehouse_manager' })]); // not doubled
    expect(rows.map((r) => r.warehouseId).sort()).toEqual([w1, w2, w3].sort());
    const events = await db.query(`SELECT source FROM access_grant_events WHERE target_user_id = $1`, [staff.id]);
    expect(events.map((e: { source: string }) => e.source)).toEqual(expect.arrayContaining(['legacy_api', 'api']));
  });

  // -------------------------------------------------------------------------------------------------------- CP-4

  it('CP-4: initial access at warehouse creation is atomic and authorized; an actor who may not assign is refused, never ignored', async () => {
    const staff = await join('Staff', [w1]);
    const warehouses = async () => (await db.query(`SELECT count(*)::int AS n FROM warehouses WHERE company_id = $1`, [companyId]))[0].n as number;
    const before = await warehouses();
    // the global Manager may create warehouses but may not manage team access
    const refused = await http().post('/api/v1/warehouses').set(auth(manager.token)).send({ name: `Refused ${TAG}`, initialAccess: [{ userId: staff.id, profile: 'operator' }] });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('ACCESS_GRANT_NOT_PERMITTED');
    expect(await warehouses()).toBe(before); // nothing was created
    // a bad assignment rolls the warehouse back too
    const bad = await http().post('/api/v1/warehouses').set(auth(owner.token)).send({ name: `Rolled back ${TAG}`, initialAccess: [{ userId: manager.id, profile: 'operator' }] });
    expect(bad.status).toBe(400);
    expect(await warehouses()).toBe(before);
    // the owner decides at creation
    const created = await http().post('/api/v1/warehouses').set(auth(owner.token)).send({
      name: `Decided ${TAG}`, initialAccess: [{ userId: staff.id, profile: 'operator' }, { userId: sm.id, profile: 'warehouse_manager' }],
    }).expect(201);
    expect((await http().get(`/api/v1/warehouses/${created.body.id}`).set(auth(staff.token)).expect(200)).body.id).toBe(created.body.id);
    await adjust(sm, created.body.id).expect(201);
    expect((await adjust(staff, created.body.id)).status).toBe(403);
    // without initialAccess nobody gets anything
    const plain = await http().post('/api/v1/warehouses').set(auth(owner.token)).send({ name: `Plain ${TAG}` }).expect(201);
    await http().get(`/api/v1/warehouses/${plain.body.id}`).set(auth(staff.token)).expect(404);
  });

  // ------------------------------------------------------------------------- A6: authority changing under a running write

  it('A6: a grant revoked while a write waits on the member\'s row refuses the write and leaves no movement', async () => {
    const mgr = await join('Staff', [w1]);
    await access(owner, mgr.id, [{ warehouseId: w1, profile: 'warehouse_manager' }]).expect(200);
    const before = await movementCount(w1);
    const holder = db.createQueryRunner();
    await holder.connect();
    await holder.startTransaction();
    try {
      // exactly what the access administration does: lock the member row, then revoke
      await holder.query(`SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, [mgr.id]);
      await holder.query(`UPDATE access_grants SET revoked_at = now(), revoke_reason = 'in-flight test' WHERE user_id = $1 AND revoked_at IS NULL`, [mgr.id]);
      const write = adjust(mgr, w1, '5').then((r) => r); // passes the request guard (revocation not committed), waits inside its transaction
      await untilLockWait();
      await holder.commitTransaction();
      const res = await write;
      expect(res.status).toBe(404);
    } finally {
      await holder.release();
    }
    expect(await movementCount(w1)).toBe(before);
  });

  it('A6: a pending authority change is ordered ahead of later writes by the member lock itself (not only by row locks)', async () => {
    const mgr = await join('Staff', [w1]);
    await access(owner, mgr.id, [{ warehouseId: w1, profile: 'warehouse_manager' }]).expect(200);
    const before = await movementCount(w1);
    const holder = db.createQueryRunner();
    await holder.connect();
    await holder.startTransaction();
    try {
      // an authority change has taken the member lock (exclusively) and revoked, but has not committed yet
      await holder.query(`SELECT pg_advisory_xact_lock(hashtextextended('stockmind:member:' || $1::text, 0))`, [mgr.id]);
      await holder.query(`UPDATE access_grants SET revoked_at = now(), revoke_reason = 'ordering test' WHERE user_id = $1 AND revoked_at IS NULL`, [mgr.id]);
      const write = adjust(mgr, w1, '5').then((r) => r);
      await untilLockWait(); // the write queues behind the pending change instead of racing past it
      expect(await movementCount(w1)).toBe(before);
      await holder.commitTransaction();
      expect((await write).status).toBe(404);
    } finally {
      await holder.release();
    }
    expect(await movementCount(w1)).toBe(before);
  });

  it('A6: a role change that commits while a write waits refuses the write (the capability is re-read inside the transaction)', async () => {
    const m2 = await join('Manager');
    const before = await movementCount(w1);
    const holder = db.createQueryRunner();
    await holder.connect();
    await holder.startTransaction();
    try {
      await holder.query(`SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, [m2.id]);
      await holder.query(`UPDATE users SET role = 'Staff' WHERE id = $1`, [m2.id]); // no token_version bump: the guard cannot see it coming
      const write = adjust(m2, w1, '5').then((r) => r);
      await untilLockWait();
      await holder.commitTransaction();
      const res = await write;
      expect([403, 404]).toContain(res.status);
    } finally {
      await holder.release();
    }
    expect(await movementCount(w1)).toBe(before);
  });

  it('A6: writes still in flight finish BEFORE a revocation that waits for them; afterwards every new write is refused (stress, no deadlock)', async () => {
    const mgr = await join('Staff', [w1]);
    await access(owner, mgr.id, [{ warehouseId: w1, profile: 'warehouse_manager' }]).expect(200);
    const [{ deadlocks: d0 }] = await db.query(`SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()`);
    const results: number[] = [];
    let stop = false;
    const worker = async () => {
      while (!stop) results.push((await adjust(mgr, w1, '1')).status);
    };
    const workers = [worker(), worker(), worker(), worker()];
    await new Promise((r) => setTimeout(r, 400));
    const t0 = Date.now();
    await access(owner, mgr.id, []).expect(200); // revoke while writes are running
    const revokedAt = Date.now() - t0;
    const afterRevoke: number[] = [];
    for (let i = 0; i < 5; i++) afterRevoke.push((await adjust(mgr, w1, '1')).status);
    stop = true;
    await Promise.all(workers);
    expect(afterRevoke).toEqual([404, 404, 404, 404, 404]); // nothing committed after the revocation
    expect(results.filter((s) => s === 201).length).toBeGreaterThan(0); // some had finished before
    expect(results.every((s) => [201, 404].includes(s))).toBe(true); // never a 5xx, never a half state
    const [{ deadlocks: d1 }] = await db.query(`SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()`);
    expect(Number(d1) - Number(d0)).toBe(0);
    // every 201 produced exactly one movement
    const n = (await db.query(`SELECT count(*)::int AS n FROM stock_movements WHERE warehouse_id = $1 AND user_id = $2`, [w1, mgr.id]))[0].n as number;
    expect(n).toBe(results.filter((s) => s === 201).length);
    expect(revokedAt).toBeLessThan(10_000);
  });

  // --------------------------------------------------------------------------------------------- A10: offline honesty

  it('A10: an operation queued earlier is judged by the server when it finally arrives: lost access answers 404 and records nothing', async () => {
    const staff = await join('Staff', [w1, w2]);
    const key = randomUUID(); // the key a device kept in its outbox
    await access(owner, staff.id, [{ warehouseId: w1, profile: 'operator' }]).expect(200); // access revoked while the device was offline
    const before = await movementCount(w2);
    const late = await inbound(staff, w2, '9', key);
    expect(late.status).toBe(404);
    expect(await movementCount(w2)).toBe(before);
    // the key was not consumed by the refusal: after access is restored the SAME queued request can still be applied once
    await access(owner, staff.id, [{ warehouseId: w1, profile: 'operator' }, { warehouseId: w2, profile: 'operator' }]).expect(200);
    const replayed = await inbound(staff, w2, '9', key);
    expect(replayed.status).toBe(201);
    expect((await inbound(staff, w2, '9', key)).body.replayed).toBe(true);
  });
});
