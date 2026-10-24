import { QueryRunner } from 'typeorm';

/**
 * Raised by a migration's down() that refuses to run because it would destroy data. It is thrown before any statement
 * that changes anything, so the transaction TypeORM wraps around down() has nothing to roll back and the database is
 * exactly as it was.
 */
export class UnsafeDownMigrationError extends Error {
  constructor(migration: string, findings: string[]) {
    super(
      `Refusing to revert ${migration}: it would permanently destroy data created after the rollout (${findings.join('; ')}). ` +
        'Nothing was changed. Reverting is supported only on a database where none of that data exists. ' +
        'To go back, restore a backup taken before the migration, or fix forward with a new migration. ' +
        'See docs/handoff/STOCKMIND_DATABASE_RECOVERY_RUNBOOK.md section 8.',
    );
    this.name = 'UnsafeDownMigrationError';
  }
}

export interface DownCheck {
  /** What the rows are, for the message: "team invitation(s)". */
  label: string;
  /** A read-only query returning one row with the number of rows that would be lost, as `n`. */
  sql: string;
}

/** Runs read-only checks and throws UnsafeDownMigrationError if any of them finds data that down() would delete. */
export async function refuseIfDataWouldBeLost(
  queryRunner: QueryRunner,
  migration: string,
  checks: DownCheck[],
): Promise<void> {
  const findings: string[] = [];
  for (const check of checks) {
    const rows: Array<{ n: number | string }> = await queryRunner.query(check.sql);
    const n = Number(rows[0]?.n ?? 0);
    if (n > 0) findings.push(`${n} ${check.label}`);
  }
  if (findings.length) throw new UnsafeDownMigrationError(migration, findings);
}
