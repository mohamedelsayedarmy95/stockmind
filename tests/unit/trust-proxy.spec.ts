/**
 * TRUST_PROXY_HOPS policy. Production chain observed in the Render logs (one external request, 2026-10-18):
 * client -> Cloudflare -> Render load balancer -> local proxy (TCP peer ::1) -> app, with
 * X-Forwarded-For = "client, cloudflare, render-lb". In these tests the TCP peer is loopback, like production.
 */
import { Controller, Get, INestApplication, Req } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import * as request from 'supertest';
import { applyTrustProxy, trustProxyHops } from '../../src/shared/http/trust-proxy';
import { THROTTLERS } from '../../src/shared/constants/throttling.constant';

const LIMIT = THROTTLERS[0].limit;
const chain = (client: string) => `${client}, 172.70.163.147, 10.25.239.2`; // client, Cloudflare, Render LB

@Controller('probe')
class ProbeController {
  @Get('ip')
  ip(@Req() req: { ip: string }) {
    return { ip: req.ip };
  }
}

async function makeApp(hops?: string): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot(THROTTLERS)],
    controllers: [ProbeController],
    providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  applyTrustProxy(app, hops);
  await app.init();
  return app;
}

describe('TRUST_PROXY_HOPS parsing', () => {
  it.each([[undefined, null], ['', null], ['3', 3], [' 3 ', 3]])('%p -> %p', (raw, expected) => {
    expect(trustProxyHops(raw as string | undefined)).toBe(expected);
  });

  it.each(['true', '0', '-1', '1.5', 'abc', '10', 'loopback'])('rejects %p (boot must fail rather than trust blindly)', (raw) => {
    expect(() => trustProxyHops(raw)).toThrow('TRUST_PROXY_HOPS');
  });
});

describe('client identity and rate-limit keys', () => {
  let app: INestApplication | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });
  const ip = async (xff?: string) => {
    const req = request(app!.getHttpServer()).get('/probe/ip');
    return (await (xff ? req.set('X-Forwarded-For', xff) : req)).body.ip as string;
  };

  it('default (unset): X-Forwarded-For is ignored, so every client gets the proxy address', async () => {
    app = await makeApp(undefined);
    expect(await ip(chain('198.51.100.1'))).toMatch(/127\.0\.0\.1$/);
    expect(await ip(chain('198.51.100.2'))).toMatch(/127\.0\.0\.1$/);
  });

  it('3 hops: the client address is the entry Cloudflare appended', async () => {
    app = await makeApp('3');
    expect(await ip(chain('198.51.100.1'))).toBe('198.51.100.1');
  });

  it('3 hops: a forged leading X-Forwarded-For entry is ignored', async () => {
    app = await makeApp('3');
    expect(await ip(`6.6.6.6, ${chain('198.51.100.1')}`)).toBe('198.51.100.1');
  });

  it('3 hops: no X-Forwarded-For (e.g. the Render health checker) falls back to the TCP peer', async () => {
    app = await makeApp('3');
    expect(await ip()).toMatch(/127\.0\.0\.1$/);
  });

  it('3 hops: each client gets its own throttle bucket', async () => {
    app = await makeApp('3');
    for (let i = 0; i < LIMIT; i++) {
      await request(app.getHttpServer()).get('/probe/ip').set('X-Forwarded-For', chain('198.51.100.1')).expect(200);
    }
    await request(app.getHttpServer()).get('/probe/ip').set('X-Forwarded-For', chain('198.51.100.1')).expect(429);
    await request(app.getHttpServer()).get('/probe/ip').set('X-Forwarded-For', chain('198.51.100.2')).expect(200);
  });

  it('known limit: if Cloudflare is bypassed (one hop fewer), a forged entry becomes the client address', async () => {
    app = await makeApp('3');
    // Attacker -> Render LB directly: only the LB appends (the attacker's real address), giving
    // "forged, attacker-real" plus the loopback peer. With 3 trusted hops the forged entry is selected,
    // so TRUST_PROXY_HOPS=3 is only safe if the origin cannot be reached without Cloudflare.
    expect(await ip('6.6.6.6, 203.0.113.9')).toBe('6.6.6.6');
  });
});
