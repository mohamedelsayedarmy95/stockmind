/**
 * Series 09 / S1 on a real PostgreSQL, over real HTTP: member lifecycle and IMMEDIATE revocation.
 *
 * What is proven here (synthetic company and users only):
 *  - a suspended/removed member's access token stops working on the very next request (not at expiry), their refresh
 *    token and password login are refused, and nothing they sent after the suspension reaches the ledger;
 *  - the role is read from the database on every request (a forged or stale role claim grants nothing), and a token issued
 *    before a role change / session revocation is refused while the refresh token keeps a role change smooth;
 *  - the in-transaction re-check closes the window between the request guard and the commit (a suspension that commits
 *    while a write waits on the member's row is honoured; the write is refused and leaves no movement);
 *  - only an owner acts on Admin members, a company with no owner fails closed, other companies' members are invisible;
 *  - every change is recorded in membership_events (who, whom, what, why).
 */
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { randomBytes, randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { AppModule } from '@/app.module';

const RUN = Boolean(process.env.DB_HOST && process.env.JWT_ACCESS_SECRET && process.env.JWT_REFRESH_SECRET);
const TAG = randomBytes(4).toString('hex');
const password = () => `Aa1!${randomBytes(8).toString('hex')}`;
const CONFIRM_ROTATE = 'ROTATE_HISTORY_GENERATION';

interface Member { id: string; email: string; password: string; token: string; refresh: string }

(RUN ? describe : describe.skip)('access lifecycle: immediate revocation and membership policy (PostgreSQL)', () => {
  jest.setTimeout(240_000);
  let app: INestApplication;
  let db: DataSource;
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let owner: Member; let companyId: string; let w1: string; let product: string;
  let otherOwner: Member; let otherCompanyId: string;
  let manager: Member;
  let seq = 0;

  const stockIn = (token: string, key = randomUUID(), quantity = '1') =>
    http().post('/api/v1/stock/inbound').set(auth(token)).set('Idempotency-Key', key).send({ productId: product, warehouseId: w1, quantity });
  const movementCount = async () => (await db.query(`SELECT count(*)::int AS n FROM stock_movements WHERE warehouse_id = $1`, [w1]))[0].n as number;
  const act = (actor: Member, memberId: string, action: string, body: object = {}) =>
    http().post(`/api/v1/team/members/${memberId}/${action}`).set(auth(actor.token)).send(body);
  const login = (m: Member) => http().post('/api/v1/auth/login').send({ email: m.email, password: m.password });
  const refresh = (m: Member) => http().post('/api/v1/auth/refresh-token').send({ refreshToken: m.refresh });
  const rowOf = async (id: string) =>
    (await db.query(`SELECT status, role::text AS role, token_version, is_owner, refresh_token_hash FROM users WHERE id = $1`, [id]))[0];
  const eventsOf = async (id: string) =>
    db.query(`SELECT event_type, actor_user_id, from_status, to_status, from_role, to_role, sessions_revoked, reason FROM membership_events WHERE target_user_id = $1 ORDER BY created_at`, [id]);

  /** Invites and accepts a member of the founder's company. */
  const join = async (role: 'Manager' | 'Staff', who: Member = owner, warehouses: string[] = [w1]): Promise<Member> => {
    const email = `lc.${role.toLowerCase()}.${++seq}.${TAG}@example.test`;
    const invite = await http().post('/api/v1/team/invitations').set(auth(who.token))
      .send(role === 'Staff' ? { email, role, warehouseIds: warehouses } : { email, role }).expect(201);
    const pw = password();
    const joined = await http().post('/api/v1/auth/accept-invitation').send({ token: invite.body.token, name: `${role} ${seq}`, password: pw }).expect(201);
    return { id: joined.body.user.id, email, password: pw, token: joined.body.accessToken, refresh: joined.body.refreshToken };
  };

  /** Waits until some backend is blocked on a lock (the request under test is waiting for the member's row). */
  const untilLockWait = async () => {
    for (let i = 0; i < 60; i++) {
      const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()`);
      if (n > 0) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('no backend ever waited on a lock');
  };

  beforeAll(async () => {
    process.env.RECOVERY_OPERATIONS_ENABLED = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1'); // listen once: concurrent supertest requests otherwise reset each other's sockets
    db = app.get(DataSource);

    const register = async (name: string): Promise<{ m: Member; company: string; warehouse: string }> => {
      const pw = password();
      const email = `lc.${name}.${TAG}@example.test`;
      const reg = await http().post('/api/v1/auth/register').send({ companyName: `Lifecycle ${name} ${TAG}`, name, email, password: pw }).expect(201);
      const company = (await db.query(`SELECT company_id FROM users WHERE id = $1`, [reg.body.user.id]))[0].company_id as string;
      return { m: { id: reg.body.user.id, email, password: pw, token: reg.body.accessToken, refresh: reg.body.refreshToken }, company, warehouse: reg.body.defaultWarehouse.id };
    };
    const a = await register('owner');
    owner = a.m; companyId = a.company; w1 = a.warehouse;
    const b = await register('other');
    otherOwner = b.m; otherCompanyId = b.company;
    product = (await http().post('/api/v1/products').set(auth(owner.token)).send({ name: 'Bolt', sku: `LC-${TAG}` }).expect(201)).body.id;
    await stockIn(owner.token, randomUUID(), '100').expect(201);
    manager = await join('Manager');
  });

  afterAll(async () => { await app?.close(); });

  // ------------------------------------------------------------------------------------------------ founders

  it('registration makes the founder the owner, and a legacy token without `tv` still works for a member at version 0', async () => {
    expect(await rowOf(owner.id)).toMatchObject({ status: 'active', role: 'Admin', is_owner: true, token_version: 0 });
    const legacy = new JwtService({}).sign({ sub: owner.id, companyId, role: 'Admin' }, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '5m' });
    await http().get('/api/v1/team/members').set(auth(legacy)).expect(200);
    const members = (await http().get('/api/v1/team/members').set(auth(owner.token)).expect(200)).body;
    expect(members.find((m: { id: string }) => m.id === owner.id)).toMatchObject({ status: 'active', isOwner: true, role: 'Admin' });
  });

  // ---------------------------------------------------------------------------------------------- suspension

  it('suspend: the very next request of the member is refused, and so are refresh and login; reactivation does not revive old tokens', async () => {
    const staff = await join('Staff');
    await http().get('/api/v1/products').set(auth(staff.token)).expect(200);
    await stockIn(staff.token).expect(201);
    const before = await movementCount();

    const res = await act(owner, staff.id, 'suspend', { reason: 'left for another site' }).expect(200);
    expect(res.body).toMatchObject({ id: staff.id, status: 'suspended', sessionsRevoked: true });

    // The same token that worked a moment ago: refused at once, with a code a client can act on.
    for (const attempt of [
      http().get('/api/v1/products').set(auth(staff.token)),
      http().get('/api/v1/warehouses').set(auth(staff.token)),
      stockIn(staff.token),
    ]) {
      const denied = await attempt;
      expect(denied.status).toBe(401);
      expect(denied.body.code).toBe('ACCESS_REVOKED');
    }
    expect(await movementCount()).toBe(before); // nothing sent after the suspension reached the ledger

    const refreshed = await refresh(staff);
    expect(refreshed.status).toBe(401);
    expect(refreshed.body.code).toBe('ACCESS_REVOKED');
    const signedIn = await login(staff);
    expect(signedIn.status).toBe(403);
    expect(signedIn.body.code).toBe('ACCESS_REVOKED');
    expect((await rowOf(staff.id)).refresh_token_hash).toBeNull();

    // Reactivation lets the member sign in again, but the tokens issued before the suspension stay dead.
    await act(owner, staff.id, 'reactivate', { reason: 'back' }).expect(200);
    await http().get('/api/v1/products').set(auth(staff.token)).expect(401);
    expect((await refresh(staff)).status).toBe(401);
    const again = await login(staff).expect(200);
    await http().get('/api/v1/products').set(auth(again.body.accessToken)).expect(200);
    await http().post('/api/v1/stock/inbound').set(auth(again.body.accessToken)).set('Idempotency-Key', randomUUID())
      .send({ productId: product, warehouseId: w1, quantity: '1' }).expect(201); // grants survived the suspension

    expect(await eventsOf(staff.id)).toEqual([
      expect.objectContaining({ event_type: 'suspend', actor_user_id: owner.id, from_status: 'active', to_status: 'suspended', sessions_revoked: true, reason: 'left for another site' }),
      expect.objectContaining({ event_type: 'reactivate', actor_user_id: owner.id, from_status: 'suspended', to_status: 'active', sessions_revoked: false }),
    ]);
    const history = (await http().get(`/api/v1/team/members/${staff.id}/events`).set(auth(owner.token)).expect(200)).body;
    expect(history.map((e: { eventType: string }) => e.eventType)).toEqual(['reactivate', 'suspend']); // newest first
  });

  it('status is enforced on its own: a member suspended directly in SQL (no version bump) is refused on the next request', async () => {
    const staff = await join('Staff');
    await http().get('/api/v1/products').set(auth(staff.token)).expect(200);
    await db.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [staff.id]); // an operator's change, token_version untouched
    expect((await rowOf(staff.id)).token_version).toBe(0);
    const denied = await http().get('/api/v1/products').set(auth(staff.token));
    expect(denied.status).toBe(401);
    expect(denied.body.code).toBe('ACCESS_REVOKED');
    await db.query(`UPDATE users SET status = 'active' WHERE id = $1`, [staff.id]);
    await http().get('/api/v1/products').set(auth(staff.token)).expect(200); // and honoured symmetrically when lifted
  });

  it('an idempotent retry of an earlier write from a suspended member is refused, not replayed', async () => {
    const staff = await join('Staff');
    const key = randomUUID();
    await stockIn(staff.token, key, '2').expect(201);
    await act(owner, staff.id, 'suspend').expect(200);
    const before = await movementCount();
    const retry = await stockIn(staff.token, key, '2');
    expect(retry.status).toBe(401);
    expect(retry.body.code).toBe('ACCESS_REVOKED');
    expect(await movementCount()).toBe(before);
  });

  // ------------------------------------------------------------------------------------------------ removal

  it('remove: access ends at once, the seat is freed, grants are cleared, and a returning member starts with no warehouses', async () => {
    const staff = await join('Staff');
    const seats = async () => (await http().get('/api/v1/team/entitlements').set(auth(owner.token)).expect(200)).body.usage.seats as number;
    const before = await seats();

    await act(owner, staff.id, 'remove', { reason: 'contract ended' }).expect(400); // needs the explicit confirmation
    await act(owner, staff.id, 'remove', { confirm: true, reason: 'contract ended' }).expect(200);
    expect(await seats()).toBe(before - 1);
    expect((await http().get('/api/v1/products').set(auth(staff.token))).status).toBe(401);
    expect((await login(staff)).body.code).toBe('ACCESS_REVOKED');
    expect(await db.query(`SELECT 1 FROM warehouse_access WHERE user_id = $1`, [staff.id])).toEqual([]);

    const listed = (await http().get('/api/v1/team/members').set(auth(owner.token)).expect(200)).body;
    expect(listed.find((m: { id: string }) => m.id === staff.id)).toMatchObject({ status: 'removed' }); // kept: history stays attributable

    // The same e-mail cannot be invited again while the removed row holds it; reactivation is the path back.
    await http().post('/api/v1/team/invitations').set(auth(owner.token)).send({ email: staff.email, role: 'Manager' }).expect(409);
    await act(owner, staff.id, 'reactivate').expect(200);
    expect(await seats()).toBe(before);
    const back = await login(staff).expect(200);
    await http().get('/api/v1/products').set(auth(back.body.accessToken)).expect(200);
    const noGrant = await http().post('/api/v1/stock/inbound').set(auth(back.body.accessToken)).set('Idempotency-Key', randomUUID())
      .send({ productId: product, warehouseId: w1, quantity: '1' });
    expect(noGrant.status).toBe(404); // no silent re-grant of the old warehouses
  });

  // ---------------------------------------------------------------------------------------- revoke sessions

  it('revoke-sessions: every token of the member dies at once, the account stays usable, and signing in again works', async () => {
    const staff = await join('Staff');
    await http().get('/api/v1/products').set(auth(staff.token)).expect(200);
    await act(owner, staff.id, 'revoke-sessions').expect(200);
    expect((await http().get('/api/v1/products').set(auth(staff.token))).body.code).toBe('ACCESS_REVOKED');
    expect((await refresh(staff)).status).toBe(401);
    const fresh = await login(staff).expect(200);
    await http().get('/api/v1/products').set(auth(fresh.body.accessToken)).expect(200);
    expect(await rowOf(staff.id)).toMatchObject({ status: 'active', token_version: 1 });
  });

  // ------------------------------------------------------------------------------------------- role change

  it('role change: needs the company-wide acknowledgement to broaden; old tokens die, the refresh token renews under the new role', async () => {
    const staff = await join('Staff');
    await http().get('/api/v1/team/members').set(auth(staff.token)).expect(403); // Staff cannot manage the team
    const unconfirmed = await http().patch(`/api/v1/team/members/${staff.id}/role`).set(auth(owner.token)).send({ role: 'Manager' });
    expect(unconfirmed.status).toBe(400);
    expect(unconfirmed.body.code).toBe('ACKNOWLEDGEMENT_REQUIRED');
    expect(await rowOf(staff.id)).toMatchObject({ role: 'Staff', token_version: 0 }); // nothing changed

    await http().patch(`/api/v1/team/members/${staff.id}/role`).set(auth(owner.token))
      .send({ role: 'Manager', acknowledgeCompanyWideAccess: true, reason: 'promoted' }).expect(200);
    expect((await http().get('/api/v1/products').set(auth(staff.token))).status).toBe(401); // issued under the old role
    const renewed = await refresh(staff).expect(200);
    staff.token = renewed.body.accessToken; staff.refresh = renewed.body.refreshToken;
    await http().post('/api/v1/products').set(auth(staff.token)).send({ name: 'By new manager', sku: `LC-M-${TAG}-${seq}` }).expect(201); // CREATE_PRODUCT: Manager
    expect((await eventsOf(staff.id))[0]).toMatchObject({ event_type: 'change_role', from_role: 'Staff', to_role: 'Manager', reason: 'promoted' });

    // Back to Staff: the grants start empty (never the leftovers of an earlier role).
    await http().patch(`/api/v1/team/members/${staff.id}/role`).set(auth(owner.token)).send({ role: 'Staff' }).expect(200);
    const asStaff = await refresh(staff).expect(200);
    await http().post('/api/v1/products').set(auth(asStaff.body.accessToken)).send({ name: 'x', sku: `LC-S-${TAG}-${seq}` }).expect(403);
    expect(await db.query(`SELECT 1 FROM warehouse_access WHERE user_id = $1`, [staff.id])).toEqual([]);
  });

  it('the role is read from the database: a forged or stale role claim grants nothing, a wrong version or company is refused', async () => {
    const staff = await join('Staff');
    const sign = (claims: object) => new JwtService({}).sign(claims, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '5m' });
    const forgedAdmin = sign({ sub: staff.id, companyId, role: 'Admin', tv: 0 });
    await http().get('/api/v1/team/members').set(auth(forgedAdmin)).expect(403); // claim says Admin, the row says Staff
    await http().get('/api/v1/products').set(auth(forgedAdmin)).expect(200);

    const wrongVersion = sign({ sub: staff.id, companyId, role: 'Staff', tv: 7 });
    expect((await http().get('/api/v1/products').set(auth(wrongVersion))).body.code).toBe('ACCESS_REVOKED');
    const otherCompany = sign({ sub: staff.id, companyId: otherCompanyId, role: 'Staff', tv: 0 });
    await http().get('/api/v1/products').set(auth(otherCompany)).expect(401);
    const ghost = sign({ sub: randomUUID(), companyId, role: 'Admin', tv: 0 });
    await http().get('/api/v1/products').set(auth(ghost)).expect(401);
  });

  // ------------------------------------------------------------------------------------- authority and tenancy

  it('who may act: Manager and Staff cannot; another company\'s owner sees 404; nobody acts on themselves', async () => {
    const staff = await join('Staff');
    for (const who of [manager, staff]) {
      await act(who, staff.id, 'suspend').expect(403);
      await http().get(`/api/v1/team/members/${staff.id}/events`).set(auth(who.token)).expect(403);
    }
    await act(otherOwner, staff.id, 'suspend').expect(404);
    await act(owner, otherOwner.id, 'suspend').expect(404);
    await act(owner, randomUUID(), 'suspend').expect(404);
    await act(owner, 'not-a-uuid', 'suspend').expect(400);
    const self = await act(owner, owner.id, 'suspend');
    expect(self.status).toBe(409);
    expect(self.body.code).toBe('CANNOT_MODIFY_SELF');
    expect(await rowOf(staff.id)).toMatchObject({ status: 'active' });
    expect(await rowOf(otherOwner.id)).toMatchObject({ status: 'active' });
  });

  it('only the owner acts on an Admin: a promoted Admin manages Staff but not the owner or other Admins', async () => {
    const peer = await join('Staff');
    const admin2 = await join('Staff');
    const unconfirmed = await http().patch(`/api/v1/team/members/${admin2.id}/role`).set(auth(owner.token)).send({ role: 'Admin' });
    expect(unconfirmed.body.code).toBe('ACKNOWLEDGEMENT_REQUIRED');
    await http().patch(`/api/v1/team/members/${admin2.id}/role`).set(auth(owner.token)).send({ role: 'Admin', acknowledgeCompanyWideAccess: true }).expect(200);
    admin2.token = (await refresh(admin2).expect(200)).body.accessToken;
    expect(await rowOf(admin2.id)).toMatchObject({ role: 'Admin', is_owner: false });

    await act(admin2, peer.id, 'suspend').expect(200); // an Admin manages Staff
    const touchOwner = await act(admin2, owner.id, 'suspend');
    expect(touchOwner.status).toBe(403);
    expect(touchOwner.body.code).toBe('OWNER_REQUIRED');
    await act(admin2, manager.id, 'suspend').expect(200); // a Manager is not an Admin
    await act(owner, manager.id, 'reactivate').expect(200);
    manager.token = (await login(manager).expect(200)).body.accessToken;
    const candidate = await join('Staff');
    const promote = await http().patch(`/api/v1/team/members/${candidate.id}/role`).set(auth(admin2.token)).send({ role: 'Admin', acknowledgeCompanyWideAccess: true });
    expect(promote.status).toBe(403); // only the owner can make someone an Admin
    expect(promote.body.code).toBe('OWNER_REQUIRED');
    expect(await rowOf(candidate.id)).toMatchObject({ role: 'Staff' });

    await act(owner, admin2.id, 'suspend').expect(200); // the owner may suspend an Admin
    expect((await http().get('/api/v1/team/members').set(auth(admin2.token))).body.code).toBe('ACCESS_REVOKED');
    expect(await rowOf(owner.id)).toMatchObject({ status: 'active', is_owner: true }); // the owner was never touched
  });

  it('a company with no owner (legacy, ambiguous) fails closed for Admin members but still manages Staff', async () => {
    const [{ id: cid }] = await db.query(`INSERT INTO companies (name) VALUES ($1) RETURNING id`, [`Ownerless ${TAG}`]);
    const hash = await bcrypt.hash('Aa1!ownerless-pass', 4);
    const mk = async (role: string) => (await db.query(
      `INSERT INTO users (company_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [cid, role, `lc.ownerless.${role}.${TAG}@example.test`, hash, role]))[0].id as string;
    const [a1, a2, st] = [await mk('Admin'), await mk('Staff'), await mk('Manager')];
    // two Admins, nobody designated: exactly what the migration leaves for an ambiguous legacy company
    await db.query(`UPDATE users SET role = 'Admin' WHERE id = $1`, [a2]);
    const signedIn = await http().post('/api/v1/auth/login').send({ email: `lc.ownerless.Admin.${TAG}@example.test`, password: 'Aa1!ownerless-pass' }).expect(200);
    const adminToken = signedIn.body.accessToken as string;
    expect((await rowOf(a1)).is_owner).toBe(false);

    const refused = await http().post(`/api/v1/team/members/${a2}/suspend`).set(auth(adminToken)).send({});
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('OWNER_REQUIRED');
    await http().post(`/api/v1/team/members/${st}/suspend`).set(auth(adminToken)).send({}).expect(200);
    expect(await rowOf(a2)).toMatchObject({ status: 'active' });
  });

  // ----------------------------------------------------------------------- the window between guard and commit

  it('in-transaction re-check: a suspension that commits while a write waits on the member\'s row refuses the write', async () => {
    const staff = await join('Staff');
    const before = await movementCount();
    const holder = db.createQueryRunner();
    await holder.connect();
    await holder.startTransaction();
    try {
      // The suspension is in flight (row locked, uncommitted): the request guard still reads the committed, active row.
      await holder.query(`UPDATE users SET status = 'suspended', token_version = token_version + 1 WHERE id = $1`, [staff.id]);
      const write = stockIn(staff.token, randomUUID(), '3').then((r) => r);
      await untilLockWait(); // the write passed the guard and now waits for the member's row inside its transaction
      await holder.commitTransaction();
      const res = await write;
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('ACCESS_REVOKED');
    } finally {
      await holder.release();
    }
    expect(await movementCount()).toBe(before); // the write left no movement and no key record
  });

  it('in-transaction re-check: a write that is already running finishes first, and the suspension waits for it', async () => {
    const staff = await join('Staff');
    const holder = db.createQueryRunner();
    await holder.connect();
    await holder.startTransaction();
    try {
      await holder.query(`SELECT 1 FROM users WHERE id = $1 FOR SHARE`, [staff.id]); // an in-flight write holds the member share-locked
      const suspension = act(owner, staff.id, 'suspend').then((r) => r);
      await untilLockWait();
      expect((await rowOf(staff.id)).status).toBe('active'); // not yet: it waits behind the write
      await holder.commitTransaction();
      expect((await suspension).status).toBe(200);
    } finally {
      await holder.release();
    }
    expect((await rowOf(staff.id)).status).toBe('suspended');
  });

  it('in-transaction re-check also covers the history-generation rotation', async () => {
    const admin2 = await join('Staff');
    await http().patch(`/api/v1/team/members/${admin2.id}/role`).set(auth(owner.token)).send({ role: 'Admin', acknowledgeCompanyWideAccess: true }).expect(200);
    admin2.token = (await refresh(admin2).expect(200)).body.accessToken;
    const generation = async () => (await db.query(`SELECT history_generation::text AS g FROM companies WHERE id = $1`, [companyId]))[0].g as string;
    const before = await generation();

    const holder = db.createQueryRunner();
    await holder.connect();
    await holder.startTransaction();
    try {
      await holder.query(`UPDATE users SET status = 'suspended', token_version = token_version + 1 WHERE id = $1`, [admin2.id]);
      const rotation = http().post('/api/v1/recovery/history-generation/rotate').set(auth(admin2.token))
        .send({ reason: 'Restore of the primary database from the 02:00 snapshot after an incident (test)', confirm: CONFIRM_ROTATE }).then((r) => r);
      await untilLockWait();
      await holder.commitTransaction();
      const res = await rotation;
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('ACCESS_REVOKED');
    } finally {
      await holder.release();
    }
    expect(await generation()).toBe(before); // not rotated by a suspended operator
  });
});
