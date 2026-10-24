/**
 * The global AuditLogInterceptor stores the request body and the response of every write in audit_logs.new_values.
 * No credential or second-factor material may reach that row, whatever the key's casing or style.
 */
import { lastValueFrom, of, throwError } from 'rxjs';
import { AuditLogInterceptor } from '../../../src/presentation/interceptors/audit-log.interceptor';

const SENTINELS = {
  googleIdToken: 'SENTINEL_GOOGLE_ID_TOKEN',
  tempToken: 'SENTINEL_2FA_TEMP_TOKEN',
  totpSeed: 'SENTINELTOTPSEEDBASE32',
  qr: 'SENTINEL_QR_PAYLOAD',
  access: 'SENTINEL_ACCESS',
  refresh: 'SENTINEL_REFRESH',
  password: 'SENTINEL_PASSWORD',
};

function context(path: string, body: unknown) {
  const req = {
    method: 'POST', body, ip: '127.0.0.1',
    headers: { 'user-agent': 'jest' }, params: {}, route: { path }, url: path, user: undefined,
  };
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({ statusCode: 200 }) }),
  } as never;
}

describe('AuditLogInterceptor never stores credentials', () => {
  const audit = { write: jest.fn().mockResolvedValue(undefined) };
  const interceptor = new AuditLogInterceptor(audit as never);
  beforeEach(() => jest.clearAllMocks());

  const stored = () => JSON.stringify(audit.write.mock.calls.map((c) => c[0].newValues));
  const expectNoSentinel = () => {
    for (const value of Object.values(SENTINELS)) expect(stored()).not.toContain(value);
  };

  it('POST /auth/google: the Google ID token in the body', async () => {
    await lastValueFrom(interceptor.intercept(
      context('/api/v1/auth/google', { idToken: SENTINELS.googleIdToken }),
      { handle: () => of({ accessToken: SENTINELS.access, refreshToken: SENTINELS.refresh }) } as never,
    ));
    expectNoSentinel();
  });

  it('POST /auth/2fa/enable: the TOTP seed in otpauthUrl and the QR code of the response', async () => {
    await lastValueFrom(interceptor.intercept(
      context('/api/v1/auth/2fa/enable', {}),
      { handle: () => of({
        secret: SENTINELS.totpSeed,
        otpauthUrl: `otpauth://totp/StockMind:a%40b.com?secret=${SENTINELS.totpSeed}&issuer=StockMind`,
        qrCodeDataUrl: `data:image/png;base64,${SENTINELS.qr}`,
      }) } as never,
    ));
    expectNoSentinel();
  });

  it('POST /auth/login with 2FA: the snake_case temp_token of the response', async () => {
    await lastValueFrom(interceptor.intercept(
      context('/api/v1/auth/login', { email: 'a@b.com', password: SENTINELS.password }),
      { handle: () => of({ requires_2fa: true, temp_token: SENTINELS.tempToken }) } as never,
    ));
    expectNoSentinel();
  });

  it('any casing or style, nested and in arrays', async () => {
    await lastValueFrom(interceptor.intercept(
      context('/api/v1/things', {
        access_token: SENTINELS.access, REFRESH_TOKEN: SENTINELS.refresh, Password: SENTINELS.password,
        nested: { deeper: [{ id_token: SENTINELS.googleIdToken }] },
      }),
      { handle: () => of({ ok: true }) } as never,
    ));
    expectNoSentinel();
  });

  it('failed requests are redacted too', async () => {
    await expect(lastValueFrom(interceptor.intercept(
      context('/api/v1/auth/google', { idToken: SENTINELS.googleIdToken }),
      { handle: () => throwError(() => Object.assign(new Error('Invalid Google token'), { status: 401 })) } as never,
    ))).rejects.toThrow();
    expectNoSentinel();
  });

  it('keeps non-sensitive audit data', async () => {
    await lastValueFrom(interceptor.intercept(
      context('/api/v1/stock/inbound', { productId: 'p1', warehouseId: 'w1', quantity: '5', notes: 'restock', email: 'a@b.com' }),
      { handle: () => of({ id: 'm1', runningBalance: '15.000000' }) } as never,
    ));
    const row = audit.write.mock.calls[0][0].newValues;
    expect(row.request).toEqual({ productId: 'p1', warehouseId: 'w1', quantity: '5', notes: 'restock', email: 'a@b.com' });
    expect(row.response).toEqual({ id: 'm1', runningBalance: '15.000000' });
  });
});
