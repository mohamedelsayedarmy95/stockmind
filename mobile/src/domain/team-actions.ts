/**
 * What the Team screen offers for a member (Series 09 / S1). This mirrors the server's membership policy ONLY to decide
 * which buttons to show; the server stays the authority and every refusal it gives is translated by `teamErrorKey`. If the
 * two ever disagree, the person sees a calm message, never a wrong state.
 */
export type MemberStatus = 'active' | 'suspended' | 'removed';
export type MemberRole = 'Admin' | 'Manager' | 'Staff';

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: MemberRole;
  status: MemberStatus;
  isOwner: boolean;
  statusChangedAt: string | null;
  /** 'all' for Admin and Manager; otherwise the granted warehouse ids. */
  warehouses: 'all' | string[];
}

export type TeamAction = 'suspend' | 'reactivate' | 'remove' | 'revoke_sessions' | 'change_role' | 'manage_access';

export interface TeamViewer {
  id: string;
  isOwner: boolean;
}

/** Active owners in the list: a viewer cannot tell from one row whether an owner is the last one. */
export function activeOwnerCount(members: readonly TeamMember[]): number {
  return members.filter((m) => m.isOwner && m.status === 'active').length;
}

/**
 * Warehouse access (Series 10) is offered for Staff members only (Admin and Manager already see every warehouse), whether active
 * or suspended (a suspension is reversible, the assignments are kept), never for the viewer's own account.
 */
export function availableActions(viewer: TeamViewer, member: TeamMember, activeOwners: number): TeamAction[] {
  const base = baseActions(viewer, member, activeOwners);
  const mayAssign = viewer.id !== member.id && member.role === 'Staff' && member.status !== 'removed';
  return mayAssign ? ['manage_access', ...base] : base;
}

function baseActions(viewer: TeamViewer, member: TeamMember, activeOwners: number): TeamAction[] {
  const self = viewer.id === member.id;
  if (self) return member.status === 'active' ? ['revoke_sessions'] : [];
  // Acting on an Admin member needs the owner (a company without any owner therefore offers nothing on Admins).
  if (member.role === 'Admin' && !viewer.isOwner) return [];

  const protectedOwner = member.isOwner && member.status === 'active' && activeOwners <= 1;
  switch (member.status) {
    case 'active':
      return protectedOwner
        ? ['revoke_sessions']
        : member.isOwner
          ? ['suspend', 'remove', 'revoke_sessions'] // an owner keeps the Admin role: no role change
          : ['change_role', 'revoke_sessions', 'suspend', 'remove'];
    case 'suspended':
      return ['reactivate', 'remove'];
    case 'removed':
      return ['reactivate'];
  }
}

export interface RoleChoice {
  role: MemberRole;
  /** The change gives company-wide access: the person must confirm it explicitly (the server insists too). */
  needsAcknowledgement: boolean;
}

/** Roles the viewer may move the member to. Only an owner can make an Admin. */
export function roleChoices(viewer: TeamViewer, member: TeamMember): RoleChoice[] {
  const all: MemberRole[] = ['Staff', 'Manager', 'Admin'];
  return all
    .filter((r) => r !== member.role && (r !== 'Admin' || viewer.isOwner))
    .map((role) => ({
      role,
      needsAcknowledgement: role === 'Admin' || (role === 'Manager' && member.role === 'Staff'),
    }));
}

/** Server refusal codes of the membership endpoints → copy keys (every code has a message in both languages). */
const ERROR_KEYS: Record<string, string> = {
  OWNER_REQUIRED: 'team.error.OWNER_REQUIRED',
  LAST_OWNER: 'team.error.LAST_OWNER',
  CANNOT_MODIFY_SELF: 'team.error.CANNOT_MODIFY_SELF',
  INVALID_TRANSITION: 'team.error.INVALID_TRANSITION',
  NO_CHANGE: 'team.error.NO_CHANGE',
  ACKNOWLEDGEMENT_REQUIRED: 'team.error.ACKNOWLEDGEMENT_REQUIRED',
  ACTOR_NOT_ACTIVE: 'team.error.ACTOR_NOT_ACTIVE',
  TARGET_NOT_ACTIVE: 'team.error.TARGET_NOT_ACTIVE',
  ROLE_REQUIRED: 'team.error.generic',
  ACCESS_REVOKED: 'team.error.ACTOR_NOT_ACTIVE',
};
export const TEAM_ERROR_CODES = Object.keys(ERROR_KEYS);

export function teamErrorKey(status: number | undefined, code: string | undefined): string {
  if (status === undefined) return 'team.error.network';
  if (code && ERROR_KEYS[code]) return ERROR_KEYS[code];
  if (status === 403) return 'team.error.forbidden';
  if (status === 404) return 'team.error.notFound';
  return 'team.error.generic';
}

/** Members to show: removed ones are history and stay out of sight unless asked for. */
export function visibleMembers(members: readonly TeamMember[], showRemoved: boolean): TeamMember[] {
  const rank = { active: 0, suspended: 1, removed: 2 } as const;
  return members
    .filter((m) => showRemoved || m.status !== 'removed')
    .slice()
    .sort((a, b) => rank[a.status] - rank[b.status] || Number(b.isOwner) - Number(a.isOwner) || a.name.localeCompare(b.name));
}
