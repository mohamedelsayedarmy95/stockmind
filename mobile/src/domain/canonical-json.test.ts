import { canonicalJson } from './canonical-json';

describe('canonicalJson — determinism', () => {
  it('produces identical output regardless of key insertion order', () => {
    // This is the whole reason the module exists: two objects with the same
    // content must hash the same, or the chain breaks for no real reason.
    const a = { zebra: 1, alpha: 2, monkey: 3 };
    const b = { monkey: 3, alpha: 2, zebra: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).toBe('{"alpha":2,"monkey":3,"zebra":1}');
  });

  it('sorts nested keys too', () => {
    const a = { outer: { z: 1, a: 2 }, first: true };
    expect(canonicalJson(a)).toBe('{"first":true,"outer":{"a":2,"z":1}}');
  });

  it('preserves array order, because order is data', () => {
    // A FEFO pick list [MID, NEW, OLD] is not the same fact as [OLD, MID, NEW].
    expect(canonicalJson(['b', 'a', 'c'])).toBe('["b","a","c"]');
  });

  it('sorts objects inside arrays without reordering the array', () => {
    const picks = [
      { qty: 10, batch: 'MID' },
      { batch: 'NEW', qty: 5 },
    ];
    expect(canonicalJson(picks)).toBe('[{"batch":"MID","qty":10},{"batch":"NEW","qty":5}]');
  });

  it('emits no whitespace', () => {
    expect(canonicalJson({ a: 1, b: [1, 2] })).not.toMatch(/\s/);
  });
});

describe('canonicalJson — null vs undefined', () => {
  it('keeps null, which is a real recorded value', () => {
    expect(canonicalJson({ reason: null })).toBe('{"reason":null}');
  });

  it('drops undefined keys, so absent and explicit-null stay distinguishable', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('treats a missing key and an undefined key as the same event', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it('does NOT treat null and undefined as the same event', () => {
    expect(canonicalJson({ a: 1, b: null })).not.toBe(canonicalJson({ a: 1, b: undefined }));
  });

  it('keeps array positions stable when an element is undefined', () => {
    expect(canonicalJson([1, undefined, 3])).toBe('[1,null,3]');
  });
});

describe('canonicalJson — numbers', () => {
  it('round-trips ordinary and fractional quantities', () => {
    expect(canonicalJson({ q: 12 })).toBe('{"q":12}');
    expect(canonicalJson({ q: 12.5 })).toBe('{"q":12.5}');
    expect(canonicalJson({ q: -3 })).toBe('{"q":-3}');
  });

  it('normalises -0 so it cannot produce two hashes for one quantity', () => {
    expect(canonicalJson({ q: -0 })).toBe(canonicalJson({ q: 0 }));
  });

  it('refuses NaN instead of silently writing null into the ledger', () => {
    // JSON.stringify turns NaN into null. In an inventory ledger that is a
    // quantity vanishing without trace — it must fail loudly.
    expect(() => canonicalJson({ q: NaN })).toThrow(/non-finite/);
  });

  it('refuses Infinity for the same reason', () => {
    expect(() => canonicalJson({ q: Infinity })).toThrow(/non-finite/);
    expect(() => canonicalJson({ q: -Infinity })).toThrow(/non-finite/);
  });

  it('refuses a non-finite number nested deep inside a payload', () => {
    expect(() => canonicalJson({ picks: [{ qty: NaN }] })).toThrow(/non-finite/);
  });
});

describe('canonicalJson — strings and escaping', () => {
  it('escapes quotes and backslashes so a reason cannot forge structure', () => {
    // A user-typed reason must never be able to break out and fake JSON.
    const forged = canonicalJson({ reason: '","hacked":"yes' });
    expect(forged).toBe('{"reason":"\\",\\"hacked\\":\\"yes"}');
    expect(JSON.parse(forged)).toEqual({ reason: '","hacked":"yes' });
  });

  it('handles Arabic text, which every reason field will contain', () => {
    const out = canonicalJson({ reason: 'تسوية جرد' });
    expect(JSON.parse(out)).toEqual({ reason: 'تسوية جرد' });
  });

  it('handles newlines and control characters', () => {
    const out = canonicalJson({ note: 'line1\nline2\ttab' });
    expect(JSON.parse(out)).toEqual({ note: 'line1\nline2\ttab' });
  });
});

describe('canonicalJson — edge shapes', () => {
  it('serializes empty containers', () => {
    expect(canonicalJson({})).toBe('{}');
    expect(canonicalJson([])).toBe('[]');
  });

  it('serializes primitives at the top level', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(42)).toBe('42');
    expect(canonicalJson('hi')).toBe('"hi"');
    expect(canonicalJson(true)).toBe('true');
  });

  it('refuses undefined at the top level rather than emitting nothing', () => {
    expect(() => canonicalJson(undefined)).toThrow(/unsupported/);
  });
});
