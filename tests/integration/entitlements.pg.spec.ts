/**
 * Subscription-ready entitlements over HTTP on a real PostgreSQL. Gates are server-side, apply only to new additions
 * (members, warehouses) and are enforced only with ENTITLEMENTS_ENFORCED=true; nothing here charges anyone: plans are
 * set by an explicit trial/test grant (SQL), as an operator or a verified store purchase would.
 * Needs a PostgreSQL and JWT secrets; skipped without them.
 */
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { randomBytes } from 'crypto';
import { DataSource } from 'typeorm';
import { AppModule } from '@/app.module';

const RUN = Boolean(process.env.DB_HOST && process.env.JWT_ACCESS_SECRET && process.env.JWT_REFRESH_SECRET);
const password = () => `Aa1!${randomBytes(8).toString('hex')}`;

(RUN ? describe : describe.skip)('entitlements (PostgreSQL)', () => {
  jest.setTimeout(180_000);
  let app: INestApplication;
  let db: DataSource;
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const enforce = (on: boolean) => {
    if (on) process.env.ENTITLEMENTS_ENFORCED = 'true';
    else delete process.env.ENTITLEMENTS_ENFORCED;
  };

  const company = async () => {
    const tag = randomBytes(4).toString('hex');
    const res = await http().post('/api/v1/auth/register').send({
      companyName: `Plan ${tag}`, name: 'Owner', email: `plan.${tag}@example.test`, password: password(),
    }).expect(201);
    return { tag, token: res.body.accessToken as string, companyId: res.body.company.id as string,
      warehouseId: res.body.defaultWarehouse.id as string };
  };
  const grant = (companyId: string, plan: string, status = 'trialing', expiresAt: Date | null = null) =>
    db.query(
      `UPDATE companies SET plan = $2, subscription_status = $3, plan_expires_at = $4, entitlement_source = 'trial_grant'
       WHERE id = $1`, [companyId, plan, status, expiresAt]);
  const invite = (c: { token: string; tag: string }, n: number, role = 'Manager') =>
    http().post('/api/v1/team/invitations').set(auth(c.token))
      .send({ email: `m${n}.${c.tag}@example.test`, role });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    db = app.get(DataSource);
  });

  afterAll(async () => {
    enforce(false);
    await new Promise((r) => setTimeout(r, 500)); // asynchronous audit listeners
    await app?.close();
  });

  it('rollout is safe: without enforcement a free company keeps inviting and adding warehouses', async () => {
    enforce(false);
    const c = await company();
    await invite(c, 1).expect(201);
    await http().post('/api/v1/warehouses').set(auth(c.token)).send({ name: 'Second' }).expect(201);
    const e = (await http().get('/api/v1/team/entitlements').set(auth(c.token)).expect(200)).body;
    expect(e).toMatchObject({ plan: 'free', status: 'active', enforced: false,
      limits: { seats: 1, warehouses: 1, teamSharing: false }, usage: { seats: 1, pendingInvitations: 1, warehouses: 2 } });
  });

  it('enforced: the free plan has no team and one warehouse (402), and existing data stays usable', async () => {
    enforce(true);
    const c = await company();
    const res = await invite(c, 1).expect(402);
    // The app's error contract is { statusCode, message }: 402 is the machine-readable signal.
    expect(res.body).toMatchObject({ statusCode: 402, message: 'The free plan does not include team members' });
    await http().post('/api/v1/warehouses').set(auth(c.token)).send({ name: 'Second' }).expect(402);
    await http().get('/api/v1/warehouses').set(auth(c.token)).expect(200);
  });

  it('a trial grant opens team sharing up to the seat limit; pending invitations hold seats', async () => {
    enforce(true);
    const c = await company();
    await grant(c.companyId, 'pro'); // 3 seats: the owner + 2
    await invite(c, 1).expect(201);
    await invite(c, 2).expect(201);
    expect((await invite(c, 3).expect(402)).body.message).toMatch(/seats/);
  });

  it('concurrent acceptances cannot exceed the seats (the company row lock serializes them)', async () => {
    enforce(true);
    const c = await company();
    await grant(c.companyId, 'business'); // invite three while seats allow it
    const tokens = await Promise.all([1, 2, 3].map(async (n) => (await invite(c, n).expect(201)).body.token as string));
    await grant(c.companyId, 'pro'); // then only 2 more seats remain
    const results = await Promise.all(tokens.map((token, i) =>
      http().post('/api/v1/auth/accept-invitation').send({ token, name: `M${i}`, password: password() })));
    expect(results.map((r) => r.status).sort()).toEqual([201, 201, 402]);
    const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM users WHERE company_id = $1`, [c.companyId]);
    expect(n).toBe(3);
  });

  it('read-only and expired plans stop growth but never hide existing stock', async () => {
    enforce(true);
    const c = await company();
    const product = (await http().post('/api/v1/products').set(auth(c.token))
      .send({ name: 'P', sku: `P-${c.tag}` }).expect(201)).body.id;
    await http().post('/api/v1/stock/inbound').set(auth(c.token))
      .send({ productId: product, warehouseId: c.warehouseId, quantity: '5' }).expect(201);

    await grant(c.companyId, 'business', 'read_only');
    await invite(c, 1).expect(402);
    await http().post('/api/v1/warehouses').set(auth(c.token)).send({ name: 'Second' }).expect(402);
    const balance = (await http().get(`/api/v1/stock/balance/${product}/${c.warehouseId}`).set(auth(c.token))
      .expect(200)).body;
    expect(balance.baseQuantity).toBe('5.000000');
    await http().get(`/api/v1/stock/movements/${product}`).set(auth(c.token)).expect(200);

    await grant(c.companyId, 'business', 'active', new Date(Date.now() - 60_000)); // expired -> free limits
    const e = (await http().get('/api/v1/team/entitlements').set(auth(c.token)).expect(200)).body;
    expect(e.plan).toBe('free');
    await invite(c, 2).expect(402);
  });
});
