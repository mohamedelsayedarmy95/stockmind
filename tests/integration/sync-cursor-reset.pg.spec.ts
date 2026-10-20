/**
 * Sync cursor integrity on a real PostgreSQL: a client's cursor (revision + anchor) must still name the same history,
 * or the server answers with an explicit reset snapshot instead of a delta with a silent gap.
 *
 * The "restore" below rewinds one warehouse of a throwaway company inside the test database (as a backup restore
 * would), then writes again so the revision numbers are reused. Needs a PostgreSQL and JWT secrets; skipped without.
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

interface Changes {
  mode: 'delta' | 'snapshot';
  revision: string;
  anchor: string | null;
  reset: boolean;
  hasMore: boolean;
  movements: Array<{ id: string; revision: string }>;
  balances: Array<{ productId: string; baseQuantity: string }>;
}

(RUN ? describe : describe.skip)('sync cursor reset detection (PostgreSQL)', () => {
  jest.setTimeout(120_000);
  let app: INestApplication;
  let db: DataSource;
  let token: string;
  let w1: string;
  let product: string;
  const http = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const inbound = (quantity: string) =>
    http().post('/api/v1/stock/inbound').set(auth()).set('Idempotency-Key', randomUUID())
      .send({ productId: product, warehouseId: w1, quantity }).expect(201);
  const changes = async (query = ''): Promise<Changes> =>
    (await http().get(`/api/v1/stock/changes/${w1}${query}`).set(auth()).expect(200)).body;
  const idAt = async (revision: number): Promise<string> =>
    (await db.query(`SELECT id FROM stock_movements WHERE warehouse_id = $1 AND revision = $2`, [w1, revision]))[0].id;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    db = app.get(DataSource);

    const reg = await http().post('/api/v1/auth/register').send({
      companyName: `Cursor ${TAG}`, name: 'Owner', email: `cursor.${TAG}@example.test`, password: password(),
    }).expect(201);
    token = reg.body.accessToken;
    w1 = reg.body.defaultWarehouse.id;
    product = (await http().post('/api/v1/products').set(auth()).send({ name: 'Nut', sku: `CR-${TAG}` }).expect(201))
      .body.id;
    for (const q of ['10', '10', '10']) await inbound(q); // revisions 1..3, balance 30
  });

  afterAll(async () => {
    await app?.close();
  });

  it('every answer carries the anchor of its revision; a matching cursor gets a normal delta', async () => {
    const snap = await changes();
    expect(snap).toMatchObject({ mode: 'snapshot', revision: '3', reset: false, anchor: await idAt(3) });

    const idle = await changes(`?since=3&anchor=${snap.anchor}`);
    expect(idle).toMatchObject({ mode: 'delta', revision: '3', reset: false, anchor: snap.anchor, movements: [] });

    await inbound('5'); // revision 4
    const delta = await changes(`?since=3&anchor=${snap.anchor}`);
    expect(delta.mode).toBe('delta');
    expect(delta.movements.map((m) => m.revision)).toEqual(['4']);
    expect(delta.anchor).toBe(await idAt(4));
    expect(delta.balances[0].baseQuantity).toBe('35.000000');
  });

  it('a page cursor anchors on the last movement of the page', async () => {
    const page = await changes(`?since=2&anchor=${await idAt(2)}&limit=1`);
    expect(page).toMatchObject({ mode: 'delta', revision: '3', hasMore: true, anchor: await idAt(3) });
  });

  it('after a restore that reuses revision numbers, the old cursor gets reset:true, not a silent gap', async () => {
    const before = { revision: '4', anchor: await idAt(4) }; // what a client holds

    // "Restore" the warehouse to its state at revision 2 (balance 20), as a backup restore would.
    await db.transaction(async (m) => {
      await m.query(`DELETE FROM stock_movements WHERE warehouse_id = $1 AND revision > 2`, [w1]);
      await m.query(`UPDATE product_warehouse SET base_quantity = 20 WHERE warehouse_id = $1 AND product_id = $2`, [
        w1, product,
      ]);
      await m.query(`UPDATE warehouses SET stock_revision = 2 WHERE id = $1`, [w1]);
    });
    await inbound('1'); // new revision 3
    await inbound('1'); // new revision 4: the client's revision number now names a different movement
    expect(await idAt(4)).not.toBe(before.anchor);

    // An old client (no anchor) cannot tell: it gets an empty delta and keeps a stale balance of 35.
    const blind = await changes(`?since=${before.revision}`);
    expect(blind).toMatchObject({ mode: 'delta', movements: [], balances: [] });

    // With the anchor, the server says so explicitly and sends the full, current state.
    const reset = await changes(`?since=${before.revision}&anchor=${before.anchor}`);
    expect(reset).toMatchObject({ mode: 'snapshot', reset: true, revision: '4', anchor: await idAt(4), movements: [] });
    expect(reset.balances).toEqual([expect.objectContaining({ productId: product, baseQuantity: '22.000000' })]);
  });

  it('a cursor ahead of the warehouse is a reset as well; old and anchor-less forms stay compatible', async () => {
    expect(await changes('?since=999')).toMatchObject({ mode: 'snapshot', reset: true, revision: '4' });
    // No movement exists at revision 0, so an anchor there is not checked.
    expect(await changes(`?since=0&anchor=${randomUUID()}`)).toMatchObject({ mode: 'delta', reset: false });
  });

  it('refuses a malformed anchor', async () => {
    await http().get(`/api/v1/stock/changes/${w1}?since=1&anchor=not-a-uuid`).set(auth()).expect(400);
  });
});
