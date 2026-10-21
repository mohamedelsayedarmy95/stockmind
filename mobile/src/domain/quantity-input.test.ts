import { MAX_MOVEMENT_QUANTITY, parseQuantityInput } from './quantity-input';

describe('parseQuantityInput', () => {
  it('accepts a whole number within the limit', () => {
    expect(parseQuantityInput('137', 500)).toBe(137);
    expect(parseQuantityInput(' 42 ', 500)).toBe(42);
    expect(parseQuantityInput('500', 500)).toBe(500);
  });

  it('accepts Arabic-Indic and Persian digits typed on an Arabic keyboard', () => {
    expect(parseQuantityInput('١٣٧', 500)).toBe(137);
    expect(parseQuantityInput('۴۲', 500)).toBe(42);
  });

  it('rejects zero, negatives, fractions, separators and text', () => {
    for (const bad of ['', '0', '-5', '2.5', '1,000', '12a', 'abc', '1e3']) {
      expect(parseQuantityInput(bad, 5000)).toBeNull();
    }
  });

  it('rejects more than the limit (for a dispatch: what can be issued)', () => {
    expect(parseQuantityInput('501', 500)).toBeNull();
    expect(parseQuantityInput(String(MAX_MOVEMENT_QUANTITY + 1), MAX_MOVEMENT_QUANTITY)).toBeNull();
  });

  it('rejects everything when nothing can be issued', () => {
    expect(parseQuantityInput('1', 0)).toBeNull();
  });
});
