import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';

type Runner = { query: (sql: string, params?: unknown[]) => Promise<any> };

/**
 * The per-member authority lock (Series 10, ordered and bounded in Series 11).
 *
 * Anything that changes what a member may do (role, status, grants) takes it EXCLUSIVELY; everything that RELIES on that
 * authority for the duration of a transaction takes it SHARED: a stock write by the member, and also an administrator who is
 * granting or revoking access (the GRANTING actor's own authority must not change under a grant that is still in flight).
 * It is a transaction-level advisory lock rather than only a row lock on purpose: the heavyweight lock manager queues
 * requests fairly, so a stream of overlapping writes by one busy member can never starve a pending revocation (a row-level
 * FOR UPDATE can wait indefinitely behind new FOR SHARE lockers). Callers still lock the member row afterwards, so a plain
 * SQL change of the row is respected too.
 *
 * LOCK ORDER (global; documented in SERIES_11_ENFORCEMENT_ADMISSION_CONTRACT.md):
 *   1. the company row (FOR UPDATE for membership actions and the recovery rotation; FOR KEY SHARE / FOR SHARE for everything
 *      else that writes under the company: grants, stock writes, replacements),
 *   2. the member locks of EVERY member the transaction involves, acquired together, in ascending canonical id order
 *      (`lockMembers`), each in the strongest mode the transaction needs: exclusive for a member whose authority it changes,
 *      shared for a member whose authority it relies on. A transaction never upgrades shared to exclusive,
 *   3. member rows, ascending id,
 *   4. warehouses / inventory rows, ascending id.
 * Any two transactions can then wait for each other in one direction only, so the waiting graph has no cycle.
 *
 * The key is derived from the CANONICAL text of the id (`::uuid::text` is lower case), so `ABC…` in a URL and `abc…` in a
 * token are the same lock. (Two different ids hashing to one 64-bit key would at worst make unrelated members wait for each
 * other; it cannot make an authority change miss a lock.)
 */
const KEY = `hashtextextended('stockmind:member:' || $1::uuid::text, 0)`;

export async function lockMemberShared(runner: Runner, userId: string): Promise<void> {
  await runner.query(`SELECT pg_advisory_xact_lock_shared(${KEY})`, [userId]);
}

export async function lockMemberExclusive(runner: Runner, userId: string): Promise<void> {
  await runner.query(`SELECT pg_advisory_xact_lock(${KEY})`, [userId]);
}

export interface MemberLockRequest { userId: string; mode: 'shared' | 'exclusive' }

/** The canonical form used for ordering and for the lock key. */
export const canonicalId = (id: string): string => id.toLowerCase();

/**
 * Acquires the member locks of one transaction as a set: de-duplicated (exclusive wins over shared, so there is never an
 * upgrade) and in ascending canonical id order. THE way to take more than one member lock.
 */
export async function lockMembers(runner: Runner, requests: readonly MemberLockRequest[]): Promise<void> {
  const merged = new Map<string, 'shared' | 'exclusive'>();
  for (const r of requests) {
    const id = canonicalId(r.userId);
    if (merged.get(id) !== 'exclusive') merged.set(id, r.mode);
  }
  for (const id of [...merged.keys()].sort()) {
    if (merged.get(id) === 'exclusive') await lockMemberExclusive(runner, id);
    else await lockMemberShared(runner, id);
  }
}

/** Step 1 of the order for a writer that is not changing the company row itself (a FK to companies would take it anyway). */
export async function lockCompanyKeyShare(runner: Runner, companyId: string): Promise<void> {
  await runner.query(`SELECT 1 FROM companies WHERE id = $1 FOR KEY SHARE`, [companyId]);
}

/**
 * Steps 1 and 2 of the global order for a transaction that CHANGES the authority of `targetIds` on behalf of `actorId`.
 * A target outside the company answers 404 BEFORE any lock is taken, so another company's administrator can neither queue
 * behind nor delay a member of this company. The actor's authority is relied on (shared), every target's is changed
 * (exclusive): one ordered set, so the acting administrator cannot lose their authority under this transaction and two
 * opposite actor/target pairs cannot wait on each other.
 */
export async function lockForAuthorityChange(
  runner: Runner, companyId: string, actorId: string, targetIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(targetIds.map(canonicalId))];
  const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM users WHERE company_id = $1 AND id = ANY($2::uuid[])`, [companyId, ids]);
  if (n !== ids.length) throw new NotFoundException('Member not found');
  await lockCompanyKeyShare(runner, companyId);
  await lockMembers(runner, [
    { userId: actorId, mode: 'shared' },
    ...ids.map((userId) => ({ userId, mode: 'exclusive' as const })),
  ]);
}

// ---------------------------------------------------------------------------------------------------------------------
// Bounded waits

const DEFAULT_AUTHORITY_LOCK_TIMEOUT_MS = 10_000;

/** How long an authority change waits for a lock before it gives up (AUTHORITY_LOCK_TIMEOUT_MS, 100 ms .. 120 s). */
export function authorityLockTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.AUTHORITY_LOCK_TIMEOUT_MS);
  if (!Number.isFinite(n) || n < 100 || n > 120_000) return DEFAULT_AUTHORITY_LOCK_TIMEOUT_MS;
  return Math.floor(n);
}

/** A retryable refusal: the authority lock could not be taken in time, or the database broke a lock cycle. Nothing was changed. */
export class AuthorityBusyException extends ServiceUnavailableException {
  constructor() {
    super({ code: 'AUTHORITY_BUSY', message: 'Access is being changed by another request; nothing was changed. Try again.' });
  }
}

const isLockFailure = (err: unknown): boolean => {
  const e = err as { code?: string; driverError?: { code?: string } } | undefined;
  const c = e?.driverError?.code ?? e?.code;
  return c === '55P03' /* lock_not_available */ || c === '40P01' /* deadlock_detected */;
};

/**
 * A transaction that changes (or relies on a change of) authority: a bounded `lock_timeout`, and a lock timeout / deadlock
 * victim answered as a clean, retryable AUTHORITY_BUSY (503) instead of a 500. The transaction is rolled back either way.
 */
export async function authorityTransaction<T>(dataSource: DataSource, fn: (m: EntityManager) => Promise<T>): Promise<T> {
  try {
    return await dataSource.transaction(async (m) => {
      await m.query(`SELECT set_config('lock_timeout', $1, true)`, [`${authorityLockTimeoutMs()}ms`]);
      return fn(m);
    });
  } catch (err) {
    if (isLockFailure(err)) throw new AuthorityBusyException();
    throw err;
  }
}
