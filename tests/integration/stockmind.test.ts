import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { randomBytes } from 'crypto';
import { AppModule } from '@/app.module';

// Unique per run: the suite writes to a real database and must not collide with a previous run's users.
const RUN = randomBytes(4).toString('hex');

// Needs a migrated PostgreSQL and JWT secrets (CI provides both); skipped without them.
const RUN_E2E = Boolean(process.env.DB_HOST && process.env.JWT_ACCESS_SECRET && process.env.JWT_REFRESH_SECRET);

(RUN_E2E ? describe : describe.skip)('StockMind e2e', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1'); // as in main.ts
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

  });

  afterAll(async () => {
    await app.close();
  });

  it('/auth/register (POST) should create a new company and user', () => {
    return request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        companyName: 'Test Company',
        name: 'Test User',
        email: `test.${RUN}@example.com`,
        password: 'StrongPassword123!',
      })
      .expect(201)
      .expect((res) => {
        expect(res.body).toHaveProperty('accessToken');
        expect(res.body).toHaveProperty('refreshToken');
        expect(res.body).toHaveProperty('defaultWarehouse');
      });
  });

  it('/auth/login (POST) should login and return tokens', () => {
    // First, register a user
    return request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        companyName: 'Test Company 2',
        name: 'Test User 2',
        email: `test2.${RUN}@example.com`,
        password: 'StrongPassword123!',
      })
      .expect(201)
      .then((res) => {
        const accessToken = res.body.accessToken;
        // Now login
        return request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({
            email: `test2.${RUN}@example.com`,
            password: 'StrongPassword123!',
          })
          .expect(200)
          .expect((res) => {
            expect(res.body).toHaveProperty('accessToken');
            expect(res.body).toHaveProperty('refreshToken');
          });
      });
  });

  it('should allow authenticated user to create product and do stock operations', async () => {
    // Register
    const regRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        companyName: 'Test Company 3',
        name: 'Test User 3',
        email: `test3.${RUN}@example.com`,
        password: 'StrongPassword123!',
      })
      .expect(201);

    const accessToken = regRes.body.accessToken;
    const warehouseId = regRes.body.defaultWarehouse.id;

    // Create Product
    const productRes = await request(app.getHttpServer())
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Test Product',
        sku: `TEST-${RUN}`,
        unitsOfMeasure: [{ uomType: 'piece', code: 'PCS', conversionFactorToBase: '1' }],
      })
      .expect(201);

    const productId = productRes.body.id;

    // Inbound Stock
    const inboundRes = await request(app.getHttpServer())
      .post('/api/v1/stock/inbound')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        productId,
        warehouseId,
        quantity: '100',
        notes: 'Initial stock',
      })
      .expect(201);

    // Check Balance
    const balanceRes = await request(app.getHttpServer())
      .get(`/api/v1/stock/balance/${productId}/${warehouseId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(parseFloat(balanceRes.body.runningBalance)).toBe(100);

    // Outbound Stock
    const outboundRes = await request(app.getHttpServer())
      .post('/api/v1/stock/outbound')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        productId,
        warehouseId,
        quantity: '30',
      })
      .expect(201);

    // Check Balance again
    const balanceRes2 = await request(app.getHttpServer())
      .get(`/api/v1/stock/balance/${productId}/${warehouseId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(parseFloat(balanceRes2.body.runningBalance)).toBe(70);
  });
});