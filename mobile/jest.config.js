/**
 * Tests for the DOMAIN layer only — pure business rules with no React Native,
 * no Expo modules, no SQLite.
 *
 * That restriction is deliberate rather than a shortcut. The rules worth
 * protecting (lockout escalation, weight conversion, event hashing, the
 * projection reducer) are all pure functions, so they run in plain Node in
 * milliseconds with no native mocking. Component and integration tests need
 * jest-expo and a very different setup; keeping them out means this suite
 * stays fast enough to run on every save and in CI without a device.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src/domain'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  collectCoverageFrom: ['src/domain/**/*.ts', '!src/domain/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: { module: 'commonjs', esModuleInterop: true } }],
  },
};
