import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';

// The cache is an optimisation: Redis must never hold up startup for long, retry forever, or serve entries that
// may have missed an invalidation. Every failure therefore falls back to the database.
const STARTUP_TIMEOUT_MS = 3000; // TCP connect + handshake + ready check
const COMMAND_TIMEOUT_MS = 500; // a slow cache must not slow requests down
const MAX_RECONNECT_ATTEMPTS = 3; // after a drop (about 1.2 s in total); then the cache is disabled for this process
const GENERATION_TTL_S = 24 * 60 * 60; // far longer than any entry TTL; an idle scope then simply starts afresh

export type CacheStatus = 'disabled' | 'connected' | 'degraded';

// On an already-ended client, disconnect() only arms ioredis' 2 s disconnect timer and delays process exit.
const release = (client: Redis) => {
  if (client.status !== 'end') client.disconnect();
};

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private redis: Redis | null = null;
  private readonly isEnabled: boolean;
  private readonly redisUrl: string;

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      this.logger.warn('REDIS_URL is not set. Redis caching is disabled.');
      this.isEnabled = false;
      this.redisUrl = ''; // dummy value, won't be used
      return;
    }
    this.isEnabled = true;
    this.redisUrl = redisUrl;
  }

  async onModuleInit() {
    if (!this.isEnabled) {
      return;
    }

    let connectedOnce = false;
    const client = new Redis(this.redisUrl, {
      lazyConnect: true,
      connectTimeout: STARTUP_TIMEOUT_MS,
      commandTimeout: COMMAND_TIMEOUT_MS,
      // Fail fast while disconnected instead of queueing commands behind reconnect attempts.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      // No retry before the first connection; a few short ones after a drop, then 'end' disables the cache.
      retryStrategy: (attempt) => (connectedOnce && attempt <= MAX_RECONNECT_ATTEMPTS ? attempt * 200 : null),
    });

    // Without an 'error' listener ioredis prints "Unhandled error event" for every failed attempt.
    let errorLogged = false;
    client.on('error', (error: Error) => {
      if (errorLogged) return;
      errorLogged = true;
      this.logger.warn(`Redis connection error: ${error.message}`);
    });
    client.on('ready', () => {
      connectedOnce = true;
      errorLogged = false;
    });
    client.on('end', () => {
      if (this.redis === client) this.disable('the connection was lost and could not be re-established');
    });

    const connecting = client.connect();
    connecting.catch(() => undefined); // settled by the race below; never an unhandled rejection
    let deadline: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        connecting,
        new Promise<never>((_, reject) => {
          deadline = setTimeout(
            () => reject(new Error(`no ready connection within ${STARTUP_TIMEOUT_MS} ms`)),
            STARTUP_TIMEOUT_MS,
          );
        }),
      ]);
      this.redis = client;
      this.logger.log('Redis connected successfully');
    } catch (error) {
      release(client);
      this.logger.error(
        `Redis unavailable at startup (${error instanceof Error ? error.message : String(error)}). ` +
          'Caching is disabled for this process; requests use the database.',
      );
    } finally {
      clearTimeout(deadline);
    }
  }

  async onModuleDestroy() {
    const client = this.redis;
    this.redis = null; // a shutdown is not a failure: keeps the 'end' listener quiet
    if (!client) {
      return;
    }
    try {
      await client.quit();
    } catch {
      client.disconnect();
    }
  }

  /** 'disabled': REDIS_URL unset. 'degraded': configured but not usable now (requests use the database). */
  getStatus(): CacheStatus {
    if (!this.isEnabled) return 'disabled';
    return this.redis?.status === 'ready' ? 'connected' : 'degraded';
  }

  private readyClient(): Redis | null {
    return this.redis?.status === 'ready' ? this.redis : null;
  }

  // Stops using the cache for the rest of the process and releases the client (no background reconnects).
  private disable(reason: string): void {
    const client = this.redis;
    if (!client) return;
    this.redis = null;
    release(client);
    this.logger.error(`Redis cache disabled for this process: ${reason}. Requests use the database.`);
  }

  async get(key: string): Promise<string | null> {
    const client = this.readyClient();
    if (!client) {
      return null;
    }
    try {
      return await client.get(key);
    } catch (error) {
      this.logger.warn(`Redis GET error for key ${key}`, error);
      return null;
    }
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    const client = this.readyClient();
    if (!client) {
      return;
    }
    try {
      if (ttl) {
        await client.setex(key, ttl, value);
      } else {
        await client.set(key, value);
      }
    } catch (error) {
      this.logger.warn(`Redis SET error for key ${key}`, error);
    }
  }

  async del(key: string): Promise<void> {
    const client = this.redis;
    if (!client) {
      return;
    }
    try {
      await client.del(key);
    } catch (error) {
      // A missed invalidation could leave a stale entry behind, so the cache can no longer be trusted.
      this.disable(`invalidation of ${key} failed (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  /**
   * Current generation of a cache scope, created on first use. Callers put it in their keys and read it BEFORE
   * the source of truth. Null when the cache is unusable: the caller must then neither read nor write entries.
   */
  async getGeneration(scope: string): Promise<string | null> {
    const client = this.readyClient();
    if (!client) {
      return null;
    }
    const key = `cache:generation:${scope}`;
    try {
      const current = await client.get(key);
      if (current !== null) return current;
      // NX: a generation set concurrently by a writer wins.
      await client.set(key, randomUUID(), 'EX', GENERATION_TTL_S, 'NX');
      return await client.get(key);
    } catch (error) {
      this.logger.warn(`Redis generation read failed for ${scope}`, error);
      return null;
    }
  }

  /** Moves a scope to a new generation, so entries cached under the previous one are never read again. */
  async bumpGeneration(scope: string): Promise<void> {
    const client = this.redis;
    if (!client) {
      return;
    }
    try {
      await client.set(`cache:generation:${scope}`, randomUUID(), 'EX', GENERATION_TTL_S);
    } catch (error) {
      // The old generation would stay readable, so the cache can no longer be trusted.
      this.disable(`generation bump for ${scope} failed (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  /**
   * Generate a standardized cache key from prefix and arguments
   * @param prefix - The prefix for the key (e.g., 'stock:balance')
   * @param args - Additional parts to append to the key
   * @returns A string key in the format 'prefix:arg1:arg2:...'
   */
  generateKey(prefix: string, ...args: string[]): string {
    return [prefix, ...args.filter(arg => arg !== undefined && arg !== null)].join(':');
  }
}
