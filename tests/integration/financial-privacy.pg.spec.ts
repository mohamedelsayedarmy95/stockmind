/**
 * Series 09 / S0 on a real PostgreSQL: financial privacy of the item cost price (NT-12).
 *
 * Contract: a product response never carries the key `costPrice` for a caller without `item.view_cost` (absent, not null), on
 * every endpoint that returns a product; the value never reaches audit_logs; list/detail responses vary by caller. Admin holds
 * the permission by default; Manager and Staff do not; an explicit role grant extends it. Synthetic data only.
 */
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { randomBytes } from 'crypto';
import { DataSource } from 'typeorm';
import { AppModule } from '@/app.module';
import { toProductResponse } from '@/application/dtos/product/product-response.dto';
import { Product } from '@/domain/entities/product.entity';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS } from '@/shared/constants/permissions.constant';

const RUN = Boolean(process.env.DB_HOST && process.env.JWT_ACCESS_SECRET && process.env.JWT_REFRESH_SECRET);
const TAG = randomBytes(4).toString('hex');
const password = () => `Aa1!${randomBytes(8).toString('hex')}`;
const COST = '7351.25'; // distinctive synthetic value
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==', 'base64');

describe('NT-12 (unit): the product response is an allowlist', () => {
  const entity = (): Product => Object.assign(new Product(), {
    id: 'p1', publicId: 'pub1', companyId: 'c1', name: 'Bolt', sku: 'B-1', barcode: null, imageUrl: null, categoryId: null,
    costPrice: COST, weight: null, volume: null, expiryDate: null, version: 1, createdAt: new Date(0),
    deletedAt: null, deletedBy: 'u9', futureSecretColumn: 'must-not-leak',
  });

  it('omits the costPrice KEY (not null) without the permission', () => {
    const out = toProductResponse(entity(), { includeCost: false });
    expect('costPrice' in out).toBe(false);
    expect(JSON.stringify(out)).not.toContain(COST);
  });
  it('includes it only when asked, and never serializes internal or future columns', () => {
    const out = toProductResponse(entity(), { includeCost: true }) as unknown as Record<string, unknown>;
    expect(out.costPrice).toBe(COST);
    expect(out).not.toHaveProperty('futureSecretColumn');
    expect(out).not.toHaveProperty('deletedBy');
    expect(out).not.toHaveProperty('deletedAt');
  });
  it('keeps a "never recorded" cost distinguishable for those who may see it', () => {
    const e = entity(); e.costPrice = null;
    expect(toProductResponse(e, { includeCost: true }).costPrice).toBeNull();
    expect('costPrice' in toProductResponse(e, { includeCost: false })).toBe(false);
  });
  it('default role matrix: only Admin holds item.view_cost', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.Admin).toContain(PERMISSIONS.VIEW_COST);
    expect(DEFAULT_ROLE_PERMISSIONS.Manager).not.toContain(PERMISSIONS.VIEW_COST);
    expect(DEFAULT_ROLE_PERMISSIONS.Staff).not.toContain(PERMISSIONS.VIEW_COST);
  });
});

(RUN ? describe : describe.skip)('NT-12 (PostgreSQL): cost price visibility over HTTP', () => {
  jest.setTimeout(240_000);
  let app: INestApplication;
  let db: DataSource;
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let admin: string; let manager: string; let staff: string; let staffId: string; let otherAdmin: string;
  let companyId: string; let w1: string; let productId: string;

  const hasCost = (body: unknown) => {
    const rows = Array.isArray(body) ? body : [body];
    return rows.some((r) => r && typeof r === 'object' && 'costPrice' in (r as object));
  };
  const leaks = (body: unknown) => JSON.stringify(body).includes(COST);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1'); // listen once: concurrent supertest requests otherwise reset each other's sockets
    db = app.get(DataSource);

    const reg = await http().post('/api/v1/auth/register').send({
      companyName: `NT12 ${TAG}`, name: 'Owner', email: `nt12.owner.${TAG}@example.test`, password: password(),
    }).expect(201);
    admin = reg.body.accessToken; w1 = reg.body.defaultWarehouse.id;
    companyId = (await db.query(`SELECT company_id FROM users WHERE id = $1`, [reg.body.user.id]))[0].company_id;
    const invite = (b: object) => http().post('/api/v1/team/invitations').set(auth(admin)).send(b).expect(201);
    const m = await invite({ email: `nt12.manager.${TAG}@example.test`, role: 'Manager' });
    const s = await invite({ email: `nt12.staff.${TAG}@example.test`, role: 'Staff', warehouseIds: [w1] });
    manager = (await http().post('/api/v1/auth/accept-invitation').send({ token: m.body.token, name: 'M', password: password() }).expect(201)).body.accessToken;
    const joined = await http().post('/api/v1/auth/accept-invitation').send({ token: s.body.token, name: 'S', password: password() }).expect(201);
    staff = joined.body.accessToken; staffId = joined.body.user.id;
    otherAdmin = (await http().post('/api/v1/auth/register').send({
      companyName: `NT12 other ${TAG}`, name: 'Other', email: `nt12.other.${TAG}@example.test`, password: password(),
    }).expect(201)).body.accessToken;

    const created = await http().post('/api/v1/products').set(auth(admin)).send({ name: 'Synthetic bolt', sku: `NT-${TAG}`, costPrice: COST }).expect(201);
    productId = created.body.id;
  });

  afterAll(async () => { await app?.close(); });

  it('Admin sees the cost on create, list, detail, update and image upload', async () => {
    const list = await http().get('/api/v1/products').set(auth(admin)).expect(200);
    expect(list.body.find((p: { id: string }) => p.id === productId).costPrice).toBe(COST);
    expect((await http().get(`/api/v1/products/${productId}`).set(auth(admin)).expect(200)).body.costPrice).toBe(COST);
    expect((await http().patch(`/api/v1/products/${productId}`).set(auth(admin)).send({ name: 'Synthetic bolt' }).expect(200)).body.costPrice).toBe(COST);
    expect((await http().post(`/api/v1/products/${productId}/image`).set(auth(admin)).attach('image', PNG, { filename: 'x.png', contentType: 'image/png' }).expect(201)).body.costPrice).toBe(COST);
  });

  it.each([['Manager'], ['Staff']])('%s never receives the costPrice key from any product endpoint', async (role) => {
    const token = role === 'Manager' ? manager : staff;
    const list = await http().get('/api/v1/products').set(auth(token)).expect(200);
    const detail = await http().get(`/api/v1/products/${productId}`).set(auth(token)).expect(200);
    expect(list.body.length).toBeGreaterThan(0);
    for (const res of [list, detail]) {
      expect(hasCost(res.body)).toBe(false);
      expect(leaks(res.body)).toBe(false);
    }
    if (role === 'Manager') {
      const patch = await http().patch(`/api/v1/products/${productId}`).set(auth(token)).send({ name: 'Synthetic bolt' }).expect(200);
      const image = await http().post(`/api/v1/products/${productId}/image`).set(auth(token)).attach('image', PNG, { filename: 'x.png', contentType: 'image/png' }).expect(201);
      for (const res of [patch, image]) {
        expect(hasCost(res.body)).toBe(false);
        expect(leaks(res.body)).toBe(false);
      }
    }
  });

  it('a Manager may still record a cost at creation (write compatibility) but does not get it echoed back', async () => {
    const res = await http().post('/api/v1/products').set(auth(manager)).send({ name: 'Manager item', sku: `NTM-${TAG}`, costPrice: COST }).expect(201);
    expect(hasCost(res.body)).toBe(false);
    expect(leaks(res.body)).toBe(false);
    const asAdmin = await http().get(`/api/v1/products/${res.body.id}`).set(auth(admin)).expect(200);
    expect(asAdmin.body.costPrice).toBe(COST); // it was stored
  });

  it('Staff cannot create products at all', async () => {
    await http().post('/api/v1/products').set(auth(staff)).send({ name: 'x', sku: `NTS-${TAG}`, costPrice: COST }).expect(403);
  });

  it('another company never sees the product or its cost', async () => {
    const list = await http().get('/api/v1/products').set(auth(otherAdmin)).expect(200);
    expect(list.body).toEqual([]);
    await http().get(`/api/v1/products/${productId}`).set(auth(otherAdmin)).expect(404);
  });

  it('list and detail vary by caller so a shared cache cannot cross-serve them', async () => {
    const list = await http().get('/api/v1/products').set(auth(staff)).expect(200);
    const detail = await http().get(`/api/v1/products/${productId}`).set(auth(staff)).expect(200);
    expect(String(list.headers['vary'])).toMatch(/authorization/i);
    expect(String(detail.headers['vary'])).toMatch(/authorization/i);
    expect(String(list.headers['cache-control'])).toMatch(/private/);
  });

  it('the cost never reaches audit_logs (key kept, value redacted)', async () => {
    const rows: Array<{ old_values: unknown; new_values: unknown; http_path: string }> = await db.query(
      `SELECT old_values, new_values, http_path FROM audit_logs WHERE company_id = $1`, [companyId]);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((r) => JSON.stringify([r.old_values, r.new_values]).includes(COST))).toEqual([]);
    const create = rows.find((r) => r.http_path === '/api/v1/products' && JSON.stringify(r.new_values).includes('REDACTED'));
    expect(create).toBeDefined();
  });

  it('the stored value is ciphertext at rest', async () => {
    const [row] = await db.query(`SELECT cost_price FROM products WHERE id = $1`, [productId]);
    expect(row.cost_price).not.toBe(COST);
    expect(row.cost_price).not.toContain(COST);
  });

  it('an explicit role grant of item.view_cost lifts the restriction for that user only (and revoking it restores it)', async () => {
    const [{ id: roleId }] = await db.query(
      `INSERT INTO roles (company_id, name, description, is_system) VALUES ($1, $2, 'finance viewer (test)', false) RETURNING id`,
      [companyId, `finance_viewer_${TAG}`]);
    const [{ id: permId }] = await db.query(
      `INSERT INTO permissions (name, description) VALUES ($1, 'view cost') ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [PERMISSIONS.VIEW_COST]);
    await db.query(`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)`, [roleId, permId]);
    await db.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [staffId, roleId]);

    const granted = await http().get(`/api/v1/products/${productId}`).set(auth(staff)).expect(200);
    expect(granted.body.costPrice).toBe(COST);
    expect(hasCost((await http().get('/api/v1/products').set(auth(manager)).expect(200)).body)).toBe(false); // someone else unaffected

    await db.query(`DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2`, [staffId, roleId]);
    const revoked = await http().get(`/api/v1/products/${productId}`).set(auth(staff)).expect(200);
    expect(hasCost(revoked.body)).toBe(false);
  });
});
