/**
 * POST /stock/operations/lookup on a real PostgreSQL: what the CURRENT server history says about a caller's own
 * earlier stock operations. This is the server half of Series 04's reconciliation after a history reset: a client that
 * once saw an operation confirmed asks whether it is still in the ledger, and must not be told "confirmed" when a
 * restore erased it, nor learn anything about other users or companies.
 *
 * "Restores" here rewind one warehouse of a throwaway company inside the test database, as a backup restore would.
 * Needs a PostgreSQL and JWT secrets (CI provides both); skipped without them.
 */
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { randomBytes, randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { AppModule } from '@/app.module';

const RUN = Boolean(process.env.DB_HOST && process.env.JWT_ACCESS_SECRET && process.env.JWT_REFRESH_SECRET);
const TAG = randomBytes(4).toString('hex');
const password = () => `Aa1!${randomBytes(8).toString('hex')}`;

interface LookupResult {
  key: string;
  status: 'present' | 'absent' | 'indeterminate' | 'unavailable';
  reason?: string;
  movement?: { id: string; warehouseId: string; productId: string; movementType: string; quantityChange: string; revision: string };
}

(RUN ? describe : describe.skip)('operation lookup after history changes (PostgreSQL)', () => {
  jest.setTimeout(180_000);
  let app: INestApplication;
  let db: DataSource;
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let owner: string;
  let manager: string;
  let staff: string;
  let staffId: string;
  let otherCompany: string;
  let w1: string;
  let product: string;

  const move = (token: string, kind: 'inbound' | 'outbound', quantity: string, key: string) =>
    http().post(`/api/v1/stock/${kind}`).set(auth(token)).set('Idempotency-Key', key)
      .send({ productId: product, warehouseId: w1, quantity });
  const lookup = async (token: string, operations: Array<{ key: string; movementId?: string }>) =>
    (await http().post('/api/v1/stock/operations/lookup').set(auth(token)).send({ operations }).expect(200))
      .body.operations as LookupResult[];
  const revisionOf = async () =>
    (await db.query(`SELECT stock_revision::text AS r FROM warehouses WHERE id = $1`, [w1]))[0].r as string;

  /** Rewinds W1 to `revision` (movements after it and their key records are gone, balance recomputed). */
  const restoreTo = async (revision: string, opts: { keepKeyRecords?: boolean } = {}) => {
    await db.transaction(async (m) => {
      // (TypeORM returns [rows, count] for DELETE ... RETURNING, so the ids are read first.)
      const gone: Array<{ id: string }> = await m.query(
        `SELECT id FROM stock_movements WHERE warehouse_id = $1 AND revision > $2`, [w1, revision],
      );
      await m.query(`DELETE FROM stock_movements WHERE warehouse_id = $1 AND revision > $2`, [w1, revision]);
      if (!opts.keepKeyRecords && gone.length) {
        await m.query(`DELETE FROM stock_idempotency_keys WHERE response->>'id' = ANY($1::text[])`, [gone.map((g) => g.id)]);
      }
      await m.query(
        `UPDATE product_warehouse pw SET base_quantity = COALESCE(
           (SELECT running_balance FROM stock_movements WHERE warehouse_id = $1 AND product_id = $2
            ORDER BY revision DESC LIMIT 1), 0)
         WHERE pw.warehouse_id = $1 AND pw.product_id = $2`,
        [w1, product],
      );
      await m.query(`UPDATE warehouses SET stock_revision = $2 WHERE id = $1`, [w1, revision]);
    });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    db = app.get(DataSource);

    const reg = await http().post('/api/v1/auth/register').send({
      companyName: `Lookup ${TAG}`, name: 'Owner', email: `lookup.${TAG}@example.test`, password: password(),
    }).expect(201);
    owner = reg.body.accessToken;
    w1 = reg.body.defaultWarehouse.id;
    product = (await http().post('/api/v1/products').set(auth(owner)).send({ name: 'Bolt', sku: `LK-${TAG}` })
      .expect(201)).body.id;
    await move(owner, 'inbound', '100', randomUUID()).expect(201);

    const invite = (body: object) => http().post('/api/v1/team/invitations').set(auth(owner)).send(body).expect(201);
    const m = await invite({ email: `lk.manager.${TAG}@example.test`, role: 'Manager' });
    const s = await invite({ email: `lk.staff.${TAG}@example.test`, role: 'Staff', warehouseIds: [w1] });
    manager = (await http().post('/api/v1/auth/accept-invitation').send({ token: m.body.token, name: 'M', password: password() })
      .expect(201)).body.accessToken;
    const joined = await http().post('/api/v1/auth/accept-invitation').send({ token: s.body.token, name: 'S', password: password() })
      .expect(201);
    staff = joined.body.accessToken;
    staffId = joined.body.user.id;

    otherCompany = (await http().post('/api/v1/auth/register').send({
      companyName: `Other ${TAG}`, name: 'Other', email: `lk.other.${TAG}@example.test`, password: password(),
    }).expect(201)).body.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('a confirmed operation is present, with its movement and its CURRENT revision, and stays so as history grows', async () => {
    const key = randomUUID();
    const sent = (await move(staff, 'outbound', '5', key).expect(201)).body;
    let [r] = await lookup(staff, [{ key, movementId: sent.id }]);
    expect(r).toMatchObject({ key, status: 'present', movement: { id: sent.id, warehouseId: w1, productId: product, movementType: 'OUTBOUND' } });
    expect(Number(r.movement!.quantityChange)).toBe(-5);
    expect(r.movement!.revision).toBe(String(sent.revision));

    await move(manager, 'inbound', '3', randomUUID()).expect(201); // normal later activity
    [r] = await lookup(staff, [{ key }]); // also found by key alone
    expect(r).toMatchObject({ status: 'present', movement: { id: sent.id } });
  });

  it('a restore that erases the movement AND its key record: absent - and the reused revision is not mistaken for it', async () => {
    const before = await revisionOf();
    const key = randomUUID();
    const sent = (await move(staff, 'outbound', '4', key).expect(201)).body; // the client holds this receipt
    await restoreTo(before);
    const reused = (await move(manager, 'outbound', '1', randomUUID()).expect(201)).body;
    expect(String(reused.revision)).toBe(String(sent.revision)); // same revision number, different movement

    const [r] = await lookup(staff, [{ key, movementId: sent.id }]);
    expect(r).toEqual({ key, status: 'absent' });

    // What the server would do if a client blindly re-sent it: apply it AGAIN as a new movement (not a replay).
    // This is why the client must never auto-resend an operation it once saw confirmed.
    const resent = await move(staff, 'outbound', '4', key).expect(201);
    expect(resent.body.replayed).toBeUndefined();
    expect(resent.body.id).not.toBe(sent.id);
  });

  it('a partial restore (key record kept, movement gone) is indeterminate, never confirmed', async () => {
    const before = await revisionOf();
    const key = randomUUID();
    const sent = (await move(staff, 'outbound', '2', key).expect(201)).body;
    await restoreTo(before, { keepKeyRecords: true });
    const [r] = await lookup(staff, [{ key, movementId: sent.id }]);
    expect(r).toEqual({ key, status: 'indeterminate', reason: 'receipt-without-movement' });
  });

  it('a key record cleaned up while the movement remains: present, found by the receipt movement id', async () => {
    const key = randomUUID();
    const sent = (await move(staff, 'outbound', '1', key).expect(201)).body;
    await db.query(`DELETE FROM stock_idempotency_keys WHERE idempotency_key = $1`, [key]);
    const [r] = await lookup(staff, [{ key, movementId: sent.id }]);
    expect(r).toMatchObject({ status: 'present', reason: 'key-record-missing', movement: { id: sent.id } });
    expect(await lookup(staff, [{ key }])).toEqual([{ key, status: 'absent' }]); // without the receipt: no evidence
  });

  it("never discloses another user's or another company's operations", async () => {
    const key = randomUUID();
    const sent = (await move(staff, 'outbound', '1', key).expect(201)).body;
    const probe = [{ key, movementId: sent.id }];
    expect(await lookup(manager, probe)).toEqual([{ key, status: 'absent' }]); // same company, other user
    expect(await lookup(owner, probe)).toEqual([{ key, status: 'absent' }]); // even the Admin: keys are per user
    expect(await lookup(otherCompany, probe)).toEqual([{ key, status: 'absent' }]);
    // A movement id of someone else, under a key that does not exist: nothing either.
    expect(await lookup(manager, [{ key: randomUUID(), movementId: sent.id }])).toEqual([
      { key: expect.any(String), status: 'absent' },
    ]);
  });

  it('after access to the warehouse is revoked: unavailable, with no movement details', async () => {
    const key = randomUUID();
    const sent = (await move(staff, 'outbound', '1', key).expect(201)).body;
    await http().put(`/api/v1/team/members/${staffId}/warehouses`).set(auth(owner)).send({ warehouseIds: [] }).expect(200);
    try {
      expect(await lookup(staff, [{ key, movementId: sent.id }])).toEqual([{ key, status: 'unavailable', reason: 'no-access' }]);
    } finally {
      await http().put(`/api/v1/team/members/${staffId}/warehouses`).set(auth(owner)).send({ warehouseIds: [w1] }).expect(200);
    }
    expect((await lookup(staff, [{ key }]))[0].status).toBe('present');
  });

  it('answers many operations in one call, in request order, and validates the request', async () => {
    const keys = [randomUUID(), randomUUID()];
    await move(staff, 'outbound', '1', keys[0]).expect(201);
    const results = await lookup(staff, [{ key: keys[1] }, { key: keys[0] }]);
    expect(results.map((r) => [r.key, r.status])).toEqual([[keys[1], 'absent'], [keys[0], 'present']]);

    const post = (body: unknown, token: string | null = staff) => {
      const req = http().post('/api/v1/stock/operations/lookup');
      if (token) req.set(auth(token));
      return req.send(body as object);
    };
    await post({ operations: [] }).expect(400);
    await post({ operations: Array.from({ length: 101 }, () => ({ key: randomUUID() })) }).expect(400);
    await post({ operations: [{ key: 'bad key!' }] }).expect(400);
    await post({ operations: [{ key: randomUUID(), movementId: 'not-a-uuid' }] }).expect(400);
    await post({ operations: [{ key: randomUUID() }] }, null).expect(401);
  });

  it('is read-only: no audit row is written for lookups', async () => {
    await lookup(staff, [{ key: randomUUID() }]);
    await new Promise((resolve) => setTimeout(resolve, 300)); // audit writes are asynchronous
    const [row] = await db.query(`SELECT count(*)::int AS n FROM audit_logs WHERE http_path LIKE '%operations/lookup%'`);
    expect(row.n).toBe(0);
  });
});
