import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { MemberRole, TeamAction, TeamMember } from '@/domain/team-actions';
import { AccessProfileInfo, AssignmentInfo } from '@/domain/capabilities';

const TEAM_KEY = ['team', 'members'] as const;

/** Server-side members of the signed-in company (Admin only; the server answers 403 to anyone else). */
export function useTeamMembers(enabled = true) {
  return useQuery({
    queryKey: TEAM_KEY,
    enabled,
    // Membership changes must show at once: no stale window.
    staleTime: 0,
    queryFn: async (): Promise<TeamMember[]> => (await api.get<TeamMember[]>('/team/members')).data,
  });
}

export interface MembershipRequest {
  id: string;
  action: TeamAction;
  reason?: string;
  /** Required by the server when moving to Manager or Admin. */
  role?: MemberRole;
  acknowledgeCompanyWideAccess?: boolean;
}

const PATH: Record<Exclude<TeamAction, 'change_role' | 'manage_access'>, string> = {
  suspend: 'suspend',
  reactivate: 'reactivate',
  remove: 'remove',
  revoke_sessions: 'revoke-sessions',
};

/** One membership action. A single click cannot repeat: the mutation is not retried (the server records each change). */
export function useMembershipAction() {
  const qc = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async (req: MembershipRequest) => {
      const reason = req.reason?.trim() || undefined;
      if (req.action === 'change_role') {
        return (await api.patch(`/team/members/${req.id}/role`, {
          role: req.role,
          acknowledgeCompanyWideAccess: req.acknowledgeCompanyWideAccess === true ? true : undefined,
          reason,
        })).data;
      }
      if (req.action === 'manage_access') throw new Error('manage_access is a screen, not a request');
      const body = req.action === 'remove' ? { confirm: true, reason } : { reason };
      return (await api.post(`/team/members/${req.id}/${PATH[req.action]}`, body)).data;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: TEAM_KEY });
    },
  });
}

// ── Warehouse access (Series 10 / S2) ─────────────────────────────────────────────────────────────────────────────────

export interface MemberAccess {
  memberId: string;
  name: string;
  email: string;
  role: string;
  status: string;
  /** False for Admin and Manager (they see every warehouse) and for removed members. */
  applicable: boolean;
  /** Send back with a save: a concurrent change makes the server answer 409 instead of overwriting it. */
  version: string;
  assignments: AssignmentInfo[];
  mode: string;
  profiles: AccessProfileInfo[];
}

const accessKey = (id: string) => ['team', 'access', id] as const;

export function useMemberAccess(memberId: string | undefined) {
  return useQuery({
    queryKey: accessKey(memberId ?? ''),
    enabled: Boolean(memberId),
    staleTime: 0,
    queryFn: async (): Promise<MemberAccess> => (await api.get<MemberAccess>(`/team/members/${memberId}/access`)).data,
  });
}

/** What can be granted right now (shared by the warehouse-creation form, which has no member yet). */
export function useAccessProfiles(enabled = true) {
  return useQuery({
    queryKey: ['team', 'access-profiles'] as const,
    enabled,
    staleTime: 0,
    queryFn: async (): Promise<{ mode: string; profiles: AccessProfileInfo[] }> =>
      (await api.get<{ mode: string; profiles: AccessProfileInfo[] }>('/team/access-profiles')).data,
  });
}

export function useSetMemberAccess() {
  const qc = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async (req: { memberId: string; assignments: Array<{ warehouseId: string; profile: string }>; version: string; reason?: string }) =>
      (await api.put(`/team/members/${req.memberId}/access`, {
        assignments: req.assignments, expectedVersion: req.version, reason: req.reason?.trim() || undefined,
      })).data,
    onSettled: (_data, _err, req) => {
      void qc.invalidateQueries({ queryKey: accessKey(req.memberId) });
      void qc.invalidateQueries({ queryKey: TEAM_KEY });
    },
  });
}
