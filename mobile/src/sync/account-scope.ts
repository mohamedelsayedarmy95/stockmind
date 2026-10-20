import { BASE_URL } from '@/api/client';
import { ONLINE_MODE_DEV_PREVIEW, apiHostLabel } from '@/lib/dev-flags';
import { useAuthStore } from '@/store/auth.store';
import { useSettingsStore } from '@/store/settings.store';
import { scopeKey, scopeOf } from '@/domain/session-scope';

/**
 * Scope key of the signed-in online account (server | company | user), or null when there is no online session.
 * Local online data - queued intents, cached server figures - is stored and used under this key only.
 */
export function currentScopeKey(): string | null {
  if (!ONLINE_MODE_DEV_PREVIEW || useSettingsStore.getState().operationMode !== 'online') return null;
  return sessionScopeKey();
}

/** The session's scope regardless of the selected mode (sign-out cleanup runs after a mode switch). */
export function sessionScopeKey(): string | null {
  const { accessToken, user } = useAuthStore.getState();
  const scope = scopeOf(apiHostLabel(BASE_URL), accessToken, user?.id);
  return scope ? scopeKey(scope) : null;
}

export function useCurrentScopeKey(): string | null {
  // Re-render on the inputs; the key itself is derived.
  useAuthStore((s) => s.accessToken);
  useAuthStore((s) => s.user?.id);
  useSettingsStore((s) => s.operationMode);
  return currentScopeKey();
}
