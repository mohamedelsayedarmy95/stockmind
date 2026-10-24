/**
 * Production fix 104b3e3 (lockfile only): compression >= 1.8.2 (GHSA-vc2v-76pw-4v95, memory leak when a response is
 * closed early) and proxy-addr >= 2.0.8 (GHSA-jqcg-44mw-7w3h, IPv4-mapped IPv6 trust-subnet spoofing).
 *
 * Production had no spec for this change; this one checks the property it established: no resolved copy of either
 * package in package-lock.json is older than the patched version. Written for the candidate in Series 06.
 */
import * as fs from 'fs';
import * as path from 'path';

type Lock = { packages: Record<string, { version?: string }> };
const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../package-lock.json'), 'utf8')) as Lock;

const parse = (v: string): number[] => v.split('-')[0].split('.').map((n) => Number.parseInt(n, 10));
const atLeast = (version: string, minimum: string): boolean => {
  const a = parse(version);
  const b = parse(minimum);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
};
const copiesOf = (name: string) =>
  Object.entries(lock.packages).filter(([key]) => key === `node_modules/${name}` || key.endsWith(`/node_modules/${name}`));

describe('production fix 104b3e3: patched dependency versions in the lockfile', () => {
  it.each([
    ['compression', '1.8.2'],
    ['proxy-addr', '2.0.8'],
  ])('%s: every resolved copy is >= %s', (name, minimum) => {
    const copies = copiesOf(name);
    expect(copies.length).toBeGreaterThan(0);
    for (const [key, entry] of copies) {
      expect({ key, patched: atLeast(entry.version ?? '0.0.0', minimum) }).toEqual({ key, patched: true });
    }
  });

  it('the version comparison itself orders patch versions correctly', () => {
    expect(atLeast('1.8.2', '1.8.2')).toBe(true);
    expect(atLeast('1.8.1', '1.8.2')).toBe(false);
    expect(atLeast('2.0.7', '2.0.8')).toBe(false);
    expect(atLeast('2.1.0', '2.0.8')).toBe(true);
  });
});
