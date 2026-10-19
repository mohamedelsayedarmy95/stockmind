import 'reflect-metadata';
import { Global, INestApplicationContext, Injectable, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { FirebaseModule } from '../../src/modules/firebase.module';
import { FcmService } from '../../src/infrastructure/firebase/fcm.service';
import { TokensRepository } from '../../src/infrastructure/repositories/tokens.repository';

/**
 * Regression: the app failed to boot with "Nest can't resolve dependencies of the
 * FcmService (?)" because no module provided TokensRepository (nor its
 * UserFcmToken repository). The existing unit tests construct both classes with
 * `new`, so only a real Nest DI resolution catches this.
 *
 * The DataSource is a stand-in so no database is needed; everything else is
 * resolved by Nest exactly as at application startup.
 */

const fcmTokenRepository = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn(), delete: jest.fn() };

@Global()
@Module({
  providers: [
    {
      provide: DataSource,
      useValue: {
        entityMetadatas: [],
        options: { type: 'postgres' },
        getRepository: () => fcmTokenRepository,
      },
    },
  ],
  exports: [DataSource],
})
class FakeDataSourceModule {}

// A consumer outside FirebaseModule, like the stock command handlers or a notifications controller.
@Injectable()
class TokensConsumer {
  constructor(
    readonly fcm: FcmService,
    readonly tokens: TokensRepository,
  ) {}
}

// Mirrors AppModule: ConfigModule is global there (FirebaseService needs ConfigService).
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), FakeDataSourceModule, FirebaseModule],
  providers: [TokensConsumer],
})
class DiRootModule {}

describe('FirebaseModule DI graph', () => {
  let app: INestApplicationContext;

  beforeAll(async () => {
    app = await NestFactory.createApplicationContext(DiRootModule, { logger: false, abortOnError: false });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('resolves FcmService together with its TokensRepository dependency', () => {
    const fcm = app.get(FcmService);
    const tokens = app.get(TokensRepository);
    expect(fcm).toBeInstanceOf(FcmService);
    expect(tokens).toBeInstanceOf(TokensRepository);
    expect((fcm as unknown as { tokensRepository: TokensRepository }).tokensRepository).toBe(tokens);
  });

  it('exports FcmService and TokensRepository to consumers in other modules', () => {
    const consumer = app.get(TokensConsumer);
    expect(consumer.fcm).toBe(app.get(FcmService));
    expect(consumer.tokens).toBe(app.get(TokensRepository));
  });
});
