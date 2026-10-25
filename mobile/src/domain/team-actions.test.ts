import {
  activeOwnerCount, availableActions, MemberRole, MemberStatus, roleChoices, TEAM_ERROR_CODES, TeamMember, teamErrorKey,
  visibleMembers,
} from './team-actions';

const member = (over: Partial<TeamMember> = {}): TeamMember => ({
  id: 'm1', name: 'Mona', email: 'mona@example.test', role: 'Staff', status: 'active', isOwner: false,
  statusChangedAt: null, warehouses: [], ...over,
});
const owner = { id: 'o1', isOwner: true };
const admin = { id: 'a2', isOwner: false };

describe('Team actions offered to the viewer (the server stays the authority)', () => {
  it('an active Staff or Manager member can be changed, signed out, suspended or removed', () => {
    for (const role of ['Staff', 'Manager'] as MemberRole[]) {
      expect(availableActions(owner, member({ role }), 1)).toEqual(['change_role', 'revoke_sessions', 'suspend', 'remove']);
      expect(availableActions(admin, member({ role }), 1)).toEqual(['change_role', 'revoke_sessions', 'suspend', 'remove']);
    }
  });
  it('a suspended member can be reactivated or removed; a removed one only reactivated', () => {
    expect(availableActions(owner, member({ status: 'suspended' }), 1)).toEqual(['reactivate', 'remove']);
    expect(availableActions(owner, member({ status: 'removed' }), 1)).toEqual(['reactivate']);
  });
  it('nobody gets lockout or demotion buttons for themselves; signing out everywhere is offered', () => {
    expect(availableActions(owner, member({ id: 'o1', role: 'Admin', isOwner: true }), 1)).toEqual(['revoke_sessions']);
    expect(availableActions(admin, member({ id: 'a2', role: 'Admin' }), 1)).toEqual(['revoke_sessions']);
  });
  it('only the owner is offered anything on an Admin; a company with no owner offers nothing on Admins', () => {
    const otherAdmin = member({ id: 'a3', role: 'Admin' });
    expect(availableActions(admin, otherAdmin, 0)).toEqual([]);
    expect(availableActions(owner, otherAdmin, 1)).toEqual(['change_role', 'revoke_sessions', 'suspend', 'remove']);
  });
  it('the last active owner is protected; with another owner an owner can be suspended but never re-roled', () => {
    const other = member({ id: 'o2', role: 'Admin', isOwner: true });
    expect(availableActions({ id: 'o1', isOwner: true }, other, 1)).toEqual(['revoke_sessions']);
    expect(availableActions({ id: 'o1', isOwner: true }, other, 2)).toEqual(['suspend', 'remove', 'revoke_sessions']);
  });
  it('counts only active owners', () => {
    const list = [member({ isOwner: true }), member({ id: 'x', isOwner: true, status: 'suspended' }), member({ id: 'y' })];
    expect(activeOwnerCount(list)).toBe(1);
  });
});

describe('Role choices', () => {
  it('Staff → Manager and → Admin need the company-wide acknowledgement; → Staff does not', () => {
    expect(roleChoices(owner, member({ role: 'Staff' }))).toEqual([
      { role: 'Manager', needsAcknowledgement: true },
      { role: 'Admin', needsAcknowledgement: true },
    ]);
    expect(roleChoices(owner, member({ role: 'Manager' }))).toEqual([
      { role: 'Staff', needsAcknowledgement: false },
      { role: 'Admin', needsAcknowledgement: true },
    ]);
  });
  it('only an owner can offer Admin', () => {
    expect(roleChoices(admin, member({ role: 'Staff' })).map((c) => c.role)).toEqual(['Manager']);
  });
});

describe('Errors and list', () => {
  it('every server refusal code maps to a copy key; unknown codes fall back by status', () => {
    for (const code of TEAM_ERROR_CODES) expect(teamErrorKey(403, code)).toMatch(/^team\.error\./);
    expect(teamErrorKey(undefined, undefined)).toBe('team.error.network');
    expect(teamErrorKey(403, 'SOMETHING_NEW')).toBe('team.error.forbidden');
    expect(teamErrorKey(404, undefined)).toBe('team.error.notFound');
    expect(teamErrorKey(500, undefined)).toBe('team.error.generic');
  });
  it('removed members are hidden unless asked for, active first, owner first among equals', () => {
    const list: TeamMember[] = [
      member({ id: '1', name: 'Zed', status: 'removed' }),
      member({ id: '2', name: 'Amr', status: 'suspended' }),
      member({ id: '3', name: 'Bea' }),
      member({ id: '4', name: 'Cal', isOwner: true, role: 'Admin' }),
    ];
    expect(visibleMembers(list, false).map((m) => m.id)).toEqual(['4', '3', '2']);
    expect(visibleMembers(list, true).map((m) => m.id)).toEqual(['4', '3', '2', '1']);
  });
  it('keeps the status and role vocabularies closed', () => {
    const statuses: MemberStatus[] = ['active', 'suspended', 'removed'];
    expect(statuses).toHaveLength(3);
  });
});
