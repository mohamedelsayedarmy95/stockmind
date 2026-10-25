/**
 * WP-C regression: Render's health check (GET /api/v1/health) must never be rate-limited, while every other route,
 * public auth routes included, keeps the global throttle and protected routes stay protected.
 * Uses the real THROTTLERS config and the AppModule guard order (ThrottlerGuard, then GlobalJwtGuard).
 * Without `trust proxy`, every client arrives from the proxy address, so the per-IP bucket is shared by all clients.
 */
import { Controller, Get, INestApplication, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { TerminusModule, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { HealthController } from '../../src/presentation/controllers/health.controller';
import { FirebaseService } from '../../src/infrastructure/firebase/firebase.service';
import { RedisService } from '../../src/infrastructure/cache/redis.service';
import { JwtStrategy } from '../../src/infrastructure/jwt.strategy';
import { GlobalJwtGuard } from '../../src/presentation/guards/global-auth.guard';
import { Public } from '../../src/presentation/decorators/public.decorator';
import { THROTTLERS } from '../../src/shared/constants/throttling.constant';

const LIMIT = THROTTLERS[0].limit;

@Controller('probe')
class ProbeController {
  @Public()
  @Post('login')
  login() {
    return { ok: true };
  }

  @Get('protected')
  protectedRoute() {
    return { secret: true };
  }
}

describe('WP-C: health endpoint and the global throttle', () => {
  let app: INestApplication;

  beforeEach(async () => {
    // A fresh app per test gives fresh throttle buckets.
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ({ JWT_ACCESS_SECRET: 'throttle-spec' })] }),
        ThrottlerModule.forRoot(THROTTLERS),
        TerminusModule,
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({}),
      ],
      controllers: [HealthController, ProbeController],
      providers: [
        JwtStrategy,
        // Series 09: the strategy re-reads the member; this probe has no database, so every token's member is an active Staff.
        { provide: DataSource, useValue: { query: async () => [{ company_id: 'c', role: 'Staff', status: 'active', token_version: 0 }] } },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: GlobalJwtGuard },
        { provide: FirebaseService, useValue: { isEnabled: () => false } },
        { provide: RedisService, useValue: { getStatus: () => 'disabled' } },
      ],
    })
      .overrideProvider(TypeOrmHealthIndicator)
      .useValue({ pingCheck: async (key: string) => ({ [key]: { status: 'up' } }) })
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  const burst = async (n: number, send: () => request.Test) => {
    const statuses: number[] = [];
    for (let i = 0; i < n; i++) statuses.push((await send()).status);
    return statuses;
  };

  it(`health stays 200 beyond the per-client limit (${LIMIT}/min)`, async () => {
    const statuses = await burst(LIMIT + 5, () => request(app.getHttpServer()).get('/api/v1/health'));
    expect(statuses.every((s) => s === 200)).toBe(true);
  });

  it('a public auth route keeps the throttle: request limit+1 gets 429', async () => {
    const statuses = await burst(LIMIT + 1, () => request(app.getHttpServer()).post('/api/v1/probe/login'));
    expect(statuses.slice(0, LIMIT).every((s) => s === 201)).toBe(true);
    expect(statuses[LIMIT]).toBe(429);
  });

  it('a protected route keeps both controls: 401 without a token, then 429, never 2xx', async () => {
    const statuses = await burst(LIMIT + 1, () => request(app.getHttpServer()).get('/api/v1/probe/protected'));
    expect(statuses.slice(0, LIMIT).every((s) => s === 401)).toBe(true);
    expect(statuses[LIMIT]).toBe(429);
  });

  it('the exemption is bound to the health handler only: an exhausted auth bucket leaves health at 200', async () => {
    await burst(LIMIT + 1, () => request(app.getHttpServer()).post('/api/v1/probe/login'));
    expect((await request(app.getHttpServer()).post('/api/v1/probe/login')).status).toBe(429);
    expect((await request(app.getHttpServer()).get('/api/v1/health')).status).toBe(200);
    for (const path of ['/api/v1/health/probe/protected', '/api/v1/health/../probe/protected', '/api/v1/healthz']) {
      const res = await request(app.getHttpServer()).get(path);
      // Either unrouted (404) or normalised onto the protected route (401): never a 2xx without a token.
      expect([401, 404]).toContain(res.status);
      expect(res.body.secret).toBeUndefined();
    }
  });
});
