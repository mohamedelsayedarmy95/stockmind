/**
 * Deterministic JSON serialization for hashing.
 *
 * The hash chain is only meaningful if the writer and every future verifier
 * produce byte-identical input for the same logical event. Plain
 * `JSON.stringify` does not guarantee that: key order follows insertion order,
 * so two objects with the same content can serialize differently and break the
 * chain for no reason.
 *
 * Rules:
 *   - object keys sorted lexicographically, recursively
 *   - array order preserved (order is meaningful data)
 *   - `undefined` keys dropped; `null` kept (absent and empty are different)
 *   - non-finite numbers REJECTED rather than silently coerced to null, so a
 *     NaN quantity surfaces as a loud error instead of a quietly wrong ledger
 */

export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

export function canonicalJson(value: CanonicalValue): string {
  if (value === null) return 'null';

  const type = typeof value;

  if (type === 'number') {
    const n = value as number;
    if (!Number.isFinite(n)) {
      throw new Error(`canonicalJson: refusing to serialize non-finite number (${String(n)})`);
    }
    // JSON.stringify already emits the shortest round-trippable form.
    return JSON.stringify(n);
  }

  if (type === 'string' || type === 'boolean') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    // Order is data — never sort. undefined has no JSON form, so it becomes
    // null to keep positions stable.
    return `[${value.map((item) => (item === undefined ? 'null' : canonicalJson(item))).join(',')}]`;
  }

  if (type === 'object') {
    const record = value as { [key: string]: CanonicalValue };
    const parts = Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${parts.join(',')}}`;
  }

  // undefined at the top level, functions, symbols — nothing sensible to hash.
  throw new Error(`canonicalJson: unsupported value of type ${type}`);
}
