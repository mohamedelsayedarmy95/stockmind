import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '@/app.module';
import { Connection } from 'typeorm';

describe('StockMind e2e', () => {
  let app: INestApplication;
  let dbConnection: Connection;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    // Get the database connection
    const configService = moduleRef.get('ConfigService');
    // We don't have a direct way to get the connection, but we can get it from the TypeOrmModule
    // For simplicity, we assume the connection is available and we don't need to close it in the test.
    // In a real scenario, we might want to use a test database and rollback transactions.
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
        email: 'test@example.com',
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
        email: 'test2@example.com',
        password: 'StrongPassword123!',
      })
      .expect(201)
      .then((res) => {
        const accessToken = res.body.accessToken;
        // Now login
        return request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({
            email: 'test2@example.com',
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
        email: 'test3@example.com',
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
        sku: 'TEST-001',
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

    expect(parseFloat(balanceRes.body)).toBe(100);

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

    expect(parseFloat(balanceRes2.body)).toBe(70);
  });
});