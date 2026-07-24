import { open, type DB, type Scalar } from '@op-engineering/op-sqlite';
import { getOrCreateDbKey } from './key';
import { DB_NAME, DB_SCHEMA_VERSION, SCHEMA_STATEMENTS } from './schema';

/**
 * Encrypted local database (SQLCipher via op-sqlite).
 *
 * The whole .db file is AES-256 encrypted with the per-device key from the
 * keystore (see key.ts) — an attacker with the raw file cannot read it. Opened
 * once at cold start (initDatabase) before any repository is used.
 */

let db: DB | null = null;

export async function initDatabase(): Promise<DB> {
  if (db) return db;

  const encryptionKey = await getOrCreateDbKey();
  const instance = open({ name: DB_NAME, encryptionKey });

  // Durability + integrity: WAL for concurrent reads, FK enforcement on.
  await instance.execute('PRAGMA journal_mode = WAL;');
  await instance.execute('PRAGMA foreign_keys = ON;');

  await runMigrations(instance);

  db = instance;
  return db;
}

export function getDb(): DB {
  if (!db) {
    throw new Error('Database used before initDatabase() completed');
  }
  return db;
}

/** Idempotent schema migration keyed on PRAGMA user_version. */
async function runMigrations(database: DB): Promise<void> {
  const res = await database.execute('PRAGMA user_version;');
  const current = Number((res.rows?.[0] as { user_version?: number } | undefined)?.user_version ?? 0);
  if (current >= DB_SCHEMA_VERSION) return;

  await database.transaction(async (tx) => {
    for (const stmt of SCHEMA_STATEMENTS) {
      await tx.execute(stmt);
    }
  });
  // PRAGMA cannot be parameterised and is a no-op inside a transaction on some
  // builds, so set the version after the schema commits.
  await database.execute(`PRAGMA user_version = ${DB_SCHEMA_VERSION};`);
}

/** Typed SELECT helper — returns the row array. */
export async function query<T>(sql: string, params: Scalar[] = []): Promise<T[]> {
  const res = await getDb().execute(sql, params);
  return (res.rows ?? []) as T[];
}

/** INSERT/UPDATE/DELETE helper — returns rows affected. */
export async function run(sql: string, params: Scalar[] = []): Promise<number> {
  const res = await getDb().execute(sql, params);
  return res.rowsAffected ?? 0;
}

/** For test/reset flows: drop the encrypted file entirely. */
export function deleteDatabase(): void {
  db?.delete();
  db = null;
}
