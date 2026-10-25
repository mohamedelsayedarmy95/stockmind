/**
 * Series 11 / F11-03: the one suite that cannot run under CAPABILITY_MODE=enforce, and the proof that nothing it asserts is lost.
 *
 * tests/equivalence/production-bb071ed/movement-history.security.spec.ts is a FROZEN production-equivalence fixture: its module
 * wires the stock controller WITHOUT the capability model (the production line has none). Under enforce the permission guard
 * correctly refuses to decide without a model (it fails closed), so that file cannot be a signal in enforce mode, and it must
 * not be edited to make it one.
 *
 * Its invariants are therefore carried, verbatim, by tests/unit/movement-history.security.spec.ts, an adapted sibling that
 * supplies a capability model derived from the request user and runs green under shadow AND enforce. This spec fails the build
 * if the sibling ever loses a test the frozen file has, so the exclusion can never silently widen.
 */
import { readFileSync } from 'fs';
import * as path from 'path';

const titles = (file: string): string[] =>
  [...readFileSync(file, 'utf8').matchAll(/^\s*it\(\s*(['"`])((?:\\.|(?!\1).)*)\1/gm)].map((m) => m[2].replace(/\\'/g, "'"));

const FROZEN = path.join(__dirname, '../equivalence/production-bb071ed/movement-history.security.spec.ts');
const SIBLING = path.join(__dirname, 'movement-history.security.spec.ts');

describe('enforce-mode coverage of the frozen movement-history fixture', () => {
  const frozen = titles(FROZEN);
  const sibling = titles(SIBLING);

  it('the frozen fixture still has the eight assertions this relationship was written for', () => {
    expect(frozen).toHaveLength(8);
  });

  it.each(frozen.map((t) => [t]))('the enforce-capable sibling asserts it too: %s', (title) => {
    expect(sibling).toContain(title);
  });

  it('the sibling builds its capability principal from the request user (so it decides the same way under shadow and enforce)', () => {
    const source = readFileSync(SIBLING, 'utf8');
    expect(source).toContain('principalFor: async (_req: unknown, userId: string, companyId: string)');
    expect(source).toContain('role: currentUser.role');
    expect(source).not.toMatch(/principalFor: async \(\) => null/);
  });
});
