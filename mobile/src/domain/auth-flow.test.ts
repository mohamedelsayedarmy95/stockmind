import {
  AuthFlowError,
  classifyLoginResponse,
  extractInvitationToken,
  httpStatusOf,
  invitationFailure,
  loginFailure,
  normalizeOtpInput,
  requireSession,
  TEMP_TOKEN_TTL_MS,
  twoFactorFailure,
  validateInvitation,
} from './auth-flow';

const user = { id: 'u1', name: 'Bee', email: 'b@example.test', role: 'Staff' };
const pair = { accessToken: 'a.b.c', refreshToken: 'r.s.t', user };

describe('online sign-in: login response', () => {
  it('a token pair becomes a session', () => {
    expect(classifyLoginResponse(pair)).toEqual({
      kind: 'session',
      session: { ...pair, company: null },
    });
  });

  it('a 2FA challenge is NOT a session: it yields the temp token for /auth/2fa/login', () => {
    expect(classifyLoginResponse({ requires_2fa: true, temp_token: 'tmp.jwt' })).toEqual({
      kind: 'second-factor',
      tempToken: 'tmp.jwt',
    });
  });

  it('never produces a session with a missing token or user (the old undefined-token bug)', () => {
    for (const body of [
      { requires_2fa: true },
      { requires_2fa: true, temp_token: '' },
      { user },
      { accessToken: 'a', user },
      { accessToken: 'a', refreshToken: 'r' },
      { ...pair, user: { name: 'x' } },
      null,
      'ok',
    ]) {
      expect(() => classifyLoginResponse(body)).toThrow(AuthFlowError);
    }
  });

  it('keeps the company id an invitation returns', () => {
    const out = classifyLoginResponse({ ...pair, company: { id: 'c1' } });
    expect(out.kind === 'session' && out.session.company).toEqual({ id: 'c1' });
  });

  it('the second step must end in a session, not another challenge', () => {
    expect(requireSession(pair).accessToken).toBe('a.b.c');
    expect(() => requireSession({ requires_2fa: true, temp_token: 't' })).toThrow(AuthFlowError);
  });
});

describe('online sign-in: 2FA step', () => {
  it('normalizes a typed code the way the server DTO accepts it', () => {
    expect(normalizeOtpInput(' 123 456 ')).toBe('123456');
    expect(normalizeOtpInput('abcd-1234')).toBe('abcd1234');
    expect(normalizeOtpInput('12345')).toBeNull();
    expect(normalizeOtpInput('12345678901')).toBeNull();
    expect(normalizeOtpInput('12345!')).toBeNull();
  });

  it('tells a wrong code from an expired temp token (both are 401)', () => {
    expect(twoFactorFailure(401, 5_000)).toBe('invalid-code');
    expect(twoFactorFailure(401, TEMP_TOKEN_TTL_MS)).toBe('expired');
    expect(twoFactorFailure(401, TEMP_TOKEN_TTL_MS - 5_000)).toBe('expired');
    expect(twoFactorFailure(429, 1_000)).toBe('locked');
    expect(twoFactorFailure(undefined, 1_000)).toBe('network');
    expect(twoFactorFailure(500, 1_000)).toBe('error');
  });

  it('maps password-step failures', () => {
    expect(loginFailure(401)).toBe('invalid-credentials');
    expect(loginFailure(429)).toBe('locked');
    expect(loginFailure(undefined)).toBe('network');
    expect(loginFailure(503)).toBe('error');
  });
});

describe('invitation acceptance', () => {
  const token = 'x'.repeat(43);

  it('accepts a raw token or a link carrying it', () => {
    expect(extractInvitationToken(`  ${token}  `)).toBe(token);
    expect(extractInvitationToken(`stockmind://invite?token=${token}&x=1`)).toBe(token);
    expect(extractInvitationToken(`https://app.example/join#token=${token}`)).toBe(token);
  });

  it('mirrors the server rules: token length, a name, a strong password', () => {
    expect(validateInvitation({ token, name: 'Bee', password: 'Str0ng!pw' })).toEqual([]);
    expect(validateInvitation({ token: 'short', name: ' ', password: 'weakpass' })).toEqual([
      'token',
      'name',
      'password',
    ]);
    for (const pw of ['Sh0rt!', 'nouppercase1!', 'NOLOWERCASE1!', 'NoDigits!!', 'NoSymbol12']) {
      expect(validateInvitation({ token, name: 'Bee', password: pw })).toEqual(['password']);
    }
  });

  it('maps server answers to what the user can do about them', () => {
    expect(invitationFailure(400)).toBe('invalid-or-expired');
    expect(invitationFailure(409)).toBe('email-registered');
    expect(invitationFailure(402)).toBe('no-seat');
    expect(invitationFailure(undefined)).toBe('network');
    expect(invitationFailure(500)).toBe('error');
  });

  it('reads the HTTP status of an axios-style error, undefined when no response arrived', () => {
    expect(httpStatusOf({ response: { status: 409 } })).toBe(409);
    expect(httpStatusOf(new Error('Network Error'))).toBeUndefined();
    expect(httpStatusOf(null)).toBeUndefined();
  });
});
