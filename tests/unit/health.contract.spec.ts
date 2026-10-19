/**
 * F7 regression: GET /api/v1/health is Render's healthCheckPath (readiness). Only the database is mandatory;
 * Firebase push and the Redis cache are optional integrations whose state is reported but never fails the check.
 * The app is built with the real GlobalExceptionFilter so the HTTP bodies match production.
 */
import { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { HealthCheckError, TerminusModule, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { I18nService } from 'nestjs-i18n';
import * as request from 'supertest';
import { HealthController } from '../../src/presentation/controllers/health.controller';
import { GlobalExceptionFilter } from '../../src/presentation/filters/global-exception.filter';
import { FirebaseService } from '../../src/infrastructure/firebase/firebase.service';
import { RedisService } from '../../src/infrastructure/cache/redis.service';

const SECRET_KEY = 'SENTINEL-PRIVATE-KEY-MATERIAL';
const DB_ERROR = 'password authentication failed for user "sentinel_db_user"';
const PROBE_ERROR = 'sentinel firebase probe failure';

type DbMode = 'up' | 'down' | 'throws';
type FirebaseMode = 'enabled' | 'disabled' | 'throws';

describe('F7: /health readiness contract', () => {
  let app: INestApplication;
  let dbMode: DbMode;
  let firebaseMode: FirebaseMode;
  let cacheStatus: string;
  const savedEnv = { ...process.env };

  const setFirebase = (mode: FirebaseMode) => {
    firebaseMode = mode;
    if (mode === 'disabled') {
      delete process.env.FIREBASE_PROJECT_ID;
      delete process.env.FIREBASE_PRIVATE_KEY;
    } else {
      process.env.FIREBASE_PROJECT_ID = 'synthetic-local-project';
      process.env.FIREBASE_PRIVATE_KEY = SECRET_KEY;
    }
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
      providers: [
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
        { provide: I18nService, useValue: { translate: (key: string) => key } },
        {
          provide: FirebaseService,
          useValue: {
            isEnabled: () => {
              if (firebaseMode === 'throws') throw new Error(PROBE_ERROR);
              return firebaseMode === 'enabled';
            },
          },
        },
        { provide: RedisService, useValue: { getStatus: () => cacheStatus } },
      ],
    })
      .overrideProvider(TypeOrmHealthIndicator)
      .useValue({
        pingCheck: async (key: string) => {
          if (dbMode === 'down') {
            throw new HealthCheckError('Database check failed', { [key]: { status: 'down', message: DB_ERROR } });
          }
          if (dbMode === 'throws') throw new TypeError(DB_ERROR);
          return { [key]: { status: 'up' } };
        },
      })
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  beforeEach(() => {
    dbMode = 'up';
    cacheStatus = 'disabled';
    setFirebase('disabled');
  });

  afterAll(async () => {
    for (const key of ['FIREBASE_PROJECT_ID', 'FIREBASE_PRIVATE_KEY'] as const) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    await app?.close();
  });

  const get = () => request(app.getHttpServer()).get('/api/v1/health');
  const expectNoInternals = (text: string) => {
    for (const needle of [SECRET_KEY, 'sentinel_db_user', 'password authentication', PROBE_ERROR, 'stack']) {
      expect(text).not.toContain(needle);
    }
  };

  it('deliberately disabled Firebase: 200, database up, firebase reported as disabled', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', details: { database: { status: 'up' } } });
    expect(res.body.integrations).toEqual({ firebase: 'disabled', cache: 'disabled' });
  });

  it('configured Firebase: 200 and reported as enabled, without credential material', async () => {
    setFirebase('enabled');
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.integrations).toMatchObject({ firebase: 'enabled' });
    expectNoInternals(res.text);
  });

  it('unexpected Firebase probe failure: still 200 (optional), reported as unknown, no exception text', async () => {
    setFirebase('throws');
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.integrations).toMatchObject({ firebase: 'unknown' });
    expectNoInternals(res.text);
  });

  it.each<FirebaseMode>(['disabled', 'enabled'])(
    'database down is never hidden: 503 with Firebase %s, and no driver message in the body',
    async (mode) => {
      setFirebase(mode);
      dbMode = 'down';
      const res = await get();
      expect(res.status).toBe(503);
      expectNoInternals(res.text);
    },
  );

  it('unexpected database-indicator error is never reported healthy and leaks nothing', async () => {
    dbMode = 'throws';
    const res = await get();
    expect(res.status).toBeGreaterThanOrEqual(500);
    expectNoInternals(res.text);
  });

  it.each(['connected', 'degraded'])('cache %s is reported and does not change readiness', async (status) => {
    cacheStatus = status;
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.integrations).toMatchObject({ cache: status });
  });
});
