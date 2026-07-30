import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { Public } from '../../presentation/decorators/public.decorator';
import { isFirebaseConfigured } from '../../infrastructure/firebase/firebase-admin';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
  ) {}

  @Get()
  @Public()
  @HealthCheck()
  @ApiOperation({ summary: 'Health check endpoint' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  check() {
    return this.health.check([
      () => this.db.pingCheck('database'),
      () => {
        const firebaseReady = isFirebaseConfigured();
        if (firebaseReady) {
          return Promise.resolve({ firebase: { status: 'up' } });
        } else {
          return Promise.reject(new Error('Firebase not configured'));
        }
      },
    ]);
  }
}