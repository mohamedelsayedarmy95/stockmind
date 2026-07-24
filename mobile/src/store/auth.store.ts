import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { secureZustandStorage } from './secure-storage';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface AuthCompany {
  id: string;
  name: string;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
  company: AuthCompany | null;
  defaultWarehouseId: string | null;
  isHydrated: boolean;
  isGuest: boolean;
  setSession: (payload: {
    accessToken: string;
    refreshToken: string;
    user: AuthUser;
    company?: AuthCompany | null;
    defaultWarehouseId?: string | null;
  }) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  setGuest: () => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      company: null,
      defaultWarehouseId: null,
      isHydrated: false,
      isGuest: false,
      setSession: ({ accessToken, refreshToken, user, company, defaultWarehouseId }) =>
        set({
          accessToken,
          refreshToken,
          user,
          company: company ?? null,
          defaultWarehouseId: defaultWarehouseId ?? null,
          isGuest: false,
        }),
      setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),
      setGuest: () =>
        set({
          accessToken: null,
          refreshToken: null,
          user: null,
          company: null,
          defaultWarehouseId: null,
          isGuest: true,
        }),
      clear: () =>
        set({
          accessToken: null,
          refreshToken: null,
          user: null,
          company: null,
          defaultWarehouseId: null,
          isGuest: false,
        }),
    }),
    {
      name: 'stockmind-auth',
      storage: createJSONStorage(() => secureZustandStorage),
      // Encrypted storage isn't ready at import time — hydrate explicitly after
      // initSecureStorage() resolves (see bootstrap.ts).
      skipHydration: true,
      onRehydrateStorage: () => (state) => {
        if (state) state.isHydrated = true;
      },
    },
  ),
);

/** Non-hook accessors for use inside the Axios interceptor (outside React). */
export const authAccessor = {
  getAccessToken: () => useAuthStore.getState().accessToken,
  getRefreshToken: () => useAuthStore.getState().refreshToken,
  setTokens: (a: string, r: string) => useAuthStore.getState().setTokens(a, r),
  clear: () => useAuthStore.getState().clear(),
};
