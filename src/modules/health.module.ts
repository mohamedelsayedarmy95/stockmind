import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from '../presentation/controllers/health.controller';
import { RedisModule } from '../infrastructure/cache/redis.module';

@Module({
  // RedisModule is shared with CqrsAppModule, so the health check reports the same RedisService instance.
  imports: [TerminusModule, RedisModule],
  controllers: [HealthController],
})
export class HealthModule {}
