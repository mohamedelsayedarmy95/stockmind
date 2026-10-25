/**
 * Series 09 / S1: the pure membership policy. Who may suspend, remove, reactivate, re-role or sign out whom, and what each
 * allowed action changes. No database: every rule of the contract is pinned here, the integration spec proves the wiring.
 */
import {
  decideMembershipAction,
  MembershipActor,
  MembershipPolicyError,
  MembershipTarget,
  MEMBERSHIP_ERROR_STATUS,
} from '../../src/domain/membership/membership-policy';
import { MemberStatus, UserRole } from '../../src/shared/constants/enums';

const C = 'company-1';
const actor = (over: Partial<MembershipActor> = {}): MembershipActor =>
  ({ id: 'owner', companyId: C, role: UserRole.ADMIN, status: MemberStatus.ACTIVE, isOwner: true, ...over });
const target = (over: Partial<MembershipTarget> = {}): MembershipTarget =>
  ({ id: 'member', companyId: C, role: UserRole.STAFF, status: MemberStatus.ACTIVE, isOwner: false, ...over });
const ctx = (activeOwners = 1) => ({ activeOwners });
const refusal = (fn: () => unknown): string => {
  try { fn(); } catch (e) { return e instanceof MembershipPolicyError ? e.code : `OTHER:${(e as Error).message}`; }
  return 'ALLOWED';
};

describe('membership policy: what an allowed action changes', () => {
  it('suspend: status, immediate revocation of access tokens and of the refresh token; grants are kept (reversible)', () => {
    expect(decideMembershipAction('suspend', actor(), target(), ctx())).toEqual({
      eventType: 'suspend', toStatus: 'suspended', toRole: 'Staff',
      bumpTokenVersion: true, clearRefreshToken: true, clearWarehouseGrants: false, clearCustomRoles: false,
    });
  });
  it('remove: revokes like suspend and also clears grants and custom roles (nothing silently returns on reactivation)', () => {
    const e = decideMembershipAction('remove', actor(), target(), ctx());
    expect(e).toMatchObject({ toStatus: 'removed', bumpTokenVersion: true, clearRefreshToken: true, clearWarehouseGrants: true, clearCustomRoles: true });
  });
  it('reactivate: from suspended or removed back to active; no revocation (the old tokens are already dead)', () => {
    for (const from of [MemberStatus.SUSPENDED, MemberStatus.REMOVED]) {
      expect(decideMembershipAction('reactivate', actor(), target({ status: from }), ctx()))
        .toMatchObject({ toStatus: 'active', bumpTokenVersion: false, clearRefreshToken: false });
    }
  });
  it('revoke_sessions: bumps the version and clears the refresh token, nothing else changes', () => {
    expect(decideMembershipAction('revoke_sessions', actor(), target(), ctx()))
      .toMatchObject({ toStatus: 'active', toRole: 'Staff', bumpTokenVersion: true, clearRefreshToken: true, clearWarehouseGrants: false });
  });
  it('change_role: old tokens die (the next request is judged under the new role) but the refresh token stays, so the app renews quietly', () => {
    const e = decideMembershipAction('change_role', actor(), target({ role: UserRole.MANAGER }), ctx(), { newRole: UserRole.STAFF });
    expect(e).toMatchObject({ toRole: 'Staff', bumpTokenVersion: true, clearRefreshToken: false, clearWarehouseGrants: true });
  });
  it('change_role to Manager keeps existing grants untouched (they are ignored for Manager) and needs the acknowledgement', () => {
    expect(refusal(() => decideMembershipAction('change_role', actor(), target(), ctx(), { newRole: UserRole.MANAGER }))).toBe('ACKNOWLEDGEMENT_REQUIRED');
    expect(decideMembershipAction('change_role', actor(), target(), ctx(), { newRole: UserRole.MANAGER, acknowledgeCompanyWideAccess: true }))
      .toMatchObject({ toRole: 'Manager', clearWarehouseGrants: false });
  });
});

describe('membership policy: refusals', () => {
  it('an inactive actor can do nothing', () => {
    for (const status of [MemberStatus.SUSPENDED, MemberStatus.REMOVED]) {
      expect(refusal(() => decideMembershipAction('suspend', actor({ status }), target(), ctx()))).toBe('ACTOR_NOT_ACTIVE');
    }
  });
  it('nobody suspends, removes or re-roles themselves; signing yourself out everywhere is allowed', () => {
    const me = target({ id: 'owner', role: UserRole.ADMIN, isOwner: true });
    for (const action of ['suspend', 'remove', 'reactivate', 'change_role'] as const) {
      expect(refusal(() => decideMembershipAction(action, actor(), me, ctx(2), { newRole: UserRole.STAFF }))).toBe('CANNOT_MODIFY_SELF');
    }
    expect(refusal(() => decideMembershipAction('revoke_sessions', actor(), me, ctx(1)))).toBe('ALLOWED');
  });
  it('acting on an Admin needs an owner: an Admin who is not the owner cannot touch another Admin or the owner', () => {
    const admin = actor({ id: 'admin-2', isOwner: false });
    for (const action of ['suspend', 'remove', 'reactivate', 'revoke_sessions'] as const) {
      expect(refusal(() => decideMembershipAction(action, admin, target({ role: UserRole.ADMIN, status: action === 'reactivate' ? MemberStatus.SUSPENDED : MemberStatus.ACTIVE }), ctx()))).toBe('OWNER_REQUIRED');
    }
    expect(refusal(() => decideMembershipAction('change_role', admin, target({ role: UserRole.ADMIN }), ctx(), { newRole: UserRole.STAFF }))).toBe('OWNER_REQUIRED');
  });
  it('a company without any owner (legacy, ambiguous) fails closed for Admin targets but still manages Manager and Staff', () => {
    const admin = actor({ id: 'admin-1', isOwner: false });
    expect(refusal(() => decideMembershipAction('suspend', admin, target({ role: UserRole.ADMIN }), ctx(0)))).toBe('OWNER_REQUIRED');
    expect(refusal(() => decideMembershipAction('suspend', admin, target({ role: UserRole.STAFF }), ctx(0)))).toBe('ALLOWED');
    expect(refusal(() => decideMembershipAction('remove', admin, target({ role: UserRole.MANAGER }), ctx(0)))).toBe('ALLOWED');
  });
  it('the last active owner can never be suspended or removed, and an owner cannot be re-roled in this release', () => {
    const owner = target({ role: UserRole.ADMIN, isOwner: true });
    const other = actor({ id: 'another-owner' });
    expect(refusal(() => decideMembershipAction('suspend', other, owner, ctx(1)))).toBe('LAST_OWNER');
    expect(refusal(() => decideMembershipAction('remove', other, owner, ctx(1)))).toBe('LAST_OWNER');
    expect(refusal(() => decideMembershipAction('suspend', other, owner, ctx(2)))).toBe('ALLOWED'); // another owner remains
    expect(refusal(() => decideMembershipAction('change_role', other, owner, ctx(2), { newRole: UserRole.MANAGER, acknowledgeCompanyWideAccess: true }))).toBe('INVALID_TRANSITION');
  });
  it('only an owner can make someone an Admin, and even then it needs the company-wide acknowledgement', () => {
    expect(refusal(() => decideMembershipAction('change_role', actor({ isOwner: false }), target(), ctx(), { newRole: UserRole.ADMIN, acknowledgeCompanyWideAccess: true }))).toBe('OWNER_REQUIRED');
    expect(refusal(() => decideMembershipAction('change_role', actor(), target(), ctx(), { newRole: UserRole.ADMIN }))).toBe('ACKNOWLEDGEMENT_REQUIRED');
    expect(refusal(() => decideMembershipAction('change_role', actor(), target(), ctx(), { newRole: UserRole.ADMIN, acknowledgeCompanyWideAccess: true }))).toBe('ALLOWED');
  });
  it('transitions must make sense', () => {
    expect(refusal(() => decideMembershipAction('suspend', actor(), target({ status: MemberStatus.SUSPENDED }), ctx()))).toBe('INVALID_TRANSITION');
    expect(refusal(() => decideMembershipAction('suspend', actor(), target({ status: MemberStatus.REMOVED }), ctx()))).toBe('INVALID_TRANSITION');
    expect(refusal(() => decideMembershipAction('remove', actor(), target({ status: MemberStatus.REMOVED }), ctx()))).toBe('INVALID_TRANSITION');
    expect(refusal(() => decideMembershipAction('reactivate', actor(), target(), ctx()))).toBe('INVALID_TRANSITION');
    expect(refusal(() => decideMembershipAction('change_role', actor(), target({ status: MemberStatus.SUSPENDED }), ctx(), { newRole: UserRole.MANAGER, acknowledgeCompanyWideAccess: true }))).toBe('TARGET_NOT_ACTIVE');
    expect(refusal(() => decideMembershipAction('change_role', actor(), target(), ctx(), { newRole: UserRole.STAFF }))).toBe('NO_CHANGE');
    expect(refusal(() => decideMembershipAction('change_role', actor(), target(), ctx(), {}))).toBe('ROLE_REQUIRED');
    expect(refusal(() => decideMembershipAction('change_role', actor(), target(), ctx(), { newRole: 'Superuser' as UserRole }))).toBe('ROLE_REQUIRED');
  });
  it('every refusal code maps to an HTTP status (authority 403, state 409, malformed 400)', () => {
    expect(Object.values(MEMBERSHIP_ERROR_STATUS).every((s) => [400, 403, 409].includes(s))).toBe(true);
    expect(MEMBERSHIP_ERROR_STATUS.OWNER_REQUIRED).toBe(403);
    expect(MEMBERSHIP_ERROR_STATUS.LAST_OWNER).toBe(409);
    expect(MEMBERSHIP_ERROR_STATUS.ACKNOWLEDGEMENT_REQUIRED).toBe(400);
  });
});
