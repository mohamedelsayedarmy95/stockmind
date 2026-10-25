/**
 * Series 10 / S2: what does the capability model cost? Measurement, not a gate: it asserts nothing about speed and writes its
 * numbers to S10_EVIDENCE_OUT (skipped without it). Local disposable PostgreSQL on the same machine, sequential HTTP requests,
 * the 100/min throttle replaced by a no-op counter: these are best-case figures for the database hop. The relevant numbers
 * are the DIFFERENCES between modes and the shape of the grant lookup, not the absolute milliseconds.
 */
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import * as request from 'supertest';
import { randomBytes, randomUUID } from 'crypto';
import { writeFileSync } from 'fs';
import { DataSource } from 'typeorm';
import { AppModule } from '@/app.module';

const OUT = process.env.S10_EVIDENCE_OUT;
const RUN = Boolean(OUT && process.env.DB_HOST && process.env.JWT_ACCESS_SECRET && process.env.JWT_REFRESH_SECRET);
const TAG = randomBytes(4).toString('hex');
const pct = (xs: number[], p: number) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const summary = (xs: number[]) => ({ n: xs.length, medianMs: r3(pct(xs, 50)), p95Ms: r3(pct(xs, 95)), p99Ms: r3(pct(xs, 99)), meanMs: r3(xs.reduce((a, b) => a + b, 0) / xs.length) });
const pw = () => `Aa1!${randomBytes(8).toString('hex')}`;

(RUN ? describe : describe.skip)('S2 perf: capability model', () => {
  jest.setTimeout(900_000);
  it('measures evaluation overhead, /me/capabilities, the grant lookup plan and contention with revocations', async () => {
    process.env.CAPABILITY_MODE = 'enforce';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    const app: INestApplication = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    const db = app.get(DataSource);
    const http = () => request(app.getHttpServer());
    const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
    try {
      const reg = await http().post('/api/v1/auth/register').send({ companyName: `Perf ${TAG}`, name: 'Owner', email: `p10.owner.${TAG}@example.test`, password: pw() }).expect(201);
      const owner = reg.body.accessToken as string;
      const companyId = (await db.query(`SELECT company_id FROM users WHERE id = $1`, [reg.body.user.id]))[0].company_id as string;
      const w1 = reg.body.defaultWarehouse.id as string;
      const w3 = (await http().post('/api/v1/warehouses').set(auth(owner)).send({ name: 'Third' }).expect(201)).body.id as string;
      const product = (await http().post('/api/v1/products').set(auth(owner)).send({ name: 'Bolt', sku: `P10-${TAG}` }).expect(201)).body.id as string;
      for (const w of [w1, w3]) await http().post('/api/v1/stock/inbound').set(auth(owner)).set('Idempotency-Key', randomUUID()).send({ productId: product, warehouseId: w, quantity: '100000' }).expect(201);
      const member = async (profile: string) => {
        const email = `p10.m.${randomBytes(3).toString('hex')}.${TAG}@example.test`;
        const inv = await http().post('/api/v1/team/invitations').set(auth(owner)).send({ email, role: 'Staff', warehouseIds: [w1] }).expect(201);
        const joined = await http().post('/api/v1/auth/accept-invitation').send({ token: inv.body.token, name: 'M', password: pw() }).expect(201);
        await http().put(`/api/v1/team/members/${joined.body.user.id}/access`).set(auth(owner))
          .send({ assignments: [{ warehouseId: w1, profile }, { warehouseId: w3, profile }] }).expect(200);
        return { id: joined.body.user.id as string, token: joined.body.accessToken as string };
      };
      const sm = await member('warehouse_manager');
      const staff = await member('operator');

      // 1. Evaluation overhead per request: the same guarded, warehouse-scoped read in each mode, alternating in rounds.
      const timed = async (token: string, path: string) => {
        const t = process.hrtime.bigint();
        await http().get(path).set(auth(token)).expect(200);
        return Number(process.hrtime.bigint() - t) / 1e6;
      };
      const path = `/api/v1/stock/balance/${product}/${w1}`;
      const modes = ['off', 'shadow', 'enforce'] as const;
      const samples: Record<string, number[]> = { off: [], shadow: [], enforce: [] };
      for (let i = 0; i < 30; i++) { process.env.CAPABILITY_MODE = modes[i % 3]; await timed(staff.token, path); } // warm-up
      for (let round = 0; round < 10; round++) {
        for (const m of modes) {
          process.env.CAPABILITY_MODE = m;
          for (let i = 0; i < 60; i++) samples[m].push(await timed(staff.token, path));
        }
      }
      const overhead = {
        off: summary(samples.off), shadow: summary(samples.shadow), enforce: summary(samples.enforce),
        shadowAddsMedianMs: r3(pct(samples.shadow, 50) - pct(samples.off, 50)),
        enforceAddsMedianMs: r3(pct(samples.enforce, 50) - pct(samples.off, 50)),
        shadowAddsP95Ms: r3(pct(samples.shadow, 95) - pct(samples.off, 95)),
        enforceAddsP95Ms: r3(pct(samples.enforce, 95) - pct(samples.off, 95)),
      };

      // 2. GET /me/capabilities
      process.env.CAPABILITY_MODE = 'enforce';
      const capsOwner: number[] = []; const capsScoped: number[] = [];
      for (let i = 0; i < 300; i++) { capsOwner.push(await timed(owner, '/api/v1/me/capabilities')); capsScoped.push(await timed(sm.token, '/api/v1/me/capabilities')); }

      // 3. Grant lookup shape on a large synthetic company (12,000 grants): the plan must use the per-member index.
      const [{ id: big }] = await db.query(`INSERT INTO companies (name) VALUES ($1) RETURNING id`, [`Big ${TAG}`]);
      await db.query(`INSERT INTO warehouses (company_id, name) SELECT $1, 'W' || g FROM generate_series(1, 300) g`, [big]);
      await db.query(`INSERT INTO users (company_id, name, email, password_hash, role) SELECT $1, 'U' || g, 'big.' || g || '.${TAG}@example.test', 'x', 'Staff' FROM generate_series(1, 40) g`, [big]);
      const [{ id: wmId }] = await db.query(`SELECT id FROM permission_profiles WHERE key = 'warehouse_manager'`);
      await db.query(
        `INSERT INTO access_grants (company_id, user_id, profile_id, scope_id)
         SELECT $1, u.id, $2, w.id FROM users u CROSS JOIN warehouses w WHERE u.company_id = $1 AND w.company_id = $1`, [big, wmId]);
      await db.query(`ANALYZE access_grants`);
      const [{ id: probeUser }] = await db.query(`SELECT id FROM users WHERE company_id = $1 ORDER BY id LIMIT 1`, [big]);
      const plan = await db.query(
        `EXPLAIN (ANALYZE, FORMAT JSON) SELECT g.scope_id, p.key, p.version, p.capabilities FROM access_grants g JOIN permission_profiles p ON p.id = g.profile_id
          WHERE g.user_id = $1 AND g.company_id = $2 AND g.revoked_at IS NULL AND g.valid_from <= now() AND (g.valid_until IS NULL OR g.valid_until > now())
            AND p.retired_at IS NULL AND (p.company_id IS NULL OR p.company_id = g.company_id)`, [probeUser, big]);
      const nodeTypes: string[] = [];
      const walk = (n: any) => { nodeTypes.push(`${n['Node Type']}${n['Index Name'] ? ':' + n['Index Name'] : ''}`); (n.Plans ?? []).forEach(walk); };
      walk(plan[0]['QUERY PLAN'][0].Plan);
      const lookup: number[] = [];
      for (let i = 0; i < 1000; i++) {
        const t = process.hrtime.bigint();
        await db.query(`SELECT g.scope_id FROM access_grants g WHERE g.user_id = $1 AND g.company_id = $2 AND g.revoked_at IS NULL`, [probeUser, big]);
        lookup.push(Number(process.hrtime.bigint() - t) / 1e6);
      }

      // 4. Contention: 4 writers adjust stock while the owner revokes and re-grants the scoped manager, repeatedly.
      const [{ deadlocks: d0 }] = await db.query(`SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()`);
      const adjust = async (token: string) => {
        const t = process.hrtime.bigint();
        const res = await http().post('/api/v1/stock/adjustment').set(auth(token)).set('Idempotency-Key', randomUUID())
          .send({ productId: product, warehouseId: w1, quantity: '1', reason: 'perf' });
        return { status: res.status, ms: Number(process.hrtime.bigint() - t) / 1e6 };
      };
      const alone: number[] = [];
      for (let i = 0; i < 100; i++) alone.push((await adjust(sm.token)).ms);
      const during: Array<{ status: number; ms: number }> = [];
      const revocations: number[] = [];
      const grants: number[] = [];
      let stop = false;
      const workers = Array.from({ length: 4 }, async () => { while (!stop) during.push(await adjust(sm.token)); });
      for (let r = 0; r < 12; r++) {
        await new Promise((res) => setTimeout(res, 150));
        let t = process.hrtime.bigint();
        await http().put(`/api/v1/team/members/${sm.id}/access`).set(auth(owner)).send({ assignments: [] }).expect(200);
        revocations.push(Number(process.hrtime.bigint() - t) / 1e6);
        await new Promise((res) => setTimeout(res, 100));
        t = process.hrtime.bigint();
        await http().put(`/api/v1/team/members/${sm.id}/access`).set(auth(owner))
          .send({ assignments: [{ warehouseId: w1, profile: 'warehouse_manager' }, { warehouseId: w3, profile: 'warehouse_manager' }] }).expect(200);
        grants.push(Number(process.hrtime.bigint() - t) / 1e6);
      }
      stop = true;
      await Promise.all(workers);
      const [{ deadlocks: d1 }] = await db.query(`SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()`);
      const byStatus: Record<string, number> = {};
      for (const d of during) byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;

      writeFileSync(OUT as string, JSON.stringify({
        method: 'local PostgreSQL 15 on the same host; sequential HTTP; alternating rounds; throttle counter replaced by a no-op',
        generatedAt: new Date().toISOString(),
        guardedRead: { route: 'GET /stock/balance/:product/:warehouse (VIEW_BALANCE + warehouse scope)', ...overhead },
        meCapabilities: { owner: summary(capsOwner), scopedManager: summary(capsScoped) },
        grantLookup: {
          grantsInTable: 12000, planNodes: nodeTypes, executionMs: r3(plan[0]['QUERY PLAN'][0]['Execution Time']),
          roundTripPerQueryMs: summary(lookup),
        },
        contention: {
          writers: 4, writeAloneMs: summary(alone), writeDuringRevocationsMs: summary(during.map((d) => d.ms)),
          responsesByStatus: byStatus, revokeRequestMs: summary(revocations), grantRequestMs: summary(grants),
          deadlocksDuringRun: Number(d1) - Number(d0),
        },
        caveat: 'Same-host database. A hosted database adds its network round trip to every query (the model costs 2 queries per guarded request, 1 more for the user lookup of Series 09).',
      }, null, 2) + '\n', 'utf8');
    } finally {
      process.env.CAPABILITY_MODE = 'shadow';
      await app.close();
    }
  });
});
