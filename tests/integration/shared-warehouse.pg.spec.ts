/**
 * Shared-warehouse collaboration over HTTP through the whole AppModule on a real PostgreSQL. Several users of one
 * company are separate API clients (separate tokens), not separate devices:
 * - team onboarding by single-use invitation (Manager, Staff with warehouse grants);
 * - server-side warehouse scoping, applied to the next request when grants change;
 * - one shared, authoritative balance and history: what one member writes, another reads;
 * - idempotent retries (sequential and concurrent) and refusal of a reused key with a different request;
 * - concurrent dispatch by two members never oversells;
 * - the sync cursor: per-warehouse revisions, delta and snapshot reads, no gaps under concurrent writes.
 * Needs a PostgreSQL and JWT secrets (CI provides both); skipped without them.
 */
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { randomBytes } from 'crypto';
import { DataSource } from 'typeorm';
import { AppModule } from '@/app.module';

const RUN = Boolean(process.env.DB_HOST && process.env.JWT_ACCESS_SECRET && process.env.JWT_REFRESH_SECRET);
const TAG = randomBytes(4).toString('hex');
const password = () => `Aa1!${randomBytes(8).toString('hex')}`;

(RUN ? describe : describe.skip)('shared warehouse collaboration (PostgreSQL)', () => {
  jest.setTimeout(180_000);
  let app: INestApplication;
  let db: DataSource;
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let owner: string;
  let manager: string;
  let staff: string;
  let staffId: string;
  let w1: string;
  let w2: string;
  let product: string;

  const invite = (body: object, token = owner) => http().post('/api/v1/team/invitations').set(auth(token)).send(body);
  const accept = (token: string, name: string) =>
    http().post('/api/v1/auth/accept-invitation').send({ token, name, password: password() });
  const balance = async (token: string, warehouseId: string) =>
    Number((await http().get(`/api/v1/stock/balance/${product}/${warehouseId}`).set(auth(token)).expect(200))
      .body.baseQuantity);
  const move = (token: string, kind: 'inbound' | 'outbound', warehouseId: string, quantity: string, key?: string) => {
    const req = http().post(`/api/v1/stock/${kind}`).set(auth(token));
    if (key) req.set('Idempotency-Key', key);
    return req.send({ productId: product, warehouseId, quantity });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    // Listen once: supertest would otherwise listen(0) and close() the shared server around every request, and under
    // concurrency one request's close() resets another's socket (ECONNRESET, seen in Series 04 run 3).
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);

    const reg = await http().post('/api/v1/auth/register').send({
      companyName: `Shared ${TAG}`, name: 'Owner', email: `owner.${TAG}@example.test`, password: password(),
    }).expect(201);
    owner = reg.body.accessToken;
    w1 = reg.body.defaultWarehouse.id;
    w2 = (await http().post('/api/v1/warehouses').set(auth(owner)).send({ name: `W2 ${TAG}` }).expect(201)).body.id;
    product = (await http().post('/api/v1/products').set(auth(owner)).send({ name: 'Bolt', sku: `SW-${TAG}` })
      .expect(201)).body.id;
    await move(owner, 'inbound', w1, '100').expect(201);
    await move(owner, 'inbound', w2, '50').expect(201);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('team onboarding', () => {
    it('the owner invites a Manager and a Staff member; each joins once with their token', async () => {
      const m = await invite({ email: `manager.${TAG}@example.test`, role: 'Manager' }).expect(201);
      const s = await invite({ email: `staff.${TAG}@example.test`, role: 'Staff', warehouseIds: [w1] }).expect(201);
      expect(typeof s.body.token).toBe('string');

      const joinedManager = await accept(m.body.token, 'Manager').expect(201);
      const joinedStaff = await accept(s.body.token, 'Staff').expect(201);
      manager = joinedManager.body.accessToken;
      staff = joinedStaff.body.accessToken;
      staffId = joinedStaff.body.user.id;
      expect(joinedStaff.body.user.role).toBe('Staff');

      await accept(s.body.token, 'Again').expect(400); // single use
      await accept(`unknown-${randomBytes(16).toString('hex')}`, 'Nobody').expect(400);
      const stored = await db.query(`SELECT token_hash FROM team_invitations WHERE id = $1`, [s.body.id]);
      expect(stored[0].token_hash).not.toBe(s.body.token); // only the hash is stored
    });

    it('refuses invalid invitations and non-admin inviters', async () => {
      await invite({ email: `s2.${TAG}@example.test`, role: 'Staff' }).expect(400); // Staff needs a warehouse
      await invite({ email: `a.${TAG}@example.test`, role: 'Admin' }).expect(400); // owners are not invited
      await invite({ email: `owner.${TAG}@example.test`, role: 'Manager' }).expect(409); // already a user
      const other = await http().post('/api/v1/auth/register').send({
        companyName: `Other ${TAG}`, name: 'O', email: `other.${TAG}@example.test`, password: password(),
      }).expect(201);
      await invite({ email: `x.${TAG}@example.test`, role: 'Staff', warehouseIds: [other.body.defaultWarehouse.id] })
        .expect(404); // another company's warehouse
      await invite({ email: `y.${TAG}@example.test`, role: 'Staff', warehouseIds: [w1] }, staff).expect(403);
      await invite({ email: `z.${TAG}@example.test`, role: 'Staff', warehouseIds: [w1] }, manager).expect(403);

      const revoked = await invite({ email: `r.${TAG}@example.test`, role: 'Manager' }).expect(201);
      await http().delete(`/api/v1/team/invitations/${revoked.body.id}`).set(auth(owner)).expect(204);
      await accept(revoked.body.token, 'Revoked').expect(400);
    });

    it('lists members with their warehouse scope', async () => {
      const members = (await http().get('/api/v1/team/members').set(auth(owner)).expect(200)).body as Array<{
        role: string; warehouses: unknown;
      }>;
      expect(members.map((m) => [m.role, m.warehouses])).toEqual([
        ['Admin', 'all'], ['Manager', 'all'], ['Staff', [w1]],
      ]);
    });
  });

  describe('warehouse scoping (Staff granted W1 only)', () => {
    it('Staff sees and uses only W1; the Manager sees both', async () => {
      const staffList = (await http().get('/api/v1/warehouses').set(auth(staff)).expect(200)).body;
      expect(staffList.map((w: { id: string }) => w.id)).toEqual([w1]);
      const managerList = (await http().get('/api/v1/warehouses').set(auth(manager)).expect(200)).body;
      expect(managerList.map((w: { id: string }) => w.id).sort()).toEqual([w1, w2].sort());

      await http().get(`/api/v1/warehouses/${w2}`).set(auth(staff)).expect(404);
      await http().get(`/api/v1/stock/balance/${product}/${w2}`).set(auth(staff)).expect(404);
      await http().get(`/api/v1/stock/changes/${w2}`).set(auth(staff)).expect(404);
      await move(staff, 'inbound', w2, '1').expect(404);
      await move(staff, 'outbound', w2, '1').expect(404);
      expect(await balance(owner, w2)).toBe(50);

      const history = (await http().get(`/api/v1/stock/movements/${product}`).set(auth(staff)).expect(200)).body;
      expect(new Set(history.map((m: { warehouseId: string }) => m.warehouseId))).toEqual(new Set([w1]));
      const full = (await http().get(`/api/v1/stock/movements/${product}`).set(auth(manager)).expect(200)).body;
      expect(new Set(full.map((m: { warehouseId: string }) => m.warehouseId))).toEqual(new Set([w1, w2]));
    });

    it('a grant change applies to the very next request, with the same access token', async () => {
      await http().put(`/api/v1/team/members/${staffId}/warehouses`).set(auth(owner)).send({ warehouseIds: [w2] })
        .expect(200);
      await http().get(`/api/v1/stock/balance/${product}/${w1}`).set(auth(staff)).expect(404);
      expect(await balance(staff, w2)).toBe(50);
      await http().put(`/api/v1/team/members/${staffId}/warehouses`).set(auth(owner)).send({ warehouseIds: [w1] })
        .expect(200);
      expect(await balance(staff, w1)).toBe(100);
      await http().put(`/api/v1/team/members/${staffId}/warehouses`).set(auth(manager)).send({ warehouseIds: [w1, w2] })
        .expect(403); // Manager has no MANAGE_USERS
    });
  });

  describe('one shared, authoritative stock', () => {
    it("Staff's dispatch is what the Manager reads next: balance, history and audit actor", async () => {
      const res = await move(staff, 'outbound', w1, '7').expect(201);
      expect(await balance(manager, w1)).toBe(93);
      const history = (await http().get(`/api/v1/stock/movements/${product}`).set(auth(manager)).expect(200)).body;
      expect(history.find((m: { id: string }) => m.id === res.body.id)).toMatchObject({ warehouseId: w1 });
      const actor = async () => (await db.query(
        `SELECT actor_user_id FROM audit_logs WHERE action = 'STOCK_ISSUED' AND entity_id = $1
         ORDER BY created_at DESC LIMIT 1`, [product]))[0]?.actor_user_id;
      for (let i = 0; i < 30 && (await actor()) !== staffId; i++) await new Promise((r) => setTimeout(r, 100));
      expect(await actor()).toBe(staffId);
    });

    it('two members dispatching at once never oversell', async () => {
      const onHand = await balance(owner, w1); // 93
      const [a, b] = await Promise.all([move(manager, 'outbound', w1, '60'), move(staff, 'outbound', w1, '60')]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect(await balance(owner, w1)).toBe(onHand - 60);
      await move(owner, 'inbound', w1, '60').expect(201); // restore
    });
  });

  describe('idempotent retries', () => {
    it('a retried request with the same key writes once and returns the first result', async () => {
      const key = `retry-${TAG}-1`;
      const before = await balance(owner, w1);
      const first = await move(staff, 'outbound', w1, '3', key).expect(201);
      const again = await move(staff, 'outbound', w1, '3', key).expect(201);
      expect(again.body.id).toBe(first.body.id);
      expect(again.body.replayed).toBe(true);
      expect(first.body.replayed).toBeUndefined();
      expect(await balance(owner, w1)).toBe(before - 3);
    });

    it('5 concurrent requests with one key: one movement, one audit row, the same answer for all', async () => {
      const key = `retry-${TAG}-2`;
      const before = await balance(owner, w1);
      const results = await Promise.all(Array.from({ length: 5 }, () => move(staff, 'outbound', w1, '2', key)));
      expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
      expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
      expect(results.filter((r) => !r.body.replayed)).toHaveLength(1);
      expect(await balance(owner, w1)).toBe(before - 2);
      const id = results[0].body.id;
      const rows = await db.query(`SELECT count(*)::int AS n FROM stock_movements WHERE id = $1`, [id]);
      expect(rows[0].n).toBe(1);
      await new Promise((r) => setTimeout(r, 1000)); // asynchronous audit listeners
      const issued = await db.query(
        `SELECT count(*)::int AS n FROM audit_logs WHERE action = 'STOCK_ISSUED' AND entity_id = $1
         AND (new_values->>'quantity') = '2'`, [product]);
      expect(issued[0].n).toBe(1);
    });

    it('refuses a reused key with a different request, and malformed keys', async () => {
      const key = `retry-${TAG}-3`;
      await move(staff, 'outbound', w1, '1', key).expect(201);
      await move(staff, 'outbound', w1, '4', key).expect(422);
      await move(staff, 'outbound', w1, '1', 'short').expect(400);
      await move(staff, 'outbound', w1, '1', 'bad key with spaces!!').expect(400);
      // Keys belong to one user: another member may use the same string independently.
      const other = await move(manager, 'outbound', w1, '1', key).expect(201);
      expect(other.body.replayed).toBeUndefined();
    });
  });

  describe('sync cursor (per-warehouse revisions)', () => {
    it('snapshot, then deltas that carry exactly the newer movements and the current balances', async () => {
      const snap = (await http().get(`/api/v1/stock/changes/${w1}`).set(auth(staff)).expect(200)).body;
      expect(snap.mode).toBe('snapshot');
      expect(snap.balances).toEqual([expect.objectContaining({ productId: product })]);
      const r0 = BigInt(snap.revision);

      await move(manager, 'inbound', w1, '10').expect(201);
      await move(manager, 'outbound', w1, '4').expect(201);
      const delta = (await http().get(`/api/v1/stock/changes/${w1}?since=${r0}`).set(auth(staff)).expect(200)).body;
      expect(delta.mode).toBe('delta');
      expect(delta.movements.map((m: { revision: string }) => m.revision)).toEqual([String(r0 + 1n), String(r0 + 2n)]);
      expect(delta.revision).toBe(String(r0 + 2n));
      expect(Number(delta.balances[0].baseQuantity)).toBe(await balance(owner, w1));

      const idle = (await http().get(`/api/v1/stock/changes/${w1}?since=${delta.revision}`).set(auth(staff))
        .expect(200)).body;
      expect([idle.mode, idle.movements.length, idle.revision]).toEqual(['delta', 0, delta.revision]);

      const ahead = (await http().get(`/api/v1/stock/changes/${w1}?since=${r0 + 1000n}`).set(auth(staff))
        .expect(200)).body;
      expect(ahead.mode).toBe('snapshot'); // a cursor this server never issued: start over from a snapshot

      const page = (await http().get(`/api/v1/stock/changes/${w1}?since=${r0}&limit=1`).set(auth(staff))
        .expect(200)).body;
      expect([page.hasMore, page.revision, page.movements.length]).toEqual([true, String(r0 + 1n), 1]);
      await http().get(`/api/v1/stock/changes/${w1}?since=-1`).set(auth(staff)).expect(400);
    });

    it('under 12 concurrent writes by three members a reader following the cursor misses none', async () => {
      const start = BigInt((await http().get(`/api/v1/stock/changes/${w1}`).set(auth(staff)).expect(200)).body.revision);
      const writers = [owner, manager, staff];
      const writes = await Promise.all(Array.from({ length: 12 }, (_, i) => move(writers[i % 3], 'inbound', w1, '1')));
      expect(writes.every((w) => w.status === 201)).toBe(true);

      const seen: string[] = [];
      let cursor = start;
      for (let i = 0; i < 20; i++) {
        const page = (await http().get(`/api/v1/stock/changes/${w1}?since=${cursor}&limit=5`).set(auth(staff))
          .expect(200)).body;
        seen.push(...page.movements.map((m: { revision: string }) => m.revision));
        cursor = BigInt(page.revision);
        if (!page.hasMore) break;
      }
      const expected = Array.from({ length: 12 }, (_, i) => String(start + BigInt(i + 1)));
      expect(seen).toEqual(expected);
      expect(new Set(writes.map((w) => w.body.revision))).toEqual(new Set(expected));
    });
  });
});
