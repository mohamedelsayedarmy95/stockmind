/**
 * Series 09 / S0 — exploit reproduction (BEFORE the fix). Disposable local PostgreSQL, synthetic company/users/products only.
 *
 * Records which roles receive the synthetic cost price through which endpoint, the cache headers, and whether the value
 * reaches audit_logs. It asserts nothing about the outcome: it only writes sanitized evidence to S09_EVIDENCE_OUT so the
 * pre-fix and post-fix behaviours can be compared. Skipped unless S09_EVIDENCE_OUT is set.
 */
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { randomBytes } from 'crypto';
import { writeFileSync } from 'fs';
import { DataSource } from 'typeorm';
import { AppModule } from '@/app.module';

const OUT = process.env.S09_EVIDENCE_OUT;
const RUN = Boolean(OUT && process.env.DB_HOST && process.env.JWT_ACCESS_SECRET && process.env.JWT_REFRESH_SECRET);
const TAG = randomBytes(4).toString('hex');
const password = () => `Aa1!${randomBytes(8).toString('hex')}`;
const SYNTHETIC_COST = '7351.25'; // distinctive, never a real price

(RUN ? describe : describe.skip)('S0 reproduction: cost price exposure (before fix)', () => {
  jest.setTimeout(240_000);
  let app: INestApplication;
  let db: DataSource;
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('records exposure per role and endpoint', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);

    try {
      const reg = await http().post('/api/v1/auth/register').send({
        companyName: `S0 ${TAG}`, name: 'Owner', email: `s0.owner.${TAG}@example.test`, password: password(),
      }).expect(201);
      const admin = reg.body.accessToken as string;
      const w1 = reg.body.defaultWarehouse.id as string;
      const companyId = (await db.query(`SELECT company_id FROM users WHERE id = $1`, [reg.body.user.id]))[0].company_id as string;

      const invite = (b: object) => http().post('/api/v1/team/invitations').set(auth(admin)).send(b).expect(201);
      const m = await invite({ email: `s0.manager.${TAG}@example.test`, role: 'Manager' });
      const s = await invite({ email: `s0.staff.${TAG}@example.test`, role: 'Staff', warehouseIds: [w1] });
      const manager = (await http().post('/api/v1/auth/accept-invitation').send({ token: m.body.token, name: 'M', password: password() }).expect(201)).body.accessToken as string;
      const staff = (await http().post('/api/v1/auth/accept-invitation').send({ token: s.body.token, name: 'S', password: password() }).expect(201)).body.accessToken as string;
      const other = await http().post('/api/v1/auth/register').send({
        companyName: `S0 other ${TAG}`, name: 'Other', email: `s0.other.${TAG}@example.test`, password: password(),
      }).expect(201);
      const otherAdmin = other.body.accessToken as string;

      const roles: Array<[string, string]> = [['Admin', admin], ['Manager', manager], ['Staff', staff], ['OtherCompanyAdmin', otherAdmin]];
      const summarise = (res: request.Response) => {
        const text = JSON.stringify(res.body);
        const rows = Array.isArray(res.body) ? res.body : [res.body];
        const first = rows[0] && typeof rows[0] === 'object' ? rows[0] : {};
        return {
          status: res.status,
          cacheControl: res.headers['cache-control'] ?? null,
          vary: res.headers['vary'] ?? null,
          containsSyntheticCost: text.includes(SYNTHETIC_COST),
          costPriceKeyPresent: 'costPrice' in first,
          costPriceValue: 'costPrice' in first ? first.costPrice : undefined,
          topLevelKeys: Object.keys(first).sort(),
        };
      };

      const evidence: Record<string, unknown> = { tag: TAG, syntheticCost: SYNTHETIC_COST, generatedAt: new Date().toISOString() };

      // Create (Admin + Manager hold CREATE_PRODUCT; Staff does not).
      const created = await http().post('/api/v1/products').set(auth(admin))
        .send({ name: 'Synthetic bolt', sku: `S0-${TAG}`, costPrice: SYNTHETIC_COST }).expect(201);
      const productId = created.body.id as string;
      evidence['POST /products (as Admin) response'] = summarise(created);
      const createdByManager = await http().post('/api/v1/products').set(auth(manager))
        .send({ name: 'Synthetic nut', sku: `S0M-${TAG}`, costPrice: SYNTHETIC_COST });
      evidence['POST /products (as Manager) response'] = summarise(createdByManager);
      const createdByStaff = await http().post('/api/v1/products').set(auth(staff))
        .send({ name: 'Synthetic washer', sku: `S0S-${TAG}`, costPrice: SYNTHETIC_COST });
      evidence['POST /products (as Staff) response'] = { status: createdByStaff.status };

      for (const [role, token] of roles) {
        evidence[`GET /products (${role})`] = summarise(await http().get('/api/v1/products').set(auth(token)));
        evidence[`GET /products/:id (${role})`] = summarise(await http().get(`/api/v1/products/${productId}`).set(auth(token)));
      }

      const patch = await http().patch(`/api/v1/products/${productId}`).set(auth(admin)).send({ name: 'Synthetic bolt v2' });
      evidence['PATCH /products/:id (as Admin, name only) response'] = summarise(patch);
      const patchCost = await http().patch(`/api/v1/products/${productId}`).set(auth(admin)).send({ costPrice: '9999.99' });
      evidence['PATCH /products/:id (as Admin, costPrice) response'] = { status: patchCost.status, note: 'UpdateProductDto has no costPrice; forbidNonWhitelisted rejects it' };

      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==', 'base64');
      const image = await http().post(`/api/v1/products/${productId}/image`).set(auth(admin)).attach('image', png, { filename: 'x.png', contentType: 'image/png' });
      evidence['POST /products/:id/image (as Admin) response'] = summarise(image);
      const imageStaff = await http().post(`/api/v1/products/${productId}/image`).set(auth(staff)).attach('image', png, { filename: 'x.png', contentType: 'image/png' });
      evidence['POST /products/:id/image (as Staff) response'] = { status: imageStaff.status };

      // Other surfaces that could carry the value.
      const cache = await http().get('/api/v1/products').set(auth(staff));
      evidence['cache-poisoning note'] = {
        listCacheControl: cache.headers['cache-control'] ?? null,
        listVary: cache.headers['vary'] ?? null,
      };

      // audit_logs: does the synthetic value (or a costPrice key) reach the audit trail?
      const audit: Array<Record<string, unknown>> = await db.query(
        `SELECT action, entity_type, http_method, http_path, old_values, new_values FROM audit_logs WHERE company_id = $1 ORDER BY created_at`, [companyId]);
      const leaking = audit.filter((r) => JSON.stringify([r.old_values, r.new_values]).includes(SYNTHETIC_COST));
      evidence['audit_logs'] = {
        rows: audit.length,
        rowsContainingSyntheticCost: leaking.length,
        leakingRows: leaking.map((r) => ({ action: r.action, entityType: r.entity_type, method: r.http_method, path: r.http_path, newValueKeys: Object.keys((r.new_values as object) ?? {}) })),
      };

      // Storage: ciphertext at rest (the column is encrypted).
      const stored: Array<{ cost_price: string | null }> = await db.query(`SELECT cost_price FROM products WHERE id = $1`, [productId]);
      evidence['database column'] = { equalsPlaintext: stored[0]?.cost_price === SYNTHETIC_COST, looksEncrypted: Boolean(stored[0]?.cost_price && stored[0].cost_price !== SYNTHETIC_COST) };

      writeFileSync(OUT as string, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
    } finally {
      await app.close();
    }
  });
});
