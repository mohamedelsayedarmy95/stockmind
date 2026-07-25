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
  await healColumns(instance);

  db = instance;
  return db;
}

/**
 * Belt-and-braces repair pass, independent of PRAGMA user_version. A device
 * can end up with user_version bumped to the latest schema version while an
 * ALTER TABLE from that same migration batch never actually applied (seen in
 * practice: the batch's transaction still committed overall, so the version
 * marker advanced, but a later statement failure meant an earlier ALTER's
 * effect wasn't durably persisted). Since the version guard alone can't be
 * trusted, re-verify the ALTER-added columns exist on every boot — cheap
 * (PRAGMA table_info is a metadata read) and fully idempotent.
 */
async function healColumns(database: DB): Promise<void> {
  const additions: Array<{ table: string; column: string; ddlType: string }> = [
    { table: 'products', column: 'cost_price', ddlType: 'REAL' },
    { table: 'stock_movements', column: 'store_id', ddlType: 'TEXT' },
    { table: 'stores', column: 'pos_x', ddlType: 'REAL' },
    { table: 'stores', column: 'pos_y', ddlType: 'REAL' },
    { table: 'products', column: 'unit_weight_kg', ddlType: 'REAL' },
    { table: 'products', column: 'lifecycle_status', ddlType: 'TEXT' },
    { table: 'stock_movements', column: 'batch_id', ddlType: 'TEXT' },
    { table: 'stock_movements', column: 'storage_unit_id', ddlType: 'TEXT' },
    { table: 'stock_movements', column: 'pick_strategy', ddlType: 'TEXT' },
  ];

  for (const { table, column, ddlType } of additions) {
    const info = await database.execute(`PRAGMA table_info(${table});`);
    const rows = (info.rows ?? []) as Array<{ name: string }>;
    if (!rows.some((r) => r.name === column)) {
      await database.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddlType};`);
    }
  }
}

export function getDb(): DB {
  if (!db) {
    throw new Error('Database used before initDatabase() completed');
  }
  return db;
}

/**
 * Idempotent schema migration keyed on PRAGMA user_version.
 *
 * The entire SCHEMA_STATEMENTS history replays on every device below the
 * current version (not just the statements added since its last version),
 * because op-sqlite has no per-statement version bookkeeping here. CREATE
 * TABLE/INDEX statements use IF NOT EXISTS so replaying is naturally safe,
 * but a bare ALTER TABLE ADD COLUMN is not — it throws "duplicate column
 * name" on any device that already has that column from an earlier partial
 * upgrade (e.g. a device that reached v2 before v3's statements were added).
 * Swallow exactly that error per-statement so the replay is safe regardless
 * of which version a device is coming from; anything else still fails loud.
 */
async function runMigrations(database: DB): Promise<void> {
  const res = await database.execute('PRAGMA user_version;');
  const current = Number((res.rows?.[0] as { user_version?: number } | undefined)?.user_version ?? 0);
  if (current >= DB_SCHEMA_VERSION) return;

  await database.transaction(async (tx) => {
    for (const stmt of SCHEMA_STATEMENTS) {
      try {
        await tx.execute(stmt);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (!/duplicate column name/i.test(message)) {
          throw e;
        }
      }
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
