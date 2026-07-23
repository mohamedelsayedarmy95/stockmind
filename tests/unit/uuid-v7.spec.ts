import { generateUuidV7 } from '../../src/shared/utils/uuid-v7';

describe('generateUuidV7', () => {
  it('produces a valid UUID-shaped string with version nibble 7', () => {
    const id = generateUuidV7();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('is monotonically ordered by ms timestamp', async () => {
    const a = generateUuidV7();
    await new Promise((r) => setTimeout(r, 5));
    const b = generateUuidV7();
    // First 48 bits are the timestamp; string-lex on the hex prefix is ordered.
    const aPrefix = a.replace(/-/g, '').slice(0, 12);
    const bPrefix = b.replace(/-/g, '').slice(0, 12);
    expect(bPrefix >= aPrefix).toBe(true);
  });
});
