import { create } from 'zustand';

/**
 * Series 09: set when the server tells this device that the signed-in member's access was suspended/removed or their
 * sessions were revoked. The person is signed out (tokens cleared) but NOTHING is wiped: queued stock intents stay on the
 * device, held for review, and the login screen explains calmly what happened. Memory only: if the app restarts, the next
 * sign-in attempt gets the same answer from the server and shows the same message.
 */
interface AccessNoticeState {
  revoked: boolean;
  raise: () => void;
  dismiss: () => void;
}

export const useAccessNotice = create<AccessNoticeState>((set) => ({
  revoked: false,
  raise: () => set({ revoked: true }),
  dismiss: () => set({ revoked: false }),
}));
