/**
 * Pure inventory arithmetic — no I/O, no React, no SQL.
 *
 * Kept in the domain layer (constitution ch.2 art.1) so the rules can be
 * reasoned about and tested on their own, and reused by any screen.
 */

export interface WeightCount {
  /** Unrounded units the weight implies — shown so an operator can sanity-check. */
  exact: number;
  /** Whole units to actually book. */
  rounded: number;
}

/**
 * Counts a pile by weighing it: quantity = total weight / weight of one unit.
 *
 * Returns null when the maths can't be trusted — no unit weight recorded, a
 * non-positive unit weight, or a negative total — because booking stock off a
 * bad conversion is worse than refusing to guess.
 */
export function quantityFromWeight(
  totalWeightKg: number,
  unitWeightKg: number | null | undefined,
): WeightCount | null {
  if (unitWeightKg == null || !Number.isFinite(unitWeightKg) || unitWeightKg <= 0) return null;
  if (!Number.isFinite(totalWeightKg) || totalWeightKg < 0) return null;

  const exact = totalWeightKg / unitWeightKg;
  return { exact, rounded: Math.round(exact) };
}

/**
 * How far a weight-derived count sits from a whole unit, 0 → 0.5.
 *
 * A reading of 10.5 units means the pile doesn't divide cleanly: either the
 * recorded unit weight is wrong or something is missing. Screens use this to
 * warn instead of silently rounding.
 */
export function weightCountDrift(count: WeightCount): number {
  return Math.abs(count.exact - count.rounded);
}

/** Drift above this fraction of a unit is worth flagging to the operator. */
export const WEIGHT_DRIFT_TOLERANCE = 0.05;
