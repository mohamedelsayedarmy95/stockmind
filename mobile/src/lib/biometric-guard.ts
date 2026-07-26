import * as LocalAuthentication from 'expo-local-authentication';
import { getStorage } from '@/store/secure-storage';
import { logActivity } from '@/data/local/local-repositories';
import { lockoutDurationFor, remainingLock } from '@/domain/lockout-policy';

/**
 * Physical-theft defence.
 *
 * When a session exists, the app demands a biometric (fingerprint/face) unlock
 * on cold start. Repeated failures trigger an ESCALATING LOCKOUT — never data
 * destruction (UWOS Master Spec §4).
 *
 * An earlier version wiped all local data after three failures. That is a worse
 * trade than it looks: a child pressing the sensor a few times, or a wet finger
 * on a cold morning, would destroy a warehouse's entire inventory with no way
 * back. A lockout denies a thief exactly as effectively — they cannot brute
 * force a biometric in a 1h window — while an honest user just waits.
 *
 * Counters live in the ENCRYPTED store so they survive the app being killed
 * between attempts; a thief cannot reset them by force-stopping the app.
 */

const FAIL_KEY = 'biometric.failCount';
const LOCK_KEY = 'biometric.lockedUntil';

export type UnlockResult = 'success' | 'retry' | 'locked' | 'unavailable';

function getFailCount(): number {
  return getStorage().getNumber(FAIL_KEY) ?? 0;
}
function setFailCount(n: number): void {
  getStorage().set(FAIL_KEY, n);
}
function getLockedUntil(): number {
  return getStorage().getNumber(LOCK_KEY) ?? 0;
}
function setLockedUntil(ts: number): void {
  getStorage().set(LOCK_KEY, ts);
}

/** Milliseconds still to wait, or 0 when not locked. */
export function remainingLockMs(nowMs: number = Date.now()): number {
  return remainingLock(getLockedUntil(), nowMs);
}

export function resetBiometricFailures(): void {
  setFailCount(0);
  setLockedUntil(0);
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

  // Still serving a lockout: refuse without even prompting, so the attempt
  // can't be used to probe whether a given finger works.
  if (remainingLockMs() > 0) return 'locked';

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

  const lockMs = lockoutDurationFor(fails);
  if (lockMs > 0) {
    setLockedUntil(Date.now() + lockMs);
    // Visible security trail. Once multi-user lands this is what notifies a
    // manager; until then it surfaces in the owner's own Activity Log.
    void logActivity(
      'lockout',
      'security',
      null,
      `${fails} failed unlock attempts · locked ${Math.round(lockMs / 60_000)} min`,
    );
    return 'locked';
  }

  return 'retry';
}
