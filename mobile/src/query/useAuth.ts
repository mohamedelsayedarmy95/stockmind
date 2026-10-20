import { useMutation } from '@tanstack/react-query';
import { api } from '@/api/client';
import { RegisterResponse } from '@/api/types';
import { useAuthStore } from '@/store/auth.store';
import {
  classifyLoginResponse,
  extractInvitationToken,
  InvitationInput,
  LoginOutcome,
  requireSession,
  SessionPayload,
} from '@/domain/auth-flow';
import { forgetSyncCache, resetWarehouseSync } from '@/sync/warehouse-sync';
import { sessionScopeKey } from '@/sync/account-scope';
import { queryClient } from './queryClient';

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  companyName: string;
}

/**
 * Starts an online session. Cached server data and sync cursors of a previous user are dropped first, so nothing
 * fetched under one account is ever shown under another.
 */
export function startOnlineSession(session: SessionPayload) {
  queryClient.clear();
  resetWarehouseSync();
  useAuthStore.getState().setSession({
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    user: session.user,
    company: session.company ? { id: session.company.id, name: session.company.name ?? '' } : null,
  });
}

/**
 * Drops the session together with every cached server answer and sync cursor, including the account's on-device
 * cache. Its unsent stock intents are kept, untouched and unsendable, until the same account signs in again.
 */
function endSession() {
  const scope = sessionScopeKey();
  useAuthStore.getState().clear();
  queryClient.clear();
  resetWarehouseSync();
  forgetSyncCache(scope);
}

export function useRegister() {
  const setSession = useAuthStore((s) => s.setSession);
  return useMutation({
    mutationFn: async (dto: RegisterInput): Promise<RegisterResponse> => {
      const { data } = await api.post<RegisterResponse>('/auth/register', dto);
      return data;
    },
    onSuccess: (data) => {
      setSession({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        user: data.user,
      });
    },
  });
}

/**
 * Password step. Resolves to a session (already stored) or to a 2FA challenge, in which case NO session is stored:
 * the screen asks for the code and calls useTwoFactorLogin with the temp token.
 */
export function useLogin() {
  return useMutation({
    mutationFn: async (creds: { email: string; password: string }): Promise<LoginOutcome> => {
      const { data } = await api.post<unknown>('/auth/login', creds);
      return classifyLoginResponse(data);
    },
    onSuccess: (outcome) => {
      if (outcome.kind === 'session') startOnlineSession(outcome.session);
    },
  });
}

/** Second step of a 2FA sign-in: temp token + code → the real token pair. */
export function useTwoFactorLogin() {
  return useMutation({
    mutationFn: async (input: { tempToken: string; otpCode: string }): Promise<SessionPayload> => {
      const { data } = await api.post<unknown>('/auth/2fa/login', input);
      return requireSession(data);
    },
    onSuccess: (session) => startOnlineSession(session),
  });
}

/** Joins the inviting company (public endpoint); the server answers with a token pair for the new member. */
export function useAcceptInvitation() {
  return useMutation({
    mutationFn: async (input: InvitationInput): Promise<SessionPayload> => {
      const { data } = await api.post<unknown>('/auth/accept-invitation', {
        token: extractInvitationToken(input.token),
        name: input.name.trim(),
        password: input.password,
      });
      return requireSession(data);
    },
    onSuccess: (session) => startOnlineSession(session),
  });
}

export function useLogout() {
  return useMutation({
    mutationFn: async () => {
      try {
        await api.post('/auth/logout');
      } catch {
        // Even if the network call fails, we still clear the local session.
      }
    },
    onSettled: () => endSession(),
  });
}

/**
 * Revoke every active session server-side (invalidates the refresh token), then
 * clear the local session. Use from Settings → "Terminate all sessions".
 */
export function useTerminateAllSessions() {
  return useMutation({
    mutationFn: async () => {
      await api.post('/auth/sessions/terminate-all');
    },
    onSettled: () => endSession(),
  });
}
