/**
 * Release-safety migration suite (Series 06) on real PostgreSQL: the upgrade from a reconstruction of the documented
 * PRODUCTION schema, a fresh install, and the protections added to the migrations.
 *
 * Scope and honesty: the "production" database here is a synthetic reconstruction (the first four migrations plus made-up
 * rows). It proves how the migrations behave on that shape of data; it says nothing about what the real Neon database
 * contains.
 *
 * Covers: no dependency on the uuid-ossp extension; fail-closed down() (nothing is deleted, nothing is partially changed,
 * Staff access is never widened); a movement written without a revision gets one from the database, in order and under
 * concurrency; existing NULL revisions are repaired; duplicate revisions are refused up front and impossible afterwards.
 *
 * Runs only with PG_INTEGRATION=1 and DB_HOST localhost/127.0.0.1. It creates scratch databases of its own, so it neither
 * races with nor depends on other specs sharing DB_DATABASE, and drops them afterwards.
 */
import { DataSource } from 'typeorm';
import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import * as path from 'path';
import { createHash, randomBytes } from 'crypto';

const RUN = process.env.PG_INTEGRATION === '1' && ['localhost', '127.0.0.1'].includes(process.env.DB_HOST ?? '');
const TAG = randomBytes(4).toString('hex');
const DB_PROD = `rs_prod_${TAG}`; // reconstructed production baseline, upgraded; uuid-ossp is NEVER installed here
const DB_FRESH = `rs_fresh_${TAG}`; // fresh installation, uuid-ossp never installed
const DB_OLD = `rs_old_${TAG}`; // an environment that ran the previous text of the FCM migration (uuid_generate_v4 default)
const ALL_DBS = [DB_PROD, DB_FRESH, DB_OLD];
const MIGRATIONS = path.join(__dirname, '../../src/migrations');
const migration = (id: string) => path.join(MIGRATIONS, `${id}-*.ts`);
const PRODUCTION_IDS = ['1721700000000', '1721800000000', '1721900000000', '1722000000000'];
const DELTA_IDS = ['1722345600000', '1792473600000', '1792560000000', '1792570000000', '1792580000000', '1792590000000'];
const PRODUCTION = PRODUCTION_IDS.map(migration);
const ALL = [...PRODUCTION_IDS, ...DELTA_IDS].map(migration);
const DELTA_NAMES = [
  'CreateUserFcmTokenTable1722345600000',
  'TotpLastAcceptedStep1792473600000',
  'SharedWarehouseFoundation1792560000000',
  'CompanyEntitlements1792570000000',
  'StockRevisionGuard1792580000000',
  'RecoveryIntegrity1792590000000', // Series 07
];
const LEGACY_TABLES = ['companies', 'users', 'warehouses', 'products', 'stock_movements', 'user_two_factor'];
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const options = (database: string, migrations: string[] = []): PostgresConnectionOptions => ({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database,
  migrations,
  extra: { max: 12 },
});

(RUN ? describe : describe.skip)('release safety: migrations on PostgreSQL', () => {
  jest.setTimeout(180_000);
  let admin: DataSource;
  let ds: DataSource;
  const ids: Record<string, string> = {};
  const legacyCounts: Record<string, number> = {};
  const ledgerOrder: Record<string, string[]> = {};
  const one = async (sql: string, params: unknown[] = [], d: DataSource = ds) => (await d.query(sql, params))[0];
  const count = async (table: string, d: DataSource = ds) => (await one(`SELECT count(*)::int AS n FROM "${table}"`, [], d)).n as number;
  const exists = async (name: string, d: DataSource = ds) => (await one(`SELECT to_regclass($1) AS t`, [`public.${name}`], d)).t !== null;
  const grantsOf = async (userId: string) =>
    (await ds.query(`SELECT warehouse_id FROM warehouse_access WHERE user_id = $1`, [userId]))
      .map((r: { warehouse_id: string }) => r.warehouse_id).sort();
  const counter = async (w: string) => Number((await one(`SELECT stock_revision FROM warehouses WHERE id = $1`, [w])).stock_revision);
  const revisionsOf = async (w: string) =>
    (await ds.query(`SELECT revision::int AS r FROM stock_movements WHERE warehouse_id = $1 ORDER BY revision`, [w]))
      .map((x: { r: number | null }) => x.r);
  const hasTrigger = async (d: DataSource = ds) =>
    (await one(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'trg_stock_movements_assign_revision' AND NOT tgisinternal`, [], d)).n === 1;
  const hasUniqueIndex = async (d: DataSource = ds) =>
    (await one(`SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'uq_stock_movements_warehouse_revision'`, [], d)).n === 1;
  // Series 07 added a migration on top of the revision guard: reverting the guard first reverts that (pristine) migration.
  const undoGuard = async () => {
    await ds.undoLastMigration(); // RecoveryIntegrity (nothing recorded yet: allowed)
    await ds.undoLastMigration(); // StockRevisionGuard
  };
  // Everything that defines the schema, so two databases can be compared: columns, indexes, constraints, triggers.
  const fingerprint = async (d: DataSource) => ({
    columns: await d.query(`SELECT table_name, column_name, data_type, is_nullable, column_default
                            FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, column_name`),
    indexes: await d.query(`SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname`),
    constraints: await d.query(`SELECT conrelid::regclass::text AS tbl, conname, contype, pg_get_constraintdef(oid) AS def
                                FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY conrelid::regclass::text, conname`),
    triggers: await d.query(`SELECT event_object_table AS tbl, trigger_name, action_timing, event_manipulation
                             FROM information_schema.triggers WHERE trigger_schema = 'public' ORDER BY 1, 2, 4`),
  });
  const fingerprints: Record<string, Awaited<ReturnType<typeof fingerprint>>> = {};
  // A digest of every table the guarded migrations could touch, to prove a refused down() changed nothing.
  const snapshot = async () => {
    const parts: string[] = [];
    for (const [table, order] of [['warehouse_access', 'user_id, warehouse_id'], ['team_invitations', 'id'], ['stock_idempotency_keys', 'idempotency_key'],
      ['companies', 'id'], ['warehouses', 'id'], ['stock_movements', 'id']] as const) {
      parts.push(JSON.stringify(await ds.query(`SELECT * FROM "${table}" ORDER BY ${order}`)));
    }
    parts.push(JSON.stringify(await ds.query(`SELECT name FROM migrations ORDER BY id`)));
    return createHash('sha256').update(parts.join('|')).digest('hex');
  };
  const insertMovement = (d: { query: (sql: string, params?: unknown[]) => Promise<any> }, w: string, product: string, user: string, qty: number, revision: string | null = null, at = '2026-03-01T00:00:00Z') =>
    d.query(
      `INSERT INTO stock_movements (product_id, warehouse_id, user_id, movement_type, reference_type, quantity_change, running_balance, revision, created_at)
       VALUES ($1, $2, $3, 'INBOUND', 'PURCHASE', $4, $4, $5, $6) RETURNING id, revision::text AS revision`,
      [product, w, user, qty, revision, at]);

  beforeAll(async () => {
    admin = await new DataSource(options(process.env.DB_DATABASE as string)).initialize();
    for (const db of ALL_DBS) await admin.query(`CREATE DATABASE "${db}"`);

    // ---- the reconstructed production baseline (first four migrations) with data written by the production release
    const legacy = await new DataSource(options(DB_PROD, PRODUCTION)).initialize();
    await legacy.runMigrations();
    const q = async (sql: string, params: unknown[]) => (await legacy.query(sql, params))[0].id as string;
    let n = 0;
    const company = (name: string) => q(`INSERT INTO companies (name) VALUES ($1) RETURNING id`, [name]);
    const warehouse = (c: string, name: string) => q(`INSERT INTO warehouses (company_id, name) VALUES ($1, $2) RETURNING id`, [c, name]);
    const user = (c: string, role: string) =>
      q(`INSERT INTO users (company_id, name, email, password_hash, role) VALUES ($1, $2, $3, 'x', $4) RETURNING id`,
        [c, `${role} ${++n}`, `${role}.${n}.${TAG}@example.test`, role]);
    const product = (c: string, sku: string) => q(`INSERT INTO products (company_id, name, sku) VALUES ($1, $2, $2) RETURNING id`, [c, sku]);
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
    ids.productA = await product(ids.companyA, 'RS-A-1');
    ids.productB = await product(ids.companyB, 'RS-B-1');
    await legacy.query(`INSERT INTO user_two_factor (user_id, secret_key, is_enabled) VALUES ($1, 'x', true)`, [ids.adminA]);
    const legacyMovement = (p: string, w: string, u: string, qty: string, bal: string, at: string) =>
      legacy.query(
        `INSERT INTO stock_movements (product_id, warehouse_id, user_id, movement_type, reference_type, quantity_change, running_balance, created_at)
         VALUES ($1, $2, $3, 'INBOUND', 'PURCHASE', $4, $5, $6)`, [p, w, u, qty, bal, at]);
    await legacyMovement(ids.productA, ids.a1, ids.adminA, '5', '5', '2026-01-01T00:00:00Z');
    await legacyMovement(ids.productA, ids.a1, ids.adminA, '2', '7', '2026-01-02T00:00:00Z');
    await legacyMovement(ids.productA, ids.a1, ids.managerA, '1', '8', '2026-01-02T00:00:00Z'); // same instant as the previous
    await legacyMovement(ids.productA, ids.a1, ids.adminA, '4', '12', '2026-01-03T00:00:00Z');
    await legacyMovement(ids.productA, ids.a2, ids.adminA, '3', '3', '2026-01-02T00:00:00Z');
    await legacyMovement(ids.productB, ids.b1, ids.adminB, '6', '6', '2026-01-02T00:00:00Z');
    for (const table of LEGACY_TABLES) legacyCounts[table] = (await legacy.query(`SELECT count(*)::int AS n FROM "${table}"`))[0].n;
    for (const w of [ids.a1, ids.a2, ids.a3, ids.b1]) {
      ledgerOrder[w] = (await legacy.query(`SELECT id FROM stock_movements WHERE warehouse_id = $1 ORDER BY created_at, id`, [w]))
        .map((r: { id: string }) => r.id);
    }
    await legacy.destroy();
    ds = await new DataSource(options(DB_PROD, ALL)).initialize();
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
    if (admin?.isInitialized) {
      for (const db of ALL_DBS) await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
      await admin.destroy();
    }
  });

  // ------------------------------------------------------------------------------------------------ upgrade

  it('upgrades the reconstructed production baseline in one run, without the uuid-ossp extension, keeping every legacy row', async () => {
    expect((await ds.runMigrations()).map((m) => m.name)).toEqual(DELTA_NAMES);
    for (const t of LEGACY_TABLES) expect(await count(t)).toBe(legacyCounts[t]);
    expect(await ds.runMigrations()).toEqual([]); // a second boot has nothing to do
    expect(await one(`SELECT count(*)::int AS n FROM pg_extension WHERE extname = 'uuid-ossp'`)).toEqual({ n: 0 });
    expect((await one(`SELECT column_default FROM information_schema.columns WHERE table_name = 'user_fcm_tokens' AND column_name = 'id'`)).column_default)
      .toContain('gen_random_uuid');
    expect(await one(`SELECT is_enabled, last_totp_step FROM user_two_factor WHERE user_id = $1`, [ids.adminA]))
      .toEqual({ is_enabled: true, last_totp_step: null });
    for (const c of [ids.companyA, ids.companyB]) {
      expect(await one(`SELECT plan, subscription_status, entitlement_source FROM companies WHERE id = $1`, [c]))
        .toEqual({ plan: 'free', subscription_status: 'active', entitlement_source: 'default' });
    }
    fingerprints.prod = await fingerprint(ds);
  });

  it('keeps permission scope exact: Staff get their own company\'s warehouses only, nobody else gets grants', async () => {
    const companyA = [ids.a1, ids.a2, ids.a3].sort();
    expect(await grantsOf(ids.staffA1)).toEqual(companyA);
    expect(await grantsOf(ids.staffA2)).toEqual(companyA);
    expect(await grantsOf(ids.staffB)).toEqual([ids.b1]);
    for (const nobody of [ids.adminA, ids.managerA, ids.adminB]) expect(await grantsOf(nobody)).toEqual([]);
    expect(await one(
      `SELECT count(*)::int AS n FROM warehouse_access a JOIN warehouses w ON w.id = a.warehouse_id JOIN users u ON u.id = a.user_id
       WHERE w.company_id <> a.company_id OR u.company_id <> a.company_id`)).toEqual({ n: 0 });
  });

  it('numbers existing movements 1..n per warehouse in ledger order, with the guard objects in place', async () => {
    for (const w of [ids.a1, ids.a2, ids.a3, ids.b1]) {
      const rows = await ds.query(`SELECT id, revision::int AS revision FROM stock_movements WHERE warehouse_id = $1 ORDER BY revision`, [w]);
      expect(rows.map((r: { revision: number }) => r.revision)).toEqual(rows.map((_: unknown, i: number) => i + 1));
      expect(rows.map((r: { id: string }) => r.id)).toEqual(ledgerOrder[w]);
      expect(await counter(w)).toBe(rows.length);
    }
    expect(await one(`SELECT count(*)::int AS n FROM stock_movements WHERE revision IS NULL`)).toEqual({ n: 0 });
    expect(await hasTrigger()).toBe(true);
    expect(await hasUniqueIndex()).toBe(true);
  });

  it('upgrades a fresh installation from nothing, without the uuid-ossp extension, and a second run changes nothing', async () => {
    const fresh = await new DataSource(options(DB_FRESH, ALL)).initialize();
    try {
      expect((await fresh.runMigrations()).length).toBe(PRODUCTION_IDS.length + DELTA_IDS.length);
      expect(await fresh.runMigrations()).toEqual([]);
      for (const t of ['warehouse_access', 'team_invitations', 'stock_idempotency_keys', 'user_fcm_tokens']) expect(await exists(t, fresh)).toBe(true);
      expect(await hasTrigger(fresh)).toBe(true);
      expect(await hasUniqueIndex(fresh)).toBe(true);
      expect(await one(`SELECT count(*)::int AS n FROM pg_extension WHERE extname = 'uuid-ossp'`, [], fresh)).toEqual({ n: 0 });
      fingerprints.fresh = await fingerprint(fresh);
    } finally {
      await fresh.destroy();
    }
  });

  it('upgrades an environment that already ran the previous FCM migration (uuid_generate_v4 default) without re-running it', async () => {
    const setup = await new DataSource(options(DB_OLD)).initialize();
    await setup.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`); // what the app's connection used to install
    await setup.destroy();
    const upToFcm = await new DataSource(options(DB_OLD, [...PRODUCTION_IDS, '1722345600000'].map(migration))).initialize();
    await upToFcm.runMigrations();
    await upToFcm.query(`ALTER TABLE user_fcm_tokens ALTER COLUMN id SET DEFAULT uuid_generate_v4()`); // the previous text's result
    await upToFcm.query(`INSERT INTO companies (name) VALUES ('Old') `);
    const [{ id: companyId }] = await upToFcm.query(`SELECT id FROM companies LIMIT 1`);
    const [{ id: userId }] = await upToFcm.query(
      `INSERT INTO users (company_id, name, email, password_hash, role) VALUES ($1, 'U', $2, 'x', 'Admin') RETURNING id`, [companyId, `old.${TAG}@example.test`]);
    await upToFcm.destroy();

    const old = await new DataSource(options(DB_OLD, ALL)).initialize();
    try {
      expect((await old.runMigrations()).map((m) => m.name)).toEqual(DELTA_NAMES.slice(1)); // FCM is tracked by name: not re-run
      expect((await one(`SELECT column_default FROM information_schema.columns WHERE table_name = 'user_fcm_tokens' AND column_name = 'id'`, [], old)).column_default)
        .toContain('uuid_generate_v4'); // untouched: only the default expression differs from a new install, and both give v4 UUIDs
      const [token] = await old.query(`INSERT INTO user_fcm_tokens ("userId", "fcmToken", "deviceType") VALUES ($1, 't-old', 'android') RETURNING id`, [userId]);
      expect(token.id).toMatch(UUID_V4);
      fingerprints.old = await fingerprint(old);
    } finally {
      await old.destroy();
    }
    // and the default a new install gets produces the same kind of id
    const [{ id: prodUser }] = await ds.query(`SELECT id FROM users LIMIT 1`);
    const [token] = await ds.query(`INSERT INTO user_fcm_tokens ("userId", "fcmToken", "deviceType") VALUES ($1, 't-new', 'android') RETURNING id`, [prodUser]);
    expect(token.id).toMatch(UUID_V4);
  });

  it('ends with the same schema whether installed fresh, upgraded from production, or upgraded after the previous FCM text', () => {
    expect(fingerprints.fresh).toEqual(fingerprints.prod); // no drift between a new install and the upgraded production baseline
    // the only difference of the environment that ran the previous FCM text: the id default of that one table
    const oldNormalised = JSON.parse(JSON.stringify(fingerprints.old).replace(/uuid_generate_v4\(\)/g, 'gen_random_uuid()'));
    expect(oldNormalised).toEqual(fingerprints.prod);
    const differing = fingerprints.old.columns.filter((c: { column_default: string | null }, i: number) =>
      c.column_default !== fingerprints.prod.columns[i].column_default);
    expect(differing.map((c: { table_name: string; column_name: string }) => `${c.table_name}.${c.column_name}`)).toEqual(['user_fcm_tokens.id']);
  });

  // ------------------------------------------------------------------------------------------- revision guard

  it('gives a movement written without a revision the next revision, under the warehouse lock, and a delta returns it', async () => {
    const before = await counter(ids.a1);
    const [row] = await insertMovement(ds, ids.a1, ids.productA, ids.adminA, 9);
    expect(Number(row.revision)).toBe(before + 1);
    expect(await counter(ids.a1)).toBe(before + 1);
    const delta = await ds.query(`SELECT id FROM stock_movements WHERE warehouse_id = $1 AND revision > $2 ORDER BY revision`, [ids.a1, String(before)]);
    expect(delta.map((r: { id: string }) => r.id)).toEqual([row.id]);
    expect(await counter(ids.b1)).toBe(1); // another warehouse is untouched
  });

  it('leaves an insert that sets its own revision alone: the application protocol is not numbered twice', async () => {
    const qr = ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const [bumped] = (await qr.query(`UPDATE warehouses SET stock_revision = stock_revision + 1 WHERE id = $1 RETURNING stock_revision`, [ids.a1]))[0];
      const [row] = await insertMovement(qr, ids.a1, ids.productA, ids.adminA, 2, String(bumped.stock_revision));
      await qr.commitTransaction();
      expect(row.revision).toBe(String(bumped.stock_revision));
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
    const revs = await revisionsOf(ids.a1);
    expect(revs).toEqual(revs.map((_: unknown, i: number) => i + 1)); // still gap-free
    expect(await counter(ids.a1)).toBe(revs.length);
  });

  it('keeps revisions unique and gap-free when old-style and application-style writers insert concurrently', async () => {
    const start = await counter(ids.a2);
    const appStyle = async () => {
      await ds.transaction(async (m) => {
        const [rows] = await m.query(`UPDATE warehouses SET stock_revision = stock_revision + 1 WHERE id = $1 RETURNING stock_revision`, [ids.a2]);
        await insertMovement(m, ids.a2, ids.productA, ids.adminA, 1, String(rows[0].stock_revision));
      });
    };
    const oldStyle = () => insertMovement(ds, ids.a2, ids.productA, ids.adminA, 1);
    await Promise.all([...Array.from({ length: 12 }, appStyle), ...Array.from({ length: 12 }, oldStyle)]);
    const revs = await revisionsOf(ids.a2);
    expect(revs.length).toBe(start + 24);
    expect(revs).toEqual(revs.map((_: unknown, i: number) => i + 1)); // unique, contiguous, none missing
    expect(await counter(ids.a2)).toBe(start + 24);
    expect(await one(`SELECT count(*)::int AS n FROM stock_movements WHERE revision IS NULL`)).toEqual({ n: 0 });
  });

  it('makes a duplicate (warehouse, revision) impossible, while the same number in another warehouse is fine', async () => {
    const [dup] = await ds.query(`SELECT revision FROM stock_movements WHERE warehouse_id = $1 ORDER BY revision LIMIT 1`, [ids.a1]);
    await expect(insertMovement(ds, ids.a1, ids.productA, ids.adminA, 1, String(dup.revision))).rejects.toThrow(/uq_stock_movements_warehouse_revision/);
    expect(Number((await insertMovement(ds, ids.b1, ids.productB, ids.adminB, 1, '9999'))[0].revision)).toBe(9999); // explicit, other warehouse
    await ds.query(`DELETE FROM stock_movements WHERE warehouse_id = $1 AND revision = 9999`, [ids.b1]);
  });

  // --------------------------------------------------------------------------- repair and duplicate pre-check

  it('repairs movements that already have no revision: numbered above everything issued, in (created_at, id) order, nothing lost', async () => {
    await undoGuard(); // StockRevisionGuard: trigger and index removed, no rows deleted
    expect(await hasTrigger()).toBe(false);
    expect(await hasUniqueIndex()).toBe(false);
    const issued = await counter(ids.b1);
    const total = await count('stock_movements');
    // what an older release writes: no revision, counter untouched; created out of insertion order on purpose
    const [late] = await insertMovement(ds, ids.b1, ids.productB, ids.adminB, 3, null, '2026-03-05T00:00:00Z');
    const [early] = await insertMovement(ds, ids.b1, ids.productB, ids.adminB, 4, null, '2026-03-02T00:00:00Z');
    expect(late.revision).toBeNull();
    expect(await counter(ids.b1)).toBe(issued);
    const issuedBefore = await ds.query(`SELECT id, revision::text AS revision FROM stock_movements WHERE warehouse_id = $1 AND revision IS NOT NULL ORDER BY revision`, [ids.b1]);

    expect((await ds.runMigrations()).map((m) => m.name)).toEqual(DELTA_NAMES.slice(4));
    const after = await ds.query(`SELECT id, revision::int AS revision FROM stock_movements WHERE warehouse_id = $1 ORDER BY revision`, [ids.b1]);
    expect(after.map((r: { revision: number }) => r.revision)).toEqual(after.map((_: unknown, i: number) => i + 1));
    expect(after.slice(0, issuedBefore.length).map((r: { id: string }) => r.id)).toEqual(issuedBefore.map((r: { id: string }) => r.id)); // issued ones kept their numbers
    expect(after.slice(issuedBefore.length).map((r: { id: string }) => r.id)).toEqual([early.id, late.id]); // created_at order, not insertion order
    expect(await counter(ids.b1)).toBe(issued + 2);
    expect(await count('stock_movements')).toBe(total + 2);
    expect(await hasTrigger()).toBe(true);
    expect(await hasUniqueIndex()).toBe(true);
  });

  it('refuses to add the guard over duplicate revisions, naming them and changing nothing', async () => {
    await undoGuard();
    const [{ id: nullRow }] = await insertMovement(ds, ids.a3, ids.productA, ids.adminA, 1, null);
    const [first] = await ds.query(`SELECT id FROM stock_movements WHERE warehouse_id = $1 AND revision = 1`, [ids.a1]);
    const [second] = await ds.query(`SELECT id FROM stock_movements WHERE warehouse_id = $1 AND revision = 2`, [ids.a1]);
    await ds.query(`UPDATE stock_movements SET revision = 1 WHERE id = $1`, [second.id]); // now (a1, 1) is held twice
    const before = await snapshot();

    await expect(ds.runMigrations()).rejects.toThrow(/duplicate \(warehouse, revision\) pairs .*warehouse .* revision 1 x2.*Nothing was changed/s);
    expect(await snapshot()).toBe(before); // the repair did not run first, nothing half-applied
    expect((await one(`SELECT revision FROM stock_movements WHERE id = $1`, [nullRow])).revision).toBeNull();
    expect(await hasTrigger()).toBe(false);
    expect(await hasUniqueIndex()).toBe(false);

    await ds.query(`UPDATE stock_movements SET revision = 2 WHERE id = $1`, [second.id]); // resolved
    expect((await ds.runMigrations()).map((m) => m.name)).toEqual(DELTA_NAMES.slice(4));
    expect(first.id).not.toBe(second.id);
  });

  // ---------------------------------------------------------------------------------- fail-closed down()

  it('adds the Series 07 recovery objects without touching any existing row: distinct generations, zero floors', async () => {
    for (const t of LEGACY_TABLES) expect(await count(t)).toBeGreaterThanOrEqual(legacyCounts[t]); // nothing removed
    const generations = await ds.query(`SELECT id, history_generation::text AS g FROM companies ORDER BY id`);
    expect(new Set(generations.map((c: { g: string }) => c.g)).size).toBe(generations.length); // each company its own
    for (const c of generations) expect(c.g).toMatch(UUID_V4);
    expect(await ds.query(`SELECT DISTINCT history_floor_revision::text AS f FROM warehouses`)).toEqual([{ f: '0' }]);
    for (const t of ['history_generation_events', 'stock_replacements']) {
      expect(await exists(t)).toBe(true);
      expect(await count(t)).toBe(0);
    }
    await expect(ds.query(
      `INSERT INTO stock_replacements (company_id, warehouse_id, actor_user_id, original_key, original_movement_id, original_claim,
         replacement_key, replacement_movement_id, generation_at_decision, original_status, reason)
       VALUES ($1, $2, $3, 'orig-key-0001', gen_random_uuid(), '{}', 'repl-key-0001', gen_random_uuid(), $4, 'absent', 'x'),
              ($1, $2, $3, 'orig-key-0001', gen_random_uuid(), '{}', 'repl-key-0002', gen_random_uuid(), $4, 'absent', 'x')`,
      [ids.companyA, ids.a1, ids.staffA1, generations[0].g],
    )).rejects.toThrow(/uq_stock_replacements_original/); // one replacement per source operation, enforced by the database
  });

  it('refuses to revert recovery integrity once a rotation, a replacement or a floor is recorded, and changes nothing; allows it while pristine', async () => {
    const digest = async () => JSON.stringify([
      await ds.query(`SELECT id, history_generation FROM companies ORDER BY id`),
      await ds.query(`SELECT id, history_floor_revision FROM warehouses ORDER BY id`),
      await ds.query(`SELECT * FROM history_generation_events ORDER BY id`),
      await ds.query(`SELECT * FROM stock_replacements ORDER BY id`),
      await ds.query(`SELECT name FROM migrations ORDER BY id`),
    ]);
    const [{ g }] = await ds.query(`SELECT history_generation::text AS g FROM companies WHERE id = $1`, [ids.companyA]);
    await ds.query(
      `INSERT INTO history_generation_events (company_id, previous_generation, new_generation, actor_user_id, reason)
       VALUES ($1, $2, gen_random_uuid(), $3, 'rotation recorded for the down() guard test')`, [ids.companyA, g, ids.adminA]);
    await expect(ds.query(`UPDATE history_generation_events SET reason = 'rewritten'`)).rejects.toThrow(/append-only/);
    let before = await digest();
    await expect(ds.undoLastMigration()).rejects.toThrow(
      /Refusing to revert RecoveryIntegrity1792590000000.*1 recorded history-generation rotation\(s\).*Nothing was changed/s);
    expect(await digest()).toBe(before);

    await ds.query(`DELETE FROM history_generation_events`);
    await ds.query(
      `INSERT INTO stock_replacements (company_id, warehouse_id, actor_user_id, original_key, original_movement_id, original_claim,
         replacement_key, replacement_movement_id, generation_at_decision, original_status, reason)
       VALUES ($1, $2, $3, 'orig-key-0002', gen_random_uuid(), '{}', 'repl-key-0003', gen_random_uuid(), $4, 'absent', 'x')`,
      [ids.companyA, ids.a1, ids.staffA1, g]);
    before = await digest();
    await expect(ds.undoLastMigration()).rejects.toThrow(/1 recorded operation replacement\(s\).*Nothing was changed/s);
    expect(await digest()).toBe(before);

    await ds.query(`DELETE FROM stock_replacements`);
    await ds.query(`UPDATE warehouses SET history_floor_revision = 2 WHERE id = $1`, [ids.a1]);
    before = await digest();
    await expect(ds.undoLastMigration()).rejects.toThrow(/1 warehouse\(s\) with a history floor.*Nothing was changed/s);
    expect(await digest()).toBe(before);

    await ds.query(`UPDATE warehouses SET history_floor_revision = 0`);
    await ds.undoLastMigration(); // pristine: lossless
    expect(await exists('stock_replacements')).toBe(false);
    expect(await exists('history_generation_events')).toBe(false);
    expect((await ds.runMigrations()).map((m) => m.name)).toEqual([DELTA_NAMES[5]]);
  });

  it('reverts the guard without deleting anything, and applies it again to the same result', async () => {
    const revs = await ds.query(`SELECT id, revision::text AS revision FROM stock_movements ORDER BY id`);
    await undoGuard();
    expect(await ds.query(`SELECT id, revision::text AS revision FROM stock_movements ORDER BY id`)).toEqual(revs);
    expect((await ds.runMigrations()).map((m) => m.name)).toEqual(DELTA_NAMES.slice(4));
    expect(await ds.query(`SELECT id, revision::text AS revision FROM stock_movements ORDER BY id`)).toEqual(revs);
  });

  it('refuses to revert entitlements once a company has a plan, and changes nothing; allows it while everything is default', async () => {
    await undoGuard();
    await ds.query(`UPDATE companies SET plan = 'pro', subscription_status = 'trialing', entitlement_source = 'trial' WHERE id = $1`, [ids.companyA]);
    const before = await snapshot();
    await expect(ds.undoLastMigration()).rejects.toThrow(
      /Refusing to revert CompanyEntitlements1792570000000.*1 company entitlement record\(s\).*Nothing was changed.*RECOVERY_RUNBOOK/s);
    expect(await snapshot()).toBe(before);
    expect((await one(`SELECT plan FROM companies WHERE id = $1`, [ids.companyA])).plan).toBe('pro'); // the plan survived

    await ds.query(`UPDATE companies SET plan = 'free', subscription_status = 'active', entitlement_source = 'default' WHERE id = $1`, [ids.companyA]);
    await ds.undoLastMigration(); // allowed now: lossless
    expect((await ds.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'plan'`))).toEqual([]);
    expect((await ds.runMigrations()).map((m) => m.name)).toEqual(DELTA_NAMES.slice(3));
  });

  it('refuses to revert the shared-warehouse tables while they hold business data, never widens access, and changes nothing', async () => {
    await undoGuard();
    await ds.undoLastMigration(); // entitlements (all default)
    // data that exists only after the rollout
    await ds.query(`DELETE FROM warehouse_access WHERE user_id = $1 AND warehouse_id <> $2`, [ids.staffA1, ids.a1]); // narrowed
    await ds.query(
      `INSERT INTO team_invitations (company_id, email, role, warehouse_ids, token_hash, expires_at, accepted_at)
       VALUES ($1, 'accepted@example.test', 'Staff', $2, repeat('a', 64), now() + interval '1 day', now())`, [ids.companyA, [ids.a1]]);
    await ds.query(
      `INSERT INTO stock_idempotency_keys (company_id, user_id, idempotency_key, request_hash, response)
       VALUES ($1, $2, 'receipt-key-0001', repeat('b', 64), '{"id":"00000000-0000-0000-0000-000000000001"}')`, [ids.companyA, ids.staffA1]);
    const before = await snapshot();

    await expect(ds.undoLastMigration()).rejects.toThrow(
      /Refusing to revert SharedWarehouseFoundation1792560000000.*1 team invitation\(s\).*1 idempotency record\(s\).*warehouse grant\(s\) that differ.*Nothing was changed/s);
    expect(await snapshot()).toBe(before); // grants, invitations, keys, ledger, migration record: all untouched
    expect(await grantsOf(ids.staffA1)).toEqual([ids.a1]); // still narrowed: access was not widened
    for (const t of ['warehouse_access', 'team_invitations', 'stock_idempotency_keys']) expect(await exists(t)).toBe(true);
    expect((await one(`SELECT count(*)::int AS n FROM migrations WHERE name = 'SharedWarehouseFoundation1792560000000'`)).n).toBe(1);
  });

  it('also refuses when the only difference is a warehouse created after the rollout that Staff were never granted', async () => {
    // put the grants and the data back to the exact default, then add one warehouse nobody was granted
    await ds.query(`DELETE FROM team_invitations`);
    await ds.query(`DELETE FROM stock_idempotency_keys`);
    await ds.query(`DELETE FROM warehouse_access`);
    await ds.query(`INSERT INTO warehouse_access (company_id, user_id, warehouse_id)
                    SELECT u.company_id, u.id, w.id FROM users u JOIN warehouses w ON w.company_id = u.company_id WHERE u.role = 'Staff'`);
    const [{ id: fresh }] = await ds.query(`INSERT INTO warehouses (company_id, name) VALUES ($1, 'Opened after rollout') RETURNING id`, [ids.companyA]);
    const before = await snapshot();
    const refusal = await ds.undoLastMigration().then(() => null, (e: Error) => e);
    expect(refusal?.message).toMatch(/Refusing to revert SharedWarehouseFoundation1792560000000.*2 warehouse grant\(s\) that differ/s);
    expect(refusal?.message).not.toMatch(/invitation|idempotency/); // the grants are the only reason
    expect(await snapshot()).toBe(before);
    expect(await grantsOf(ids.staffA1)).not.toContain(fresh); // up() would have granted it silently
  });

  it('allows the revert on a pristine rollout (default grants, no invitations, no keys), restoring nothing it should not', async () => {
    await ds.query(`DELETE FROM warehouses WHERE id IN (SELECT id FROM warehouses WHERE name = 'Opened after rollout')`);
    await ds.undoLastMigration();
    for (const t of ['warehouse_access', 'team_invitations', 'stock_idempotency_keys']) expect(await exists(t)).toBe(false);
    expect((await ds.runMigrations()).map((m) => m.name)).toEqual(DELTA_NAMES.slice(2));
    expect(await grantsOf(ids.staffA1)).toEqual([ids.a1, ids.a2, ids.a3].sort()); // the same default, no more
  });
});
