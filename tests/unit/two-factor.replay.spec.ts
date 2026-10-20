/**
 * TOTP replay protection (RFC 6238 section 5.2): a verifier must not accept the same one-time password twice. A code
 * is bound to its time-step; each user's last accepted step is persisted, and only a later step is accepted.
 * These tests pin the service logic. Atomicity under concurrency is proven against real PostgreSQL in
 * tests/integration/two-factor.replay.pg.spec.ts.
 */
import { ConflictException, HttpException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as speakeasy from 'speakeasy';
import { TwoFactorService } from '../../src/infrastructure/security/two-factor.service';
import { AuthService } from '../../src/infrastructure/repositories/auth.service';

const SECRET = 'JBSWY3DPEHPK3PXP'; // RFC test-style base32 secret, not a real credential
const USER = '7d0f6a2e-1b1c-4c3a-9a7e-2f6b0b0c1d22';
const T0 = 1_800_000_000; // seconds; a time-step boundary (T0 / 30 is an integer)
const codeAt = (seconds: number) => speakeasy.totp({ secret: SECRET, encoding: 'base32', time: seconds });
const at = (seconds: number) => jest.spyOn(Date, 'now').mockReturnValue(seconds * 1000);

type Row = { id: string; userId: string; secretKey: string; isEnabled: boolean; backupCodes: string | null;
  lastTotpStep: string | null };

/** In-memory user_two_factor row. The conditional update mirrors the SQL contract: user, enabled, earlier step. */
function fakeRepo(initial: Partial<Row>) {
  const state = { row: { id: 'r1', userId: USER, secretKey: SECRET, isEnabled: true, backupCodes: null,
    lastTotpStep: null, ...initial } as Row, failWrites: false };
  const findOne = async ({ where }: { where: { userId: string } }) =>
    where.userId === state.row.userId ? { ...state.row } : null;
  const save = async (r: Row) => {
    if (state.failWrites) throw new Error('connection terminated');
    state.row = { ...r };
    return r;
  };
  const repo = {
    findOne: jest.fn(findOne),
    save: jest.fn(save),
    create: jest.fn((x: Partial<Row>) => ({ ...x })),
    createQueryBuilder: jest.fn(() => {
      let values: Partial<Row> = {};
      let params: { userId?: string; step?: number } = {};
      const qb = {
        update: () => qb,
        set: (v: Partial<Row>) => ((values = v), qb),
        where: (_sql: string, p: typeof params) => ((params = p), qb),
        execute: async () => {
          if (state.failWrites) throw new Error('connection terminated');
          const r = state.row;
          const ok = r.userId === params.userId && r.isEnabled
            && (r.lastTotpStep === null || Number(r.lastTotpStep) < Number(params.step));
          if (ok) state.row = { ...r, ...values };
          return { affected: ok ? 1 : 0 };
        },
      };
      return qb;
    }),
    manager: {
      transaction: async <T>(fn: (m: unknown) => Promise<T>) =>
        fn({ findOne: (_entity: unknown, opts: { where: { userId: string } }) => findOne(opts), save }),
    },
  };
  return { repo, state, service: new TwoFactorService(repo as never) };
}

afterEach(() => jest.restoreAllMocks());

describe('TOTP replay protection', () => {
  it('accepts a valid code once; the same code again is rejected', async () => {
    const { service } = fakeRepo({});
    at(T0 + 5);
    expect(await service.verifyCode(USER, codeAt(T0))).toBe(true);
    at(T0 + 20);
    expect(await service.verifyCode(USER, codeAt(T0))).toBe(false);
  });

  it('the next time-step code is accepted after a successful sign-in', async () => {
    const { service } = fakeRepo({});
    at(T0 + 1);
    expect(await service.verifyCode(USER, codeAt(T0))).toBe(true);
    at(T0 + 31);
    expect(await service.verifyCode(USER, codeAt(T0 + 30))).toBe(true);
  });

  it('a code from the previous step (clock drift) is accepted once, and the current step still works', async () => {
    const { service } = fakeRepo({});
    at(T0 + 30);
    expect(await service.verifyCode(USER, codeAt(T0))).toBe(true);
    expect(await service.verifyCode(USER, codeAt(T0 + 30))).toBe(true);
    expect(await service.verifyCode(USER, codeAt(T0))).toBe(false);
    expect(await service.verifyCode(USER, codeAt(T0 + 30))).toBe(false);
  });

  it('after a code from the next step is accepted, codes from earlier steps are rejected', async () => {
    const { service } = fakeRepo({});
    at(T0 + 29);
    expect(await service.verifyCode(USER, codeAt(T0 + 30))).toBe(true);
    expect(await service.verifyCode(USER, codeAt(T0))).toBe(false);
    at(T0 + 61);
    expect(await service.verifyCode(USER, codeAt(T0 + 60))).toBe(true);
  });

  it('codes outside the one-step window are rejected and consume nothing', async () => {
    const { service, state } = fakeRepo({});
    at(T0 + 10);
    expect(await service.verifyCode(USER, codeAt(T0 + 60))).toBe(false);
    expect(await service.verifyCode(USER, codeAt(T0 - 60))).toBe(false);
    expect(state.row.lastTotpStep).toBeNull();
    expect(await service.verifyCode(USER, codeAt(T0))).toBe(true);
  });

  it('the enrolment code cannot be replayed to sign in', async () => {
    const { service } = fakeRepo({ isEnabled: false });
    at(T0 + 3);
    await service.verifyAndEnable(USER, codeAt(T0));
    expect(await service.verifyCode(USER, codeAt(T0))).toBe(false);
    at(T0 + 33);
    expect(await service.verifyCode(USER, codeAt(T0 + 30))).toBe(true);
  });

  it('a failed write leaves the code unconsumed', async () => {
    const { service, state } = fakeRepo({});
    at(T0 + 2);
    state.failWrites = true;
    await expect(service.verifyCode(USER, codeAt(T0))).rejects.toThrow('connection terminated');
    expect(state.row.lastTotpStep).toBeNull();
    state.failWrites = false;
    expect(await service.verifyCode(USER, codeAt(T0))).toBe(true);
  });

  it('a disabled factor accepts nothing and records nothing', async () => {
    const { service, state } = fakeRepo({ isEnabled: false });
    at(T0 + 2);
    expect(await service.verifyCode(USER, codeAt(T0))).toBe(false);
    expect(state.row.lastTotpStep).toBeNull();
  });

  it('another user is not affected by a consumed step', async () => {
    const a = fakeRepo({});
    const b = fakeRepo({ userId: 'b7c1d2e3-0000-4000-8000-000000000002' });
    at(T0 + 4);
    expect(await a.service.verifyCode(USER, codeAt(T0))).toBe(true);
    expect(await b.service.verifyCode('b7c1d2e3-0000-4000-8000-000000000002', codeAt(T0))).toBe(true);
  });
});

describe('backup codes', () => {
  it('a backup code is single-use and may be typed in lower case', async () => {
    const hashes = await Promise.all(['A1B2C3D4', 'E5F60718'].map((c) => bcrypt.hash(c, 4)));
    const { service, state } = fakeRepo({ backupCodes: JSON.stringify(hashes) });
    expect(await service.verifyCode(USER, 'a1b2c3d4')).toBe(true);
    expect(await service.verifyCode(USER, 'A1B2C3D4')).toBe(false);
    expect(JSON.parse(state.row.backupCodes as string)).toHaveLength(1);
  });

  it('a failed write keeps the backup code', async () => {
    const hashes = [await bcrypt.hash('A1B2C3D4', 4)];
    const { service, state } = fakeRepo({ backupCodes: JSON.stringify(hashes) });
    state.failWrites = true;
    await expect(service.verifyCode(USER, 'A1B2C3D4')).rejects.toThrow('connection terminated');
    state.failWrites = false;
    expect(await service.verifyCode(USER, 'A1B2C3D4')).toBe(true);
  });
});

describe('enrolment while 2FA is enabled', () => {
  it('is refused: the active secret and factor stay unchanged', async () => {
    const { service, state } = fakeRepo({});
    await expect(service.generateSecret(USER, 'u@example.test')).rejects.toBeInstanceOf(ConflictException);
    expect(state.row.isEnabled).toBe(true);
    expect(state.row.secretKey).toBe(SECRET);
  });

  it('a factor that was never verified can be enrolled again', async () => {
    const { service, state } = fakeRepo({ isEnabled: false, secretKey: 'OLDSECRETOLDSECR' });
    const setup = await service.generateSecret(USER, 'u@example.test');
    expect(state.row.secretKey).toBe(setup.secret);
    expect(state.row.isEnabled).toBe(false);
  });
});

describe('twoFactorLogin with a replayed code', () => {
  it('returns 401, records a failed attempt and issues no session', async () => {
    const { service } = fakeRepo({});
    const user = { id: USER, companyId: 'c1', role: 'Admin', name: 'U', email: 'u@example.test', company: { id: 'c1' } };
    const stored: { refreshTokenHash: string | null } = { refreshTokenHash: null };
    const failures: boolean[] = [];
    const bruteForce = {
      assertNotLocked: jest.fn(async () => {
        if (failures.filter((ok) => !ok).length >= 5) throw new HttpException('Too many attempts', 429);
      }),
      record: jest.fn(async (_e: string, _ip: unknown, _ua: unknown, ok: boolean) => void failures.push(ok)),
    };
    const cfg: Record<string, string> = {
      JWT_ACCESS_SECRET: 'access-secret-test', JWT_REFRESH_SECRET: 'refresh-secret-test', JWT_2FA_SECRET: 'twofa-test',
    };
    const jwt = new JwtService({});
    const auth = new AuthService(
      { findOne: jest.fn(async () => user), update: jest.fn(async (_id: string, p: { refreshTokenHash?: string }) => {
        stored.refreshTokenHash = p.refreshTokenHash ?? null;
      }) } as never,
      {} as never, {} as never, jwt, { get: (k: string, d?: string) => cfg[k] ?? d } as never,
      {} as never, service as never, bruteForce as never, { write: jest.fn() } as never, {} as never,
    );
    const temp = () => jwt.signAsync({ sub: USER, purpose: '2fa_pending' }, { secret: cfg.JWT_2FA_SECRET, expiresIn: '2m' });

    at(T0 + 7);
    const first = (await auth.twoFactorLogin(await temp(), codeAt(T0), {})) as { refreshToken?: string };
    expect(typeof first.refreshToken).toBe('string');
    const issued = stored.refreshTokenHash;

    await expect(auth.twoFactorLogin(await temp(), codeAt(T0), {})).rejects.toBeInstanceOf(UnauthorizedException);
    expect(failures).toEqual([true, false]);
    expect(stored.refreshTokenHash).toBe(issued);
  });
});
