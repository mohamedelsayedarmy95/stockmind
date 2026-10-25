/**
 * Series 13 / N-1 on a real PostgreSQL, over real HTTP: the last-owner guard and the global lock order.
 *
 * The question (Mission 00, N-1): the database guard `users_guard_last_owner` (migration 1792600000000) serialized owner changes
 * with `SELECT ... FROM companies ... FOR UPDATE`, taken INSIDE the UPDATE of the member row, i.e. after the membership action
 * already holds the member authority locks (member-lock.ts steps 2 and 3). Every stock write, replacement and grant takes the
 * company row in a SHARED mode first (step 1) and then queues for the member lock. So an owner's suspension and that owner's own
 * write (or grant) can wait on each other, and a stream of other members' writes can keep the guard's FOR UPDATE out.
 *
 * The scenarios are deterministic, in the style of authority-linearization.pg.spec.ts: a row lock held by the TEST parks the
 * membership action at a known point (its member-row FOR UPDATE, after the member locks), the competing request is fired and
 * observed parked on pg_locks, and the test then releases its row. Sleeps never decide an outcome: they only place the release
 * on a known side of PostgreSQL's deadlock_timeout (1 s on the gate cluster), which picks the transaction that detects a cycle.
 *
 * The invariant checked in every scenario is the one the protocol promises: the revocation and the write are LINEARIZED (the
 * write before the suspension commits, or refused after it), nobody gets a 5xx or a spurious AUTHORITY_BUSY, and the company
 * keeps an active owner. Observations (status codes, elapsed time, the database's deadlock counter) are appended to
 * $S13_EVIDENCE_FILE when it is set, so the before-fix run is recorded exactly as it happened.
 */
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { appendFileSync } from 'fs';
import { randomBytes, randomUUID } from 'crypto';
import { DataSource, QueryRunner } from 'typeorm';
import { AppModule } from '@/app.module';

const RUN = Boolean(process.env.DB_HOST && process.env.JWT_ACCESS_SECRET && process.env.JWT_REFRESH_SECRET);
const TAG = randomBytes(4).toString('hex');
const password = () => `Aa1!${randomBytes(8).toString('hex')}`;

interface Member { id: string; email: string; password: string; token: string }
type Done<T> = { settled: boolean; res?: T; err?: unknown; at?: number };

const note = (scenario: string, data: Record<string, unknown>) => {
  const file = process.env.S13_EVIDENCE_FILE;
  if (file) appendFileSync(file, `${JSON.stringify({ spec: 'owner-guard-lock-order', scenario, at: new Date().toISOString(), ...data })}\n`);
};

(RUN ? describe : describe.skip)('N-1 last-owner guard and the global lock order (PostgreSQL)', () => {
  jest.setTimeout(240_000);
  let app: INestApplication;
  let db: DataSource;
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  let owner: Member; let companyId: string; let w1: string; let product: string;
  let foreign: { owner: Member; companyId: string };
  let seq = 0;
  const holders: QueryRunner[] = [];

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (cond: () => Promise<boolean> | boolean, ms = 10_000, what = 'condition') => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await cond()) return true; await sleep(25); }
    throw new Error(`timed out waiting for ${what}`);
  };
  const track = <T>(p: PromiseLike<T>): Done<T> => {
    const d: Done<T> = { settled: false };
    p.then((res) => { d.settled = true; d.res = res; d.at = Date.now(); }, (err) => { d.settled = true; d.err = err; d.at = Date.now(); });
    return d;
  };
  const statusOf = (d: Done<request.Response>) => (d.res ? d.res.status : -1);
  const codeOf = (d: Done<request.Response>) => (d.res?.body?.code ?? d.res?.body?.message?.code) as string | undefined;

  const register = async (name: string) => {
    const pw = password();
    const email = `og.${name}.${TAG}@example.test`;
    const reg = await http().post('/api/v1/auth/register').send({ companyName: `Owner guard ${name} ${TAG}`, name, email, password: pw }).expect(201);
    const company = (await db.query(`SELECT company_id FROM users WHERE id = $1`, [reg.body.user.id]))[0].company_id as string;
    return { m: { id: reg.body.user.id, email, password: pw, token: reg.body.accessToken } as Member, company, warehouse: reg.body.defaultWarehouse.id as string };
  };
  const login = async (m: Member) => { m.token = (await http().post('/api/v1/auth/login').send({ email: m.email, password: m.password }).expect(200)).body.accessToken; return m; };
  const join = async (inviter: Member, role: 'Manager' | 'Staff', warehouseIds: string[] = [w1]): Promise<Member> => {
    const email = `og.${role.toLowerCase()}.${++seq}.${TAG}@example.test`;
    const invite = await http().post('/api/v1/team/invitations').set(auth(inviter.token))
      .send(role === 'Staff' ? { email, role, warehouseIds } : { email, role }).expect(201);
    const pw = password();
    const joined = await http().post('/api/v1/auth/accept-invitation').send({ token: invite.body.token, name: `${role} ${seq}`, password: pw }).expect(201);
    return { id: joined.body.user.id, email, password: pw, token: joined.body.accessToken };
  };
  /**
   * A second OWNER of the fixture company. The product has no ownership-transfer flow yet (an owner is designated from evidence by an
   * operator, Series 09 R-19), so the fixture designates it the way an operator would: an Admin, then `is_owner` set in SQL.
   */
  const secondOwner = async (by: Member = owner): Promise<Member> => {
    const a = await join(by, 'Manager');
    await http().patch(`/api/v1/team/members/${a.id}/role`).set(auth(by.token)).send({ role: 'Admin', acknowledgeCompanyWideAccess: true }).expect(200);
    await db.query(`UPDATE users SET is_owner = true WHERE id = $1`, [a.id]);
    return login(a);
  };

  const stockIn = (m: Member, qty = '1') =>
    http().post('/api/v1/stock/inbound').set(auth(m.token)).set('Idempotency-Key', randomUUID()).send({ productId: product, warehouseId: w1, quantity: qty });
  const suspend = (actor: Member, target: Member) => http().post(`/api/v1/team/members/${target.id}/suspend`).set(auth(actor.token)).send({});

  const deadlocks = async () => {
    await db.query(`SELECT pg_stat_clear_snapshot()`);
    return Number((await db.query(`SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()`))[0].deadlocks);
  };
  /** The counter is flushed by the backend that hit the deadlock, lazily: poll for a short while before reading the delta. */
  const deadlockDelta = async (before: number) => {
    let now = await deadlocks();
    const end = Date.now() + 12_000;
    while (now === before && Date.now() < end) { await sleep(250); now = await deadlocks(); }
    return now - before;
  };
  const waitersOnXid = async (xid: string) =>
    (await db.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'transactionid' AND transactionid::text = $1 AND NOT granted`, [xid]))[0].n as number;
  const waitersOnMember = async (memberId: string) => (await db.query(
    `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted
        AND ((classid::bigint << 32) | objid::bigint) = hashtextextended('stockmind:member:' || $1::uuid::text, 0)`, [memberId]))[0].n as number;
  const activeOwners = async (company: string) =>
    (await db.query(`SELECT count(*)::int AS n FROM users WHERE company_id = $1 AND is_owner AND status = 'active'`, [company]))[0].n as number;
  const movementsBy = async (userId: string) => (await db.query(`SELECT count(*)::int AS n FROM stock_movements WHERE user_id = $1`, [userId]))[0].n as number;
  const statusOfMember = async (id: string) => (await db.query(`SELECT status FROM users WHERE id = $1`, [id]))[0].status as string;

  /** The TEST holds the member's row FOR SHARE (what an in-flight write of that member holds): it parks a membership action at its row lock. */
  const holdMemberRow = async (memberId: string) => {
    const qr = db.createQueryRunner(); await qr.connect(); await qr.startTransaction(); holders.push(qr);
    expect((await qr.query(`SELECT 1 FROM users WHERE id = $1 FOR SHARE`, [memberId])).length).toBe(1);
    const [{ x }] = await qr.query(`SELECT pg_current_xact_id()::xid::text AS x`);
    return {
      parked: () => until(async () => (await waitersOnXid(x)) > 0, 10_000, 'the membership action to park on the held member row'),
      release: async () => { await qr.rollbackTransaction(); await qr.release(); holders.splice(holders.indexOf(qr), 1); },
    };
  };
  /** One in-flight write of ANOTHER member: the company row in key-share, exactly what lockCompanyKeyShare takes. */
  const keyShareHolder = async (company: string) => {
    const qr = db.createQueryRunner(); await qr.connect(); await qr.startTransaction(); holders.push(qr);
    await qr.query(`SELECT 1 FROM companies WHERE id = $1 FOR KEY SHARE`, [company]);
    return async () => { await qr.commitTransaction(); await qr.release(); holders.splice(holders.indexOf(qr), 1); };
  };

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
    const a = await register('owner');
    owner = a.m; companyId = a.company; w1 = a.warehouse;
    product = (await http().post('/api/v1/products').set(auth(owner.token)).send({ name: 'Washer', sku: `OG-${TAG}` }).expect(201)).body.id;
    await stockIn(owner, '100').expect(201);
    const f = await register('foreign');
    foreign = { owner: f.m, companyId: f.company };
    note('environment', {
      postgres: (await db.query(`SELECT version() AS v`))[0].v,
      deadlockTimeout: (await db.query(`SHOW deadlock_timeout`))[0].deadlock_timeout,
      capabilityMode: process.env.CAPABILITY_MODE ?? '(default shadow)',
      guard: (await db.query(`SELECT pg_get_functiondef('users_guard_last_owner'::regproc) AS d`))[0].d.includes('FOR UPDATE') ? 'company FOR UPDATE (Series 09)' : 'membership lock',
    });
  });

  afterEach(async () => {
    delete process.env.AUTHORITY_LOCK_TIMEOUT_MS;
    for (const qr of [...holders]) {
      try { if (qr.isTransactionActive) await qr.rollbackTransaction(); else await qr.query('ROLLBACK'); } catch { /* released below */ }
      try { await qr.release(); } catch { /* ignore */ }
    }
    holders.length = 0;
  });
  afterAll(async () => { await app?.close(); });

  // ---------------------------------------------------------------------------------------- an owner's own write vs its suspension

  describe.each([
    ['the suspension', 1300],
    ['the write', 100],
  ])('owner B writes stock while owner A suspends B (%s reaches deadlock_timeout first)', (_detector, releaseAfterMs) => {
    it('linearized: the suspension commits and the write is refused after it; no 5xx, no AUTHORITY_BUSY, no deadlock', async () => {
      const B = await secondOwner();
      const before = await deadlocks();
      const hold = await holdMemberRow(B.id);
      const started = Date.now();
      const s = track(suspend(owner, B).then((r) => r));
      await hold.parked(); // A's suspension holds B's member lock (exclusive) and waits for B's row
      const w = track(stockIn(B).then((r) => r));
      await until(async () => (await waitersOnMember(B.id)) > 0, 10_000, "B's write to queue for B's member lock"); // holding the company key-share
      await sleep(releaseAfterMs);
      const released = Date.now();
      await hold.release();
      await until(() => s.settled && w.settled, 20_000, 'both requests to finish');
      const observed = {
        suspension: { status: statusOf(s), code: codeOf(s), msAfterRelease: (s.at as number) - released },
        write: { status: statusOf(w), code: codeOf(w), msAfterRelease: (w.at as number) - released },
        deadlocksDelta: await deadlockDelta(before),
        bStatus: await statusOfMember(B.id),
        movementsByB: await movementsBy(B.id),
        activeOwners: await activeOwners(companyId),
        totalMs: Date.now() - started,
      };
      note(`own-write-vs-suspension/${releaseAfterMs}ms`, observed);
      expect(observed.suspension.status).toBe(200);
      expect(observed.write.status).toBe(401); // ACCESS_REVOKED: ordered after the suspension, refused, nothing written
      expect(observed.write.code).toBe('ACCESS_REVOKED');
      expect(observed.movementsByB).toBe(0);
      expect(observed.bStatus).toBe('suspended');
      expect(observed.activeOwners).toBe(1);
    });
  });

  it('owner B changes a Staff member\'s warehouses while owner A suspends B: linearized, no deadlock', async () => {
    const B = await secondOwner();
    const S = await join(owner, 'Staff', [w1]);
    const before = await deadlocks();
    const hold = await holdMemberRow(B.id);
    const s = track(suspend(owner, B).then((r) => r));
    await hold.parked();
    const g = track(http().put(`/api/v1/team/members/${S.id}/warehouses`).set(auth(B.token)).send({ warehouseIds: [] }).then((r) => r));
    await until(async () => (await waitersOnMember(B.id)) > 0, 10_000, "B's grant change to queue for B's member lock");
    await sleep(1300);
    await hold.release();
    await until(() => s.settled && g.settled, 20_000, 'both requests to finish');
    const observed = {
      suspension: { status: statusOf(s), code: codeOf(s) },
      grant: { status: statusOf(g), code: codeOf(g) },
      deadlocksDelta: await deadlockDelta(before),
      staffWarehouses: (await db.query(`SELECT count(*)::int AS n FROM warehouse_access WHERE user_id = $1`, [S.id]))[0].n,
    };
    note('grant-by-owner-vs-suspension', observed);
    expect(observed.suspension.status).toBe(200);
    expect([401, 403]).toContain(observed.grant.status); // the suspended actor is re-authorized inside the transaction
    expect(observed.staffWarehouses).toBe(1); // unchanged: the refused change left nothing behind
  });

  // ---------------------------------------------------------------------------------------- other members' writes

  it("a relay of other members' in-flight writes (company key-share) cannot keep an owner's suspension waiting", async () => {
    process.env.AUTHORITY_LOCK_TIMEOUT_MS = '1500';
    const B = await secondOwner();
    let stop = false;
    let held = 0;
    // Two overlapping holders, so that at every instant at least one write of the company holds the key-share (each one is short).
    const relay = (async () => {
      let previous = await keyShareHolder(companyId);
      while (!stop) {
        await sleep(150);
        const next = await keyShareHolder(companyId);
        await previous();
        previous = next;
        held++;
      }
      await previous();
    })();
    await sleep(200);
    const started = Date.now();
    const s = track(suspend(owner, B).then((r) => r));
    await until(() => s.settled, 8000, 'the suspension to finish while the relay runs').catch(() => undefined);
    const whileRelaying = s.settled;
    stop = true;
    await relay;
    await until(() => s.settled, 20_000, 'the suspension to finish after the relay stopped');
    const observed = {
      finishedWhileRelayRan: whileRelaying, msToFinish: (s.at as number) - started, status: statusOf(s), code: codeOf(s), keyShareHandovers: held,
    };
    note('key-share-relay-vs-owner-suspension', observed);
    expect(observed.finishedWhileRelayRan).toBe(true);
    expect(observed.status).toBe(200);
    expect(observed.msToFinish).toBeLessThan(1000);
  });

  /** Runs `start` while two overlapping key-share holders keep the company row share-locked at every instant. */
  const underKeyShareRelay = async (scenario: string, start: () => PromiseLike<request.Response>) => {
    process.env.AUTHORITY_LOCK_TIMEOUT_MS = '1500';
    let stop = false;
    let handovers = 0;
    const relay = (async () => {
      let previous = await keyShareHolder(companyId);
      while (!stop) {
        await sleep(150);
        const next = await keyShareHolder(companyId);
        await previous();
        previous = next;
        handovers++;
      }
      await previous();
    })();
    await sleep(200);
    const started = Date.now();
    const d = track(start());
    await until(() => d.settled, 8000, `${scenario} to finish while the relay runs`).catch(() => undefined);
    const whileRelaying = d.settled;
    stop = true;
    await relay;
    await until(() => d.settled, 20_000, `${scenario} to finish after the relay stopped`);
    const observed = { finishedWhileRelayRan: whileRelaying, msToFinish: (d.at as number) - started, status: statusOf(d), code: codeOf(d), keyShareHandovers: handovers };
    note(scenario, observed);
    return observed;
  };

  describe('seat-taking actions under a stream of writes (bounded, never starved)', () => {
    it('reactivating a REMOVED member', async () => {
      const S = await join(owner, 'Staff', [w1]);
      await http().post(`/api/v1/team/members/${S.id}/remove`).set(auth(owner.token)).send({ confirm: true }).expect(200);
      const o = await underKeyShareRelay('key-share-relay-vs-reactivate-removed', () =>
        http().post(`/api/v1/team/members/${S.id}/reactivate`).set(auth(owner.token)).send({}));
      expect(o.finishedWhileRelayRan).toBe(true);
      expect(o.status).toBe(200);
      expect(o.msToFinish).toBeLessThan(1000);
    });

    it('accepting an invitation', async () => {
      const email = `og.relay.${++seq}.${TAG}@example.test`;
      const invite = await http().post('/api/v1/team/invitations').set(auth(owner.token)).send({ email, role: 'Staff', warehouseIds: [w1] }).expect(201);
      const o = await underKeyShareRelay('key-share-relay-vs-accept-invitation', () =>
        http().post('/api/v1/auth/accept-invitation').send({ token: invite.body.token, name: 'Relay', password: password() }));
      expect(o.finishedWhileRelayRan).toBe(true);
      expect(o.status).toBe(201);
      expect(o.msToFinish).toBeLessThan(1500); // includes one bcrypt hash of the new password
    });
  });

  // ---------------------------------------------------------------------------------------- competing owners, with writes

  it('three owners suspending each other in a ring while all three write stock: no 5xx, a single serial outcome, an owner always remains', async () => {
    const B = await secondOwner();
    const C = await secondOwner();
    const ring = [owner, B, C];
    const before = await deadlocks();
    const rounds: Array<{ round: number; suspensions: number[]; writes: number[]; activeOwners: number }> = [];
    try {
      for (let round = 0; round < 6; round++) {
        const res = await Promise.all([
          suspend(ring[0], ring[1]), suspend(ring[1], ring[2]), suspend(ring[2], ring[0]),
          stockIn(ring[0]), stockIn(ring[1]), stockIn(ring[2]), stockIn(ring[0]), stockIn(ring[1]), stockIn(ring[2]),
        ].map((p) => p.then((r) => r)));
        const codes = res.map((r) => r.status);
        rounds.push({ round, suspensions: codes.slice(0, 3), writes: codes.slice(3), activeOwners: await activeOwners(companyId) });
        // restore the ring (an operator change: reactivating owners never loses one) and sign everyone in again
        await db.query(`UPDATE users SET status = 'active', token_version = token_version + 1 WHERE id = ANY($1::uuid[])`, [ring.map((m) => m.id)]);
        for (const m of ring) await login(m);
      }
    } finally {
      note('owner-ring-with-writes', { rounds, deadlocksDelta: await deadlockDelta(before) });
      for (const m of [B, C]) await db.query(`UPDATE users SET is_owner = false WHERE id = $1`, [m.id]);
    }
    const all = rounds.flatMap((r) => [...r.suspensions, ...r.writes]);
    expect(all.filter((c) => c >= 500)).toEqual([]); // no 500 (deadlock victim) and no 503 (AUTHORITY_BUSY)
    for (const r of rounds) {
      expect(r.activeOwners).toBeGreaterThanOrEqual(1);
      expect(r.suspensions.filter((c) => c === 200).length).toBeLessThanOrEqual(2); // never all three owners gone
    }
  });

  // ---------------------------------------------------------------------------------------- tenancy

  it("another company's held membership and company locks never delay this company's owner suspension", async () => {
    const B = await secondOwner();
    const qr = db.createQueryRunner(); await qr.connect(); await qr.startTransaction(); holders.push(qr);
    await qr.query(`SELECT pg_advisory_xact_lock(hashtextextended('stockmind:company-members:' || $1::uuid::text, 0))`, [foreign.companyId]);
    await qr.query(`SELECT 1 FROM companies WHERE id = $1 FOR UPDATE`, [foreign.companyId]);
    await qr.query(`SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, [foreign.owner.id]);
    const started = Date.now();
    const r = await suspend(owner, B);
    const ms = Date.now() - started;
    note('cross-tenant-independence', { status: r.status, ms });
    expect(r.status).toBe(200);
    expect(ms).toBeLessThan(1000);
  });

  // ---------------------------------------------------------------------------------------- direct SQL (operator) paths

  describe('direct SQL keeps the database ownership invariant', () => {
    const company = async (owners: number) => {
      const c = (await db.query(`INSERT INTO companies (name) VALUES ($1) RETURNING id`, [`SQL owners ${TAG} ${++seq}`]))[0].id as string;
      const ids: string[] = [];
      for (let i = 0; i < owners; i++) {
        ids.push((await db.query(
          `INSERT INTO users (company_id, name, email, password_hash, role, is_owner) VALUES ($1, 'Owner', $2, 'x', 'Admin', true) RETURNING id`,
          [c, `og.sql.${seq}.${i}.${TAG}@example.test`],
        ))[0].id as string);
      }
      return { c, ids };
    };
    const legitimateOwners = async (c: string) =>
      (await db.query(`SELECT count(*)::int AS n FROM users WHERE company_id = $1 AND is_owner AND status = 'active' AND role = 'Admin'`, [c]))[0].n as number;

    it('the sole owner cannot be demoted out of the Admin role (the company would have no owner able to act as one)', async () => {
      const { c, ids } = await company(1);
      const outcome = await db.query(`UPDATE users SET role = 'Staff' WHERE id = $1`, [ids[0]]).then(() => 'committed', (e: Error) => e.message);
      note('sql-demote-sole-owner', { outcome, legitimateOwners: await legitimateOwners(c) });
      expect(outcome).toMatch(/last_active_owner|owner_requires_admin_role/);
      expect(await legitimateOwners(c)).toBe(1);
      await db.query(`DELETE FROM companies WHERE id = $1`, [c]);
    });

    it('an owner demoted while another owner remains: refused unless ownership is cleared in the same statement', async () => {
      const { c, ids } = await company(2);
      const keepFlag = await db.query(`UPDATE users SET role = 'Staff' WHERE id = $1`, [ids[0]]).then(() => 'committed', (e: Error) => e.message);
      const clearFlag = await db.query(`UPDATE users SET role = 'Staff', is_owner = false WHERE id = $1`, [ids[0]]).then(() => 'committed', (e: Error) => e.message);
      const lastOne = await db.query(`UPDATE users SET role = 'Manager', is_owner = false WHERE id = $1`, [ids[1]]).then(() => 'committed', (e: Error) => e.message);
      note('sql-demote-with-second-owner', { keepFlag, clearFlag, lastOne, legitimateOwners: await legitimateOwners(c) });
      expect(keepFlag).toMatch(/owner_requires_admin_role/); // never "owner but not Admin"
      expect(clearFlag).toBe('committed'); // a real seat change: another legitimate owner remains
      expect(lastOne).toMatch(/last_active_owner/);
      expect(await legitimateOwners(c)).toBe(1);
      await db.query(`DELETE FROM companies WHERE id = $1`, [c]);
    });

    it('an owner flag on a non-Admin (legacy or hand-edited data) does not count as the remaining legitimate owner', async () => {
      const { c, ids } = await company(1);
      await db.query(
        `INSERT INTO users (company_id, name, email, password_hash, role, is_owner) VALUES ($1, 'Flagged', $2, 'x', 'Staff', true)`,
        [c, `og.sql.flagged.${++seq}.${TAG}@example.test`],
      ); // an INSERT never fires the guard: this is how such a row could exist
      const outcome = await db.query(`UPDATE users SET status = 'removed' WHERE id = $1`, [ids[0]]).then(() => 'committed', (e: Error) => e.message);
      note('sql-non-admin-owner-flag', { outcome, legitimateOwners: await legitimateOwners(c) });
      expect(outcome).toMatch(/last_active_owner/);
      expect(await legitimateOwners(c)).toBe(1);
      await db.query(`DELETE FROM companies WHERE id = $1`, [c]);
    });

    it("a direct SQL owner change waits for the application's membership lock of that company (one shared key), then re-checks", async () => {
      const { c, ids } = await company(2);
      const appTx = db.createQueryRunner(); await appTx.connect(); await appTx.startTransaction(); holders.push(appTx);
      // exactly what lockCompanyMembership takes, first in every membership action
      await appTx.query(`SELECT pg_advisory_xact_lock(hashtextextended('stockmind:company-members:' || $1::uuid::text, 0))`, [c.toUpperCase()]);
      await appTx.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [ids[0]]); // the application removes owner 1 (owner 2 remains)
      const sql = track(db.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [ids[1]]).then(() => 'committed', (e: Error) => e.message));
      await until(async () => (await db.query(
        `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted
            AND ((classid::bigint << 32) | objid::bigint) = hashtextextended('stockmind:company-members:' || $1::uuid::text, 0)`, [c]))[0].n > 0,
      10_000, 'the SQL change to queue for the membership lock');
      expect(sql.settled).toBe(false);
      await appTx.commitTransaction(); await appTx.release(); holders.splice(holders.indexOf(appTx), 1);
      await until(() => sql.settled, 10_000, 'the SQL change to finish');
      note('sql-waits-for-membership-lock', { sql: sql.res, legitimateOwners: await legitimateOwners(c) });
      expect(sql.res).toMatch(/last_active_owner/); // re-checked after the application committed: owner 2 is now the last one
      expect(await legitimateOwners(c)).toBe(1);
      await db.query(`DELETE FROM companies WHERE id = $1`, [c]);
    });

    it.each(['REPEATABLE READ', 'SERIALIZABLE'])('two %s sessions removing the two owners at once cannot both commit', async (level) => {
      const { c, ids } = await company(2);
      const tx1 = db.createQueryRunner(); const tx2 = db.createQueryRunner();
      await tx1.connect(); await tx2.connect(); holders.push(tx1, tx2);
      await tx1.query(`BEGIN ISOLATION LEVEL ${level}`); await tx2.query(`BEGIN ISOLATION LEVEL ${level}`);
      await tx1.query(`SELECT count(*) FROM users WHERE company_id = $1`, [c]); // both snapshots taken: each still sees two owners
      await tx2.query(`SELECT count(*) FROM users WHERE company_id = $1`, [c]);
      const run = (qr: QueryRunner, id: string) =>
        qr.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [id]).then(() => qr.query('COMMIT')).then(() => 'committed', async (e: Error) => {
          await qr.query('ROLLBACK').catch(() => undefined); return e.message;
        });
      const first = await run(tx1, ids[0]);
      const second = await run(tx2, ids[1]);
      const owners = await legitimateOwners(c);
      note(`sql-${level.replace(' ', '-').toLowerCase()}-two-owners`, { first, second, legitimateOwners: owners });
      expect(owners).toBeGreaterThanOrEqual(1);
      expect([first, second].filter((o) => o === 'committed').length).toBeLessThanOrEqual(1);
      await tx1.release(); await tx2.release(); holders.splice(holders.indexOf(tx1), 1); holders.splice(holders.indexOf(tx2), 1);
      await db.query(`DELETE FROM companies WHERE id = $1`, [c]);
    });
  });
});
