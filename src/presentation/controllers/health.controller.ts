import { Controller, Get, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../presentation/decorators/public.decorator';
import { GLOBAL_THROTTLER } from '../../shared/constants/throttling.constant';
import { FirebaseService } from '../../infrastructure/firebase/firebase.service';
import { RedisService } from '../../infrastructure/cache/redis.service';

/**
 * Readiness check used as Render's healthCheckPath. Only the database is mandatory: when it is down the
 * response is 503. Firebase push and the Redis cache are optional, so their state is reported under
 * `integrations` but never changes the status code.
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly firebase: FirebaseService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @Public()
  // Render's health check must never get 429: without `trust proxy`, all clients share one per-IP bucket.
  @SkipThrottle({ [GLOBAL_THROTTLER]: true })
  @HealthCheck()
  @ApiOperation({ summary: 'Health check endpoint' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  @ApiResponse({ status: 503, description: 'Database unavailable' })
  async check() {
    const result = await this.health.check([() => this.db.pingCheck('database')]);
    return {
      ...result,
      integrations: {
        firebase: this.probe('firebase', () => (this.firebase.isEnabled() ? 'enabled' : 'disabled')),
        cache: this.probe('cache', () => this.redis.getStatus()),
      },
    };
  }

  // An optional probe that fails is reported as 'unknown'; its error stays in the server log.
  private probe(name: string, read: () => string): string {
    try {
      return read();
    } catch (error) {
      this.logger.warn(`Health probe '${name}' failed: ${error instanceof Error ? error.message : String(error)}`);
      return 'unknown';
    }
  }
}
