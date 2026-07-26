/**
 * Unlock-failure policy — pure, no platform imports.
 *
 * Lives in the domain layer so the rule can be tested and reasoned about
 * without dragging in expo-local-authentication or the encrypted store. The
 * guard in lib/biometric-guard owns the side effects; this owns the decision.
 *
 * UWOS Master Spec §4: repeated failures escalate a lockout. They never
 * destroy data.
 */

/**
 * Lock earned by the Nth consecutive failure (1-based). The first two are
 * free — a wet finger or a half-press is normal and shouldn't punish anyone.
 * Pressure then ramps hard and caps at an hour: long enough that brute
 * forcing a biometric is hopeless, short enough that a legitimate owner is
 * never permanently locked out of their own warehouse.
 */
const LADDER_MS = [
  0, // 1st failure
  0, // 2nd
  60_000, // 3rd  → 1 minute
  600_000, // 4th  → 10 minutes
  3_600_000, // 5th+ → 1 hour (cap)
] as const;

export function lockoutDurationFor(failCount: number): number {
  if (!Number.isFinite(failCount) || failCount < 1) return 0;
  const index = Math.min(Math.floor(failCount), LADDER_MS.length) - 1;
  return LADDER_MS[index];
}

/** Milliseconds left to wait. 0 when the lock has expired or was never set. */
export function remainingLock(lockedUntilMs: number, nowMs: number): number {
  if (!Number.isFinite(lockedUntilMs) || !Number.isFinite(nowMs)) return 0;
  return Math.max(0, lockedUntilMs - nowMs);
}

export function isLocked(lockedUntilMs: number, nowMs: number): boolean {
  return remainingLock(lockedUntilMs, nowMs) > 0;
}

/** `m:ss` for the countdown on the lock screen. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
