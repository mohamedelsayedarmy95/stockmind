import { AuditLogInterceptor } from '../../src/presentation/interceptors/audit-log.interceptor';
import { of, throwError, lastValueFrom } from 'rxjs';

function context(method: string, body: unknown, user?: unknown) {
  const req = {
    method,
    body,
    ip: '127.0.0.1',
    headers: { 'user-agent': 'jest', 'x-correlation-id': 'corr-123' },
    params: { id: 'entity-1' },
    route: { path: '/api/v1/products/:id' },
    url: '/api/v1/products/entity-1',
    user,
  };
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({ statusCode: 200 }),
    }),
  } as never;
}

describe('AuditLogInterceptor', () => {
  const audit = { write: jest.fn().mockResolvedValue(undefined) };
  const interceptor = new AuditLogInterceptor(audit as never);

  beforeEach(() => jest.clearAllMocks());

  it('records writes on successful POST', async () => {
    const call = { handle: () => of({ id: 'entity-1', name: 'x' }) };
    await lastValueFrom(interceptor.intercept(
      context('POST', { name: 'x' }, { sub: 'u1', companyId: 'c1' }), call as never,
    ));

    // await audit hop (fired via void inside tap)
    await new Promise(process.nextTick);

    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CREATE',
      entityType: 'products',
      correlationId: 'corr-123',
      actorUserId: 'u1',
      companyId: 'c1',
    }));
  });

  it('records failed writes too', async () => {
    const err = Object.assign(new Error('boom'), { status: 409 });
    const call = { handle: () => throwError(() => err) };

    await expect(lastValueFrom(interceptor.intercept(
      context('DELETE', undefined, { sub: 'u1', companyId: 'c1' }), call as never,
    ))).rejects.toThrow('boom');

    await new Promise(process.nextTick);

    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({
      action: 'DELETE',
      statusCode: 409,
    }));
  });

  it('skips GET requests entirely', async () => {
    const call = { handle: () => of({}) };
    await lastValueFrom(interceptor.intercept(context('GET', undefined), call as never));
    expect(audit.write).not.toHaveBeenCalled();
  });

  it('redacts sensitive fields from request body', async () => {
    const call = { handle: () => of({ id: 'e' }) };
    await lastValueFrom(interceptor.intercept(
      context('POST', { email: 'a@b.com', password: 'secret' }, { sub: 'u', companyId: 'c' }),
      call as never,
    ));

    await new Promise(process.nextTick);

    const call0 = audit.write.mock.calls[0][0];
    expect(call0.newValues.request.password).toBe('[REDACTED]');
    expect(call0.newValues.request.email).toBe('a@b.com');
  });
});
