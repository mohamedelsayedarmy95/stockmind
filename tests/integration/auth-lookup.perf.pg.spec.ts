/**
 * Series 09 / S1: what does the per-request member lookup cost? Measurement, not a gate: it asserts nothing about speed and
 * writes its numbers to S09_EVIDENCE_OUT (skipped without it). Local disposable PostgreSQL on the same machine, so absolute
 * numbers are best case for the database hop; the relevant figure is the DIFFERENCE between the two strategies.
 *
 * A/B: the same authenticated endpoint is requested alternately with the claims-only strategy (the behaviour before
 * Series 09) and the database-backed strategy, in rounds, so machine drift affects both equally.
 */
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { randomBytes } from 'crypto';
import { writeFileSync } from 'fs';
import { DataSource } from 'typeorm';
import { AppModule } from '@/app.module';
import { JwtStrategy } from '@/infrastructure/jwt.strategy';

const OUT = process.env.S09_EVIDENCE_OUT;
const RUN = Boolean(OUT && process.env.DB_HOST && process.env.JWT_ACCESS_SECRET && process.env.JWT_REFRESH_SECRET);
const TAG = randomBytes(4).toString('hex');
const pct = (xs: number[], p: number) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];
const round = (n: number) => Math.round(n * 1000) / 1000;
const summary = (xs: number[]) => ({ n: xs.length, medianMs: round(pct(xs, 50)), p95Ms: round(pct(xs, 95)), p99Ms: round(pct(xs, 99)), meanMs: round(xs.reduce((a, b) => a + b, 0) / xs.length) });

(RUN ? describe : describe.skip)('S1 perf: per-request member lookup', () => {
  jest.setTimeout(600_000);
  it('measures the database-backed strategy against the claims-only one', async () => {
    // The 100/min/route throttle would stop a measurement of thousands of requests; its counter is irrelevant to what is measured.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    const app: INestApplication = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    try {
      const db = app.get(DataSource);
      const http = () => request(app.getHttpServer());
      const reg = await http().post('/api/v1/auth/register').send({
        companyName: `Perf ${TAG}`, name: 'Owner', email: `perf.${TAG}@example.test`, password: `Aa1!${randomBytes(8).toString('hex')}`,
      }).expect(201);
      const token = reg.body.accessToken as string;
      const strategy = app.get(JwtStrategy);
      const dbBacked = strategy.validate.bind(strategy);
      const claimsOnly = async (payload: Record<string, unknown>) =>
        ({ sub: payload.sub as string, companyId: payload.companyId as string, role: payload.role as string });
      const timed = async () => {
        const t = process.hrtime.bigint();
        await http().get('/api/v1/team/entitlements').set({ Authorization: `Bearer ${token}` }).expect(200);
        return Number(process.hrtime.bigint() - t) / 1e6;
      };

      const A: number[] = []; const B: number[] = [];
      for (let i = 0; i < 40; i++) { (strategy as any).validate = i % 2 ? claimsOnly : dbBacked; await timed(); } // warm-up
      const ROUNDS = 10; const PER = 100;
      for (let r = 0; r < ROUNDS; r++) {
        (strategy as any).validate = claimsOnly;
        for (let i = 0; i < PER; i++) A.push(await timed());
        (strategy as any).validate = dbBacked;
        for (let i = 0; i < PER; i++) B.push(await timed());
      }
      (strategy as any).validate = dbBacked;

      // The lookup alone, straight on the pool.
      const lookup: number[] = [];
      for (let i = 0; i < 2000; i++) {
        const t = process.hrtime.bigint();
        await db.query(`SELECT company_id, role::text AS role, status, token_version FROM users WHERE id = $1`, [reg.body.user.id]);
        lookup.push(Number(process.hrtime.bigint() - t) / 1e6);
      }
      const plan = await db.query(`EXPLAIN (FORMAT JSON) SELECT company_id, role::text AS role, status, token_version FROM users WHERE id = '${reg.body.user.id}'`);

      writeFileSync(OUT as string, JSON.stringify({
        method: 'A/B alternating rounds on one endpoint (GET /team/entitlements), local PostgreSQL 15 on the same host, sequential requests',
        generatedAt: new Date().toISOString(),
        claimsOnly: summary(A),
        databaseBacked: summary(B),
        addedMedianMs: round(pct(B, 50) - pct(A, 50)),
        addedP95Ms: round(pct(B, 95) - pct(A, 95)),
        lookupAlone: summary(lookup),
        lookupPlan: plan[0]['QUERY PLAN'][0].Plan['Node Type'] + ' on ' + (plan[0]['QUERY PLAN'][0].Plan['Index Name'] ?? plan[0]['QUERY PLAN'][0].Plan['Relation Name']),
        caveat: 'Same-host database: a network hop to a hosted database adds its round-trip time (1-20 ms typical) to the lookup. There is deliberately no cache, because a cache would reintroduce the revocation delay.',
      }, null, 2) + '\n', 'utf8');
    } finally {
      await app.close();
    }
  });
});
