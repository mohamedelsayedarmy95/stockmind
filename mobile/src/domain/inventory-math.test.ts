import {
  quantityFromWeight,
  weightCountDrift,
  WEIGHT_DRIFT_TOLERANCE,
} from './inventory-math';

describe('quantityFromWeight', () => {
  it('converts a clean multiple exactly', () => {
    expect(quantityFromWeight(10, 2)).toEqual({ exact: 5, rounded: 5 });
  });

  it('reports the unrounded value alongside the bookable one', () => {
    // The operator needs to SEE 10.5 to notice something is off; showing only
    // the rounded 11 would hide the problem.
    const count = quantityFromWeight(21, 2);
    expect(count).not.toBeNull();
    expect(count?.exact).toBeCloseTo(10.5);
    expect(count?.rounded).toBe(11); // Math.round: .5 goes up
  });

  it('refuses to guess when no unit weight is recorded', () => {
    // Booking stock off a missing conversion is worse than refusing.
    expect(quantityFromWeight(10, null)).toBeNull();
    expect(quantityFromWeight(10, undefined)).toBeNull();
  });

  it('refuses a non-positive unit weight instead of dividing by zero', () => {
    expect(quantityFromWeight(10, 0)).toBeNull();
    expect(quantityFromWeight(10, -2)).toBeNull();
  });

  it('refuses a negative total weight', () => {
    expect(quantityFromWeight(-5, 2)).toBeNull();
  });

  it('refuses non-finite input rather than producing Infinity or 0 units', () => {
    expect(quantityFromWeight(NaN, 2)).toBeNull();
    expect(quantityFromWeight(Infinity, 2)).toBeNull();
    expect(quantityFromWeight(10, NaN)).toBeNull();
    // An infinite unit weight would divide down to 0 units and silently book
    // nothing. Refusing is the honest answer.
    expect(quantityFromWeight(10, Infinity)).toBeNull();
  });

  it('accepts an empty pile as a legitimate zero', () => {
    expect(quantityFromWeight(0, 2)).toEqual({ exact: 0, rounded: 0 });
  });

  it('handles a unit heavier than the pile', () => {
    const count = quantityFromWeight(1, 5);
    expect(count?.exact).toBeCloseTo(0.2);
    expect(count?.rounded).toBe(0);
  });
});

describe('weightCountDrift', () => {
  it('is zero for an exact multiple', () => {
    expect(weightCountDrift({ exact: 5, rounded: 5 })).toBe(0);
  });

  it('measures distance from the whole unit, in either direction', () => {
    expect(weightCountDrift({ exact: 10.4, rounded: 10 })).toBeCloseTo(0.4);
    expect(weightCountDrift({ exact: 10.6, rounded: 11 })).toBeCloseTo(0.4);
  });

  it('flags a half-unit reading as beyond tolerance', () => {
    // 10.5 units means the recorded unit weight is wrong or stock is missing.
    const count = quantityFromWeight(21, 2);
    expect(count).not.toBeNull();
    expect(weightCountDrift(count!)).toBeGreaterThan(WEIGHT_DRIFT_TOLERANCE);
  });

  it('does not flag ordinary scale noise', () => {
    const count = quantityFromWeight(10.02, 1);
    expect(count).not.toBeNull();
    expect(weightCountDrift(count!)).toBeLessThan(WEIGHT_DRIFT_TOLERANCE);
  });
});
