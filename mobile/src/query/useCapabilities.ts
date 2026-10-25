import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { ONLINE_MODE_DEV_PREVIEW } from '@/lib/dev-flags';
import { onCapabilityRefresh } from '@/domain/capability-signal';
import { useSettingsStore } from '@/store/settings.store';
import { useAuthStore } from '@/store/auth.store';
import { useCapabilities } from '@/store/capabilities.store';
import { can as canDo, CapabilitySnapshot, navigationFor, NavigationFlags, roleFallback } from '@/domain/capabilities';

/** Online with a server session: the only situation in which the server's capabilities describe what the app may offer. */
function useIsOnline(): boolean {
  const mode = useSettingsStore((s) => s.operationMode);
  const hasSession = useAuthStore((s) => Boolean(s.accessToken));
  return ONLINE_MODE_DEV_PREVIEW && mode === 'online' && hasSession;
}

/** The snapshot to render from: the server's, else what the role implied, else (offline) nothing — the local inventory is the member's own. */
export function useCapabilitySnapshot(): CapabilitySnapshot | null {
  const online = useIsOnline();
  const snapshot = useCapabilities((s) => s.snapshot);
  const role = useAuthStore((s) => s.user?.role);
  if (!online) return null;
  return snapshot ?? (role ? roleFallback(role, 0) : null);
}

/**
 * `can(capability, warehouseId?)` for gating what the screens show. Offline (the on-device inventory) everything the app
 * offers is available: it is the member's own data. Online it follows the server's description; before that arrives it
 * follows the role. It hides or shows controls; it never grants anything.
 */
export function useCan(): (capability: string, warehouseId?: string) => boolean {
  const online = useIsOnline();
  const snapshot = useCapabilitySnapshot();
  return useCallback((capability: string, warehouseId?: string) => (online ? canDo(snapshot, capability, warehouseId) : true), [online, snapshot]);
}

/** Which destinations exist. Offline: all of them (the local app); online: from the capabilities. */
export function useNavigation(): NavigationFlags {
  const online = useIsOnline();
  const snapshot = useCapabilitySnapshot();
  return online ? navigationFor(snapshot) : { scan: true, warehouses: true, analytics: true, team: false };
}

/** Fetches the snapshot for an online session and keeps it honest: at start, on every return to the app, and whenever the server refuses. */
export function useCapabilityRuntime(): void {
  const online = useIsOnline();
  const userId = useAuthStore((s) => s.user?.id);
  const refresh = useCapabilities((s) => s.refresh);
  const clear = useCapabilities((s) => s.clear);

  useEffect(() => {
    // A different account (or no session) never inherits the previous member's capabilities.
    clear();
    if (online) void refresh();
  }, [online, userId, refresh, clear]);

  useEffect(() => {
    if (!online) return undefined;
    const sub = AppState.addEventListener('change', (state) => {
      // Always on return to the app: the member may have been changed while it was in the background (the answer is no-store and tiny).
      if (state === 'active') void refresh();
    });
    const off = onCapabilityRefresh(() => void refresh());
    return () => {
      sub.remove();
      off();
    };
  }, [online, refresh]);
}
