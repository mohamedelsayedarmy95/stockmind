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
export const DB_SCHEMA_VERSION = 7;

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

  // v2: optional unit cost, used to compute the dashboard's Stock Value KPI
  // (sum(quantity * cost_price) across stock_balances). Not part of the
  // original CREATE TABLE so this ALTER runs exactly once per device,
  // whether upgrading from v1 or creating a fresh v2 database.
  `ALTER TABLE products ADD COLUMN cost_price REAL;`,

  // v3: per-section (store) stock tracking, additive to stock_balances so the
  // warehouse-level total stays the single source of truth for "how much is
  // available to move" (used by transfer/move insufficient-stock checks).
  // A row here means "this much of this product is putaway in this specific
  // section"; SUM(quantity) per (product, warehouse) is always <=
  // stock_balances.quantity for that pair — the remainder is unallocated to
  // any section yet. Kept in sync inside the same transaction as the
  // warehouse-level update whenever a movement/transfer names a store.
  `CREATE TABLE IF NOT EXISTS stock_balances_by_store (
    id           TEXT PRIMARY KEY NOT NULL,
    product_id   TEXT NOT NULL,
    warehouse_id TEXT NOT NULL,
    store_id     TEXT NOT NULL,
    quantity     REAL NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    deleted_at   INTEGER,
    sync_status  TEXT NOT NULL DEFAULT 'pending',
    UNIQUE (product_id, store_id)
  );`,
  `ALTER TABLE stock_movements ADD COLUMN store_id TEXT;`,

  // v4: freeform (x, y) placement for the interactive warehouse map. NULL
  // means "not placed yet" — the UI falls back to an auto-arranged grid
  // until the user drags a section, at which point real coordinates persist.
  `ALTER TABLE stores ADD COLUMN pos_x REAL;`,
  `ALTER TABLE stores ADD COLUMN pos_y REAL;`,

  // v5: local crash/error log (launch-readiness monitoring). No external
  // service or native SDK — the ErrorBoundary and the global JS error handler
  // both write here, so a crash is never silently lost even offline.
  `CREATE TABLE IF NOT EXISTS crash_log (
    id           TEXT PRIMARY KEY NOT NULL,
    message      TEXT NOT NULL,
    stack        TEXT,
    fatal        INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL
  );`,

  // ── v6: professional WMS depth (Product Constitution, ch.3) ──────────────
  //
  // Storage units form a TREE inside a section: a pallet holds cartons, a
  // carton holds units. Stored as a materialized path ('/rootId/childId/')
  // so a whole subtree is one indexed `path LIKE '/id/%'` scan rather than a
  // recursive query — the "Tree Queries" the constitution mandates.
  `CREATE TABLE IF NOT EXISTS storage_units (
    id           TEXT PRIMARY KEY NOT NULL,
    warehouse_id TEXT NOT NULL,
    store_id     TEXT NOT NULL DEFAULT '',
    parent_id    TEXT,
    name         TEXT NOT NULL,
    unit_type    TEXT NOT NULL,
    path         TEXT NOT NULL,
    depth        INTEGER NOT NULL DEFAULT 0,
    position     INTEGER,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    deleted_at   INTEGER,
    sync_status  TEXT NOT NULL DEFAULT 'pending'
  );`,

  // A batch (lot) of one product: the unit FEFO/FIFO/LIFO actually picks from.
  // expiry_date drives FEFO; received_at drives FIFO/LIFO.
  `CREATE TABLE IF NOT EXISTS batches (
    id          TEXT PRIMARY KEY NOT NULL,
    product_id  TEXT NOT NULL,
    batch_code  TEXT NOT NULL,
    expiry_date INTEGER,
    received_at INTEGER NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER,
    sync_status TEXT NOT NULL DEFAULT 'pending',
    UNIQUE (product_id, batch_code)
  );`,

  // Per-batch on-hand quantity. Additive to stock_balances exactly like
  // stock_balances_by_store: the warehouse-level row stays the single source
  // of truth for "how much can move", so every existing insufficient-stock
  // check keeps working untouched. Location columns default to '' (not NULL)
  // so the UNIQUE key behaves — SQLite treats NULLs as distinct.
  `CREATE TABLE IF NOT EXISTS stock_batch_balances (
    id              TEXT PRIMARY KEY NOT NULL,
    batch_id        TEXT NOT NULL,
    product_id      TEXT NOT NULL,
    warehouse_id    TEXT NOT NULL,
    store_id        TEXT NOT NULL DEFAULT '',
    storage_unit_id TEXT NOT NULL DEFAULT '',
    quantity        REAL NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    deleted_at      INTEGER,
    sync_status     TEXT NOT NULL DEFAULT 'pending',
    UNIQUE (batch_id, warehouse_id, store_id, storage_unit_id)
  );`,

  // Serialized tracking: one row per physical unit that carries a serial.
  `CREATE TABLE IF NOT EXISTS serials (
    id              TEXT PRIMARY KEY NOT NULL,
    product_id      TEXT NOT NULL,
    serial_number   TEXT NOT NULL,
    batch_id        TEXT,
    status          TEXT NOT NULL DEFAULT 'in_stock',
    warehouse_id    TEXT,
    store_id        TEXT,
    storage_unit_id TEXT,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    deleted_at      INTEGER,
    sync_status     TEXT NOT NULL DEFAULT 'pending',
    UNIQUE (product_id, serial_number)
  );`,

  // Independent ledger for serial movement (constitution ch.3 art.2).
  `CREATE TABLE IF NOT EXISTS serial_movements (
    id                TEXT PRIMARY KEY NOT NULL,
    serial_id         TEXT NOT NULL,
    movement_id       TEXT,
    action            TEXT NOT NULL,
    from_warehouse_id TEXT,
    to_warehouse_id   TEXT,
    note              TEXT,
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL,
    deleted_at        INTEGER,
    sync_status       TEXT NOT NULL DEFAULT 'pending'
  );`,

  // Reservations hold stock without deducting it: available = on-hand minus
  // active reservations. Released or fulfilled rows stop counting.
  `CREATE TABLE IF NOT EXISTS reservations (
    id           TEXT PRIMARY KEY NOT NULL,
    product_id   TEXT NOT NULL,
    warehouse_id TEXT NOT NULL,
    batch_id     TEXT,
    quantity     REAL NOT NULL,
    status       TEXT NOT NULL DEFAULT 'active',
    reference    TEXT,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    deleted_at   INTEGER,
    sync_status  TEXT NOT NULL DEFAULT 'pending'
  );`,

  // Weight-based counting (qty = total_weight / unit_weight) + lifecycle state.
  `ALTER TABLE products ADD COLUMN unit_weight_kg REAL;`,
  `ALTER TABLE products ADD COLUMN lifecycle_status TEXT;`,
  // Movements record which batch/unit they touched and how the pick was made.
  `ALTER TABLE stock_movements ADD COLUMN batch_id TEXT;`,
  `ALTER TABLE stock_movements ADD COLUMN storage_unit_id TEXT;`,
  `ALTER TABLE stock_movements ADD COLUMN pick_strategy TEXT;`,

  // ── v7: Inventory Event Engine (UWOS §0, docs/event-schema.md) ───────────
  //
  // Append-only. No UPDATE, no DELETE, ever — a mistake is corrected by
  // appending a compensating event. `seq` (not occurred_at) is the replay
  // order: wall-clock timestamps collide and can move backwards, and a
  // ledger that replays in a different order than it was written is not a
  // ledger. Deliberately has no deleted_at column; that is the whole point.
  `CREATE TABLE IF NOT EXISTS inventory_events (
    seq                 INTEGER PRIMARY KEY AUTOINCREMENT,
    id                  TEXT NOT NULL UNIQUE,
    event_type          TEXT NOT NULL,
    occurred_at         INTEGER NOT NULL,
    recorded_at         INTEGER NOT NULL,
    product_id          TEXT,
    warehouse_id        TEXT,
    store_id            TEXT,
    storage_unit_id     TEXT,
    batch_id            TEXT,
    dest_warehouse_id   TEXT,
    dest_store_id       TEXT,
    dest_storage_unit_id TEXT,
    quantity            REAL,
    reason              TEXT,
    reference           TEXT,
    created_by          TEXT NOT NULL,
    approved_by         TEXT,
    status              TEXT NOT NULL DEFAULT 'confirmed',
    reverses_event_id   TEXT,
    cost_impact         REAL,
    financial_impact    REAL,
    payload             TEXT,
    prev_hash           TEXT NOT NULL,
    hash                TEXT NOT NULL,
    sync_status         TEXT NOT NULL DEFAULT 'pending'
  );`,

  // Migration bookkeeping — data migrations can't key off PRAGMA
  // user_version, which only tracks DDL.
  `CREATE TABLE IF NOT EXISTS app_meta (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );`,

  // Indexes for the hot query paths. At scale (multiple warehouses x
  // hundreds of sections x thousands of products) these keep list/aggregate
  // queries index-backed instead of full table scans.
  `CREATE INDEX IF NOT EXISTS idx_products_barcode ON products (barcode);`,
  `CREATE INDEX IF NOT EXISTS idx_balances_product ON stock_balances (product_id);`,
  `CREATE INDEX IF NOT EXISTS idx_movements_product ON stock_movements (product_id, created_at);`,
  `CREATE INDEX IF NOT EXISTS idx_movements_store ON stock_movements (store_id, created_at);`,
  `CREATE INDEX IF NOT EXISTS idx_stores_warehouse ON stores (warehouse_id);`,
  `CREATE INDEX IF NOT EXISTS idx_reminders_time ON reminders (remind_at);`,
  `CREATE INDEX IF NOT EXISTS idx_balances_store_product ON stock_balances_by_store (product_id);`,
  `CREATE INDEX IF NOT EXISTS idx_balances_store_warehouse ON stock_balances_by_store (warehouse_id);`,
  // sync_status indexes back the dashboard's Pending Sync aggregate query.
  `CREATE INDEX IF NOT EXISTS idx_products_sync ON products (sync_status);`,
  `CREATE INDEX IF NOT EXISTS idx_warehouses_sync ON warehouses (sync_status);`,
  `CREATE INDEX IF NOT EXISTS idx_movements_sync ON stock_movements (sync_status);`,
  // v6 hot paths: subtree scans, FEFO/FIFO ordering, serial lookup, reservations.
  `CREATE INDEX IF NOT EXISTS idx_units_path ON storage_units (path);`,
  `CREATE INDEX IF NOT EXISTS idx_units_store ON storage_units (store_id, sort_order);`,
  `CREATE INDEX IF NOT EXISTS idx_units_warehouse ON storage_units (warehouse_id);`,
  `CREATE INDEX IF NOT EXISTS idx_batches_product ON batches (product_id, expiry_date);`,
  `CREATE INDEX IF NOT EXISTS idx_batches_received ON batches (product_id, received_at);`,
  `CREATE INDEX IF NOT EXISTS idx_batch_bal_lookup ON stock_batch_balances (product_id, warehouse_id);`,
  `CREATE INDEX IF NOT EXISTS idx_batch_bal_batch ON stock_batch_balances (batch_id);`,
  `CREATE INDEX IF NOT EXISTS idx_serials_product ON serials (product_id, status);`,
  `CREATE INDEX IF NOT EXISTS idx_serials_number ON serials (serial_number);`,
  `CREATE INDEX IF NOT EXISTS idx_serial_moves ON serial_movements (serial_id, created_at);`,
  `CREATE INDEX IF NOT EXISTS idx_reservations_lookup ON reservations (product_id, warehouse_id, status);`,
  // Replay and per-entity history are the two ways the log is ever read.
  `CREATE INDEX IF NOT EXISTS idx_events_product ON inventory_events (product_id, warehouse_id, seq);`,
  `CREATE INDEX IF NOT EXISTS idx_events_batch ON inventory_events (batch_id, seq);`,
  `CREATE INDEX IF NOT EXISTS idx_events_sync ON inventory_events (sync_status);`,
];
