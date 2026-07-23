import { isStrongPassword } from '../../src/shared/validators/strong-password.validator';

describe('isStrongPassword', () => {
  it('accepts a strong password', () => {
    expect(isStrongPassword('Str0ng!Passphrase')).toBe(true);
  });

  it('rejects passwords shorter than 12 chars', () => {
    expect(isStrongPassword('Ab1!xyz')).toBe(false);
  });

  it('rejects when missing an uppercase letter', () => {
    expect(isStrongPassword('str0ng!passphrase')).toBe(false);
  });

  it('rejects when missing a digit', () => {
    expect(isStrongPassword('Strong!Passphrase')).toBe(false);
  });

  it('rejects when missing a special character', () => {
    expect(isStrongPassword('Str0ngPassphrase')).toBe(false);
  });

  it('rejects common blacklisted passwords even if complex-looking', () => {
    // Meets complexity but is a known weak pattern.
    expect(isStrongPassword('Password123!')).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(isStrongPassword(12345678 as unknown)).toBe(false);
  });
});
