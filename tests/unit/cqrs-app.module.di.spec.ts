import 'reflect-metadata';
import { WarehouseAccessService } from '../../src/infrastructure/security/warehouse-access.service';
import { Global, INestApplicationContext, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { CqrsAppModule } from '../../src/modules/cqrs-app.module';
import { FirebaseModule } from '../../src/modules/firebase.module';
import { AuditModule } from '../../src/modules/audit.module';
import { ContextModule } from '../../src/modules/context.module';
import { StockService } from '../../src/infrastructure/repositories/stock.service';
import { RedisService } from '../../src/infrastructure/cache/redis.service';
import { InboundStockHandler } from '../../src/application/commands/inbound-stock.handler';
import { GetMovementHistoryHandler } from '../../src/application/queries/get-movement-history.handler';

/**
 * Regression: after the FcmService fix, startup failed next with "Nest can't resolve
 * dependencies of the StockService (..., ?)" because RedisModule was never
 * imported where StockService is provided. The existing StockService tests pass a
 * RedisService mock to the constructor, so only real Nest DI resolution catches this.
 *
 * Mirrors AppModule's global modules; the DataSource is a stand-in so no database is needed.
 */

@Global()
@Module({
  providers: [
    {
      provide: DataSource,
      useValue: {
        entityMetadatas: [],
        options: { type: 'postgres' },
        getRepository: () => ({}),
      },
    },
    // Exported globally by RbacModule in AppModule; WarehouseService and the history handler depend on it.
    WarehouseAccessService,
  ],
  exports: [DataSource, WarehouseAccessService],
})
class FakeDataSourceModule {}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
    EventEmitterModule.forRoot(),
    FakeDataSourceModule,
    ContextModule,
    AuditModule,
    FirebaseModule,
    CqrsAppModule,
  ],
})
class DiRootModule {}

describe('CqrsAppModule DI graph', () => {
  let app: INestApplicationContext;

  beforeAll(async () => {
    app = await NestFactory.createApplicationContext(DiRootModule, { logger: false, abortOnError: false });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('resolves StockService with its RedisService dependency', () => {
    const stock = app.get(StockService);
    expect(stock).toBeInstanceOf(StockService);
    expect((stock as unknown as { redisService: unknown }).redisService).toBeInstanceOf(RedisService);
  });

  it('resolves the stock command and query handlers that depend on it', () => {
    expect(app.get(InboundStockHandler)).toBeInstanceOf(InboundStockHandler);
    expect(app.get(GetMovementHistoryHandler)).toBeInstanceOf(GetMovementHistoryHandler);
  });
});
