/**
 * A1: refresh-token rotation and revocation. Only the most recently issued refresh token may be redeemed; a rotated,
 * logged-out or terminated token must be rejected. bcrypt only reads the first 72 bytes of its input, which are the
 * same for every refresh JWT of a user, so with a bcrypt hash any earlier token still matched.
 */
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../../src/infrastructure/repositories/auth.service';

const USER = {
  id: '6f1c2c1e-4a0b-4c55-9a77-1f0f0c9b2a11', companyId: 'c1', role: 'Admin', name: 'A', email: 'a@example.test',
  status: 'active', tokenVersion: 0,
};
const cfgValues: Record<string, string> = {
  JWT_ACCESS_SECRET: 'access-secret-for-tests', JWT_REFRESH_SECRET: 'refresh-secret-for-tests',
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setup() {
  const row: { refreshTokenHash: string | null } = { refreshTokenHash: null };
  const userRepo = {
    findOne: jest.fn(async () => ({ ...USER, refreshTokenHash: row.refreshTokenHash })),
    update: jest.fn(async (_id: string, patch: { refreshTokenHash?: string | null }) => {
      if ('refreshTokenHash' in patch) row.refreshTokenHash = patch.refreshTokenHash ?? null;
    }),
  };
  const cfg = { get: (key: string, fallback?: string) => cfgValues[key] ?? fallback };
  const auth = new AuthService(
    userRepo as never, {} as never, {} as never, new JwtService({}), cfg as never, {} as never,
    {} as never, {} as never, { write: jest.fn() } as never, {} as never, { assertSeatAvailable: async () => undefined } as never
  );
  // Issue a session exactly as login does (private helpers).
  const issue = async () => {
    const tokens = await (auth as any).generateTokens(USER);
    await (auth as any).storeRefreshHash(USER.id, tokens.refreshToken);
    return tokens.refreshToken as string;
  };
  return { auth, row, issue };
}

describe('A1: refresh tokens are single-use and revocable', () => {
  it('the current refresh token is accepted and rotated', async () => {
    const { auth, issue } = setup();
    const t1 = await issue();
    const next = await auth.refreshTokens(t1);
    expect(next.refreshToken).not.toBe(t1);
  });

  it('a rotated (already used) refresh token is rejected', async () => {
    const { auth, issue } = setup();
    const t1 = await issue();
    await sleep(1100); // a later iat, as in real use
    await auth.refreshTokens(t1);
    await expect(auth.refreshTokens(t1)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('two tokens issued in the same second are still distinct', async () => {
    const { issue } = setup();
    expect(await issue()).not.toBe(await issue());
  });

  it('after logout and a new login, a pre-logout token is rejected', async () => {
    const { auth, issue } = setup();
    const before = await issue();
    await auth.logout(USER.id);
    await sleep(1100);
    await issue(); // new login
    await expect(auth.refreshTokens(before)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('a legacy bcrypt hash is no longer accepted (all such tokens expired before this change)', async () => {
    const { auth, row } = setup();
    const legacy = await new JwtService({}).signAsync({ sub: USER.id, companyId: 'c1', role: 'Admin' }, { secret: cfgValues.JWT_REFRESH_SECRET, expiresIn: '7d' });
    row.refreshTokenHash = await bcrypt.hash(legacy, 4);
    await expect(auth.refreshTokens(legacy)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('the stored value is a digest, never the token', async () => {
    const { row, issue } = setup();
    const t = await issue();
    expect(row.refreshTokenHash).not.toContain(t.slice(0, 20));
    expect(row.refreshTokenHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
