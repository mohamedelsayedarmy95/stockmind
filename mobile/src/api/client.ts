import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import Constants from 'expo-constants';
import { authAccessor } from '@/store/auth.store';
import { useSettingsStore } from '@/store/settings.store';
import { sessionLock } from '@/lib/session-lock';
import { pinnedAxiosAdapter, shouldPin } from '@/lib/pinned-http';

const BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ??
  'http://10.0.2.2:3000/api/v1';

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15_000,
  // In production, swap the transport to the SSL-pinned adapter so every
  // request is verified against the bundled certificate at the native layer.
  // In development, the default XMLHttpRequest adapter is used (no cert needed).
  ...(shouldPin() ? { adapter: pinnedAxiosAdapter } : {}),
});

// ── Request: attach bearer token + Accept-Language ──────────────────────────
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = authAccessor.getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  config.headers['Accept-Language'] = useSettingsStore.getState().language;
  return config;
});

// ── Response: transparent refresh on 401, single-flight ─────────────────────
let refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = authAccessor.getRefreshToken();
  if (!refreshToken) return null;
  try {
    const { data } = await axios.post<{ accessToken: string; refreshToken: string }>(
      `${BASE_URL}/auth/refresh-token`,
      { refreshToken },
    );
    authAccessor.setTokens(data.accessToken, data.refreshToken);
    return data.accessToken;
  } catch {
    authAccessor.clear();
    return null;
  }
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;

    if (error.response?.status === 401 && original && !original._retry) {
      original._retry = true;

      // Guests have no token — a 401 is expected. Don't lock the session or
      // attempt a refresh; just let the query fail so the UI can show an
      // appropriate empty/sign-in state.
      if (!authAccessor.getAccessToken() && !authAccessor.getRefreshToken()) {
        return Promise.reject(error);
      }

      // Cover the UI with the "session expired" gate: the user must re-assert
      // presence (biometric/password) before they can keep using the app, even
      // though the token refresh itself proceeds transparently below.
      sessionLock.lock();

      // Single-flight: concurrent 401s share one refresh call.
      refreshing = refreshing ?? refreshAccessToken();
      const newToken = await refreshing;
      refreshing = null;

      if (newToken) {
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      }
    }
    return Promise.reject(error);
  },
);
