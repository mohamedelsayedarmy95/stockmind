import 'reflect-metadata';
import { INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CqrsModule } from '@nestjs/cqrs';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, FindManyOptions } from 'typeorm';
import * as path from 'path';
import * as request from 'supertest';
import type { NextFunction, Request, Response } from 'express';

import { StockController } from '../../src/presentation/controllers/stock.controller';
import { GetMovementHistoryHandler } from '../../src/application/queries/get-movement-history.handler';
import { StockService } from '../../src/infrastructure/repositories/stock.service';
import { PermissionService } from '../../src/infrastructure/repositories/permission.service';
import { RedisService } from '../../src/infrastructure/cache/redis.service';
import { ProductWarehouse } from '../../src/domain/entities/product-warehouse.entity';
import { StockMovement } from '../../src/domain/entities/stock-movement.entity';
import { Product } from '../../src/domain/entities/product.entity';
import { Warehouse } from '../../src/domain/entities/warehouse.entity';
import { User } from '../../src/domain/entities/user.entity';
import { MovementType, ReferenceType, UserRole } from '../../src/shared/constants/enums';
import { JwtPayload } from '../../src/presentation/decorators/current-user.decorator';

/**
 * WP-H0 / F4 regression: GET /stock/movements/:productId must never disclose
 * credential material of the users who performed the movements.
 *
 * Runs the real controller -> QueryBus -> handler -> StockService -> Express JSON
 * serialization path. Only the persistence layer is mocked; `req.user` stands in
 * for the global JWT guard, which is not under test here.
 */

const COMPANY_A = '0b7c1a52-1111-4c1e-9a0d-000000000001';
const COMPANY_B = '0b7c1a52-2222-4c1e-9a0d-000000000002';
const PRODUCT_ID = 'a1a1a1a1-0000-4000-8000-000000000001';
const WAREHOUSE_ID = 'b2b2b2b2-0000-4000-8000-000000000001';
const ACTOR_ID = 'c3c3c3c3-0000-4000-8000-000000000001';
const STAFF_ID = 'd4d4d4d4-0000-4000-8000-000000000001';

const SENTINEL_PASSWORD_HASH = '$2b$12$SENTINELpasswordHASHvalueXXXXXXXXXXXXXXXXXXXXXXXXXX';
const SENTINEL_REFRESH_HASH = '$2b$10$SENTINELrefreshHASHvalueXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const SENTINEL_EMAIL = 'actor.private@example.test';
const SENTINEL_ADDRESS = '1 Private Warehouse Street';

function makeMovement(): StockMovement {
  const actor = Object.assign(new User(), {
    id: ACTOR_ID,
    companyId: COMPANY_A,
    warehouseId: WAREHOUSE_ID,
    name: 'Alice Admin',
    email: SENTINEL_EMAIL,
    passwordHash: SENTINEL_PASSWORD_HASH,
    role: UserRole.ADMIN,
    refreshTokenHash: SENTINEL_REFRESH_HASH,
    createdAt: new Date('2026-07-01T00:00:00Z'),
  });
  const warehouse = Object.assign(new Warehouse(), {
    id: WAREHOUSE_ID,
    companyId: COMPANY_A,
    name: 'Main Warehouse',
    address: SENTINEL_ADDRESS,
    isActive: true,
    createdAt: new Date('2026-07-01T00:00:00Z'),
  });
  return Object.assign(new StockMovement(), {
    id: 'e5e5e5e5-0000-4000-8000-000000000001',
    productId: PRODUCT_ID,
    warehouseId: WAREHOUSE_ID,
    userId: ACTOR_ID,
    user: actor,
    warehouse,
    movementType: MovementType.INBOUND,
    referenceType: ReferenceType.PURCHASE,
    referenceId: null,
    quantityChange: '10.000000',
    runningBalance: '10.000000',
    notes: 'Received from supplier',
    createdAt: new Date('2026-07-20T10:00:00Z'),
  });
}

// The product lookup honours the tenant filter exactly as the real query would.
const productRepo = {
  findOne: jest.fn(async ({ where }: { where: { id: string; companyId: string } }) =>
    where.id === PRODUCT_ID && where.companyId === COMPANY_A
      ? ({ id: PRODUCT_ID, companyId: COMPANY_A } as Product)
      : null,
  ),
};
const movementRepo = { find: jest.fn(async (_options?: unknown) => [makeMovement()]) };
const permissionService = { hasAll: jest.fn(async () => false) };
const warehouseRepo = { findOne: jest.fn(async () => null) };

// In-memory stand-in for Redis, so the real cache read/write/invalidate path runs.
const redisStore = new Map<string, string>();
const redisService = {
  get: jest.fn(async (key: string) => redisStore.get(key) ?? null),
  set: jest.fn(async (key: string, value: string) => {
    redisStore.set(key, value);
  }),
  del: jest.fn(async (key: string) => {
    redisStore.delete(key);
  }),
  generateKey: (prefix: string, ...args: string[]) => [prefix, ...args].join(':'),
};
const V2_ALL_KEY = `stock:movements:v2:${PRODUCT_ID}:all`;
const LEGACY_ALL_KEY = `stock:movements:${PRODUCT_ID}:all`;

let currentUser: JwtPayload;

@Module({
  imports: [CqrsModule],
  controllers: [StockController],
  providers: [
    GetMovementHistoryHandler,
    StockService,
    { provide: getRepositoryToken(ProductWarehouse), useValue: {} },
    { provide: getRepositoryToken(StockMovement), useValue: movementRepo },
    { provide: getRepositoryToken(Product), useValue: productRepo },
    { provide: getRepositoryToken(Warehouse), useValue: warehouseRepo },
    { provide: DataSource, useValue: {} },
    { provide: PermissionService, useValue: permissionService },
    { provide: RedisService, useValue: redisService },
  ],
})
class MovementHistoryTestModule {}

describe('F4: movement history must not disclose user credentials', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await NestFactory.create(MovementHistoryTestModule, { logger: false });
    app.setGlobalPrefix('api/v1');
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as unknown as { user: JwtPayload }).user = currentUser;
      next();
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    redisStore.clear();
    currentUser = { sub: STAFF_ID, companyId: COMPANY_A, role: UserRole.STAFF };
  });

  const get = () => request(app.getHttpServer()).get(`/api/v1/stock/movements/${PRODUCT_ID}`);

  it('lets Staff (lowest role holding VIEW_MOVEMENTS) read movement history', async () => {
    const res = await get().expect(200);
    expect(res.body).toHaveLength(1);
  });

  it('needs no warehouse lookup when no warehouse filter is given (F3)', async () => {
    await get().expect(200);
    expect(warehouseRepo.findOne).not.toHaveBeenCalled();
  });

  it('caches only the allowlisted DTO, under the versioned key', async () => {
    await get().expect(200);
    const cached = redisStore.get(V2_ALL_KEY);
    expect(cached).toBeDefined();
    for (const secret of [SENTINEL_PASSWORD_HASH, SENTINEL_REFRESH_HASH, SENTINEL_EMAIL, SENTINEL_ADDRESS]) {
      expect(cached).not.toContain(secret);
    }
    expect(JSON.parse(cached as string)[0].user).toEqual({ id: ACTOR_ID, name: 'Alice Admin' });
  });

  it('serves a cache hit without reading the database again', async () => {
    await get().expect(200);
    const res = await get().expect(200);
    expect(movementRepo.find).toHaveBeenCalledTimes(1);
    expect(res.body[0].user).toEqual({ id: ACTOR_ID, name: 'Alice Admin' });
  });

  it('never serves a legacy (pre-fix) cache entry that may hold credentials', async () => {
    redisStore.set(LEGACY_ALL_KEY, JSON.stringify([makeMovement()]));
    const res = await get().expect(200);
    expect(res.text).not.toContain(SENTINEL_PASSWORD_HASH);
    expect(movementRepo.find).toHaveBeenCalledTimes(1);
  });

  it('write-path invalidation clears the versioned movement keys', async () => {
    await get().expect(200);
    expect(redisStore.has(V2_ALL_KEY)).toBe(true);
    const service = app.get(StockService) as unknown as {
      invalidateStockCache(productId: string, warehouseIds: string[]): Promise<void>;
    };
    await service.invalidateStockCache(PRODUCT_ID, [WAREHOUSE_ID]);
    expect(redisStore.has(V2_ALL_KEY)).toBe(false);
  });

  it('never serializes credential material or private contact data', async () => {
    const res = await get().expect(200);
    const raw = res.text;
    for (const secret of [SENTINEL_PASSWORD_HASH, SENTINEL_REFRESH_HASH, SENTINEL_EMAIL, SENTINEL_ADDRESS]) {
      expect(raw).not.toContain(secret);
    }
    for (const key of ['passwordHash', 'refreshTokenHash', 'email', 'address']) {
      expect(raw).not.toContain(`"${key}"`);
    }
  });

  it('returns only allowlisted fields, with user and warehouse reduced to {id, name}', async () => {
    const res = await get().expect(200);
    const [movement] = res.body;
    expect(Object.keys(movement).sort()).toEqual(
      [
        'createdAt',
        'id',
        'movementType',
        'notes',
        'productId',
        'quantityChange',
        'referenceId',
        'referenceType',
        'runningBalance',
        'user',
        'userId',
        'warehouse',
        'warehouseId',
      ].sort(),
    );
    expect(movement.user).toEqual({ id: ACTOR_ID, name: 'Alice Admin' });
    expect(movement.warehouse).toEqual({ id: WAREHOUSE_ID, name: 'Main Warehouse' });
    expect(movement.quantityChange).toBe('10.000000');
    expect(movement.runningBalance).toBe('10.000000');
  });

  it('service output (the value any cache layer would store) carries no credential material', async () => {
    const service = app.get(StockService);
    const result = await service.getMovements(COMPANY_A, PRODUCT_ID);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(SENTINEL_PASSWORD_HASH);
    expect(serialized).not.toContain(SENTINEL_REFRESH_HASH);
    expect(serialized).not.toContain(SENTINEL_EMAIL);
    expect(result[0]).not.toBeInstanceOf(StockMovement);
  });

  it('does not load credential columns from the database for the related user', async () => {
    await get().expect(200);
    const options = movementRepo.find.mock.calls[0][0] as { select?: { user?: Record<string, unknown> } };
    expect(options.select?.user).toEqual({ id: true, name: true });
  });

  it('generated SQL reads no credential columns (TypeORM query build, no DB connection)', async () => {
    await get().expect(200);
    const options = movementRepo.find.mock.calls[0][0] as FindManyOptions<StockMovement>;

    const entitiesGlob = path.join(__dirname, '../../src/domain/entities/*.entity.ts').replace(/\\/g, '/');
    const ds = new DataSource({ type: 'postgres', entities: [entitiesGlob] });
    await (ds as unknown as { buildMetadatas(): Promise<void> }).buildMetadatas();
    const sql = ds.getRepository(StockMovement).createQueryBuilder().setFindOptions(options).getQuery();

    expect(sql).toContain('"name"');
    for (const column of ['password_hash', 'refresh_token_hash', 'email', 'address']) {
      expect(sql).not.toContain(`"${column}"`);
    }
  });

  it('isolates tenants: a user of another company gets 404 and no movements are read', async () => {
    currentUser = { sub: STAFF_ID, companyId: COMPANY_B, role: UserRole.STAFF };
    await get().expect(404);
    expect(movementRepo.find).not.toHaveBeenCalled();
  });

  it('still enforces the permission guard for roles without VIEW_MOVEMENTS', async () => {
    currentUser = { sub: STAFF_ID, companyId: COMPANY_A, role: 'NoSuchRole' };
    await get().expect(403);
    expect(movementRepo.find).not.toHaveBeenCalled();
  });
});
