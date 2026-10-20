/**
 * Migration 1792560000000 (shared-warehouse foundations) on real PostgreSQL, applied to a schema that already holds
 * data written by the previous release: existing Staff keep access to every warehouse of their company, existing
 * movements get per-warehouse revisions in ledger order, and down() removes exactly what up() added.
 * Runs only with PG_INTEGRATION=1 and DB_HOST localhost/127.0.0.1, in a schema of its own that it drops afterwards.
 */
import { DataSource } from 'typeorm';
import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import * as path from 'path';
import { randomBytes } from 'crypto';

const RUN = process.env.PG_INTEGRATION === '1' && ['localhost', '127.0.0.1'].includes(process.env.DB_HOST ?? '');
const SCHEMA = `sw_mig_${randomBytes(4).toString('hex')}`;
const MIGRATIONS = path.join(__dirname, '../../src/migrations');
const PREVIOUS = [path.join(MIGRATIONS, '172*.ts'), path.join(MIGRATIONS, '1792473600000-*.ts')];
const NEW_MIGRATION = 'SharedWarehouseFoundation1792560000000';

const options = (migrations: string[] = [], schema: string | undefined = SCHEMA): PostgresConnectionOptions => ({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  schema,
  migrations,
  extra: schema ? { options: `-c search_path=${schema},public` } : {},
});

(RUN ? describe : describe.skip)('migration 1792560000000 on PostgreSQL', () => {
  jest.setTimeout(120_000);
  let admin: DataSource;
  let ds: DataSource;
  const ids: Record<string, string> = {};
  const one = async (sql: string, params: unknown[] = []) => (await ds.query(sql, params))[0];

  beforeAll(async () => {
    admin = await new DataSource(options([], undefined)).initialize();
    await admin.query(`CREATE SCHEMA "${SCHEMA}"`);

    // The previous release's schema, with a company, two warehouses, an Admin, a Staff member and three movements.
    const before = await new DataSource(options(PREVIOUS)).initialize();
    await before.runMigrations();
    const q = async (sql: string, params: unknown[]) => (await before.query(sql, params))[0].id as string;
    ids.company = await q(`INSERT INTO companies (name) VALUES ($1) RETURNING id`, ['Legacy']);
    ids.w1 = await q(`INSERT INTO warehouses (company_id, name) VALUES ($1, 'W1') RETURNING id`, [ids.company]);
    ids.w2 = await q(`INSERT INTO warehouses (company_id, name) VALUES ($1, 'W2') RETURNING id`, [ids.company]);
    const user = (role: string) =>
      q(`INSERT INTO users (company_id, name, email, password_hash, role) VALUES ($1, $2, $3, 'x', $4) RETURNING id`,
        [ids.company, role, `${role}.${SCHEMA}@example.test`, role]);
    ids.admin = await user('Admin');
    ids.staff = await user('Staff');
    ids.product = await q(`INSERT INTO products (company_id, name, sku) VALUES ($1, 'P', 'P-1') RETURNING id`,
      [ids.company]);
    const movement = (warehouse: string, qty: string, balance: string, at: string) =>
      before.query(
        `INSERT INTO stock_movements (product_id, warehouse_id, user_id, movement_type, reference_type,
           quantity_change, running_balance, created_at)
         VALUES ($1, $2, $3, 'INBOUND', 'PURCHASE', $4, $5, $6)`,
        [ids.product, warehouse, ids.admin, qty, balance, at]);
    await movement(ids.w1, '5', '5', '2026-01-01T00:00:00Z');
    await movement(ids.w2, '3', '3', '2026-01-02T00:00:00Z');
    await movement(ids.w1, '2', '7', '2026-01-03T00:00:00Z');
    await before.destroy();

    ds = await new DataSource(options([...PREVIOUS, path.join(MIGRATIONS, '1792560000000-*.ts')])).initialize();
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await admin.destroy();
    }
  });

  it('up: backfills Staff grants and per-warehouse revisions in ledger order', async () => {
    expect((await ds.runMigrations()).map((m) => m.name)).toEqual([NEW_MIGRATION]);

    const grants = await ds.query(
      `SELECT user_id, warehouse_id FROM warehouse_access ORDER BY warehouse_id`);
    expect(grants.map((g: { user_id: string }) => g.user_id)).toEqual([ids.staff, ids.staff]); // not the Admin
    expect(new Set(grants.map((g: { warehouse_id: string }) => g.warehouse_id))).toEqual(new Set([ids.w1, ids.w2]));

    const revs = await ds.query(
      `SELECT warehouse_id, revision::int AS revision, quantity_change::text AS q FROM stock_movements
       ORDER BY warehouse_id, revision`);
    const byWarehouse = (w: string) => revs.filter((r: { warehouse_id: string }) => r.warehouse_id === w)
      .map((r: { revision: number; q: string }) => [r.revision, Number(r.q)]);
    expect(byWarehouse(ids.w1)).toEqual([[1, 5], [2, 2]]);
    expect(byWarehouse(ids.w2)).toEqual([[1, 3]]);
    expect(Number((await one(`SELECT stock_revision FROM warehouses WHERE id = $1`, [ids.w1])).stock_revision)).toBe(2);
    expect(Number((await one(`SELECT stock_revision FROM warehouses WHERE id = $1`, [ids.w2])).stock_revision)).toBe(1);
  });

  it('down removes exactly what up added and keeps every existing row; up again is clean', async () => {
    await ds.undoLastMigration();
    for (const table of ['warehouse_access', 'team_invitations', 'stock_idempotency_keys']) {
      expect(await one(`SELECT to_regclass($1) AS t`, [`"${SCHEMA}".${table}`])).toEqual({ t: null });
    }
    const cols = await ds.query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = $1 AND column_name IN ('stock_revision', 'revision')`, [SCHEMA]);
    expect(cols).toEqual([]);
    expect(await one(`SELECT count(*)::int AS n FROM stock_movements`)).toEqual({ n: 3 });
    expect(await one(`SELECT count(*)::int AS n FROM users`)).toEqual({ n: 2 });

    expect((await ds.runMigrations()).map((m) => m.name)).toEqual([NEW_MIGRATION]);
    expect(await one(`SELECT count(*)::int AS n FROM warehouse_access`)).toEqual({ n: 2 });
  });
});
