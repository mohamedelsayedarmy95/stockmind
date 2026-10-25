/**
 * Series 11: the ORDER in which a grant transaction takes its locks, observed on a recording runner (no database). Opposite
 * actor/target pairs can only never deadlock if every transaction takes its member locks in the same global order, whichever of
 * the two ids is smaller. The real-PostgreSQL behaviour is in tests/integration/authority-linearization.pg.spec.ts.
 */
import { AccessGrantService } from '../../src/infrastructure/repositories/access-grant.service';
import { CapabilityService } from '../../src/infrastructure/security/capability.service';

const COMPANY = '00000000-0000-4000-8000-0000000000c1';
const W = '00000000-0000-4000-8000-0000000000a1';
const LOW = '10000000-0000-4000-8000-000000000001';
const HIGH = 'f0000000-0000-4000-8000-000000000002';

function recorder(actorId: string, targetId: string) {
  const events: string[] = [];
  const runner = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes('pg_advisory_xact_lock_shared')) { events.push(`S:${params[0]}`); return []; }
      if (sql.includes('pg_advisory_xact_lock')) { events.push(`X:${params[0]}`); return []; }
      if (sql.includes('FROM companies') && sql.includes('FOR KEY SHARE')) { events.push('company:key-share'); return []; }
      if (sql.includes('count(*)::int AS n FROM users')) return [{ n: (params[1] as string[]).length }];
      if (sql.includes('FROM users WHERE id = $1 AND company_id = $2 FOR UPDATE')) return [{ id: targetId, role: 'Staff', status: 'active' }];
      if (sql.includes('FROM users WHERE id = $1 AND company_id = $2 FOR SHARE')) {
        return [{ id: actorId, company_id: COMPANY, role: 'Admin', status: 'active', is_owner: false }];
      }
      if (sql.includes('FROM user_roles ur')) return [];
      if (sql.includes('count(*)::int AS n FROM warehouses')) return [{ n: 1 }];
      return [];
    },
  };
  return { runner, events };
}

describe('AccessGrantService: lock acquisition order', () => {
  const service = () => new AccessGrantService({} as never, { write: async () => undefined } as never, new CapabilityService({} as never));

  it.each([
    ['the actor sorts BEFORE the target', LOW, HIGH],
    ['the actor sorts AFTER the target', HIGH, LOW],
  ])('%s: the company comes first, then the member locks in ascending id order, actor shared and target exclusive', async (_n, actor, target) => {
    const { runner, events } = recorder(actor, target);
    await service().applyForMember(runner, COMPANY, actor, target, () => [{ warehouseId: W, profile: 'operator' }], 'api');
    expect(events[0]).toBe('company:key-share');
    const memberLocks = events.filter((e) => /^[SX]:/.test(e));
    const ids = memberLocks.map((e) => e.slice(2));
    const firstAcquisitions = [...new Set(ids)]; // (a lock already held is re-acquired later when the actor is loaded: harmless)
    expect(firstAcquisitions).toEqual([...firstAcquisitions].sort()); // ascending
    expect(new Set(ids)).toEqual(new Set([actor, target]));
    expect(memberLocks).toContain(`S:${actor}`);
    expect(memberLocks).toContain(`X:${target}`);
    // nothing is ever taken shared and then exclusive for the same member (no upgrade)
    expect(memberLocks.filter((e) => e === `X:${actor}`)).toEqual([]);
  });
});
