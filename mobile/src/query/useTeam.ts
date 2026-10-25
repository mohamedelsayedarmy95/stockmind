import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { MemberRole, TeamAction, TeamMember } from '@/domain/team-actions';

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

const PATH: Record<Exclude<TeamAction, 'change_role'>, string> = {
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
      const body = req.action === 'remove' ? { confirm: true, reason } : { reason };
      return (await api.post(`/team/members/${req.id}/${PATH[req.action]}`, body)).data;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: TEAM_KEY });
    },
  });
}
