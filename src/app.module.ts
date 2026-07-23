import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { LoggerModule } from 'nestjs-pino';
import { I18nModule, AcceptLanguageResolver, QueryResolver } from 'nestjs-i18n';
import * as path from 'path';

import { AuthModule } from './modules/auth.module';
import { SamlModule } from './modules/saml.module';
import { WarehouseModule } from './modules/warehouse.module';
import { ProductModule } from './modules/product.module';
import { StockModule } from './modules/stock.module';
import { HealthModule } from './modules/health.module';
import { StorageModule } from './modules/storage.module';
import { AuditModule } from './modules/audit.module';
import { RbacModule } from './modules/rbac.module';
import { ContextModule } from './modules/context.module';
import { AiModule } from './modules/ai.module';
import { FirebaseModule } from './modules/firebase.module';

import { GlobalJwtGuard } from './presentation/guards/global-auth.guard';
import { IpAllowlistGuard } from './presentation/guards/ip-allowlist.guard';
import { GlobalExceptionFilter } from './presentation/filters/global-exception.filter';
import { AuditLogInterceptor } from './presentation/interceptors/audit-log.interceptor';
import { TenantMiddleware } from './presentation/middleware/tenant.middleware';
import { TenantSubscriber } from './infrastructure/database/subscribers/tenant.subscriber';
import { generateUuidV7 } from './shared/utils/uuid-v7';
import type { IncomingMessage, ServerResponse } from 'http';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    EventEmitterModule.forRoot({ wildcard: false, delimiter: '.', maxListeners: 20 }),

    LoggerModule.forRoot({
      pinoHttp: {
        genReqId: (req: IncomingMessage, res: ServerResponse) => {
          const existing = req.headers['x-correlation-id'];
          const id = typeof existing === 'string' ? existing : generateUuidV7();
          res.setHeader('X-Correlation-ID', id);
          res.setHeader('X-Request-ID', id);
          return id;
        },
        transport:
          process.env.NODE_ENV === 'development'
            ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
            : undefined,
        customProps: () => ({ service: 'stockmind' }),
      },
    }),

    ThrottlerModule.forRoot([{ name: 'short', ttl: 60000, limit: 100 }]),

    I18nModule.forRoot({
      fallbackLanguage: 'en',
      loaderOptions: {
        path: path.join(__dirname, 'i18n/'),
        watch: process.env.NODE_ENV === 'development',
      },
      resolvers: [
        { use: QueryResolver, options: ['lang', 'locale'] },
        AcceptLanguageResolver,
      ],
    }),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type: 'postgres' as const,
        host: cfg.get<string>('DB_HOST') ?? 'localhost',
        port: parseInt(cfg.get<string>('DB_PORT') ?? '5432', 10),
        username: cfg.get<string>('DB_USERNAME') ?? 'stockmind',
        password: cfg.get<string>('DB_PASSWORD') ?? 'stockmind123',
        database: cfg.get<string>('DB_DATABASE') ?? 'stockmind',
        entities: [__dirname + '/domain/entities/*.entity{.ts,.js}'],
        migrations: [__dirname + '/migrations/*{.ts,.js}'],
        // TenantSubscriber registers itself into dataSource.subscribers from its
        // own (Nest-injected) constructor below — listing it here too makes
        // TypeORM's own container instantiate a second, un-injected copy with
        // `new TenantSubscriber()` (no DataSource arg), which crashes on
        // `dataSource.subscribers.push(this)`.
        synchronize: false,
        logging: cfg.get('NODE_ENV') === 'development' ? ['error'] : false,
        // Hosted Postgres (e.g. Neon) requires TLS; self-signed chain so we don't
        // verify against a CA. Off by default for local docker-compose Postgres.
        ssl: cfg.get('DB_SSL') === 'true' ? { rejectUnauthorized: false } : false,
        // Connection pool: cap at 10 to stay within PaaS tier limits
        extra: { max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 },
      }),
    }),

    // Global / infrastructure modules
    ContextModule,
    AuditModule,
    RbacModule,
    StorageModule,
    AiModule,
    FirebaseModule,

    // Feature modules
    AuthModule,
    // SAML SSO: registered only when SAML_ENABLED=true. The env var is read at
    // module init time (after dotenv has loaded), so this is safe to evaluate here.
    ...(process.env.SAML_ENABLED === 'true' ? [SamlModule] : []),
    WarehouseModule,
    ProductModule,
    StockModule,
    HealthModule,
  ],
  providers: [
    TenantSubscriber,
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    // IP allowlist runs first — reject untrusted networks before anything else.
    { provide: APP_GUARD, useClass: IpAllowlistGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: GlobalJwtGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
