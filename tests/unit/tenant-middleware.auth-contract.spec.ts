/**
 * F1 regression: TenantMiddleware must not decide access. It runs before routing, so it cannot see @Public();
 * GlobalJwtGuard is the single enforcement point. The probe app mirrors main.ts (global prefix) and
 * AppModule (TenantMiddleware bound with forRoutes('*'), GlobalJwtGuard + JwtStrategy as APP_GUARD).
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { Controller, Get, INestApplication, MiddlewareConsumer, Module, NestModule, Post, Req, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { ContextModule } from '../../src/modules/context.module';
import { TenantContextService } from '../../src/infrastructure/context/tenant-context.service';
import { JwtStrategy } from '../../src/infrastructure/jwt.strategy';
import { GlobalJwtGuard } from '../../src/presentation/guards/global-auth.guard';
import { IS_PUBLIC_KEY, Public } from '../../src/presentation/decorators/public.decorator';
import { TenantMiddleware } from '../../src/presentation/middleware/tenant.middleware';

const SECRET = 'tenant-middleware-spec-secret';
const COMPANY_A = '11111111-1111-4111-8111-111111111111';
const COMPANY_B = '22222222-2222-4222-8222-222222222222';
const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

@Controller('probe')
class ProbeController {
  constructor(private readonly ctx: TenantContextService) {}

  @Public()
  @Get('public')
  publicGet() {
    return { context: this.ctx.get() ?? null };
  }

  @Public()
  @Post('public')
  publicPost() {
    return { context: this.ctx.get() ?? null };
  }

  @Get('protected')
  async protectedGet(@Req() req: { user?: unknown }) {
    // Yield once so concurrent requests interleave; the context must survive the async hop.
    await new Promise((resolve) => setImmediate(resolve));
    return { context: this.ctx.get() ?? null, user: req.user ?? null };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ({ JWT_ACCESS_SECRET: SECRET })] }),
    ContextModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}),
  ],
  controllers: [ProbeController],
  providers: [
    JwtStrategy,
    // Series 09: JwtStrategy re-reads the member. The probe has no database: each user is an active Staff of its own company.
    {
      provide: DataSource,
      useValue: {
        query: async (_sql: string, [id]: [string]) => {
          const company = id === USER_A ? COMPANY_A : id === USER_B ? COMPANY_B : null;
          return company ? [{ company_id: company, role: 'Staff', status: 'active', token_version: 0 }] : [];
        },
      },
    },
    { provide: APP_GUARD, useClass: GlobalJwtGuard },
  ],
})
class ProbeAppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}

describe('F1: TenantMiddleware and GlobalJwtGuard route contract', () => {
  let app: INestApplication;
  let jwt: JwtService;

  const sign = (sub: string, companyId: string, secret = SECRET, expiresIn: string | number = '5m') =>
    jwt.sign({ sub, companyId, role: 'Staff' }, { secret, expiresIn });
  const unsignedToken = () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: USER_B, companyId: COMPANY_B, role: 'Admin' })}.`;
  };

  // ConfigService prefers process.env over `load`, so an ambient JWT_ACCESS_SECRET (CI sets one) would replace SECRET.
  const ambientSecret = process.env.JWT_ACCESS_SECRET;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = SECRET;
    const moduleRef = await Test.createTestingModule({ imports: [ProbeAppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    await app.init();
    jwt = app.get(JwtService);
  });

  afterAll(async () => {
    await app?.close();
    if (ambientSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
    else process.env.JWT_ACCESS_SECRET = ambientSecret;
  });

  describe('@Public routes are reachable without a valid token', () => {
    it('GET without Authorization returns 200 and no tenant context', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/probe/public');
      expect(res.status).toBe(200);
      expect(res.body.context).toBeNull();
    });

    it('POST without Authorization returns 201', async () => {
      const res = await request(app.getHttpServer()).post('/api/v1/probe/public').send({});
      expect(res.status).toBe(201);
      expect(res.body.context).toBeNull();
    });

    it.each([
      ['expired', () => `Bearer ${sign(USER_A, COMPANY_A, SECRET, -60)}`],
      ['wrong signature', () => `Bearer ${sign(USER_B, COMPANY_B, 'attacker-secret')}`],
      ['garbage', () => 'Bearer not-a-jwt'],
    ])('a stale or invalid %s Bearer token does not block a public route and builds no context', async (_label, header) => {
      const res = await request(app.getHttpServer()).get('/api/v1/probe/public').set('Authorization', header());
      expect(res.status).toBe(200);
      expect(res.body.context).toBeNull();
    });

    it('a valid token on a public route still builds the caller context', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/probe/public')
        .set('Authorization', `Bearer ${sign(USER_A, COMPANY_A)}`);
      expect(res.status).toBe(200);
      expect(res.body.context).toMatchObject({ userId: USER_A, companyId: COMPANY_A });
    });
  });

  describe('protected routes still reject unauthenticated requests', () => {
    it.each([
      ['no header', undefined],
      ['Basic scheme', () => 'Basic dXNlcjpwYXNz'],
      ['empty Bearer', () => 'Bearer'],
      ['garbage', () => 'Bearer not-a-jwt'],
      ['wrong signature claiming another company', () => `Bearer ${sign(USER_B, COMPANY_B, 'attacker-secret')}`],
      ['expired', () => `Bearer ${sign(USER_A, COMPANY_A, SECRET, -60)}`],
      ['alg none', () => `Bearer ${unsignedToken()}`],
    ])('%s returns 401', async (_label, header) => {
      const req = request(app.getHttpServer()).get('/api/v1/probe/protected');
      const res = await (header ? req.set('Authorization', header()) : req);
      expect(res.status).toBe(401);
      expect(res.body.context).toBeUndefined();
    });

    it('a token in the query string is not accepted', async () => {
      const res = await request(app.getHttpServer()).get(`/api/v1/probe/protected?access_token=${sign(USER_A, COMPANY_A)}`);
      expect(res.status).toBe(401);
    });

    it.each([
      ['trailing slash', '/api/v1/probe/protected/'],
      ['upper case', '/api/v1/PROBE/PROTECTED'],
      ['query string', '/api/v1/probe/protected?isPublic=true'],
    ])('route variation (%s) without a token returns 401', async (_label, url) => {
      const res = await request(app.getHttpServer()).get(url);
      expect(res.status).toBe(401);
    });

    it.each([
      ['encoded segment', '/api/v1/probe/%70rotected'],
      ['double slash', '/api/v1//probe/protected'],
      ['dot segment', '/api/v1/probe/public/../protected'],
      ['public prefix', '/api/v1/probe/public/protected'],
      ['missing global prefix', '/probe/protected'],
    ])('route variation (%s) without a token never reaches a handler', async (_label, url) => {
      const res = await request(app.getHttpServer()).get(url);
      expect([401, 404]).toContain(res.status);
      expect(res.body.context).toBeUndefined();
    });

    it('HEAD on a protected GET route returns 401', async () => {
      const res = await request(app.getHttpServer()).head('/api/v1/probe/protected');
      expect(res.status).toBe(401);
    });
  });

  describe('tenant context always matches the authenticated identity', () => {
    it.each([
      ['canonical', (t: string) => `Bearer ${t}`],
      ['lower-case scheme (accepted by the guard)', (t: string) => `bearer ${t}`],
      ['extra whitespace (accepted by the guard)', (t: string) => `Bearer   ${t}`],
    ])('%s: when the guard accepts the token, the context carries the same user and company', async (_label, format) => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/probe/protected')
        .set('Authorization', format(sign(USER_A, COMPANY_A)));
      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({ sub: USER_A, companyId: COMPANY_A });
      expect(res.body.context).toMatchObject({ userId: USER_A, companyId: COMPANY_A, role: 'Staff' });
    });

    it('concurrent requests from two companies never see each other context', async () => {
      const tokenA = sign(USER_A, COMPANY_A);
      const tokenB = sign(USER_B, COMPANY_B);
      const calls = Array.from({ length: 20 }, (_, i) => {
        const [token, userId, companyId] = i % 2 ? [tokenB, USER_B, COMPANY_B] : [tokenA, USER_A, COMPANY_A];
        return request(app.getHttpServer())
          .get('/api/v1/probe/protected')
          .set('Authorization', `Bearer ${token}`)
          .then((res) => ({ res, userId, companyId }));
      });
      for (const { res, userId, companyId } of await Promise.all(calls)) {
        expect(res.status).toBe(200);
        expect(res.body.context).toMatchObject({ userId, companyId });
        expect(res.body.user).toMatchObject({ sub: userId, companyId });
      }
    });
  });
});

describe('F1: @Public route allowlist on the real controllers', () => {
  // Every route not listed here must stay behind GlobalJwtGuard. Adding a public route is a deliberate contract change.
  const EXPECTED_PUBLIC = [
    'GET /auth/saml/login',
    'GET /auth/saml/logout',
    'GET /health',
    'POST /auth/2fa/login',
    'POST /auth/accept-invitation',
    'POST /auth/google',
    'POST /auth/login',
    'POST /auth/refresh-token',
    'POST /auth/register',
    'POST /auth/saml/callback',
  ];

  it('only the documented routes are marked @Public()', () => {
    const dir = path.join(__dirname, '../../src/presentation/controllers');
    const publicRoutes: string[] = [];
    let protectedCount = 0;

    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.controller.ts'))) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const exported = require(path.join(dir, file)) as Record<string, unknown>;
      for (const cls of Object.values(exported)) {
        if (typeof cls !== 'function') continue;
        const base = Reflect.getMetadata(PATH_METADATA, cls) as string | undefined;
        if (base === undefined) continue;
        const proto = (cls as { prototype: Record<string, unknown> }).prototype;
        for (const name of Object.getOwnPropertyNames(proto)) {
          const handler = proto[name];
          if (typeof handler !== 'function' || name === 'constructor') continue;
          const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
          if (method === undefined) continue;
          const sub = (Reflect.getMetadata(PATH_METADATA, handler) as string | undefined) ?? '/';
          const route = `${RequestMethod[method]} /${[base, sub].map((p) => p.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/')}`;
          const isPublic = Reflect.getMetadata(IS_PUBLIC_KEY, handler) ?? Reflect.getMetadata(IS_PUBLIC_KEY, cls);
          if (isPublic) publicRoutes.push(route);
          else protectedCount++;
        }
      }
    }

    expect(publicRoutes.sort()).toEqual(EXPECTED_PUBLIC);
    expect(protectedCount).toBeGreaterThan(0);
  });
});
