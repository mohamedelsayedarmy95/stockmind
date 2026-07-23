import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * Military-grade password policy:
 *  - ≥ 12 characters
 *  - at least one uppercase, one lowercase, one digit, one special char
 *  - not a well-known weak password (built-in blacklist, case-insensitive,
 *    also catches the common "<word>+digits" pattern like "Password123").
 *
 * WHY a blacklist on top of complexity: complexity rules alone still accept
 * predictable passwords such as "Password123!" that appear in every breach
 * corpus. Rejecting the known-bad set closes the most exploited gap.
 */

const COMMON_PASSWORDS = new Set(
  [
    'password',
    'passw0rd',
    'password1',
    'password123',
    'admin',
    'administrator',
    'welcome',
    'welcome1',
    'letmein',
    'qwerty',
    'qwerty123',
    'iloveyou',
    'monkey',
    'dragon',
    'football',
    'baseball',
    'superman',
    'trustno1',
    'changeme',
    'secret',
    'master',
    'sunshine',
    'princess',
    'abc123',
    '123456',
    '12345678',
    '1234567890',
    'stockmind',
  ].map((p) => p.toLowerCase()),
);

const SPECIAL_CHARS = /[!@#$%^&*(),.?":{}|<>_\-\\[\]/~`+=;']/;

export function isStrongPassword(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length < 12) return false;
  if (!/[A-Z]/.test(value)) return false;
  if (!/[a-z]/.test(value)) return false;
  if (!/[0-9]/.test(value)) return false;
  if (!SPECIAL_CHARS.test(value)) return false;

  // Blacklist check: strip trailing digits/symbols so "Password123!" is caught.
  const normalized = value.toLowerCase();
  const stripped = normalized.replace(/[0-9!@#$%^&*._\-]+$/g, '');
  if (COMMON_PASSWORDS.has(normalized) || COMMON_PASSWORDS.has(stripped)) return false;

  return true;
}

@ValidatorConstraint({ name: 'isStrongPassword', async: false })
class StrongPasswordConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isStrongPassword(value);
  }

  defaultMessage(): string {
    return (
      'Password must be at least 12 characters and include uppercase, lowercase, ' +
      'a number, and a special character, and must not be a common password.'
    );
  }
}

export function IsStrongPassword(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: StrongPasswordConstraint,
    });
  };
}
