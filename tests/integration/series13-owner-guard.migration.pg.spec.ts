/**
 * Series 13 migration 1792620000000 (OwnerGuardLockOrder) on real PostgreSQL: the upgrade from the Series 12 schema (twelve
 * migrations, synthetic members already in it), a fresh installation, and down().
 *
 * Covers: the upgrade runs only the new migration and touches no row; the upgraded and the fresh database end with the same
 * guard (function text and trigger definition); the new guard is in force on the upgraded data; down() restores the Series 09
 * guard exactly and a second up() returns to the fresh state.
 *
 * Runs only with PG_INTEGRATION=1 and DB_HOST localhost/127.0.0.1, on scratch databases of its own (dropped afterwards).
 */
import { DataSource } from 'typeorm';
import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import * as path from 'path';
import { createHash, randomBytes } from 'crypto';

const RUN = process.env.PG_INTEGRATION === '1' && ['localhost', '127.0.0.1'].includes(process.env.DB_HOST ?? '');
const TAG = randomBytes(4).toString('hex');
const DB_UP = `s13_up_${TAG}`;
const DB_FRESH = `s13_fresh_${TAG}`;
const MIGRATIONS = path.join(__dirname, '../../src/migrations');
const SERIES12_IDS = [
  '1721700000000', '1721800000000', '1721900000000', '1722000000000', '1722345600000', '1792473600000',
  '1792560000000', '1792570000000', '1792580000000', '1792590000000', '1792600000000', '1792610000000',
];
const SERIES12 = SERIES12_IDS.map((id) => path.join(MIGRATIONS, `${id}-*.ts`));
const ALL = [...SERIES12, path.join(MIGRATIONS, '1792620000000-*.ts')];

const options = (database: string, migrations: string[] = []): PostgresConnectionOptions => ({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database,
  migrations,
  extra: { max: 4 },
});

(RUN ? describe : describe.skip)('Series 13 owner guard migration on PostgreSQL', () => {
  jest.setTimeout(180_000);
  let admin: DataSource;
  const guard = async (d: DataSource) => ({
    fn: (await d.query(`SELECT pg_get_functiondef('users_guard_last_owner'::regproc) AS d`))[0].d as string,
    trigger: (await d.query(`SELECT pg_get_triggerdef(oid) AS d FROM pg_trigger WHERE tgname = 'trg_users_guard_last_owner'`))[0].d as string,
  });
  const digestOfMembers = async (d: DataSource) =>
    createHash('sha256').update(JSON.stringify(await d.query(
      `SELECT id, company_id, role::text AS role, status, is_owner, token_version FROM users ORDER BY id`))).digest('hex');
  const insertCompany = async (d: DataSource, owners: number, others: string[] = []) => {
    const c = (await d.query(`INSERT INTO companies (name) VALUES ($1) RETURNING id`, [`S13 ${randomBytes(3).toString('hex')}`]))[0].id as string;
    const ids: string[] = [];
    for (const [i, role] of [...Array(owners).fill('Admin'), ...others].entries()) {
      ids.push((await d.query(
        `INSERT INTO users (company_id, name, email, password_hash, role, is_owner) VALUES ($1, 'M', $2, 'x', $3, $4) RETURNING id`,
        [c, `s13.mig.${i}.${randomBytes(4).toString('hex')}.${TAG}@example.test`, role, i < owners],
      ))[0].id as string);
    }
    return { c, ids };
  };

  let series12Guard: { fn: string; trigger: string };
  let upgradedGuard: { fn: string; trigger: string };
  let sole: { c: string; ids: string[] };

  beforeAll(async () => {
    admin = await new DataSource(options(process.env.DB_DATABASE as string)).initialize();
    for (const db of [DB_UP, DB_FRESH]) await admin.query(`CREATE DATABASE "${db}"`);
  });
  afterAll(async () => {
    for (const db of [DB_UP, DB_FRESH]) await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin.destroy();
  });

  it('upgrades a Series 12 database: only the new migration runs, no member row changes, the new guard is installed', async () => {
    const s12 = await new DataSource(options(DB_UP, SERIES12)).initialize();
    try {
      expect((await s12.runMigrations()).length).toBe(12);
      series12Guard = await guard(s12);
      expect(series12Guard.fn).toContain('FOR UPDATE'); // the Series 09 guard, as applied
      sole = await insertCompany(s12, 1, ['Manager', 'Staff']);
      await insertCompany(s12, 2, ['Staff']);
      await s12.query(`UPDATE users SET status = 'suspended', token_version = 1 WHERE id = $1`, [sole.ids[2]]);
    } finally { await s12.destroy(); }

    const up = await new DataSource(options(DB_UP, ALL)).initialize();
    try {
      const before = await digestOfMembers(up);
      expect((await up.runMigrations()).map((m) => m.name)).toEqual(['OwnerGuardLockOrder1792620000000']);
      expect(await digestOfMembers(up)).toBe(before);
      upgradedGuard = await guard(up);
      expect(upgradedGuard.fn).not.toContain('FOR UPDATE');
      expect(upgradedGuard.fn).toContain(`hashtextextended('stockmind:company-members:'`);
      expect(upgradedGuard.trigger).toMatch(/BEFORE DELETE OR UPDATE OF is_owner, status, company_id, role ON public\.users/);
      // in force on the upgraded data
      await expect(up.query(`UPDATE users SET role = 'Staff' WHERE id = $1`, [sole.ids[0]])).rejects.toThrow(/owner_requires_admin_role/);
      await expect(up.query(`UPDATE users SET status = 'removed' WHERE id = $1`, [sole.ids[0]])).rejects.toThrow(/last_active_owner/);
      await up.query(`UPDATE users SET name = 'Renamed', role = 'Staff' WHERE id = $1`, [sole.ids[1]]); // not an owner: untouched by the guard
      await up.query(`UPDATE users SET name = 'Renamed' WHERE id = $1`, [sole.ids[0]]);
    } finally { await up.destroy(); }
  });

  it('a fresh installation ends with exactly the same guard as the upgraded database', async () => {
    const fresh = await new DataSource(options(DB_FRESH, ALL)).initialize();
    try {
      expect((await fresh.runMigrations()).length).toBe(13);
      expect(await guard(fresh)).toEqual(upgradedGuard);
    } finally { await fresh.destroy(); }
  });

  it('down() restores the Series 09 guard exactly (no data involved); up() again returns to the fresh state', async () => {
    const up = await new DataSource(options(DB_UP, ALL)).initialize();
    try {
      const before = await digestOfMembers(up);
      await up.undoLastMigration();
      expect(await guard(up)).toEqual(series12Guard);
      expect(await digestOfMembers(up)).toBe(before);
      expect((await up.runMigrations()).map((m) => m.name)).toEqual(['OwnerGuardLockOrder1792620000000']);
      expect(await guard(up)).toEqual(upgradedGuard);
    } finally { await up.destroy(); }
  });
});
