/**
 * Typed stock quantities. The slider alone could not set an exact count (about 2 px per unit at its 500 maximum on
 * a phone), and a receipt could not exceed 500 units, so the movement screen also accepts a typed number.
 */

/** Upper bound for one receipt: a typo guard, far above any single delivery the app is meant for. */
export const MAX_MOVEMENT_QUANTITY = 1_000_000;

// Arabic-Indic (U+0660..0669) and Extended Arabic-Indic / Persian (U+06F0..06F9) digits, as Arabic keyboards type them.
const toAsciiDigits = (text: string) =>
  text.replace(/[٠-٩۰-۹]/g, (d) => String(d.charCodeAt(0) & 0xf));

/** A whole number from 1 to `max`, or null when the text is not one (empty, zero, fraction, separators, too big). */
export function parseQuantityInput(text: string, max: number): number | null {
  const digits = toAsciiDigits(text.trim());
  if (!/^\d{1,9}$/.test(digits)) return null;
  const value = Number(digits);
  return value >= 1 && value <= max ? value : null;
}
