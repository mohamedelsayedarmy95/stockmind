/**
 * Local SQLite schema (SQLCipher-encrypted).
 *
 * Every table mirrors the backend PostgreSQL entities logically and carries the
 * columns needed for future incremental cloud sync WITHOUT a schema rewrite:
 *   - id          TEXT primary key (uuid, same id space as the server)
 *   - created_at  / updated_at  epoch millis — differential sync watermark
 *   - deleted_at  epoch millis, NULL = live (soft delete, never hard-delete
 *                 user data so a tombstone can be pushed on sync)
 *   - sync_status 'pending' (local change not yet uploaded) | 'synced'
 *                 | 'conflict' (server + local diverged; resolve on sync)
 *
 * DB_SCHEMA_VERSION is bumped whenever statements change; runMigrations applies
 * new versions idempotently.
 */

export const DB_NAME = 'stockmind.db';
export const DB_SCHEMA_VERSION = 1;

/**
 * Ordered CREATE statements. All use `IF NOT EXISTS` so a fresh install and an
 * upgrade run through the same path. Foreign keys are declared but enforcement
 * is toggled per-connection (see database.ts) so seed order never blocks.
 */
export const SCHEMA_STATEMENTS: string[] = [
  // Local account / guest identity for offline mode.
  `CREATE TABLE IF NOT EXISTS local_users (
    id           TEXT PRIMARY KEY NOT NULL,
    name         TEXT NOT NULL,
    email        TEXT,
    is_guest     INTEGER NOT NULL DEFAULT 0,
    company_name TEXT,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    deleted_at   INTEGER,
    sync_status  TEXT NOT NULL DEFAULT 'pending'
  );`,

  `CREATE TABLE IF NOT EXISTS warehouses (
    id          TEXT PRIMARY KEY NOT NULL,
    name        TEXT NOT NULL,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER,
    sync_status TEXT NOT NULL DEFAULT 'pending'
  );`,

  // Sections/stores inside a warehouse (future-facing; interactive map).
  `CREATE TABLE IF NOT EXISTS stores (
    id           TEXT PRIMARY KEY NOT NULL,
    warehouse_id TEXT NOT NULL,
    name         TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    deleted_at   INTEGER,
    sync_status  TEXT NOT NULL DEFAULT 'pending'
  );`,

  `CREATE TABLE IF NOT EXISTS categories (
    id          TEXT PRIMARY KEY NOT NULL,
    name        TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER,
    sync_status TEXT NOT NULL DEFAULT 'pending'
  );`,

  `CREATE TABLE IF NOT EXISTS products (
    id          TEXT PRIMARY KEY NOT NULL,
    name        TEXT NOT NULL,
    sku         TEXT NOT NULL,
    barcode     TEXT,
    category_id TEXT,
    image_url   TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER,
    sync_status TEXT NOT NULL DEFAULT 'pending'
  );`,

  // Current on-hand quantity per product per warehouse (base units).
  `CREATE TABLE IF NOT EXISTS stock_balances (
    id           TEXT PRIMARY KEY NOT NULL,
    product_id   TEXT NOT NULL,
    warehouse_id TEXT NOT NULL,
    quantity     REAL NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    deleted_at   INTEGER,
    sync_status  TEXT NOT NULL DEFAULT 'pending',
    UNIQUE (product_id, warehouse_id)
  );`,

  // Immutable ledger of movements (inbound/outbound/adjustment/transfer).
  `CREATE TABLE IF NOT EXISTS stock_movements (
    id            TEXT PRIMARY KEY NOT NULL,
    product_id    TEXT NOT NULL,
    warehouse_id  TEXT NOT NULL,
    type          TEXT NOT NULL,
    quantity      REAL NOT NULL,
    balance_after REAL NOT NULL,
    notes         TEXT,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    deleted_at    INTEGER,
    sync_status   TEXT NOT NULL DEFAULT 'pending'
  );`,

  // Free-text notes attached to a product (future UI).
  `CREATE TABLE IF NOT EXISTS notes (
    id          TEXT PRIMARY KEY NOT NULL,
    product_id  TEXT NOT NULL,
    body        TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER,
    sync_status TEXT NOT NULL DEFAULT 'pending'
  );`,

  // Local reminders → scheduled via expo-notifications (offline alarms).
  `CREATE TABLE IF NOT EXISTS reminders (
    id                TEXT PRIMARY KEY NOT NULL,
    product_id        TEXT,
    title             TEXT NOT NULL,
    body              TEXT,
    remind_at         INTEGER NOT NULL,
    notification_id   TEXT,
    is_done           INTEGER NOT NULL DEFAULT 0,
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL,
    deleted_at        INTEGER,
    sync_status       TEXT NOT NULL DEFAULT 'pending'
  );`,

  // Activity log (سجل النشاطات) — every mutation records an entry.
  `CREATE TABLE IF NOT EXISTS activity_log (
    id          TEXT PRIMARY KEY NOT NULL,
    action      TEXT NOT NULL,
    entity      TEXT NOT NULL,
    entity_id   TEXT,
    detail      TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER,
    sync_status TEXT NOT NULL DEFAULT 'pending'
  );`,

  // Indexes for the hot query paths.
  `CREATE INDEX IF NOT EXISTS idx_products_barcode ON products (barcode);`,
  `CREATE INDEX IF NOT EXISTS idx_balances_product ON stock_balances (product_id);`,
  `CREATE INDEX IF NOT EXISTS idx_movements_product ON stock_movements (product_id, created_at);`,
  `CREATE INDEX IF NOT EXISTS idx_stores_warehouse ON stores (warehouse_id);`,
  `CREATE INDEX IF NOT EXISTS idx_reminders_time ON reminders (remind_at);`,
];
