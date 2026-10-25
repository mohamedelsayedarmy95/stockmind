/**
 * Online sign-in rules, kept free of React Native so they run in plain Node.
 *
 * `/auth/login` (and `/auth/google`) answer either a token pair or, when the user enabled 2FA, a challenge
 * `{requires_2fa, temp_token}` that only `POST /auth/2fa/login` can redeem. A session is created only from a body that
 * really carries both tokens: anything else is an error, never a session with an undefined token.
 */

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface SessionPayload {
  accessToken: string;
  refreshToken: string;
  user: SessionUser;
  /** Only `/auth/accept-invitation` returns it (id only). */
  company?: { id: string; name?: string } | null;
}

export type LoginOutcome =
  | { kind: 'session'; session: SessionPayload }
  | { kind: 'second-factor'; tempToken: string };

export class AuthFlowError extends Error {
  constructor(public readonly code: 'MALFORMED_AUTH_RESPONSE') {
    super(code);
    this.name = 'AuthFlowError';
  }
}

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

function asUser(v: unknown): SessionUser | null {
  if (!v || typeof v !== 'object') return null;
  const u = v as Record<string, unknown>;
  if (!nonEmpty(u.id) || typeof u.email !== 'string' || typeof u.role !== 'string') return null;
  return { id: u.id, name: typeof u.name === 'string' ? u.name : '', email: u.email, role: u.role };
}

/** Classifies a sign-in response body. Throws AuthFlowError for a body that is neither a session nor a challenge. */
export function classifyLoginResponse(body: unknown): LoginOutcome {
  if (!body || typeof body !== 'object') throw new AuthFlowError('MALFORMED_AUTH_RESPONSE');
  const b = body as Record<string, unknown>;

  if (b.requires_2fa === true) {
    if (!nonEmpty(b.temp_token)) throw new AuthFlowError('MALFORMED_AUTH_RESPONSE');
    return { kind: 'second-factor', tempToken: b.temp_token };
  }

  const user = asUser(b.user);
  if (!nonEmpty(b.accessToken) || !nonEmpty(b.refreshToken) || !user) {
    throw new AuthFlowError('MALFORMED_AUTH_RESPONSE');
  }
  const company =
    b.company && typeof b.company === 'object' && nonEmpty((b.company as Record<string, unknown>).id)
      ? (b.company as { id: string; name?: string })
      : null;
  return { kind: 'session', session: { accessToken: b.accessToken, refreshToken: b.refreshToken, user, company } };
}

/** The second step must end in a session: a second challenge is as malformed as a missing token. */
export function requireSession(body: unknown): SessionPayload {
  const outcome = classifyLoginResponse(body);
  if (outcome.kind !== 'session') throw new AuthFlowError('MALFORMED_AUTH_RESPONSE');
  return outcome.session;
}

/** A 6-digit TOTP code or a backup code, as the server's DTO accepts it; spaces and dashes are typing aids. */
export function normalizeOtpInput(text: string): string | null {
  const code = text.replace(/[\s-]/g, '');
  return /^[0-9A-Za-z]{6,10}$/.test(code) ? code : null;
}

/** The server signs temp tokens for 2 minutes; past this age a 401 means "start again", not "wrong code". */
export const TEMP_TOKEN_TTL_MS = 120_000;
const TEMP_TOKEN_MARGIN_MS = 10_000;

export type TwoFactorFailure = 'expired' | 'invalid-code' | 'locked' | 'network' | 'error';

/** Why the 2FA step failed. Both an expired session and a wrong code are 401, so the challenge age tells them apart. */
export function twoFactorFailure(status: number | undefined, challengeAgeMs: number): TwoFactorFailure {
  if (status === undefined) return 'network';
  if (status === 401) {
    return challengeAgeMs >= TEMP_TOKEN_TTL_MS - TEMP_TOKEN_MARGIN_MS ? 'expired' : 'invalid-code';
  }
  if (status === 429 || status === 423) return 'locked';
  return 'error';
}

export type LoginFailure = 'invalid-credentials' | 'locked' | 'network' | 'access-revoked' | 'error';

export function loginFailure(status: number | undefined, code?: string | undefined): LoginFailure {
  if (status === undefined) return 'network';
  // Series 09: the member's access was suspended or removed. The server says so only after the password was right.
  if (code === ACCESS_REVOKED_CODE) return 'access-revoked';
  if (status === 401 || status === 400) return 'invalid-credentials';
  if (status === 429 || status === 423) return 'locked';
  return 'error';
}

// ── Invitations ─────────────────────────────────────────────────────────────

export interface InvitationInput {
  token: string;
  name: string;
  password: string;
}

export type InvitationField = 'token' | 'name' | 'password';

/** Accepts the raw token or a link carrying `token=…` (the invite may be shared either way). */
export function extractInvitationToken(text: string): string {
  const trimmed = text.trim();
  const match = /[?&#]token=([^&#\s]+)/.exec(trimmed);
  if (!match) return trimmed;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/**
 * Mirrors the server's AcceptInvitationDto: token 20–200 chars, a name, and class-validator's default strong password
 * (8+ characters with a lowercase and an uppercase letter, a digit and a symbol). Returns the invalid fields.
 */
export function validateInvitation(input: InvitationInput): InvitationField[] {
  const invalid: InvitationField[] = [];
  const token = extractInvitationToken(input.token);
  if (token.length < 20 || token.length > 200) invalid.push('token');
  const name = input.name.trim();
  if (name.length === 0 || name.length > 255) invalid.push('name');
  const p = input.password;
  const strong =
    p.length >= 8 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /[0-9]/.test(p) && /[^A-Za-z0-9]/.test(p);
  if (!strong) invalid.push('password');
  return invalid;
}

export type InvitationFailure = 'invalid-or-expired' | 'email-registered' | 'no-seat' | 'network' | 'error';

export function invitationFailure(status: number | undefined): InvitationFailure {
  if (status === undefined) return 'network';
  if (status === 400) return 'invalid-or-expired';
  if (status === 409) return 'email-registered';
  if (status === 402) return 'no-seat';
  return 'error';
}

/** The machine-readable reason the server gives when a member's access was suspended/removed or their sessions revoked. */
export const ACCESS_REVOKED_CODE = 'ACCESS_REVOKED';

/** The `code` of an axios-style error body, when the server sent one; undefined otherwise. */
export function errorCodeOf(err: unknown): string | undefined {
  const code = (err as { response?: { data?: { code?: unknown } } } | null)?.response?.data?.code;
  return typeof code === 'string' ? code : undefined;
}

/** True when the server refused because the member's access was revoked (not because a token merely expired). */
export function isAccessRevoked(err: unknown): boolean {
  return errorCodeOf(err) === ACCESS_REVOKED_CODE;
}

/** HTTP status of an axios-style error; undefined when no response arrived (offline, timeout, DNS). */
export function httpStatusOf(err: unknown): number | undefined {
  const status = (err as { response?: { status?: unknown } } | null)?.response?.status;
  return typeof status === 'number' ? status : undefined;
}
