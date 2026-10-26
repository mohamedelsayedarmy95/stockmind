/** Real local HTTP + PostgreSQL revocation, production mobile reducer/query cache/resolver; no device or native mocks. */
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { randomBytes, randomUUID } from 'crypto';
import { AppModule } from '@/app.module';
import { queryClient, queryKeys } from '../../mobile/src/query/queryClient';
import { applyChanges, initialSyncState } from '../../mobile/src/domain/stock-sync';
import { httpStatusOf } from '../../mobile/src/domain/auth-flow';
import { knownQuantity, resolveBalance } from '../../mobile/src/domain/balance-truth';
import type { BalanceResponse } from '../../mobile/src/api/types';

// Refuse even an accidentally configured remote database. Gate uses a NEW disposable local DB.
const RUN = process.env.PG_INTEGRATION === '1' && process.env.DB_HOST === '127.0.0.1'
  && process.env.DB_PORT === '55433' && /^stockmind_gate_sol_f13_[a-z0-9_]+$/.test(process.env.DB_DATABASE ?? '');
const TAG = randomBytes(4).toString('hex');

(RUN ? describe : describe.skip)('F13 balance after actual warehouse revocation (local PG/HTTP, shadow)', () => {
  jest.setTimeout(240_000);
  let app: INestApplication;
  let ownerToken: string; let staffToken: string; let staffId: string; let warehouseId: string; let productId: string;
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    expect(process.env.CAPABILITY_MODE ?? 'shadow').toBe('shadow');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    const owner = await http().post('/api/v1/auth/register').send({
      companyName: `F13 ${TAG}`, name: 'Synthetic owner', email: `f13.owner.${TAG}@example.test`, password: `Aa1!${randomBytes(12).toString('hex')}`,
    }).expect(201);
    ownerToken = owner.body.accessToken;
    warehouseId = owner.body.defaultWarehouse.id;
    const email = `f13.staff.${TAG}@example.test`;
    const invite = await http().post('/api/v1/team/invitations').set(auth(ownerToken))
      .send({ email, role: 'Staff', warehouseIds: [warehouseId] }).expect(201);
    const staff = await http().post('/api/v1/auth/accept-invitation').send({
      token: invite.body.token, name: 'Synthetic staff', password: `Aa1!${randomBytes(12).toString('hex')}`,
    }).expect(201);
    staffToken = staff.body.accessToken; staffId = staff.body.user.id;
    productId = (await http().post('/api/v1/products').set(auth(ownerToken))
      .send({ name: 'Synthetic bolt', sku: `F13-${TAG}` }).expect(201)).body.id;
    await http().post('/api/v1/stock/inbound').set(auth(ownerToken)).set('Idempotency-Key', randomUUID())
      .send({ productId, warehouseId, quantity: '55' }).expect(201);
  });

  afterEach(() => queryClient.clear());
  afterAll(async () => { await app?.close(); });

  it('fresh denial hides the old figure before the independent warehouse poll observes revocation', async () => {
    const snapshot = await http().get(`/api/v1/stock/changes/${warehouseId}`).set(auth(staffToken)).expect(200);
    const sync = {
      ...applyChanges(initialSyncState(warehouseId), undefined, snapshot.body),
      lastError: null, lastSuccessAt: Date.now(),
    };
    expect(sync.status).toBe('synced');
    expect(sync.balances[productId].baseQuantity).toBe('55.000000');
    const queryKey = [...queryKeys.balance(productId, warehouseId), 'online'];
    const queryFn = async (): Promise<BalanceResponse> => {
      const response = await http().get(`/api/v1/stock/balance/${productId}/${warehouseId}`).set(auth(staffToken));
      if (response.status !== 200) throw { response: { status: response.status, data: response.body } };
      return response.body;
    };
    const options = { queryKey, queryFn, staleTime: 0, retry: false as const };
    await queryClient.fetchQuery(options);
    const read = () => {
      const query = queryClient.getQueryState<BalanceResponse>(queryKey)!;
      return resolveBalance({ online: true, productId, warehouseId, sync,
        query: { status: query.status, data: query.data, errorStatus: httpStatusOf(query.error) } });
    };
    expect(read()).toEqual({ state: 'confirmed', quantity: 55, source: 'server' });

    // Commit a REAL owner-authorized revocation; staff keeps the same valid session and product access.
    await http().put(`/api/v1/team/members/${staffId}/warehouses`).set(auth(ownerToken)).send({ warehouseIds: [] }).expect(200);
    await http().get('/api/v1/products').set(auth(staffToken)).expect(200);
    await expect(queryClient.fetchQuery(options)).rejects.toMatchObject({ response: { status: 404 } });
    const failed = queryClient.getQueryState<BalanceResponse>(queryKey)!;
    expect(failed.status).toBe('error');
    expect(failed.data?.baseQuantity).toBe('55.000000'); // TanStack retains the successful data after refetch failure
    expect(sync.lastError).toBeNull(); // no warehouse poll has run since the revocation
    expect(read()).toEqual({ state: 'unknown', reason: 'no-access' });
    expect(knownQuantity(read())).toBeNull();

    // Eventual poll denial is real too; server still has the authoritative quantity for its owner.
    await http().get(`/api/v1/stock/changes/${warehouseId}`).set(auth(staffToken)).expect(404);
    const ownerBalance = await http().get(`/api/v1/stock/balance/${productId}/${warehouseId}`).set(auth(ownerToken)).expect(200);
    expect(ownerBalance.body.baseQuantity).toBe('55.000000');
  });

  it('a different tenant cannot retrieve this warehouse balance or its snapshot', async () => {
    const other = await http().post('/api/v1/auth/register').send({ companyName: `Other F13 ${TAG}`, name: 'Other synthetic owner',
      email: `f13.other.${TAG}@example.test`, password: `Aa1!${randomBytes(12).toString('hex')}` }).expect(201);
    await http().get(`/api/v1/stock/balance/${productId}/${warehouseId}`).set(auth(other.body.accessToken)).expect(404);
    await http().get(`/api/v1/stock/changes/${warehouseId}`).set(auth(other.body.accessToken)).expect(404);
  });
});
