/**
 * Series 11: the lock protocol helpers, without a database. The real-PostgreSQL behaviour (waits, cycles, timeouts) is in
 * tests/integration/authority-linearization.pg.spec.ts; this pins the ordering and error-mapping rules.
 */
import {
  authorityLockTimeoutMs, AuthorityBusyException, authorityTransaction, canonicalId, lockMembers,
} from '../../src/infrastructure/security/member-lock';

const A = '0A000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';
const C = 'C0000000-0000-4000-8000-000000000003';

const recorder = () => {
  const calls: Array<{ mode: 'shared' | 'exclusive'; id: string }> = [];
  return {
    calls,
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ mode: sql.includes('pg_advisory_xact_lock_shared') ? 'shared' : 'exclusive', id: String(params[0]) });
      return [];
    },
  };
};

describe('lockMembers', () => {
  it('acquires in ascending canonical (lower-case) id order, whatever order the caller lists them', async () => {
    const r = recorder();
    await lockMembers(r, [{ userId: C, mode: 'exclusive' }, { userId: B, mode: 'shared' }, { userId: A, mode: 'exclusive' }]);
    expect(r.calls.map((c) => c.id)).toEqual([A, B, C].map(canonicalId).sort());
  });

  it('two opposite pairs produce the SAME acquisition order (no cycle is possible)', async () => {
    const one = recorder(); const two = recorder();
    await lockMembers(one, [{ userId: A, mode: 'shared' }, { userId: B, mode: 'exclusive' }]);
    await lockMembers(two, [{ userId: B, mode: 'shared' }, { userId: A, mode: 'exclusive' }]);
    expect(one.calls.map((c) => c.id)).toEqual(two.calls.map((c) => c.id));
  });

  it('a member named twice is locked once, in the strongest mode (never shared then exclusive: no upgrade)', async () => {
    const r = recorder();
    await lockMembers(r, [{ userId: A, mode: 'shared' }, { userId: A.toLowerCase(), mode: 'exclusive' }, { userId: B, mode: 'shared' }]);
    expect(r.calls).toEqual([{ mode: 'exclusive', id: canonicalId(A) }, { mode: 'shared', id: canonicalId(B) }]);
  });

  it('upper- and lower-case spellings of an id are the same lock', async () => {
    const r = recorder();
    await lockMembers(r, [{ userId: A, mode: 'shared' }, { userId: A.toUpperCase(), mode: 'shared' }]);
    expect(r.calls).toHaveLength(1);
  });
});

describe('authorityTransaction', () => {
  const dataSource = (fn: (m: unknown) => Promise<unknown>, setup?: (queries: string[]) => void) => {
    const queries: string[] = [];
    setup?.(queries);
    return {
      queries,
      transaction: async (cb: (m: unknown) => Promise<unknown>) => cb({ query: async (sql: string, p?: unknown[]) => { queries.push(`${sql} ${JSON.stringify(p ?? [])}`); return []; } }),
      fn,
    };
  };

  it('sets a bounded lock_timeout first (default 10 s, AUTHORITY_LOCK_TIMEOUT_MS within 100 ms .. 120 s)', async () => {
    expect(authorityLockTimeoutMs({} as NodeJS.ProcessEnv)).toBe(10_000);
    expect(authorityLockTimeoutMs({ AUTHORITY_LOCK_TIMEOUT_MS: '2500' } as unknown as NodeJS.ProcessEnv)).toBe(2500);
    for (const bad of ['0', '50', '-1', 'abc', '999999999', '']) {
      expect(authorityLockTimeoutMs({ AUTHORITY_LOCK_TIMEOUT_MS: bad } as unknown as NodeJS.ProcessEnv)).toBe(10_000);
    }
    const ds = dataSource(async () => 'ok');
    await expect(authorityTransaction(ds as never, async (m) => { await (m as { query: (s: string) => Promise<unknown> }).query('SELECT 1'); return 'done'; })).resolves.toBe('done');
    expect(ds.queries[0]).toContain("set_config('lock_timeout'");
    expect(ds.queries[0]).toContain('10000ms');
    expect(ds.queries[1]).toContain('SELECT 1');
  });

  it.each([['55P03', 'a lock timeout'], ['40P01', 'a deadlock victim']])('maps %s (%s) to a retryable AUTHORITY_BUSY (503)', async (code) => {
    const ds = { transaction: async (cb: (m: unknown) => Promise<unknown>) => cb({ query: async () => { throw Object.assign(new Error('pg'), { driverError: { code } }); } }) };
    const err = await authorityTransaction(ds as never, async () => 'unused').catch((e) => e);
    expect(err).toBeInstanceOf(AuthorityBusyException);
    expect(err.getStatus()).toBe(503);
    expect(err.getResponse()).toMatchObject({ code: 'AUTHORITY_BUSY' });
  });

  it('any other error passes through untouched', async () => {
    const boom = new Error('syntax');
    const ds = { transaction: async (cb: (m: unknown) => Promise<unknown>) => cb({ query: async () => { throw boom; } }) };
    await expect(authorityTransaction(ds as never, async () => 'unused')).rejects.toBe(boom);
    const forbidden = Object.assign(new Error('x'), { code: '23505' });
    await expect(authorityTransaction({ transaction: async () => { throw forbidden; } } as never, async () => 1)).rejects.toBe(forbidden);
  });
});
