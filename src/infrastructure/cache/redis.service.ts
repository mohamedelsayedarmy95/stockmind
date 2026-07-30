import { Injectable } from '@nestjs/common';

@Injectable()
export class RedisService {
  async get(key: string): Promise<string | null> {
    // TODO: Implement Redis GET
    return null;
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    // TODO: Implement Redis SET with optional TTL
    return;
  }

  async del(key: string): Promise<void> {
    // TODO: Implement Redis DEL
    return;
  }
}