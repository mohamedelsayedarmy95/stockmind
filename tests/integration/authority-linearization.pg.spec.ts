/**
 * Series 11 / F11-01 on a real PostgreSQL, over real HTTP, with the capability engine ENFORCING.
 *
 * Question: can an authority mutation (a warehouse grant) COMMIT after the authority it relied on (the GRANTING actor's
 * administrative role) was revoked by an earlier COMMITTED change?
 *
 * The scenarios are deterministic: a held lock (a row lock on the row the grant must replace, or the member's authority lock
 * taken by the test) parks the grant at a known point INSIDE its transaction; the revocation is then fired and the test observes
 * whether it can commit while the grant is parked, by looking at the database from a third connection. Nothing is decided by a
 * sleep: waiting is done on pg_locks, and the sleeps only give a revocation that is NOT ordered a generous chance to show itself.
 *
 * The invariant is a linearization: whichever of {grant, revocation} commits first is visible to the other. So
 *   - if the revocation could NOT commit while the grant was parked, the grant was authorized first and commits (200), and the
 *     revocation applies after it;
 *   - if the revocation committed first, the grant must be refused and must leave nothing behind.
 */
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { randomBytes, randomUUID } from 'crypto';
import { DataSource, QueryRunner } from 'typeorm';
import { AppModule } from '@/app.module';
import { AccessGrantService } from '@/infrastructure/repositories/access-grant.service';

process.env.CAPABILITY_MODE = 'enforce';
process.env.RECOVERY_OPERATIONS_ENABLED = 'true';

const RUN = Boolean(process.env.DB_HOST && process.env.JWT_ACCESS_SECRET && process.env.JWT_REFRESH_SECRET);
const TAG = randomBytes(4).toString('hex');
const password = () => `Aa1!${randomBytes(8).toString('hex')}`;

interface Member { id: string; email: string; password: string; token: string }
type Done<T> = { settled: boolean; res?: T };

(RUN ? describe : describe.skip)('F11-01 authority linearization (PostgreSQL, CAPABILITY_MODE=enforce)', () => {
  jest.setTimeout(240_000);
  let app: INestApplication;
  let db: DataSource;
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  let owner: Member; let companyId: string; let w1: string; let w3: string;
  let other: Member;
  let seq = 0;
  const holders: QueryRunner[] = [];

  const join = async (role: 'Manager' | 'Staff', warehouseIds: string[] = [w1]): Promise<Member> => {
    const email = `al.${role.toLowerCase()}.${++seq}.${TAG}@example.test`;
    const invite = await http().post('/api/v1/team/invitations').set(auth(owner.token))
      .send(role === 'Staff' ? { email, role, warehouseIds } : { email, role }).expect(201);
    const pw = password();
    const joined = await http().post('/api/v1/auth/accept-invitation').send({ token: invite.body.token, name: `${role} ${seq}`, password: pw }).expect(201);
    return { id: joined.body.user.id, email, password: pw, token: joined.body.accessToken };
  };
  const login = async (m: Member) => { m.token = (await http().post('/api/v1/auth/login').send({ email: m.email, password: m.password }).expect(200)).body.accessToken; return m; };
  /** A second administrator (not an owner): promoted by the owner, then signed in again (the promotion ended the old session). */
  const newAdmin = async (): Promise<Member> => {
    const a = await join('Manager');
    await http().patch(`/api/v1/team/members/${a.id}/role`).set(auth(owner.token)).send({ role: 'Admin', acknowledgeCompanyWideAccess: true }).expect(200);
    return login(a);
  };
  const newStaff = () => join('Staff', [w1]);

  const grant = (actor: Member, memberId: string, assignments: Array<{ warehouseId: string; profile: string }>) =>
    http().put(`/api/v1/team/members/${memberId}/access`).set(auth(actor.token)).send({ assignments });
  const legacyGrant = (actor: Member, memberId: string, warehouseIds: string[]) =>
    http().put(`/api/v1/team/members/${memberId}/warehouses`).set(auth(actor.token)).send({ warehouseIds });
  const revocations: Record<string, (a: Member) => request.Test> = {
    "demoted to Staff": (a) => http().patch(`/api/v1/team/members/${a.id}/role`).set(auth(owner.token)).send({ role: 'Staff' }),
    "demoted to Manager": (a) => http().patch(`/api/v1/team/members/${a.id}/role`).set(auth(owner.token)).send({ role: 'Manager', acknowledgeCompanyWideAccess: true }),
    "suspended": (a) => http().post(`/api/v1/team/members/${a.id}/suspend`).set(auth(owner.token)).send({}),
    "removed": (a) => http().post(`/api/v1/team/members/${a.id}/remove`).set(auth(owner.token)).send({ confirm: true }),
  };

  const track = <T>(p: PromiseLike<T>): Done<T> => {
    const d: Done<T> = { settled: false };
    p.then((res) => { d.settled = true; d.res = res; }, () => { d.settled = true; });
    return d;
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  /** A request that waits on a lock the TEST holds must not hang the suite: after `ms` it counts as HUNG and the test fails. */
  const HUNG = Symbol('hung');
  const bounded = <T>(p: PromiseLike<T>, ms = 7000): Promise<T | typeof HUNG> =>
    Promise.race<T | typeof HUNG>([Promise.resolve(p), sleep(ms).then((): typeof HUNG => HUNG)]);
  const until = async (cond: () => Promise<boolean> | boolean, ms = 10_000, what = 'condition') => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await cond()) return true; await sleep(40); }
    throw new Error(`timed out waiting for ${what}`);
  };
  const waitersOn = async (xid: string) =>
    (await db.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'transactionid' AND transactionid::text = $1 AND NOT granted`, [xid]))[0].n as number;

  /** A row lock held by the test on a row the grant/legacy change must replace: it parks THAT statement, taking no lock that a revocation needs. */
  const parkOnRow = async (table: 'warehouse_access' | 'warehouses', where: string, params: unknown[]) => {
    const qr = db.createQueryRunner(); await qr.connect(); await qr.startTransaction(); holders.push(qr);
    expect((await qr.query(`SELECT 1 FROM ${table} WHERE ${where} FOR UPDATE`, params)).length).toBe(1);
    const [{ x }] = await qr.query(`SELECT pg_current_xact_id()::xid::text AS x`);
    return {
      parked: () => until(async () => (await waitersOn(x)) > 0, 10_000, 'the transaction to park on the held row'),
      release: async () => { await qr.rollbackTransaction(); await qr.release(); holders.splice(holders.indexOf(qr), 1); },
    };
  };
  const parkOnAccessRow = (memberId: string, warehouseId: string) => parkOnRow('warehouse_access', 'user_id = $1 AND warehouse_id = $2', [memberId, warehouseId]);

  /** The company row held by the test: a grant parks on its company key-share BEFORE it has taken any member lock. */
  const parkOnCompany = async () => {
    const qr = db.createQueryRunner(); await qr.connect(); await qr.startTransaction(); holders.push(qr);
    await qr.query(`SELECT 1 FROM companies WHERE id = $1 FOR UPDATE`, [companyId]);
    const [{ x }] = await qr.query(`SELECT pg_current_xact_id()::xid::text AS x`);
    return {
      parked: () => until(async () => (await waitersOn(x)) > 0, 10_000, 'the request to park on the company row'),
      release: async () => { await qr.rollbackTransaction(); await qr.release(); holders.splice(holders.indexOf(qr), 1); },
    };
  };
  /** A revoker that follows the documented protocol (member lock, then the row) and does NOT need the company row. */
  const protocolRevoke = async (memberId: string) => {
    const qr = db.createQueryRunner(); await qr.connect();
    try {
      await qr.startTransaction();
      await qr.query(`SELECT pg_advisory_xact_lock(hashtextextended('stockmind:member:' || $1::uuid::text, 0))`, [memberId]);
      // Manager keeps every warehouse capability but loses MANAGE_USERS: only the administrative check can refuse such an actor
      await qr.query(`UPDATE users SET role = 'Manager', token_version = token_version + 1 WHERE id = $1`, [memberId]);
      await qr.commitTransaction();
    } finally { await qr.release(); }
  };

  /** The member's authority lock held by the test (what an in-flight authority change of that member would hold). */
  const holdMemberLock = async (memberId: string) => {
    const qr = db.createQueryRunner(); await qr.connect(); holders.push(qr);
    await qr.query(`SELECT pg_advisory_lock(hashtextextended('stockmind:member:' || $1::uuid::text, 0))`, [memberId]);
    return {
      release: async () => {
        await qr.query(`SELECT pg_advisory_unlock(hashtextextended('stockmind:member:' || $1::uuid::text, 0))`, [memberId]);
        await qr.release(); holders.splice(holders.indexOf(qr), 1);
      },
    };
  };
  const waitersOnMember = async (memberId: string) => (await db.query(
    `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted
        AND ((classid::bigint << 32) | objid::bigint) = hashtextextended('stockmind:member:' || $1::uuid::text, 0)`, [memberId]))[0].n as number;
  const rowOf = async (id: string) => (await db.query(`SELECT role::text AS role, status FROM users WHERE id = $1`, [id]))[0] as { role: string; status: string };
  const membershipEvents = async (id: string) => (await db.query(`SELECT 1 FROM membership_events WHERE target_user_id = $1`, [id])).length as number;
  const operatorRows = async (memberId: string) =>
    (await db.query(`SELECT warehouse_id FROM warehouse_access WHERE user_id = $1 ORDER BY warehouse_id`, [memberId])).map((r: { warehouse_id: string }) => r.warehouse_id) as string[];
  const scopedRows = async (memberId: string) =>
    (await db.query(`SELECT scope_id FROM access_grants WHERE user_id = $1 AND revoked_at IS NULL ORDER BY scope_id`, [memberId])).map((r: { scope_id: string }) => r.scope_id) as string[];
  const events = async (memberId: string) => (await db.query(`SELECT event_type FROM access_grant_events WHERE target_user_id = $1`, [memberId])).length as number;
  const status = (d: Done<request.Response>) => (d.res as request.Response).status;

  beforeAll(async () => {
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
      const email = `al.${name}.${TAG}@example.test`;
      const reg = await http().post('/api/v1/auth/register').send({ companyName: `Linear ${name} ${TAG}`, name, email, password: pw }).expect(201);
      const company = (await db.query(`SELECT company_id FROM users WHERE id = $1`, [reg.body.user.id]))[0].company_id as string;
      return { m: { id: reg.body.user.id, email, password: pw, token: reg.body.accessToken } as Member, company, warehouse: reg.body.defaultWarehouse.id as string };
    };
    const a = await register('owner');
    owner = a.m; companyId = a.company; w1 = a.warehouse;
    other = (await register('other')).m;
    w3 = (await http().post('/api/v1/warehouses').set(auth(owner.token)).send({ name: `Third ${TAG}` }).expect(201)).body.id;
  });

  afterEach(async () => {
    for (const qr of [...holders]) {
      try { if (qr.isTransactionActive) await qr.rollbackTransaction(); } catch { /* released below */ }
      try { await qr.query(`SELECT pg_advisory_unlock_all()`); } catch { /* ignore */ }
      try { await qr.release(); } catch { /* ignore */ }
    }
    holders.length = 0;
  });
  afterAll(async () => { await app?.close(); });

  // ---------------------------------------------------------------------------------------- F11-01: the core question

  describe.each(Object.keys(revocations))('the granting administrator is %s while the grant transaction is in flight', (kind) => {
    it('the revocation cannot commit before the grant (no grant commits on revoked authority); both then finish in a defined order', async () => {
      const A = await newAdmin();
      const B = await newStaff();
      const park = await parkOnAccessRow(B.id, w1); // the grant replaces B's operator row on w1 by a warehouse_manager grant: it parks there
      const g = track(grant(A, B.id, [{ warehouseId: w1, profile: 'warehouse_manager' }]).then((r) => r));
      await park.parked(); // the grant is inside its transaction, the actor already authorized
      const r = track(revocations[kind](A).then((x) => x));
      await sleep(1500); // generous: a revocation that is NOT ordered behind the grant commits within milliseconds
      // Observed from a third connection: the revocation has NOT committed while the grant is in flight.
      expect(r.settled).toBe(false);
      expect((await rowOf(A.id)).role).toBe('Admin');
      expect((await rowOf(A.id)).status).toBe('active');
      expect(await membershipEvents(A.id)).toBe(1); // only the owner's promotion event: no revocation event yet
      await park.release();
      await until(() => g.settled && r.settled, 15_000, 'both operations to finish');
      expect(status(g)).toBe(200); // authorized first, so it commits
      expect(status(r)).toBe(200); // and the revocation applies after it
      expect(await scopedRows(B.id)).toEqual([w1]);
      expect(await events(B.id)).toBeGreaterThan(0);
      expect((await rowOf(A.id)).role === 'Admin' && (await rowOf(A.id)).status === 'active').toBe(false); // the revocation took effect
    });
  });

  it("the same holds for a revoker that follows the documented protocol (member lock, then the row) outside the membership service", async () => {
    const A = await newAdmin();
    const B = await newStaff();
    const park = await parkOnAccessRow(B.id, w1);
    const g = track(grant(A, B.id, [{ warehouseId: w1, profile: 'warehouse_manager' }]).then((r) => r));
    await park.parked();
    const revoker = db.createQueryRunner(); await revoker.connect(); holders.push(revoker);
    const r = track((async () => {
      await revoker.startTransaction();
      await revoker.query(`SELECT pg_advisory_xact_lock(hashtextextended('stockmind:member:' || $1::uuid::text, 0))`, [A.id]);
      await revoker.query(`UPDATE users SET role = 'Staff', token_version = token_version + 1 WHERE id = $1`, [A.id]);
      await revoker.commitTransaction();
      return { status: 200 } as request.Response;
    })());
    await sleep(1500);
    expect(r.settled).toBe(false);
    expect((await rowOf(A.id)).role).toBe('Admin');
    expect(await waitersOnMember(A.id)).toBe(1); // it waits for the ACTOR lock the grant holds
    await park.release();
    await until(() => g.settled && r.settled, 15_000, 'both to finish');
    expect(status(g)).toBe(200);
    expect((await rowOf(A.id)).role).toBe('Staff');
    expect(await scopedRows(B.id)).toEqual([w1]);
  });

  it("legacy PUT /team/members/:id/warehouses: the actor is re-authorized inside the transaction and the revocation waits for it", async () => {
    const A = await newAdmin();
    const B = await newStaff();
    const park = await parkOnAccessRow(B.id, w1);
    const g = track(legacyGrant(A, B.id, [w3]).then((r) => r)); // replaces B's w1 by w3: its DELETE parks on the held row
    await park.parked();
    const r = track(revocations["demoted to Staff"](A).then((x) => x));
    await sleep(1500);
    expect(r.settled).toBe(false);
    expect((await rowOf(A.id)).role).toBe('Admin');
    await park.release();
    await until(() => g.settled && r.settled, 15_000, 'both to finish');
    expect(status(g)).toBe(200);
    expect(status(r)).toBe(200);
    expect(await operatorRows(B.id)).toEqual([w3]);
  });

  it("legacy endpoint: an actor revoked after the request guard but before the transaction takes its locks is refused (or ordered first), never half-applied", async () => {
    const A = await newAdmin();
    const B = await newStaff();
    const hold = await holdMemberLock(B.id); // parks the request at the member lock, after the guard let the (then valid) admin through
    const g = track(legacyGrant(A, B.id, [w1, w3]).then((r) => r));
    await sleep(700);
    const r = track(revocations["demoted to Staff"](A).then((x) => x));
    await sleep(1500);
    const revokedFirst = r.settled; // observed BEFORE the hold is released
    await hold.release();
    await until(() => g.settled && r.settled, 15_000, 'both to finish');
    expect(status(r)).toBe(200);
    if (revokedFirst) {
      expect([401, 403]).toContain(status(g)); // the revocation committed first: the grant must see it
      expect(await operatorRows(B.id)).toEqual([w1]); // and wrote nothing
    } else {
      expect(status(g)).toBe(200); // the grant was ordered first
      expect(await operatorRows(B.id)).toEqual([w1, w3].sort());
    }
  });

  it("an actor revoked while the grant waits for its locks: the outcome is one of the two linearizations, never a mix", async () => {
    const A = await newAdmin();
    const B = await newStaff();
    const before = await operatorRows(B.id);
    const eventsBefore = await events(B.id);
    const hold = await holdMemberLock(B.id);
    const g = track(grant(A, B.id, [{ warehouseId: w1, profile: 'operator' }, { warehouseId: w3, profile: 'operator' }]).then((r) => r));
    await sleep(700);
    const r = track(revocations["suspended"](A).then((x) => x));
    await sleep(1500);
    const revokedFirst = r.settled;
    await hold.release();
    await until(() => g.settled && r.settled, 15_000, 'both to finish');
    expect(status(r)).toBe(200);
    if (revokedFirst) {
      expect([401, 403]).toContain(status(g));
      expect(await operatorRows(B.id)).toEqual(before);
      expect(await events(B.id)).toBe(eventsBefore); // no partial evidence
    } else {
      expect(status(g)).toBe(200);
      expect(await operatorRows(B.id)).toEqual([w1, w3].sort());
    }
  });

  describe.each([
    ['PUT /team/members/:id/access', (A: Member, B: Member) => grant(A, B.id, [{ warehouseId: w1, profile: 'operator' }, { warehouseId: w3, profile: 'operator' }]), 200],
    ['legacy PUT /team/members/:id/warehouses', (A: Member, B: Member) => legacyGrant(A, B.id, [w1, w3]), 200],
    ['POST /warehouses with initialAccess (CP-4)', (A: Member, B: Member) => http().post('/api/v1/warehouses').set(auth(A.token)).send({ name: `Cp4 late ${TAG} ${++seq}`, initialAccess: [{ userId: B.id, profile: 'operator' }] }), 201],
  ] as Array<[string, (A: Member, B: Member) => request.Test, number]>)(
    'an administrator revoked AFTER the request guard but BEFORE the transaction takes any lock: %s', (_name, send, _okStatus) => {
      it('is refused inside the transaction and writes nothing', async () => {
        const A = await newAdmin();
        const B = await newStaff();
        const before = await operatorRows(B.id);
        const eventsBefore = await events(B.id);
        const warehousesBefore = (await db.query(`SELECT count(*)::int AS n FROM warehouses WHERE company_id = $1`, [companyId]))[0].n as number;
        const park = await parkOnCompany();
        const g = track(send(A, B).then((r) => r)); // passes the guards while A is still an administrator, then parks on the company row
        await park.parked();
        await protocolRevoke(A.id); // commits: it does not need the company row
        expect((await rowOf(A.id)).role).toBe('Manager');
        await park.release();
        await until(() => g.settled, 15_000, 'the request to finish');
        expect([401, 403]).toContain(status(g)); // the revocation committed first, so the change must see it
        expect(await operatorRows(B.id)).toEqual(before);
        expect(await events(B.id)).toBe(eventsBefore);
        expect((await db.query(`SELECT count(*)::int AS n FROM warehouses WHERE company_id = $1`, [companyId]))[0].n).toBe(warehousesBefore);
      });
    });

  // Series 13 (F13-T1): the member locks are taken as ONE set in ascending id order, so where the creation parks depends on
  // how the held target's id sorts against the actor's. The Series 11 version of this test held C's lock and assumed the
  // creation already held A's: true only when A < C (random UUIDs: it failed 3 of 10 isolated runs). Both orders are now
  // pinned and each asserts the guarantee that holds for it; together they are the linearization of creation vs revocation.
  it.each([
    ['the actor sorts before the held target: the creator is held and stays ordered ahead of the revocation', true],
    ['the held target sorts before the actor: the revocation commits first and the creation is refused, leaving nothing', false],
  ])("CP-4 with several targets, %s", async (_case, actorFirst) => {
    let A = await newAdmin();
    const B = await newStaff();
    let C = await newStaff();
    // Converges quickly: an actor in the wrong half of the id space is replaced, otherwise the held target is.
    const wrongHalf = () => (A.id.toLowerCase()[0] >= '8') === actorFirst;
    for (let i = 0; i < 24 && (A.id.toLowerCase() < C.id.toLowerCase()) !== actorFirst; i++) {
      if (wrongHalf()) A = await newAdmin(); else C = await newStaff();
    }
    expect(A.id.toLowerCase() < C.id.toLowerCase()).toBe(actorFirst); // the premise of this case, not a hope
    const name = `Cp4 ${TAG} ${++seq}`;
    const hold = await holdMemberLock(C.id); // parks the creation at C, after every member lock that sorts before C
    const g = track(http().post('/api/v1/warehouses').set(auth(A.token)).send({ name, initialAccess: [{ userId: B.id, profile: 'operator' }, { userId: C.id, profile: 'warehouse_manager' }] }).then((r) => r));
    await until(async () => (await waitersOnMember(C.id)) > 0, 10_000, 'the creation to wait for the second target');
    const r = track(revocations["demoted to Staff"](A).then((x) => x));
    if (actorFirst) {
      await sleep(1500);
      expect(r.settled).toBe(false);
      expect((await rowOf(A.id)).role).toBe('Admin');
      await hold.release();
      await until(() => g.settled && r.settled, 15_000, 'both to finish');
      expect(status(g)).toBe(201);
      expect(status(r)).toBe(200);
      expect((await db.query(`SELECT 1 FROM warehouses WHERE company_id = $1 AND name = $2`, [companyId, name])).length).toBe(1);
    } else {
      await until(() => r.settled, 10_000, 'the revocation to commit (the creation does not hold the actor yet)');
      expect(status(r)).toBe(200);
      expect((await rowOf(A.id)).role).toBe('Staff');
      expect(g.settled).toBe(false);
      await hold.release();
      await until(() => g.settled, 15_000, 'the creation to finish');
      expect([401, 403]).toContain(status(g)); // re-authorized inside its transaction: it sees the committed demotion
      expect((await db.query(`SELECT 1 FROM warehouses WHERE company_id = $1 AND name = $2`, [companyId, name])).length).toBe(0);
      expect(await scopedRows(C.id)).toEqual([]);
    }
  });

  it("CP-4 where the second target is not eligible: the whole creation is refused, no warehouse, no grant, no evidence", async () => {
    const A = await newAdmin();
    const B = await newStaff(); const M = await join('Manager');
    const name = `Cp4 refused ${TAG} ${++seq}`;
    const eventsBefore = await events(B.id);
    const res = await http().post('/api/v1/warehouses').set(auth(A.token)).send({ name, initialAccess: [{ userId: B.id, profile: 'operator' }, { userId: M.id, profile: 'operator' }] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ACCESS_NOT_APPLICABLE');
    expect((await db.query(`SELECT 1 FROM warehouses WHERE company_id = $1 AND name = $2`, [companyId, name])).length).toBe(0);
    expect(await events(B.id)).toBe(eventsBefore);
  });

  it("CP-4: the creating actor is re-authorized for warehouse creation inside the transaction (a Manager-turned-Staff cannot create)", async () => {
    const A = await newAdmin();
    const B = await newStaff();
    const name = `Cp4 demoted ${TAG} ${++seq}`;
    const hold = await holdMemberLock(B.id);
    const g = track(http().post('/api/v1/warehouses').set(auth(A.token)).send({ name, initialAccess: [{ userId: B.id, profile: 'operator' }] }).then((r) => r));
    await until(async () => (await waitersOnMember(B.id)) > 0, 10_000, 'the creation to wait for its target');
    const r = track(revocations["demoted to Staff"](A).then((x) => x));
    await sleep(1500);
    const revokedFirst = r.settled;
    await hold.release();
    await until(() => g.settled && r.settled, 15_000, 'both to finish');
    if (revokedFirst) {
      expect([401, 403]).toContain(status(g));
      expect((await db.query(`SELECT 1 FROM warehouses WHERE company_id = $1 AND name = $2`, [companyId, name])).length).toBe(0);
    } else {
      expect(status(g)).toBe(201);
    }
  });

  it("a validation failure rolls back and releases its locks at once (the next change is not delayed)", async () => {
    const A = await newAdmin();
    const B = await newStaff();
    const before = await operatorRows(B.id);
    const bad = await grant(A, B.id, [{ warehouseId: w1, profile: 'no_such_profile' }]);
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('UNKNOWN_PROFILE');
    expect(await operatorRows(B.id)).toEqual(before);
    const started = Date.now();
    await grant(owner, B.id, [{ warehouseId: w1, profile: 'operator' }, { warehouseId: w3, profile: 'operator' }]).expect(200);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("legacy endpoint does not silently keep scoped access it cannot replace (409, nothing changed)", async () => {
    const owner2 = owner;
    const B = await newStaff();
    await grant(owner2, B.id, [{ warehouseId: w1, profile: 'operator' }, { warehouseId: w3, profile: 'warehouse_manager' }]).expect(200);
    const before = await operatorRows(B.id);
    const res = await legacyGrant(owner2, B.id, [w1]); // would drop w3, which is held through a scoped grant
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SCOPED_GRANTS_PRESENT');
    expect(await operatorRows(B.id)).toEqual(before);
    expect(await scopedRows(B.id)).toEqual([w3]);
    await legacyGrant(owner2, B.id, [w1, w3]).expect(200); // naming the scoped warehouse too is fine: nothing is dropped
  });

  it("tenancy: another company's administrator cannot park or even queue on a member of this company (404 at once, no lock taken)", async () => {
    const B = await newStaff();
    const hold = await holdMemberLock(B.id);
    const started = Date.now();
    const res = await bounded(grant(other, B.id, [{ warehouseId: w1, profile: 'operator' }]), 4000);
    expect(res).not.toBe(HUNG); // pre-fix: it queued behind the held lock first
    expect((res as request.Response).status).toBe(404);
    expect(Date.now() - started).toBeLessThan(3500);
    const legacy = await bounded(legacyGrant(other, B.id, [w1]), 4000);
    expect(legacy).not.toBe(HUNG);
    expect((legacy as request.Response).status).toBe(404);
    const role = await bounded(http().post(`/api/v1/team/members/${B.id}/suspend`).set(auth(other.token)).send({}), 4000);
    expect(role).not.toBe(HUNG);
    expect((role as request.Response).status).toBe(404);
    await hold.release();
  });

  // ---------------------------------------------------------------------------------------- locks: bounded waits and cycles

  it("two owners acting on each other at once: exactly one wins, the other is refused (no deadlock, no 5xx)", async () => {
    const O2 = await newAdmin();
    await db.query(`UPDATE users SET is_owner = true WHERE id = $1`, [O2.id]);
    const res = await Promise.all([
      http().post(`/api/v1/team/members/${O2.id}/suspend`).set(auth(owner.token)).send({}).then((r) => r),
      http().post(`/api/v1/team/members/${owner.id}/suspend`).set(auth(O2.token)).send({}).then((r) => r),
    ]);
    const codes = res.map((r) => r.status).sort();
    expect(codes.every((c) => c < 500)).toBe(true);
    expect(codes.filter((c) => c === 200).length).toBe(1);
    // the survivor is whoever won; restore the fixture owner for the tests that follow
    await db.query(`UPDATE users SET status = 'active', is_owner = true, role = 'Admin' WHERE id = $1`, [owner.id]);
    await db.query(`UPDATE users SET token_version = token_version + 1 WHERE id = $1`, [owner.id]);
    await db.query(`UPDATE users SET is_owner = false WHERE id = $1`, [O2.id]);
    await login(owner);
  });

  it("opposite actor/target pairs never deadlock: 60 concurrent grants in both directions", async () => {
    const service = app.get(AccessGrantService);
    const A = await newAdmin();
    const B = await newStaff();
    const pairs: Array<Promise<unknown>> = [];
    for (let i = 0; i < 30; i++) {
      pairs.push(service.setMemberAccess(companyId, A.id, B.id, [{ warehouseId: w1, profile: 'operator' }]).catch((e) => e));
      pairs.push(service.setMemberAccess(companyId, B.id, A.id, [{ warehouseId: w1, profile: 'operator' }]).catch((e) => e));
    }
    const results = await Promise.all(pairs) as Array<{ message?: string; getResponse?: () => { code?: string } }>;
    // A deadlock victim or a lock timeout is answered as AUTHORITY_BUSY (503): under a correct protocol neither can happen here.
    const bad = results.filter((e) => e && typeof e === 'object' && (e.getResponse?.()?.code === 'AUTHORITY_BUSY' || /deadlock|40P01|55P03/i.test(String(e.message))));
    expect(bad).toEqual([]);
  });

  it("a grant waiting for a held member lock gives up with a retryable AUTHORITY_BUSY after the configured timeout and commits nothing", async () => {
    process.env.AUTHORITY_LOCK_TIMEOUT_MS = '1500';
    try {
      const A = await newAdmin();
      const B = await newStaff();
      const before = await operatorRows(B.id);
      const hold = await holdMemberLock(B.id);
      const started = Date.now();
      const out = await bounded(grant(A, B.id, [{ warehouseId: w1, profile: 'operator' }, { warehouseId: w3, profile: 'operator' }]), 9000);
      expect(out).not.toBe(HUNG);
      const res = out as request.Response;
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('AUTHORITY_BUSY');
      expect(Date.now() - started).toBeLessThan(8000);
      await hold.release();
      expect(await operatorRows(B.id)).toEqual(before);
      // once the lock is free the same request succeeds
      await grant(A, B.id, [{ warehouseId: w1, profile: 'operator' }, { warehouseId: w3, profile: 'operator' }]).expect(200);
    } finally {
      delete process.env.AUTHORITY_LOCK_TIMEOUT_MS;
    }
  });

  it("an UPPER-CASE member id in the URL is the same lock as the lower-case id in the member's own token", async () => {
    process.env.AUTHORITY_LOCK_TIMEOUT_MS = '1500';
    try {
      const A = await newAdmin();
      const B = await newStaff();
      const hold = await holdMemberLock(B.id); // canonical key, as the member's own writes take it
      const out = await bounded(
        http().put(`/api/v1/team/members/${B.id.toUpperCase()}/access`).set(auth(A.token)).send({ assignments: [{ warehouseId: w1, profile: 'operator' }, { warehouseId: w3, profile: 'operator' }] }), 9000);
      expect(out).not.toBe(HUNG);
      expect((out as request.Response).status).toBe(503); // pre-fix: a different lock key, so no wait at all and the change went through
      await hold.release();
    } finally {
      delete process.env.AUTHORITY_LOCK_TIMEOUT_MS;
    }
  });

  it("a membership action waiting for a held member lock also gives up with AUTHORITY_BUSY and changes nothing", async () => {
    process.env.AUTHORITY_LOCK_TIMEOUT_MS = '1500';
    try {
      const B = await newStaff();
      const hold = await holdMemberLock(B.id);
      const out = await bounded(http().post(`/api/v1/team/members/${B.id}/suspend`).set(auth(owner.token)).send({}), 9000);
      expect(out).not.toBe(HUNG);
      const res = out as request.Response;
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('AUTHORITY_BUSY');
      await hold.release();
      expect((await rowOf(B.id)).status).toBe('active');
    } finally {
      delete process.env.AUTHORITY_LOCK_TIMEOUT_MS;
    }
  });

  it("lockMembers on raw connections: opposite actor/target pairs acquire in one global order, so there is no cycle (40 racing rounds)", async () => {
    const { lockMembers } = await import('@/infrastructure/security/member-lock');
    const a = randomUUID(); const b = randomUUID();
    const tx = async (pair: Array<{ userId: string; mode: 'shared' | 'exclusive' }>) => {
      const qr = db.createQueryRunner(); await qr.connect(); await qr.startTransaction();
      try {
        await qr.query(`SELECT set_config('lock_timeout', '8s', true)`);
        await lockMembers(qr, pair);
        await sleep(15); // hold both locks briefly so the rounds overlap
        await qr.commitTransaction();
        return 'ok';
      } catch (e) {
        await qr.rollbackTransaction().catch(() => undefined);
        return String((e as Error).message);
      } finally { await qr.release(); }
    };
    const outcomes: string[] = [];
    for (let round = 0; round < 40; round++) {
      outcomes.push(...await Promise.all([
        tx([{ userId: a, mode: 'shared' }, { userId: b, mode: 'exclusive' }]),
        tx([{ userId: b, mode: 'shared' }, { userId: a, mode: 'exclusive' }]),
      ]));
    }
    expect(outcomes.filter((o) => o !== 'ok')).toEqual([]);
  });

  // ------------------------------------------------------------------ stock writes against membership changes (lock order)

  const stockFixture = async () => {
    const product = (await http().post('/api/v1/products').set(auth(owner.token)).send({ name: 'Nut', sku: `AL-${TAG}-${++seq}` }).expect(201)).body.id;
    await http().post('/api/v1/stock/inbound').set(auth(owner.token)).set('Idempotency-Key', randomUUID()).send({ productId: product, warehouseId: w1, quantity: '50' }).expect(201);
    return product as string;
  };

  it("a stock write that already holds the member lock and a membership action on the same member finish in order without a deadlock", async () => {
    const S = await newStaff();
    const product = await stockFixture();
    // park the write AFTER it took the member lock and its idempotency record: another transaction holds the warehouse row
    const park = await parkOnRow('warehouses', 'id = $1', [w1]);
    const write = track(http().post('/api/v1/stock/outbound').set(auth(S.token)).set('Idempotency-Key', randomUUID()).send({ productId: product, warehouseId: w1, quantity: '1' }).then((r) => r));
    await park.parked();
    const act = track(http().post(`/api/v1/team/members/${S.id}/suspend`).set(auth(owner.token)).send({}).then((r) => r));
    await sleep(800);
    await park.release();
    await until(() => write.settled && act.settled, 20_000, 'the write and the suspension to finish');
    expect(status(write)).toBeLessThan(500);
    expect(status(act)).toBe(200);
  });

  it("a stock write parked at its idempotency record (holding the member lock, not yet the company) and a membership action: no company/member lock cycle", async () => {
    const S = await newStaff();
    const product = await stockFixture();
    const key = randomUUID();
    const parker = db.createQueryRunner(); await parker.connect(); await parker.startTransaction(); holders.push(parker);
    await parker.query(`INSERT INTO stock_idempotency_keys (company_id, user_id, idempotency_key, request_hash) VALUES ($1, $2, $3, $4)`, [companyId, S.id, key, 'f'.repeat(64)]);
    const [{ x }] = await parker.query(`SELECT pg_current_xact_id()::xid::text AS x`);
    const write = track(http().post('/api/v1/stock/outbound').set(auth(S.token)).set('Idempotency-Key', key).send({ productId: product, warehouseId: w1, quantity: '1' }).then((r) => r));
    await until(async () => (await waitersOn(x)) > 0, 10_000, 'the write to park on its idempotency record');
    const act = track(http().post(`/api/v1/team/members/${S.id}/suspend`).set(auth(owner.token)).send({}).then((r) => r));
    await sleep(800); // the suspension has the company row and waits for the member lock the write holds
    await parker.rollbackTransaction();
    await until(() => write.settled && act.settled, 20_000, 'the write and the suspension to finish');
    expect(status(write)).toBeLessThan(500);
    expect(status(act)).toBe(200);
  });

  it("urgent membership actions are not starved by a continuous stream of stock writes (they do not wait on the company row)", async () => {
    const S = await newStaff(); const T = await newStaff();
    const product = await stockFixture();
    const stop = { v: false };
    const statuses: Record<string, number> = {};
    const writers = Array.from({ length: 4 }, async () => {
      while (!stop.v) {
        const r = await http().post('/api/v1/stock/inbound').set(auth(S.token)).set('Idempotency-Key', randomUUID()).send({ productId: product, warehouseId: w1, quantity: '1' });
        statuses[r.status] = (statuses[r.status] ?? 0) + 1;
      }
    });
    try {
      await sleep(300); // the writers overlap: at every instant some transaction holds the company key-share
      const timed = async (call: () => request.Test) => { const t = Date.now(); const r = await call(); return { ms: Date.now() - t, status: r.status }; };
      const post = (id: string, action: string, body: object = {}) => () => http().post(`/api/v1/team/members/${id}/${action}`).set(auth(owner.token)).send(body);
      const results = [
        await timed(post(T.id, 'suspend')),
        await timed(post(T.id, 'reactivate')),
        await timed(post(T.id, 'revoke-sessions')),
        await timed(() => http().patch(`/api/v1/team/members/${T.id}/role`).set(auth(owner.token)).send({ role: 'Manager', acknowledgeCompanyWideAccess: true })),
        await timed(post(S.id, 'suspend')), // even the member who is writing right now
      ];
      for (const r of results) { expect(r.status).toBe(200); expect(r.ms).toBeLessThan(4000); }
      await sleep(300);
      expect(statuses[201]).toBeGreaterThan(0); // the writers really were writing
      expect(Object.keys(statuses).every((k) => Number(k) < 500)).toBe(true);
    } finally {
      stop.v = true;
      await Promise.all(writers);
    }
  });

  it("the same, for a TRANSFER and for a replacement-less retry of the same key", async () => {
    const S = await newStaff();
    const product = await stockFixture();
    await grant(owner, S.id, [{ warehouseId: w1, profile: 'warehouse_manager' }, { warehouseId: w3, profile: 'warehouse_manager' }]).expect(200);
    const key = randomUUID();
    const parker = db.createQueryRunner(); await parker.connect(); await parker.startTransaction(); holders.push(parker);
    await parker.query(`INSERT INTO stock_idempotency_keys (company_id, user_id, idempotency_key, request_hash) VALUES ($1, $2, $3, $4)`, [companyId, S.id, key, 'e'.repeat(64)]);
    const [{ x }] = await parker.query(`SELECT pg_current_xact_id()::xid::text AS x`);
    const write = track(http().post('/api/v1/stock/transfer').set(auth(S.token)).set('Idempotency-Key', key)
      .send({ productId: product, fromWarehouseId: w1, toWarehouseId: w3, quantity: '1' }).then((r) => r));
    await until(async () => (await waitersOn(x)) > 0, 10_000, 'the transfer to park on its idempotency record');
    const act = track(http().post(`/api/v1/team/members/${S.id}/suspend`).set(auth(owner.token)).send({}).then((r) => r));
    await sleep(800);
    await parker.rollbackTransaction();
    await until(() => write.settled && act.settled, 20_000, 'the transfer and the suspension to finish');
    expect(status(write)).toBeLessThan(500);
    expect(status(act)).toBe(200);
  });
});
