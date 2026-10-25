/**
 * Series 11: what do the ordered authority locks cost, and do they ever deadlock or time out? Measurement, not a gate: it
 * asserts only the safety facts (zero deadlocks, zero AUTHORITY_BUSY) and writes its numbers to S11_EVIDENCE_OUT (skipped
 * without it). Local disposable PostgreSQL on the same machine, the 100/min throttle replaced by a no-op counter: best-case
 * figures for the database hop; the SHAPE (alone vs under contention) is the point, not the absolute milliseconds.
 */
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import * as request from 'supertest';
import { randomBytes, randomUUID } from 'crypto';
import { writeFileSync } from 'fs';
import { DataSource } from 'typeorm';
import { AppModule } from '@/app.module';

process.env.CAPABILITY_MODE = 'enforce';

const OUT = process.env.S11_EVIDENCE_OUT;
const RUN = Boolean(OUT && process.env.DB_HOST && process.env.JWT_ACCESS_SECRET && process.env.JWT_REFRESH_SECRET);
const TAG = randomBytes(4).toString('hex');
const pct = (xs: number[], p: number) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const summary = (xs: number[]) => (xs.length
  ? { n: xs.length, medianMs: r3(pct(xs, 50)), p95Ms: r3(pct(xs, 95)), p99Ms: r3(pct(xs, 99)), maxMs: r3(Math.max(...xs)), meanMs: r3(xs.reduce((a, b) => a + b, 0) / xs.length) }
  : { n: 0 });
const pw = () => `Aa1!${randomBytes(8).toString('hex')}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(RUN ? describe : describe.skip)('S11 perf: ordered authority locks', () => {
  jest.setTimeout(900_000);

  it('measures grant latency alone and under writer + revocation contention, lock-wait samples and deadlocks', async () => {
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
      const reg = await http().post('/api/v1/auth/register').send({ companyName: `Lockperf ${TAG}`, name: 'Owner', email: `lp.owner.${TAG}@example.test`, password: pw() }).expect(201);
      const owner = reg.body.accessToken as string; const w1 = reg.body.defaultWarehouse.id as string;
      const w2 = (await http().post('/api/v1/warehouses').set(auth(owner)).send({ name: `Second ${TAG}` }).expect(201)).body.id as string;
      const product = (await http().post('/api/v1/products').set(auth(owner)).send({ name: 'Bolt', sku: `LP-${TAG}` }).expect(201)).body.id as string;
      await http().post('/api/v1/stock/inbound').set(auth(owner)).set('Idempotency-Key', randomUUID()).send({ productId: product, warehouseId: w1, quantity: '100000' }).expect(201);
      let seq = 0;
      const join = async (role: 'Manager' | 'Staff') => {
        const email = `lp.${role}.${++seq}.${TAG}@example.test`; const password = pw();
        const inv = await http().post('/api/v1/team/invitations').set(auth(owner)).send(role === 'Staff' ? { email, role, warehouseIds: [w1] } : { email, role }).expect(201);
        const j = await http().post('/api/v1/auth/accept-invitation').send({ token: inv.body.token, name: `${role} ${seq}`, password }).expect(201);
        return { id: j.body.user.id as string, token: j.body.accessToken as string, email, password };
      };
      const admin = await join('Manager');
      await http().patch(`/api/v1/team/members/${admin.id}/role`).set(auth(owner)).send({ role: 'Admin', acknowledgeCompanyWideAccess: true }).expect(200);
      admin.token = (await http().post('/api/v1/auth/login').send({ email: admin.email, password: admin.password }).expect(200)).body.accessToken;
      const staff = await join('Staff');
      const victim = await join('Staff'); // the member whose sessions the owner suspends and reactivates

      const timed = async (fn: () => Promise<request.Response>) => { const t = process.hrtime.bigint(); const res = await fn(); return { ms: Number(process.hrtime.bigint() - t) / 1e6, status: res.status, body: res.body }; };
      const toggle = (n: number) => http().put(`/api/v1/team/members/${staff.id}/access`).set(auth(admin.token))
        .send({ assignments: [{ warehouseId: w1, profile: n % 2 ? 'warehouse_manager' : 'operator' }, { warehouseId: w2, profile: 'operator' }] });
      const write = () => http().post('/api/v1/stock/inbound').set(auth(staff.token)).set('Idempotency-Key', randomUUID()).send({ productId: product, warehouseId: w1, quantity: '1' });

      const dead0 = (await db.query(`SELECT deadlocks::int AS n FROM pg_stat_database WHERE datname = current_database()`))[0].n as number;
      const busy: number[] = [];

      // 1. a grant alone
      for (let i = 0; i < 20; i++) await toggle(i); // warm-up
      const alone: number[] = [];
      for (let i = 0; i < 100; i++) { const r = await timed(() => toggle(i)); alone.push(r.ms); if (r.status === 503) busy.push(i); }

      // 2. writers by the TARGET (they hold its authority lock shared) + the admin toggling the target's access + the owner suspending/reactivating another member
      const stop = { v: false };
      const writerMs: number[] = []; const writerStatus: Record<string, number> = {};
      const writers = Array.from({ length: 4 }, async () => {
        while (!stop.v) { const r = await timed(write); writerMs.push(r.ms); writerStatus[r.status] = (writerStatus[r.status] ?? 0) + 1; }
      });
      const samples: Record<string, number> = {}; let sampleCount = 0;
      const sampler = (async () => {
        while (!stop.v) {
          const rows = await db.query(`SELECT wait_event_type AS t, wait_event AS e, count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' GROUP BY 1, 2`);
          sampleCount += 1;
          for (const r of rows) samples[`${r.t}:${r.e}`] = (samples[`${r.t}:${r.e}`] ?? 0) + r.n;
          await sleep(5);
        }
      })();
      const grantMs: number[] = []; const membershipMs: number[] = [];
      await sleep(200);
      for (let i = 0; i < 60; i++) {
        const [g, m1] = await Promise.all([
          timed(() => toggle(i)),
          timed(() => http().post(`/api/v1/team/members/${victim.id}/${i % 2 ? 'reactivate' : 'suspend'}`).set(auth(owner)).send({})),
        ]);
        grantMs.push(g.ms); membershipMs.push(m1.ms);
        if (g.status === 503) busy.push(i);
        if (m1.status === 503) busy.push(i);
      }
      stop.v = true;
      await Promise.all([...writers, sampler]);

      const dead1 = (await db.query(`SELECT deadlocks::int AS n FROM pg_stat_database WHERE datname = current_database()`))[0].n as number;
      const result = {
        method: 'local PostgreSQL 15 on the same host; HTTP; 4 concurrent writers by the grant target; the throttle counter replaced by a no-op',
        generatedAt: new Date().toISOString(),
        grantAloneMs: summary(alone),
        underContention: {
          writers: 4,
          grantWhileWritersAndMembershipMs: summary(grantMs),
          membershipActionMs: summary(membershipMs),
          writerLatencyMs: summary(writerMs),
          writerStatusCounts: writerStatus,
          lockWaitSamples: { sampleIntervalMs: 5, polls: sampleCount, backendsWaitingByEvent: samples },
        },
        deadlocksDuringRun: dead1 - dead0,
        authorityBusyResponses: busy.length,
      };
      writeFileSync(OUT as string, JSON.stringify(result, null, 2));
      expect(dead1 - dead0).toBe(0);
      expect(busy).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
