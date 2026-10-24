/**
 * RC-admission preflight (Series 05): the upgrade from the PRODUCTION schema, and what rolling the newest migrations
 * back does to data, on real PostgreSQL.
 *
 * - Production runs only the first four migrations (release/prod-hotfix-f4). The candidate adds four more, and on its
 *   first boot they all run in one go (migrationsRun: true). The other migration specs start from the RC schema (six
 *   migrations), so this is the one place that applies the whole delta to the production schema.
 * - The last three tests CHARACTERIZE hazards (a missing uuid-ossp extension, down(), and an application rollback).
 *   They record what happens today so the risk stays visible; they describe hazards, not behaviour to keep. When a
 *   hazard is fixed, update the test on purpose.
 * Runs only with PG_INTEGRATION=1 and DB_HOST localhost/127.0.0.1. It creates two scratch databases of its own (so it
 * cannot race with, or depend on, other specs sharing DB_DATABASE) and drops them afterwards.
 */
import { DataSource } from 'typeorm';
import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import * as path from 'path';
import { randomBytes } from 'crypto';

const RUN = process.env.PG_INTEGRATION === '1' && ['localhost', '127.0.0.1'].includes(process.env.DB_HOST ?? '');
const TAG = randomBytes(4).toString('hex');
const DB = `rc_adm_${TAG}`; // with uuid-ossp, as the app's TypeORM connection leaves a database
const DB_BARE = `rc_adm_${TAG}_bare`; // without it
const MIGRATIONS = path.join(__dirname, '../../src/migrations');
const migration = (id: string) => path.join(MIGRATIONS, `${id}-*.ts`);
const PRODUCTION = ['1721700000000', '1721800000000', '1721900000000', '1722000000000'].map(migration);
const DELTA = ['1722345600000', '1792473600000', '1792560000000', '1792570000000'].map(migration);
const DELTA_NAMES = [
  'CreateUserFcmTokenTable1722345600000',
  'TotpLastAcceptedStep1792473600000',
  'SharedWarehouseFoundation1792560000000',
  'CompanyEntitlements1792570000000',
];
const LEGACY_TABLES = ['companies', 'users', 'warehouses', 'products', 'stock_movements', 'user_two_factor'];

const options = (database: string, migrations: string[] = []): PostgresConnectionOptions => ({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database,
  migrations,
});

(RUN ? describe : describe.skip)('RC admission: production schema -> candidate schema on PostgreSQL', () => {
  jest.setTimeout(120_000);
  let admin: DataSource;
  let ds: DataSource;
  const ids: Record<string, string> = {};
  const legacyCounts: Record<string, number> = {};
  const ledgerOrder: Record<string, string[]> = {};
  const one = async (sql: string, params: unknown[] = []) => (await ds.query(sql, params))[0];
  const count = async (table: string) => (await one(`SELECT count(*)::int AS n FROM "${table}"`)).n as number;
  const exists = async (table: string) => (await one(`SELECT to_regclass($1) AS t`, [`public.${table}`])).t !== null;
  const grantsOf = async (userId: string) =>
    (await ds.query(`SELECT warehouse_id FROM warehouse_access WHERE user_id = $1`, [userId]))
      .map((r: { warehouse_id: string }) => r.warehouse_id).sort();

  beforeAll(async () => {
    admin = await new DataSource(options(process.env.DB_DATABASE as string)).initialize();
    await admin.query(`CREATE DATABASE "${DB}"`);
    await admin.query(`CREATE DATABASE "${DB_BARE}"`);

    // A TypeORM connection with uuid entities runs this on connect (installExtensions defaults to true). Migration
    // 1722345600000 relies on it without creating it; the third-to-last test shows what happens without.
    const setup = await new DataSource(options(DB)).initialize();
    await setup.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await setup.destroy();

    // The production schema with data written by the production release: two companies, Admin/Manager/Staff users,
    // an enabled second factor, an empty warehouse, and movements (two with identical timestamps).
    const legacy = await new DataSource(options(DB, PRODUCTION)).initialize();
    await legacy.runMigrations();
    const q = async (sql: string, params: unknown[]) => (await legacy.query(sql, params))[0].id as string;
    const company = (name: string) => q(`INSERT INTO companies (name) VALUES ($1) RETURNING id`, [name]);
    const warehouse = (companyId: string, name: string) =>
      q(`INSERT INTO warehouses (company_id, name) VALUES ($1, $2) RETURNING id`, [companyId, name]);
    let n = 0;
    const user = (companyId: string, role: string) =>
      q(`INSERT INTO users (company_id, name, email, password_hash, role) VALUES ($1, $2, $3, 'x', $4) RETURNING id`,
        [companyId, `${role} ${++n}`, `${role}.${n}.${TAG}@example.test`, role]);
    const product = (companyId: string, sku: string) =>
      q(`INSERT INTO products (company_id, name, sku) VALUES ($1, $2, $2) RETURNING id`, [companyId, sku]);

    ids.companyA = await company('Legacy A');
    ids.companyB = await company('Legacy B');
    ids.a1 = await warehouse(ids.companyA, 'A1');
    ids.a2 = await warehouse(ids.companyA, 'A2');
    ids.a3 = await warehouse(ids.companyA, 'A3 (no movements)');
    ids.b1 = await warehouse(ids.companyB, 'B1');
    ids.adminA = await user(ids.companyA, 'Admin');
    ids.managerA = await user(ids.companyA, 'Manager');
    ids.staffA1 = await user(ids.companyA, 'Staff');
    ids.staffA2 = await user(ids.companyA, 'Staff');
    ids.adminB = await user(ids.companyB, 'Admin');
    ids.staffB = await user(ids.companyB, 'Staff');
    ids.productA = await product(ids.companyA, 'RC-A-1');
    ids.productB = await product(ids.companyB, 'RC-B-1');
    await legacy.query(`INSERT INTO user_two_factor (user_id, secret_key, is_enabled) VALUES ($1, 'x', true)`, [ids.adminA]);

    const movement = (productId: string, warehouseId: string, userId: string, qty: string, balance: string, at: string) =>
      legacy.query(
        `INSERT INTO stock_movements (product_id, warehouse_id, user_id, movement_type, reference_type,
           quantity_change, running_balance, created_at)
         VALUES ($1, $2, $3, 'INBOUND', 'PURCHASE', $4, $5, $6)`,
        [productId, warehouseId, userId, qty, balance, at]);
    await movement(ids.productA, ids.a1, ids.adminA, '5', '5', '2026-01-01T00:00:00Z');
    await movement(ids.productA, ids.a1, ids.adminA, '2', '7', '2026-01-02T00:00:00Z');
    await movement(ids.productA, ids.a1, ids.managerA, '1', '8', '2026-01-02T00:00:00Z'); // same instant as the previous
    await movement(ids.productA, ids.a1, ids.adminA, '4', '12', '2026-01-03T00:00:00Z');
    await movement(ids.productA, ids.a2, ids.adminA, '3', '3', '2026-01-02T00:00:00Z');
    await movement(ids.productB, ids.b1, ids.adminB, '6', '6', '2026-01-02T00:00:00Z');

    for (const table of LEGACY_TABLES) {
      legacyCounts[table] = (await legacy.query(`SELECT count(*)::int AS n FROM "${table}"`))[0].n;
    }
    // The ledger order the backfill must follow: created_at, then id.
    for (const w of [ids.a1, ids.a2, ids.a3, ids.b1]) {
      ledgerOrder[w] = (await legacy.query(
        `SELECT id FROM stock_movements WHERE warehouse_id = $1 ORDER BY created_at, id`, [w],
      )).map((r: { id: string }) => r.id);
    }
    await legacy.destroy();

    ds = await new DataSource(options(DB, [...PRODUCTION, ...DELTA])).initialize();
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
      await admin.query(`DROP DATABASE IF EXISTS "${DB_BARE}" WITH (FORCE)`);
      await admin.destroy();
    }
  });

  it('applies the whole delta in one run, in order, and keeps every legacy row', async () => {
    expect((await ds.runMigrations()).map((m) => m.name)).toEqual(DELTA_NAMES);
    for (const table of LEGACY_TABLES) expect(await count(table)).toBe(legacyCounts[table]);
    expect(await ds.runMigrations()).toEqual([]); // nothing pending: a second boot changes nothing

    const [factor] = await ds.query(`SELECT is_enabled, last_totp_step FROM user_two_factor WHERE user_id = $1`, [ids.adminA]);
    expect(factor).toEqual({ is_enabled: true, last_totp_step: null });
    for (const company of [ids.companyA, ids.companyB]) {
      expect(await one(`SELECT plan, subscription_status, entitlement_source FROM companies WHERE id = $1`, [company]))
        .toEqual({ plan: 'free', subscription_status: 'active', entitlement_source: 'default' });
    }
  });

  it('backfills Staff grants inside their own company only, and nothing for Admin or Manager', async () => {
    const companyA = [ids.a1, ids.a2, ids.a3].sort();
    expect(await grantsOf(ids.staffA1)).toEqual(companyA);
    expect(await grantsOf(ids.staffA2)).toEqual(companyA);
    expect(await grantsOf(ids.staffB)).toEqual([ids.b1]);
    for (const nobody of [ids.adminA, ids.managerA, ids.adminB]) expect(await grantsOf(nobody)).toEqual([]);
    expect(await one(
      `SELECT count(*)::int AS n FROM warehouse_access a
       JOIN warehouses w ON w.id = a.warehouse_id JOIN users u ON u.id = a.user_id
       WHERE w.company_id <> a.company_id OR u.company_id <> a.company_id`)).toEqual({ n: 0 });
  });

  it('backfills one gap-free revision sequence per warehouse in ledger order, and the counter matches it', async () => {
    for (const w of [ids.a1, ids.a2, ids.a3, ids.b1]) {
      const rows = await ds.query(
        `SELECT id, revision::int AS revision FROM stock_movements WHERE warehouse_id = $1 ORDER BY revision`, [w]);
      // 1..n with no gap, no duplicate and no NULL; ids in (created_at, id) order, so the two equal timestamps are stable.
      expect(rows.map((r: { revision: number }) => r.revision)).toEqual(rows.map((_: unknown, i: number) => i + 1));
      expect(rows.map((r: { id: string }) => r.id)).toEqual(ledgerOrder[w]);
      expect(Number((await one(`SELECT stock_revision FROM warehouses WHERE id = $1`, [w])).stock_revision)).toBe(rows.length);
    }
    expect(await one(`SELECT count(*)::int AS n FROM stock_movements WHERE revision IS NULL`)).toEqual({ n: 0 });
  });

  it('creates the constraints the features rely on', async () => {
    const names = (await ds.query(
      `SELECT c.conname FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public'`,
    )).map((r: { conname: string }) => r.conname);
    expect(names).toEqual(expect.arrayContaining([
      'uq_warehouse_access_user_warehouse', 'uq_team_invitations_token_hash', 'pk_stock_idempotency_keys',
      'chk_companies_plan', 'chk_companies_subscription_status',
    ]));
    await expect(ds.query(
      `INSERT INTO team_invitations (company_id, email, role, token_hash, expires_at)
       VALUES ($1, 'x@example.test', 'Admin', repeat('c', 64), now() + interval '1 day')`, [ids.companyA],
    )).rejects.toThrow(/team_invitations_role_check|violates check constraint/); // an invitation can never make an Admin
  });

  it('CHARACTERIZATION (a hazard, not a behaviour to keep): without the uuid-ossp extension the FCM migration fails and the whole upgrade rolls back', async () => {
    const bare = await new DataSource(options(DB_BARE, [...PRODUCTION, ...DELTA])).initialize();
    try {
      await expect(bare.runMigrations()).rejects.toThrow(/uuid_generate_v4/);
      // One transaction for the whole pending batch: nothing is left half-applied, not even the four production tables.
      for (const t of ['companies', 'user_fcm_tokens', 'warehouse_access']) {
        expect((await bare.query(`SELECT to_regclass($1) AS t`, [`public.${t}`]))[0].t).toBeNull();
      }
    } finally {
      await bare.destroy();
    }
  });

  it('CHARACTERIZATION (a hazard, not a behaviour to keep): down() deletes business data created after the rollout and up() re-widens a narrowed Staff grant', async () => {
    // Business data that exists only after the rollout.
    await ds.query(`DELETE FROM warehouse_access WHERE user_id = $1 AND warehouse_id <> $2`, [ids.staffA1, ids.a1]);
    expect(await grantsOf(ids.staffA1)).toEqual([ids.a1]); // an Admin narrowed this Staff member to one warehouse
    await ds.query(
      `INSERT INTO team_invitations (company_id, email, role, warehouse_ids, token_hash, expires_at, accepted_at)
       VALUES ($1, 'accepted@example.test', 'Staff', $2, repeat('a', 64), now() + interval '1 day', now())`,
      [ids.companyA, [ids.a1]]);
    await ds.query(
      `INSERT INTO stock_idempotency_keys (company_id, user_id, idempotency_key, request_hash, response)
       VALUES ($1, $2, 'receipt-key-0001', repeat('b', 64), '{"id":"00000000-0000-0000-0000-000000000001"}')`,
      [ids.companyA, ids.staffA1]);
    await ds.query(
      `UPDATE companies SET plan = 'pro', subscription_status = 'trialing', entitlement_source = 'trial' WHERE id = $1`,
      [ids.companyA]);

    await ds.undoLastMigration(); // CompanyEntitlements
    await ds.undoLastMigration(); // SharedWarehouseFoundation
    for (const table of ['warehouse_access', 'team_invitations', 'stock_idempotency_keys']) {
      expect(await exists(table)).toBe(false); // the rows went with the tables
    }

    expect((await ds.runMigrations()).map((m) => m.name)).toEqual(DELTA_NAMES.slice(2));
    expect(await grantsOf(ids.staffA1)).toEqual([ids.a1, ids.a2, ids.a3].sort()); // ACCESS WIDENED again
    expect(await count('team_invitations')).toBe(0);
    expect(await count('stock_idempotency_keys')).toBe(0); // the receipts the device reconciliation relies on
    expect(await one(`SELECT plan, subscription_status FROM companies WHERE id = $1`, [ids.companyA]))
      .toEqual({ plan: 'free', subscription_status: 'active' });
  });

  it('CHARACTERIZATION (a hazard, not a behaviour to keep): a movement written by the previous release has no revision, so no delta ever returns it', async () => {
    // The previous release inserts movements without a revision and never touches warehouses.stock_revision.
    const counterBefore = (await one(`SELECT stock_revision::text AS r FROM warehouses WHERE id = $1`, [ids.a1])).r;
    const [{ id }] = await ds.query(
      `INSERT INTO stock_movements (product_id, warehouse_id, user_id, movement_type, reference_type,
         quantity_change, running_balance, created_at)
       VALUES ($1, $2, $3, 'INBOUND', 'PURCHASE', 9, 99, '2026-02-01T00:00:00Z') RETURNING id`,
      [ids.productA, ids.a1, ids.adminA]);
    expect((await one(`SELECT revision FROM stock_movements WHERE id = $1`, [id])).revision).toBeNull();
    expect((await one(`SELECT stock_revision::text AS r FROM warehouses WHERE id = $1`, [ids.a1])).r).toBe(counterBefore);

    // The delta predicate of StockService.getChanges: `sm.revision > $since` is never true for NULL.
    const delta = await ds.query(
      `SELECT sm.id FROM stock_movements sm WHERE sm.warehouse_id = $1 AND sm.revision > $2 ORDER BY sm.revision`,
      [ids.a1, '0']);
    expect(delta.map((r: { id: string }) => r.id)).not.toContain(id);
  });

  it('the repair procedure in the recovery runbook gives those movements revisions above every revision already issued', async () => {
    // Same statements as "After an application rollback" in docs/handoff/STOCKMIND_DATABASE_RECOVERY_RUNBOOK.md.
    const issued = Number((await one(`SELECT stock_revision FROM warehouses WHERE id = $1`, [ids.a1])).stock_revision);
    const [{ id }] = await ds.query(`SELECT id FROM stock_movements WHERE warehouse_id = $1 AND revision IS NULL`, [ids.a1]);
    const runner = ds.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query(`SELECT id FROM warehouses WHERE id IN (
          SELECT DISTINCT warehouse_id FROM stock_movements WHERE revision IS NULL) ORDER BY id FOR UPDATE`);
      await runner.query(`
        WITH todo AS (
          SELECT id, warehouse_id, row_number() OVER (PARTITION BY warehouse_id ORDER BY created_at, id) AS rn
          FROM stock_movements WHERE revision IS NULL)
        UPDATE stock_movements m SET revision = w.stock_revision + t.rn
        FROM todo t JOIN warehouses w ON w.id = t.warehouse_id WHERE m.id = t.id`);
      await runner.query(`
        UPDATE warehouses w SET stock_revision =
          COALESCE((SELECT max(m.revision) FROM stock_movements m WHERE m.warehouse_id = w.id), 0)`);
      await runner.commitTransaction();
    } catch (err) {
      await runner.rollbackTransaction();
      throw err;
    } finally {
      await runner.release();
    }

    expect(Number((await one(`SELECT revision FROM stock_movements WHERE id = $1`, [id])).revision)).toBe(issued + 1);
    expect(Number((await one(`SELECT stock_revision FROM warehouses WHERE id = $1`, [ids.a1])).stock_revision)).toBe(issued + 1);
    // A device whose cursor was at the old counter now receives it in its next delta.
    const delta = await ds.query(
      `SELECT sm.id FROM stock_movements sm WHERE sm.warehouse_id = $1 AND sm.revision > $2 ORDER BY sm.revision`,
      [ids.a1, String(issued)]);
    expect(delta.map((r: { id: string }) => r.id)).toEqual([id]);
    expect(await one(`SELECT count(*)::int AS n FROM stock_movements WHERE revision IS NULL`)).toEqual({ n: 0 });
  });
});
