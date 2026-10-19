/**
 * Redis resilience: real ioredis client against real loopback sockets (no Redis server is installed locally).
 * Failure modes: connection refused, server closing every connection, server that never answers, and a connection
 * lost after a successful start. The "server" in the last two cases is a minimal RESP stub, not Redis.
 */
import * as net from 'net';
import { RedisService } from '../../src/infrastructure/cache/redis.service';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const TIMEOUT = Symbol('timeout');
const within = <T>(promise: Promise<T>, ms: number) => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};
const statusOf = (svc: RedisService) => (svc as unknown as { getStatus?: () => string }).getStatus?.();

interface TestServer {
  port: number;
  connections: () => number;
  openSockets: () => number;
  close: () => Promise<void>;
}

/** behaviour: 'destroy' closes every connection at once, 'hang' never answers, 'resp' speaks minimal RESP. */
function startServer(behaviour: 'destroy' | 'hang' | 'resp', port = 0): Promise<TestServer> {
  let connections = 0;
  const sockets = new Set<net.Socket>();
  const store = new Map<string, string>();
  const server = net.createServer((socket) => {
    connections++;
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    if (behaviour === 'destroy') return void socket.destroy();
    // Reads (so the client's FIN is seen) but never answers.
    if (behaviour === 'hang') return void socket.resume();
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('latin1');
      for (let parsed = parseCommand(buffer); parsed; parsed = parseCommand(buffer)) {
        buffer = buffer.slice(parsed.used);
        socket.write(reply(parsed.args, store, socket));
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({
        port: (server.address() as net.AddressInfo).port,
        connections: () => connections,
        openSockets: () => sockets.size,
        close: () =>
          new Promise<void>((done) => {
            sockets.forEach((s) => s.destroy());
            server.close(() => done());
          }),
      });
    });
  });
}

function parseCommand(input: string): { args: string[]; used: number } | null {
  if (!input.startsWith('*')) return null;
  let eol = input.indexOf('\r\n');
  if (eol < 0) return null;
  const count = Number(input.slice(1, eol));
  let pos = eol + 2;
  const args: string[] = [];
  for (let i = 0; i < count; i++) {
    eol = input.indexOf('\r\n', pos);
    if (eol < 0) return null;
    const len = Number(input.slice(pos + 1, eol));
    const start = eol + 2;
    if (input.length < start + len + 2) return null;
    args.push(input.slice(start, start + len));
    pos = start + len + 2;
  }
  return { args, used: pos };
}

function reply(args: string[], store: Map<string, string>, socket: net.Socket): string {
  const bulk = (s: string) => `$${Buffer.byteLength(s)}\r\n${s}\r\n`;
  switch (args[0].toLowerCase()) {
    case 'info': return bulk('# Server\r\nredis_version:7.2.0\r\nloading:0\r\n');
    case 'ping': return '+PONG\r\n';
    case 'get': return store.has(args[1]) ? bulk(store.get(args[1])!) : '$-1\r\n';
    case 'set': {
      // SET key value [EX seconds] [NX]
      if (args.some((a) => a.toUpperCase() === 'NX') && store.has(args[1])) return '$-1\r\n';
      store.set(args[1], args[2]);
      return '+OK\r\n';
    }
    case 'setex': store.set(args[1], args[3]); return '+OK\r\n';
    case 'del': return `:${args.slice(1).filter((k) => store.delete(k)).length}\r\n`;
    case 'quit': setImmediate(() => socket.end()); return '+OK\r\n';
    default: return '+OK\r\n';
  }
}

async function refusedPort(): Promise<number> {
  const server = await startServer('hang');
  await server.close();
  return server.port;
}

describe('RedisService resilience (real loopback sockets)', () => {
  const services: RedisService[] = [];
  const servers: TestServer[] = [];
  const savedUrl = process.env.REDIS_URL;

  const create = (port: number) => {
    process.env.REDIS_URL = `redis://127.0.0.1:${port}`;
    const svc = new RedisService();
    services.push(svc);
    return svc;
  };

  afterEach(async () => {
    await Promise.all(services.splice(0).map((s) => s.onModuleDestroy().catch(() => undefined)));
    await Promise.all(servers.splice(0).map((s) => s.close()));
  });

  afterAll(() => {
    if (savedUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = savedUrl;
  });

  it('connection refused at startup: init is fast, cache degrades, calls are harmless no-ops', async () => {
    const svc = create(await refusedPort());
    const started = Date.now();
    expect(await within(svc.onModuleInit(), 5000)).not.toBe(TIMEOUT);
    expect(Date.now() - started).toBeLessThan(1500);
    expect(statusOf(svc)).toBe('degraded');
    expect(await svc.get('stock:movements:v2:x')).toBeNull();
    await expect(svc.set('k', 'v', 30)).resolves.toBeUndefined();
    await expect(svc.del('k')).resolves.toBeUndefined();
  }, 10000);

  it('server closing every connection: exactly one attempt, no background reconnect loop', async () => {
    const server = await startServer('destroy');
    servers.push(server);
    const svc = create(server.port);
    await within(svc.onModuleInit(), 5000);
    await sleep(1500);
    expect(server.connections()).toBe(1);
    expect(statusOf(svc)).toBe('degraded');
  }, 10000);

  it('server that never answers: startup is bounded and the socket is released', async () => {
    const server = await startServer('hang');
    servers.push(server);
    const svc = create(server.port);
    const started = Date.now();
    expect(await within(svc.onModuleInit(), 6000)).not.toBe(TIMEOUT);
    expect(Date.now() - started).toBeLessThan(4000);
    await sleep(300);
    expect(server.openSockets()).toBe(0);
    expect(statusOf(svc)).toBe('degraded');
  }, 10000);

  // "[ioredis] Unhandled error event" output is not testable here: ioredis checks `error instanceof Error`, and
  // socket errors come from Node's realm, not the jest sandbox. It is measured against the built app instead.

  it('connection lost after a good start: reads fail fast, a failed invalidation disables the cache, no reconnect loop', async () => {
    const server = await startServer('resp');
    const svc = create(server.port);
    await svc.onModuleInit();
    await svc.set('stock:movements:v2:c1:p1:all', '[]', 30);
    expect(await svc.get('stock:movements:v2:c1:p1:all')).toBe('[]');

    await server.close();
    const read = await within(svc.get('stock:movements:v2:c1:p1:all'), 1500);
    expect(read).toBeNull();
    expect(await within(svc.del('stock:movements:v2:c1:p1:all'), 1500)).not.toBe(TIMEOUT);
    expect(statusOf(svc)).toBe('degraded');

    // Nothing may reconnect later and serve entries that missed the failed invalidation.
    const reopened = await startServer('resp', server.port);
    servers.push(reopened);
    await sleep(2000);
    expect(reopened.connections()).toBe(0);
    expect(await svc.get('stock:movements:v2:c1:p1:all')).toBeNull();
  }, 15000);

  it('cache generation: created once, stable between reads, replaced by a bump (F2)', async () => {
    const server = await startServer('resp');
    servers.push(server);
    const svc = create(server.port);
    await svc.onModuleInit();
    const first = await svc.getGeneration('stock:p1');
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(await svc.getGeneration('stock:p1')).toBe(first);
    await svc.bumpGeneration('stock:p1');
    const second = await svc.getGeneration('stock:p1');
    expect(second).not.toBe(first);
    expect(statusOf(svc)).toBe('connected');
  }, 10000);

  it('a generation bump that cannot reach Redis disables the cache (F2)', async () => {
    const server = await startServer('resp');
    const svc = create(server.port);
    await svc.onModuleInit();
    expect(await svc.getGeneration('stock:p1')).not.toBeNull();
    await server.close();
    expect(await within(svc.bumpGeneration('stock:p1'), 1500)).not.toBe(TIMEOUT);
    expect(statusOf(svc)).toBe('degraded');
    expect(await svc.getGeneration('stock:p1')).toBeNull();
    // Disabling a client that is between reconnect attempts leaves one bounded ioredis timer (disconnectTimeout,
    // 2 s) for the already-closed socket; it cannot be cancelled through the public API. Let it run out here.
    await sleep(2100);
  }, 10000);

  it('shutdown closes a healthy connection promptly', async () => {
    const server = await startServer('resp');
    servers.push(server);
    const svc = create(server.port);
    await svc.onModuleInit();
    await svc.set('k', 'v', 30);
    expect(await svc.get('k')).toBe('v');
    const started = Date.now();
    expect(await within(svc.onModuleDestroy(), 3000)).not.toBe(TIMEOUT);
    expect(Date.now() - started).toBeLessThan(1000);
    await sleep(200);
    expect(server.openSockets()).toBe(0);
  }, 10000);
});
