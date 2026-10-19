import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import * as compression from 'compression';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { applyTrustProxy } from './shared/http/trust-proxy';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));

  // Off unless TRUST_PROXY_HOPS is set (see trust-proxy.ts); an invalid value stops the boot.
  applyTrustProxy(app);

  app.setGlobalPrefix('api/v1');

  app.use(helmet());

  // Compress responses in production (gzip/brotli via Accept-Encoding)
  if (process.env.NODE_ENV === 'production') {
    app.use(compression());
  }

  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:3000'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID', 'Accept-Language'],
    exposedHeaders: ['X-Correlation-ID', 'X-Request-ID'],
    credentials: true,
    maxAge: 86400,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // GlobalExceptionFilter is registered via APP_FILTER in AppModule (DI-aware for i18n).

  // Swagger setup (only in non-production)
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('StockMind API')
      .setDescription('Intelligent Warehouse Operating System — Atomic Ledger Engine')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}

bootstrap();