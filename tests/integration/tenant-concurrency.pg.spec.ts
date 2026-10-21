/**
 * Release-candidate guarantees over HTTP on a real PostgreSQL (the whole AppModule):
 * - tenant isolation: another company's product, warehouse, balance, history and stock writes answer 404;
 * - concurrent dispatch: parallel outbound requests never oversell, and the ledger stays a consistent chain;
 * - transfer atomicity: a transfer that cannot complete changes neither warehouse and writes no movement;
 * - audit integrity: exactly one STOCK_ISSUED row per accepted dispatch.
 * Needs a migrated PostgreSQL and JWT secrets (CI provides both); skipped without them.
 */
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { randomBytes } from 'crypto';
import { DataSource } from 'typeorm';
import { AppModule } from '@/app.module';

const RUN = Boolean(process.env.DB_HOST && process.env.JWT_ACCESS_SECRET && process.env.JWT_REFRESH_SECRET);
const TAG = randomBytes(4).toString('hex');

(RUN ? describe : describe.skip)('tenant isolation, concurrency and atomicity (PostgreSQL)', () => {
  jest.setTimeout(120_000);
  let app: INestApplication;
  let db: DataSource;
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const register = async (name: string) => {
    const res = await http().post('/api/v1/auth/register').send({
      companyName: `${name} ${TAG}`, name, email: `${name.toLowerCase()}.${TAG}@example.test`,
      password: `Aa1!${randomBytes(8).toString('hex')}`,
    }).expect(201);
    return { token: res.body.accessToken as string, warehouseId: res.body.defaultWarehouse.id as string };
  };
  const balance = async (token: string, productId: string, warehouseId: string) =>
    Number((await http().get(`/api/v1/stock/balance/${productId}/${warehouseId}`).set(auth(token)).expect(200))
      .body.baseQuantity);

  let A: { token: string; warehouseId: string };
  let B: { token: string; warehouseId: string };
  let productA: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    // Listen once: supertest would otherwise listen(0) and close() the shared server around every request, and under
    // concurrency one request's close() resets another's socket (ECONNRESET, seen in Series 04 run 3).
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);

    A = await register('Alpha');
    B = await register('Bravo');
    productA = (await http().post('/api/v1/products').set(auth(A.token))
      .send({ name: 'Bolt', sku: `BOLT-${TAG}` }).expect(201)).body.id;
    await http().post('/api/v1/stock/inbound').set(auth(A.token))
      .send({ productId: productA, warehouseId: A.warehouseId, quantity: '100' }).expect(201);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("another company cannot read or write company A's product, warehouse, balance or history", async () => {
    const reads = [
      `/api/v1/products/${productA}`,
      `/api/v1/warehouses/${A.warehouseId}`,
      `/api/v1/stock/balance/${productA}/${A.warehouseId}`,
      `/api/v1/stock/movements/${productA}`,
      `/api/v1/stock/movements/${productA}?warehouseId=${A.warehouseId}`,
    ];
    for (const url of reads) {
      const res = await http().get(url).set(auth(B.token));
      expect([url, res.status]).toEqual([url, 404]);
    }
    const writes: Array<[string, Record<string, string>]> = [
      ['/api/v1/stock/inbound', { productId: productA, warehouseId: A.warehouseId, quantity: '5' }],
      ['/api/v1/stock/inbound', { productId: productA, warehouseId: B.warehouseId, quantity: '5' }],
      ['/api/v1/stock/outbound', { productId: productA, warehouseId: A.warehouseId, quantity: '5' }],
      ['/api/v1/stock/transfer', { productId: productA, fromWarehouseId: A.warehouseId, toWarehouseId: B.warehouseId,
        quantity: '5' }],
    ];
    for (const [url, body] of writes) {
      const res = await http().post(url).set(auth(B.token)).send(body);
      expect([url, res.status]).toEqual([url, 404]);
    }
    const patch = await http().patch(`/api/v1/products/${productA}`).set(auth(B.token)).send({ name: 'pwned' });
    expect(patch.status).toBe(404);
    expect(await balance(A.token, productA, A.warehouseId)).toBe(100);
  });

  it('10 parallel dispatches of 15 against 100 on hand: 6 accepted, 4 refused, never negative', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () =>
      http().post('/api/v1/stock/outbound').set(auth(A.token))
        .send({ productId: productA, warehouseId: A.warehouseId, quantity: '15' })));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 201, 201, 201, 201, 201, 409, 409, 409, 409]);
    expect(await balance(A.token, productA, A.warehouseId)).toBe(10);

    // The ledger is one consistent chain: each running balance follows from the previous one. created_at is the
    // transaction start, not the commit order; here (one receipt, then dispatches only) balances strictly decrease.
    const rows: Array<{ quantity_change: string; running_balance: string }> = await db.query(
      `SELECT quantity_change, running_balance FROM stock_movements
       WHERE product_id = $1 AND warehouse_id = $2 ORDER BY running_balance DESC`,
      [productA, A.warehouseId],
    );
    let running = 0;
    for (const r of rows) {
      running += Number(r.quantity_change);
      expect(Number(r.running_balance)).toBe(running);
      expect(running).toBeGreaterThanOrEqual(0);
    }
    expect(rows).toHaveLength(7);

    // Audit: one STOCK_ISSUED row per accepted dispatch (listeners are asynchronous).
    const issued = async () => Number((await db.query(
      `SELECT count(*)::int AS n FROM audit_logs WHERE entity_id = $1 AND action = 'STOCK_ISSUED'`, [productA]))[0].n);
    for (let i = 0; i < 30 && (await issued()) < 6; i++) await new Promise((r) => setTimeout(r, 100));
    expect(await issued()).toBe(6);
  });

  it('a transfer larger than the stock changes neither warehouse and writes no movement', async () => {
    const second = (await http().post('/api/v1/warehouses').set(auth(A.token)).send({ name: `Second ${TAG}` })
      .expect(201)).body.id as string;
    const count = async () => Number((await db.query(
      `SELECT count(*)::int AS n FROM stock_movements WHERE product_id = $1`, [productA]))[0].n);
    const before = await count();

    await http().post('/api/v1/stock/transfer').set(auth(A.token))
      .send({ productId: productA, fromWarehouseId: A.warehouseId, toWarehouseId: second, quantity: '11' })
      .expect(409);
    expect(await balance(A.token, productA, A.warehouseId)).toBe(10);
    expect(await balance(A.token, productA, second)).toBe(0);
    expect(await count()).toBe(before);

    await http().post('/api/v1/stock/transfer').set(auth(A.token))
      .send({ productId: productA, fromWarehouseId: A.warehouseId, toWarehouseId: second, quantity: '4' })
      .expect(201);
    expect(await balance(A.token, productA, A.warehouseId)).toBe(6);
    expect(await balance(A.token, productA, second)).toBe(4);
    expect(await count()).toBe(before + 2);
  });
});
