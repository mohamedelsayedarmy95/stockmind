/**
 * A3: a user who enabled 2FA must not receive an access or refresh token from ANY sign-in path (password, Google,
 * SAML) until the second factor is verified through /auth/2fa/login, and the OTP step must be brute-force limited.
 */
import { HttpException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../../src/infrastructure/repositories/auth.service';

const PASSWORD = 'Aa1!correct-horse';
const VALID_OTP = '123456';
const cfgValues: Record<string, string> = {
  JWT_ACCESS_SECRET: 'access-secret-test', JWT_REFRESH_SECRET: 'refresh-secret-test', JWT_2FA_SECRET: 'twofa-secret-test',
};

async function setup(twoFactorEnabled: boolean) {
  const user = {
    id: '7d0f6a2e-1b1c-4c3a-9a7e-2f6b0b0c1d22', companyId: 'c1', role: 'Admin', name: 'U', email: 'u@example.test',
    passwordHash: await bcrypt.hash(PASSWORD, 4), company: { id: 'c1' },
  };
  const stored: { refreshTokenHash: string | null } = { refreshTokenHash: null };
  const failures: Record<string, number> = {};
  const userRepo = {
    findOne: jest.fn(async () => user),
    update: jest.fn(async (_id: string, patch: { refreshTokenHash?: string | null }) => {
      if ('refreshTokenHash' in patch) stored.refreshTokenHash = patch.refreshTokenHash ?? null;
    }),
  };
  const bruteForce = {
    // Same contract as BruteForceService: 5 failures lock the account.
    assertNotLocked: jest.fn(async (email: string) => {
      if ((failures[email] ?? 0) >= 5) throw new HttpException('Too many attempts', 429);
    }),
    record: jest.fn(async (email: string, _ip: unknown, _ua: unknown, ok: boolean) => {
      if (!ok) failures[email] = (failures[email] ?? 0) + 1;
    }),
  };
  const twoFactor = {
    isEnabled: jest.fn(async () => twoFactorEnabled),
    verifyCode: jest.fn(async (_id: string, code: string) => code === VALID_OTP),
  };
  const jwt = new JwtService({});
  const auth = new AuthService(
    userRepo as never, {} as never, {} as never, jwt, { get: (k: string, d?: string) => cfgValues[k] ?? d } as never,
    {} as never, twoFactor as never, bruteForce as never, { write: jest.fn() } as never,
    { verifyGoogleIdToken: async () => ({ uid: 'g', email: user.email, name: 'U' }) } as never,
  );
  return { auth, user, stored, jwt };
}

// Called through `any` so the test compiles against both the old and the new signature (ctx was added).
const tfa = (a: AuthService, temp: string, otp: string) =>
  (a as unknown as { twoFactorLogin: (t: string, o: string, c: object) => Promise<unknown> }).twoFactorLogin(temp, otp, {});

const isPending = (r: Record<string, unknown>) =>
  r.requires_2fa === true && typeof r.temp_token === 'string' && !('accessToken' in r) && !('refreshToken' in r);

describe('A3: every sign-in path enforces the second factor', () => {
  it.each([
    ['password', (a: AuthService) => a.login({ email: 'u@example.test', password: PASSWORD } as never, {})],
    ['Google', (a: AuthService) => a.googleLogin('google-id-token', {})],
    ['SAML / SSO', async (a: AuthService) => a.issueTokensForSsoUser((await a['userRepo'].findOne({} as never)) as never, {})],
  ])('%s: a 2FA user gets only a temp token, never a session', async (_path, signIn) => {
    const { auth, stored } = await setup(true);
    const result = (await signIn(auth)) as Record<string, unknown>;
    expect(isPending(result)).toBe(true);
    expect(stored.refreshTokenHash).toBeNull();
  });

  it('Google: without 2FA the session is issued as before', async () => {
    const { auth } = await setup(false);
    const result = (await auth.googleLogin('google-id-token', {})) as Record<string, unknown>;
    expect(typeof result.accessToken).toBe('string');
    expect(typeof result.refreshToken).toBe('string');
  });

  it('the temp token is not an access token', async () => {
    const { auth, jwt } = await setup(true);
    const { temp_token } = (await auth.googleLogin('google-id-token', {})) as unknown as { temp_token: string };
    expect(() => jwt.verify(temp_token, { secret: cfgValues.JWT_ACCESS_SECRET })).toThrow();
  });

  it('Google + correct OTP completes the sign-in through /auth/2fa/login', async () => {
    const { auth, stored } = await setup(true);
    const { temp_token } = (await auth.googleLogin('google-id-token', {})) as unknown as { temp_token: string };
    const session = (await tfa(auth, temp_token, VALID_OTP)) as Record<string, unknown>;
    expect(typeof session.accessToken).toBe('string');
    expect(stored.refreshTokenHash).not.toBeNull();
  });

  it('a wrong OTP issues nothing', async () => {
    const { auth, stored } = await setup(true);
    const { temp_token } = (await auth.googleLogin('google-id-token', {})) as unknown as { temp_token: string };
    await expect(tfa(auth, temp_token, '000000')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(stored.refreshTokenHash).toBeNull();
  });

  it('OTP guessing is limited: after 5 wrong codes even the right code is refused', async () => {
    const { auth, stored } = await setup(true);
    for (let i = 0; i < 5; i++) {
      const { temp_token } = (await auth.login({ email: 'u@example.test', password: PASSWORD } as never, {})) as unknown as { temp_token: string };
      await expect(tfa(auth, temp_token, String(100000 + i))).rejects.toBeInstanceOf(UnauthorizedException);
    }
    const { temp_token } = (await auth.googleLogin('google-id-token', {})) as unknown as { temp_token: string };
    await expect(tfa(auth, temp_token, VALID_OTP)).rejects.toMatchObject({ status: 429 });
    expect(stored.refreshTokenHash).toBeNull();
  });
});
