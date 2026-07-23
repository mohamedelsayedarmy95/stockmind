import { create } from 'zustand';

/**
 * Drives the "Session expired — re-authenticate" overlay. The Axios interceptor
 * flips `locked` on the first 401 so the UI is covered until the user proves
 * presence again (biometric/password), rather than silently swapping tokens
 * underneath a possibly-unattended device.
 */
interface SessionLockState {
  locked: boolean;
  lock: () => void;
  unlock: () => void;
}

export const useSessionLock = create<SessionLockState>((set) => ({
  locked: false,
  lock: () => set({ locked: true }),
  unlock: () => set({ locked: false }),
}));

/** Non-hook accessor for the interceptor (runs outside React). */
export const sessionLock = {
  lock: () => useSessionLock.getState().lock(),
};
