import { useMutation } from '@tanstack/react-query';
import { api } from '@/api/client';
import { LoginResponse } from '@/api/types';
import { useAuthStore } from '@/store/auth.store';

export function useLogin() {
  const setSession = useAuthStore((s) => s.setSession);
  return useMutation({
    mutationFn: async (creds: { email: string; password: string }): Promise<LoginResponse> => {
      const { data } = await api.post<LoginResponse>('/auth/login', creds);
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

export function useLogout() {
  const clear = useAuthStore((s) => s.clear);
  return useMutation({
    mutationFn: async () => {
      try {
        await api.post('/auth/logout');
      } catch {
        // Even if the network call fails, we still clear the local session.
      }
    },
    onSettled: () => clear(),
  });
}

/**
 * Revoke every active session server-side (invalidates the refresh token), then
 * clear the local session. Use from Settings → "Terminate all sessions".
 */
export function useTerminateAllSessions() {
  const clear = useAuthStore((s) => s.clear);
  return useMutation({
    mutationFn: async () => {
      await api.post('/auth/sessions/terminate-all');
    },
    onSettled: () => clear(),
  });
}
