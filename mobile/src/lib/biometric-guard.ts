import * as LocalAuthentication from 'expo-local-authentication';
import { getStorage, wipeAllLocalData } from '@/store/secure-storage';
import { useAuthStore } from '@/store/auth.store';

/**
 * Physical-theft defence.
 *
 * When a session exists, the app demands a biometric (fingerprint/face) unlock
 * on cold start. THREE consecutive failures trip an auto-wipe: all local data is
 * destroyed and the session is cleared, so a stolen, unlocked-at-the-OS device
 * still yields nothing. The failure counter is persisted in the ENCRYPTED store
 * so it survives the app being killed between attempts.
 */

const FAIL_KEY = 'biometric.failCount';
const MAX_FAILS = 3;

export type UnlockResult = 'success' | 'retry' | 'wiped' | 'unavailable';

function getFailCount(): number {
  return getStorage().getNumber(FAIL_KEY) ?? 0;
}
function setFailCount(n: number): void {
  getStorage().set(FAIL_KEY, n);
}

export function resetBiometricFailures(): void {
  setFailCount(0);
}

/** Whether the device actually has enrolled biometrics we can prompt for. */
export async function biometricsAvailable(): Promise<boolean> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  return hasHardware && enrolled;
}

export async function requireBiometricUnlock(): Promise<UnlockResult> {
  if (!(await biometricsAvailable())) {
    // No biometrics enrolled — do not brick the user out; fall through.
    return 'unavailable';
  }

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Unlock StockMind',
    cancelLabel: 'Cancel',
    disableDeviceFallback: false,
  });

  if (result.success) {
    resetBiometricFailures();
    return 'success';
  }

  const fails = getFailCount() + 1;
  setFailCount(fails);

  if (fails >= MAX_FAILS) {
    // Tripwire: destroy everything and drop the session.
    wipeAllLocalData();
    useAuthStore.getState().clear();
    return 'wiped';
  }
  return 'retry';
}
