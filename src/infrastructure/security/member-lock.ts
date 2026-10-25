type Runner = { query: (sql: string, params?: unknown[]) => Promise<any> };

/**
 * The per-member authority lock (Series 10).
 *
 * Anything that changes what a member may do (role, status, grants) takes it EXCLUSIVELY; every write that relies on that
 * authority takes it SHARED for the duration of its transaction. It is a transaction-level advisory lock rather than only
 * a row lock on purpose: the heavyweight lock manager queues requests fairly, so a stream of overlapping writes by one busy
 * member can never starve a pending revocation (a row-level FOR UPDATE can wait indefinitely behind new FOR SHARE lockers).
 * The writer still share-locks the member row afterwards, so a plain SQL change of the row is respected too.
 *
 * Lock order everywhere: company row, then this lock (target member), then member rows (id order), then warehouses.
 */
const KEY = `hashtextextended('stockmind:member:' || $1::text, 0)`;

export async function lockMemberShared(runner: Runner, userId: string): Promise<void> {
  await runner.query(`SELECT pg_advisory_xact_lock_shared(${KEY})`, [userId]);
}

export async function lockMemberExclusive(runner: Runner, userId: string): Promise<void> {
  await runner.query(`SELECT pg_advisory_xact_lock(${KEY})`, [userId]);
}
