/**
 * Request logs must not contain credentials. Production logs every completed request with its headers (pino-http),
 * so without redaction each authenticated request writes its Bearer access token to the log store.
 * Uses the real httpLoggerOptions() that AppModule passes to LoggerModule.
 */
import * as http from 'http';
import { AddressInfo } from 'net';
import { Writable } from 'stream';
import { pinoHttp } from 'pino-http';
import { httpLoggerOptions } from '../../src/shared/logging/http-logger.options';

const ACCESS_TOKEN = 'SENTINEL.ACCESS.TOKEN';
const REQUEST_COOKIE = 'sid=SENTINEL_REQUEST_COOKIE';
const RESPONSE_COOKIE = 'session=SENTINEL_RESPONSE_COOKIE';
const REFRESH_TOKEN = 'SENTINEL_REFRESH_TOKEN';
const SHADOW_TOKEN = 'SENTINEL_SHADOW_DIAGNOSTICS_TOKEN_0123456789';

describe('HTTP request logging redacts credentials', () => {
  let server: http.Server;
  let port: number;
  const lines: string[] = [];

  beforeAll(async () => {
    const sink = new Writable({
      write(chunk, _enc, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    // In development the options add a pino-pretty transport, which writes from a worker thread instead of to this
    // sink. Redaction happens before any transport, so the test drops it and checks the same redaction everywhere.
    const logger = pinoHttp({ ...httpLoggerOptions(), transport: undefined }, sink);
    server = http.createServer((req, res) => {
      logger(req, res);
      req.resume();
      req.on('end', () => {
        res.setHeader('set-cookie', RESPONSE_COOKIE);
        res.end('ok');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const send = () =>
    new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1', port, method: 'POST', path: '/api/v1/auth/refresh-token',
          headers: {
            authorization: `Bearer ${ACCESS_TOKEN}`,
            cookie: REQUEST_COOKIE,
            'x-shadow-diagnostics-token': SHADOW_TOKEN, // Series 13: the operator token of the shadow diagnostics
            'content-type': 'application/json',
            'x-forwarded-for': '203.0.113.7',
          },
        },
        (res) => { res.resume(); res.on('end', resolve); },
      );
      req.on('error', reject);
      req.end(JSON.stringify({ refreshToken: REFRESH_TOKEN }));
    });

  it('logs the request without the Authorization header, cookies or body', async () => {
    await send();
    const entry = lines.map((l) => JSON.parse(l)).find((l) => l.msg === 'request completed');
    expect(entry).toBeDefined();
    const raw = JSON.stringify(entry);
    for (const secret of [ACCESS_TOKEN, 'SENTINEL_REQUEST_COOKIE', 'SENTINEL_RESPONSE_COOKIE', REFRESH_TOKEN, SHADOW_TOKEN]) {
      expect(raw).not.toContain(secret);
    }
    expect(entry.req.headers.authorization).toBe('[Redacted]');
    expect(entry.req.headers['x-shadow-diagnostics-token']).toBe('[Redacted]');
    // Still useful for operations: method, path, status and proxy headers remain.
    expect(entry.req.url).toBe('/api/v1/auth/refresh-token');
    expect(entry.req.headers['x-forwarded-for']).toBe('203.0.113.7');
    expect(entry.res.statusCode).toBe(200);
  });
});
