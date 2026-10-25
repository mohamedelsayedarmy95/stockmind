import { MemberStatus, UserRole } from '../../shared/constants/enums';

/**
 * Who may do what to whom inside one company (Series 09 / S1). Pure: no database, no framework, so every rule is
 * unit-testable and the service only has to load the facts and apply the answer.
 *
 * Principles (approved decisions Q-02, Q-03, Q-07):
 *  - Manager semantics are untouched: a Manager still sees every warehouse; nothing here grants or removes that silently.
 *  - Ownership is metadata (`isOwner`), separate from the Admin role. It never changes through this module. The last
 *    active owner is protected, and a company with no owner (legacy ambiguity) fails closed for actions on Admins.
 *  - Acting on an Admin member (suspend, remove, reactivate, demote) and promoting anyone to Admin need an owner.
 *  - No silent broadening: promoting to Manager or Admin needs an explicit acknowledgement that it is company-wide.
 */
export type MembershipAction = 'suspend' | 'reactivate' | 'remove' | 'change_role' | 'revoke_sessions';

export interface MembershipActor { id: string; companyId: string; role: UserRole; status: MemberStatus; isOwner: boolean }
export interface MembershipTarget { id: string; companyId: string; role: UserRole; status: MemberStatus; isOwner: boolean }
export interface MembershipContext {
  /** Active owners in the company, the target included when it is one. */
  activeOwners: number;
}
export interface MembershipInput {
  newRole?: UserRole;
  /** Must be true to promote to Manager or Admin (company-wide access). */
  acknowledgeCompanyWideAccess?: boolean;
}

export type MembershipErrorCode =
  | 'ACTOR_NOT_ACTIVE'
  | 'CANNOT_MODIFY_SELF'
  | 'OWNER_REQUIRED'
  | 'LAST_OWNER'
  | 'INVALID_TRANSITION'
  | 'NO_CHANGE'
  | 'ROLE_REQUIRED'
  | 'ACKNOWLEDGEMENT_REQUIRED'
  | 'TARGET_NOT_ACTIVE';

/** How a refusal maps onto HTTP: authority problems are 403, state problems 409, malformed requests 400. */
export const MEMBERSHIP_ERROR_STATUS: Record<MembershipErrorCode, 400 | 403 | 409> = {
  ACTOR_NOT_ACTIVE: 403,
  CANNOT_MODIFY_SELF: 409,
  OWNER_REQUIRED: 403,
  LAST_OWNER: 409,
  INVALID_TRANSITION: 409,
  NO_CHANGE: 409,
  ROLE_REQUIRED: 400,
  ACKNOWLEDGEMENT_REQUIRED: 400,
  TARGET_NOT_ACTIVE: 409,
};

export class MembershipPolicyError extends Error {
  constructor(readonly code: MembershipErrorCode, message: string) {
    super(message);
    this.name = 'MembershipPolicyError';
  }
}

/** What applying an allowed action changes. */
export interface MembershipEffects {
  eventType: MembershipAction;
  toStatus: MemberStatus;
  toRole: UserRole;
  /** token_version + 1: every access token issued before now stops working on its next request. */
  bumpTokenVersion: boolean;
  /** Clears the stored refresh hash, so the member cannot obtain a new session. */
  clearRefreshToken: boolean;
  /** Deletes the member's warehouse grants (Staff) and custom role links. */
  clearWarehouseGrants: boolean;
  clearCustomRoles: boolean;
}

const ROLES = new Set<string>(Object.values(UserRole));

export function decideMembershipAction(
  action: MembershipAction,
  actor: MembershipActor,
  target: MembershipTarget,
  ctx: MembershipContext,
  input: MembershipInput = {},
): MembershipEffects {
  if (actor.status !== MemberStatus.ACTIVE) {
    throw new MembershipPolicyError('ACTOR_NOT_ACTIVE', 'Your own access is not active');
  }
  if (actor.companyId !== target.companyId) {
    // The service answers 404 before reaching here; this is the backstop.
    throw new MembershipPolicyError('OWNER_REQUIRED', 'Not a member of your company');
  }

  const self = actor.id === target.id;
  // Signing yourself out everywhere is fine; locking yourself out or demoting yourself is not (no self-lockout).
  if (self && action !== 'revoke_sessions') {
    throw new MembershipPolicyError('CANNOT_MODIFY_SELF', 'You cannot change your own membership; ask another owner');
  }

  // Authority over Admin members belongs to an owner. In a company without any owner this is deliberately unreachable.
  if (target.role === UserRole.ADMIN && !actor.isOwner && !self) {
    throw new MembershipPolicyError('OWNER_REQUIRED', 'Only the company owner can change an Admin member');
  }

  const base: MembershipEffects = {
    eventType: action,
    toStatus: target.status,
    toRole: target.role,
    bumpTokenVersion: false,
    clearRefreshToken: false,
    clearWarehouseGrants: false,
    clearCustomRoles: false,
  };
  const losesOwnerSeat = target.isOwner && target.status === MemberStatus.ACTIVE;
  const assertNotLastOwner = () => {
    if (losesOwnerSeat && ctx.activeOwners <= 1) {
      throw new MembershipPolicyError('LAST_OWNER', 'The last active owner cannot be suspended, removed or demoted');
    }
    if (losesOwnerSeat && !actor.isOwner) {
      throw new MembershipPolicyError('OWNER_REQUIRED', 'Only an owner can change another owner');
    }
  };

  switch (action) {
    case 'suspend': {
      if (target.status !== MemberStatus.ACTIVE) {
        throw new MembershipPolicyError('INVALID_TRANSITION', `A ${target.status} member cannot be suspended`);
      }
      assertNotLastOwner();
      return { ...base, toStatus: MemberStatus.SUSPENDED, bumpTokenVersion: true, clearRefreshToken: true };
    }
    case 'remove': {
      if (target.status === MemberStatus.REMOVED) {
        throw new MembershipPolicyError('INVALID_TRANSITION', 'The member is already removed');
      }
      assertNotLastOwner();
      return {
        ...base, toStatus: MemberStatus.REMOVED, bumpTokenVersion: true, clearRefreshToken: true,
        clearWarehouseGrants: true, clearCustomRoles: true,
      };
    }
    case 'reactivate': {
      if (target.status === MemberStatus.ACTIVE) {
        throw new MembershipPolicyError('INVALID_TRANSITION', 'The member is already active');
      }
      // Returning access is not a silent grant: a removed member comes back with no warehouse grants and no custom
      // roles (both were cleared at removal); a suspended one comes back exactly as they were.
      return { ...base, toStatus: MemberStatus.ACTIVE };
    }
    case 'revoke_sessions': {
      return { ...base, bumpTokenVersion: true, clearRefreshToken: true };
    }
    case 'change_role': {
      if (!input.newRole || !ROLES.has(input.newRole)) {
        throw new MembershipPolicyError('ROLE_REQUIRED', 'A valid role is required');
      }
      if (target.status !== MemberStatus.ACTIVE) {
        throw new MembershipPolicyError('TARGET_NOT_ACTIVE', 'Only an active member can change role; reactivate first');
      }
      if (input.newRole === target.role) {
        throw new MembershipPolicyError('NO_CHANGE', 'The member already has that role');
      }
      // Ownership and the Admin role travel together in this release; transferring ownership is a later, separate flow.
      if (target.isOwner) {
        throw new MembershipPolicyError('INVALID_TRANSITION', 'An owner keeps the Admin role; ownership is not transferred in this release');
      }
      if (input.newRole === UserRole.ADMIN && !actor.isOwner) {
        throw new MembershipPolicyError('OWNER_REQUIRED', 'Only the company owner can make someone an Admin');
      }
      const broadens = input.newRole === UserRole.ADMIN || (input.newRole === UserRole.MANAGER && target.role === UserRole.STAFF);
      if (broadens && input.acknowledgeCompanyWideAccess !== true) {
        throw new MembershipPolicyError(
          'ACKNOWLEDGEMENT_REQUIRED',
          'Manager and Admin see every warehouse of the company; confirm that this is intended',
        );
      }
      return {
        ...base,
        toRole: input.newRole,
        // The old token carried the old role; the next request must be judged under the new one. The refresh token is
        // kept, so the member's app renews quietly instead of being signed out.
        bumpTokenVersion: true,
        // A Staff member starts with no grants (never the leftovers of an earlier role): the Admin grants explicitly.
        clearWarehouseGrants: input.newRole === UserRole.STAFF,
      };
    }
  }
}
