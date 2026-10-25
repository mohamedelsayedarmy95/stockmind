import { create } from 'zustand';
import { api } from '@/api/client';
import { CapabilitySnapshot } from '@/domain/capabilities';
import { errorCodeOf, httpStatusOf } from '@/domain/auth-flow';
import { queryClient } from '@/query/queryClient';

/**
 * The member's capability snapshot (GET /me/capabilities), in memory only. It describes; it never authorizes. It is dropped
 * at sign-out and account switch, so one account's permissions can never colour another's screens, and nothing about it is
 * written to disk. When the server's answer shows the authority CHANGED (accessVersion), cached server answers are
 * invalidated so a revoked warehouse stops being shown; queued offline work is untouched and is judged by the server when
 * it is sent.
 */
type Status = 'idle' | 'loading' | 'ready' | 'error';

interface CapabilitiesState {
  snapshot: CapabilitySnapshot | null;
  status: Status;
  refresh: () => Promise<void>;
  clear: () => void;
}

let inflight: Promise<void> | null = null;

export const useCapabilities = create<CapabilitiesState>((set, get) => ({
  snapshot: null,
  status: 'idle',
  clear: () => {
    inflight = null;
    set({ snapshot: null, status: 'idle' });
  },
  refresh: () => {
    inflight ??= (async () => {
      set({ status: get().snapshot ? get().status : 'loading' });
      try {
        const { data } = await api.get<Omit<CapabilitySnapshot, 'fetchedAt' | 'source'>>('/me/capabilities');
        const previous = get().snapshot;
        const next: CapabilitySnapshot = { ...data, fetchedAt: Date.now(), source: 'server' };
        set({ snapshot: next, status: 'ready' });
        if (previous && previous.source === 'server' && previous.accessVersion !== next.accessVersion) {
          void queryClient.invalidateQueries(); // authority changed: re-ask the server for everything the screens show
        }
      } catch (err) {
        // A refusal that says the member has no standing any more empties the copy; anything else keeps the last good one
        // (the server still decides every request) and marks the failure so the UI can say it could not refresh.
        const status = httpStatusOf(err);
        if (status === 401 || status === 403 || errorCodeOf(err) === 'ACCESS_REVOKED') set({ snapshot: null, status: 'error' });
        else set({ status: 'error' });
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  },
}));
