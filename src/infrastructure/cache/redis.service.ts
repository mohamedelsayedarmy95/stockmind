import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import Redis from 'ioredis';

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

    try {
      this.redis = new Redis(this.redisUrl);
      // Test the connection
      await this.redis.ping();
      this.logger.log('Redis connected successfully');
    } catch (error) {
      this.logger.error('Failed to connect to Redis', error);
      this.redis = null;
      // Graceful degradation: continue without Redis
    }
  }

  async onModuleDestroy() {
    if (this.redis) {
      await this.redis.quit();
    }
  }

  private isAvailable(): boolean {
    return this.isEnabled && this.redis !== null;
  }

  async get(key: string): Promise<string | null> {
    if (!this.isAvailable()) {
      return null;
    }
    try {
      return await this.redis!.get(key);
    } catch (error) {
      this.logger.warn(`Redis GET error for key ${key}`, error);
      return null;
    }
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    if (!this.isAvailable()) {
      return;
    }
    try {
      if (ttl) {
        await this.redis!.setex(key, ttl, value);
      } else {
        await this.redis!.set(key, value);
      }
    } catch (error) {
      this.logger.warn(`Redis SET error for key ${key}`, error);
    }
  }

  async del(key: string): Promise<void> {
    if (!this.isAvailable()) {
      return;
    }
    try {
      await this.redis!.del(key);
    } catch (error) {
      this.logger.warn(`Redis DEL error for key ${key}`, error);
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