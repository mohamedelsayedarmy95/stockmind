import { encryptedColumn } from '../../src/shared/crypto/encrypted-column.transformer';

describe('encryptedColumn transformer (AES-256-GCM)', () => {
  const KEY = 'unit-test-master-key-do-not-use-in-prod';

  beforeAll(() => {
    process.env.DB_ENCRYPTION_KEY = KEY;
  });
  afterAll(() => {
    delete process.env.DB_ENCRYPTION_KEY;
  });

  it('round-trips a value through encrypt/decrypt', () => {
    const t = encryptedColumn();
    const plaintext = 'JBSWY3DPEHPK3PXP'; // sample base32 secret
    const stored = t.to(plaintext) as string;

    expect(stored).not.toBe(plaintext); // must be ciphertext at rest
    expect(t.from(stored)).toBe(plaintext); // must decrypt back
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const t = encryptedColumn();
    const a = t.to('same-value') as string;
    const b = t.to('same-value') as string;
    expect(a).not.toBe(b);
    expect(t.from(a)).toBe('same-value');
    expect(t.from(b)).toBe('same-value');
  });

  it('passes null through untouched', () => {
    const t = encryptedColumn();
    expect(t.to(null)).toBeNull();
    expect(t.from(null)).toBeNull();
  });

  it('returns legacy plaintext unchanged on decrypt (no valid envelope)', () => {
    const t = encryptedColumn();
    // A short legacy value that is not a valid GCM envelope.
    expect(t.from('legacy-plaintext')).toBe('legacy-plaintext');
  });
});
