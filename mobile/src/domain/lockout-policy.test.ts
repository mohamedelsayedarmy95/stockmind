import {
  lockoutDurationFor,
  remainingLock,
  isLocked,
  formatCountdown,
} from './lockout-policy';

const MIN = 60_000;
const HOUR = 3_600_000;

describe('lockoutDurationFor', () => {
  it('lets the first two failures pass free', () => {
    // A wet finger or a half-press must not cost the user anything.
    expect(lockoutDurationFor(1)).toBe(0);
    expect(lockoutDurationFor(2)).toBe(0);
  });

  it('escalates 1 minute, 10 minutes, then 1 hour', () => {
    expect(lockoutDurationFor(3)).toBe(MIN);
    expect(lockoutDurationFor(4)).toBe(10 * MIN);
    expect(lockoutDurationFor(5)).toBe(HOUR);
  });

  it('caps at an hour instead of growing without bound', () => {
    // A legitimate owner must never be permanently locked out of their own data.
    expect(lockoutDurationFor(6)).toBe(HOUR);
    expect(lockoutDurationFor(50)).toBe(HOUR);
    expect(lockoutDurationFor(10_000)).toBe(HOUR);
  });

  it('never escalates backwards', () => {
    let previous = 0;
    for (let n = 1; n <= 12; n++) {
      const current = lockoutDurationFor(n);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it('fails open on nonsense counts rather than throwing or locking', () => {
    // A corrupt counter must not trap the owner out of their own warehouse.
    // Unreachable in practice — the guard only ever passes `stored + 1` — but
    // the policy has to be consistent with remainingLock, which also fails open.
    expect(lockoutDurationFor(0)).toBe(0);
    expect(lockoutDurationFor(-3)).toBe(0);
    expect(lockoutDurationFor(NaN)).toBe(0);
    expect(lockoutDurationFor(Infinity)).toBe(0);
  });

  it('floors fractional counts', () => {
    expect(lockoutDurationFor(3.9)).toBe(MIN);
  });
});

describe('remainingLock / isLocked', () => {
  const now = 1_000_000;

  it('reports the time left while locked', () => {
    expect(remainingLock(now + 30_000, now)).toBe(30_000);
    expect(isLocked(now + 30_000, now)).toBe(true);
  });

  it('clears the moment the deadline passes', () => {
    expect(remainingLock(now, now)).toBe(0);
    expect(isLocked(now, now)).toBe(false);
    expect(remainingLock(now - 1, now)).toBe(0);
  });

  it('never returns a negative wait for a long-expired lock', () => {
    expect(remainingLock(now - HOUR, now)).toBe(0);
  });

  it('is unlocked when no lock was ever set', () => {
    expect(isLocked(0, now)).toBe(false);
  });

  it('survives corrupt stored values instead of locking forever', () => {
    // A garbage value in the encrypted store must fail OPEN, not trap the
    // owner out of their warehouse permanently.
    expect(remainingLock(NaN, now)).toBe(0);
    expect(remainingLock(now + 1000, NaN)).toBe(0);
  });
});

describe('formatCountdown', () => {
  it('pads seconds to two digits', () => {
    expect(formatCountdown(65_000)).toBe('1:05');
    expect(formatCountdown(600_000)).toBe('10:00');
  });

  it('rounds up so the display never shows 0:00 while still locked', () => {
    expect(formatCountdown(1)).toBe('0:01');
    expect(formatCountdown(1500)).toBe('0:02');
  });

  it('shows zero for an elapsed or negative duration', () => {
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(-500)).toBe('0:00');
  });

  it('keeps counting past an hour without wrapping to 0', () => {
    expect(formatCountdown(HOUR)).toBe('60:00');
  });
});
