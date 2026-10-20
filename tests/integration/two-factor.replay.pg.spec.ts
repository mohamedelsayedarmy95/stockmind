/**
 * TOTP replay protection on real PostgreSQL. Two DataSources with their own connection pools stand in for two app
 * instances. Proves: concurrent use of one TOTP or backup code succeeds at most once, consumption survives a restart,
 * a failed write consumes nothing, and the migration adds and removes the column without touching existing rows.
 *
 * Runs only with PG_INTEGRATION=1 and DB_HOST localhost/127.0.0.1 (DB_PORT, DB_USERNAME, DB_PASSWORD, DB_DATABASE as
 * for the app). It works in a schema of its own and drops it afterwards.
 */
import { DataSource } from 'typeorm';
import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import * as bcrypt from 'bcrypt';
import * as path from 'path';
import * as speakeasy from 'speakeasy';
import { randomBytes, randomUUID } from 'crypto';
import { UserTwoFactor } from '../../src/domain/entities/user-two-factor.entity';
import { TwoFactorService } from '../../src/infrastructure/security/two-factor.service';

const RUN = process.env.PG_INTEGRATION === '1' && ['localhost', '127.0.0.1'].includes(process.env.DB_HOST ?? '');
const SCHEMA = `totp_it_${randomBytes(4).toString('hex')}`;
const MIGRATIONS = path.join(__dirname, '../../src/migrations');
const NEW_MIGRATION = 'TotpLastAcceptedStep1792473600000';

const options = (migrations: string[] = [], schema: string | undefined = SCHEMA): PostgresConnectionOptions => ({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  schema,
  entities: [UserTwoFactor],
  migrations,
  extra: schema ? { options: `-c search_path=${schema},public`, max: 10 } : {},
});

const column = async (ds: DataSource) =>
  (await ds.query(
    `SELECT data_type, is_nullable FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = 'user_two_factor' AND column_name = 'last_totp_step'`,
    [SCHEMA],
  ))[0] as { data_type: string; is_nullable: string } | undefined;

(RUN ? describe : describe.skip)('TOTP replay protection on PostgreSQL', () => {
  jest.setTimeout(120_000);
  let admin: DataSource;
  let a: DataSource;
  let b: DataSource;
  let svcA: TwoFactorService;
  let svcB: TwoFactorService;
  const secret = speakeasy.generateSecret({ length: 20 }).base32;
  const LEGACY_USER = '00000000-0000-4000-8000-0000000000aa';
  let columnBefore: unknown;
  let ran: string[] = [];

  const enabledUser = async (backupCodes: string[] = []) => {
    const userId = randomUUID();
    const hashes = await Promise.all(backupCodes.map((c) => bcrypt.hash(c, 4)));
    await a.getRepository(UserTwoFactor).save({
      userId, secretKey: secret, isEnabled: true, backupCodes: hashes.length ? JSON.stringify(hashes) : null,
    });
    return userId;
  };
  const both = (userId: string, code: string, n: number) =>
    Promise.all(Array.from({ length: n }, (_, i) => (i % 2 ? svcA : svcB).verifyCode(userId, code)));
  const stepOf = async (userId: string) =>
    (await a.query(`SELECT last_totp_step FROM user_two_factor WHERE user_id = $1`, [userId]))[0].last_totp_step;

  beforeAll(async () => {
    process.env.DB_ENCRYPTION_KEY = 'pg-integration-test-only-key'; // secrets are stored encrypted, as in production
    admin = await new DataSource(options([], undefined)).initialize();
    await admin.query(`CREATE SCHEMA "${SCHEMA}"`);

    // The existing schema first (every migration before this change) with an enrolled user, then the new migration.
    const before = await new DataSource(options([path.join(MIGRATIONS, '172*.ts')])).initialize();
    await before.runMigrations();
    columnBefore = await column(before);
    await before.query(
      `INSERT INTO user_two_factor (user_id, secret_key, is_enabled, backup_codes) VALUES ($1, 'legacy', true, NULL)`,
      [LEGACY_USER],
    );
    await before.destroy();

    a = await new DataSource(options([path.join(MIGRATIONS, '*.ts')])).initialize();
    ran = (await a.runMigrations()).map((m) => m.name);
    b = await new DataSource(options()).initialize();
    svcA = new TwoFactorService(a.getRepository(UserTwoFactor));
    svcB = new TwoFactorService(b.getRepository(UserTwoFactor));
  });

  afterAll(async () => {
    for (const ds of [a, b]) if (ds?.isInitialized) await ds.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await admin.destroy();
    }
  });

  it('migration: adds a nullable bigint, keeps existing rows, reverts and re-applies cleanly', async () => {
    expect(columnBefore).toBeUndefined();
    expect(ran).toEqual([NEW_MIGRATION]);
    expect(await column(a)).toEqual({ data_type: 'bigint', is_nullable: 'YES' });
    const legacy = `SELECT secret_key, is_enabled, last_totp_step FROM user_two_factor WHERE user_id = $1`;
    const id = LEGACY_USER;
    expect(await a.query(legacy, [id])).toEqual([{ secret_key: 'legacy', is_enabled: true, last_totp_step: null }]);

    await a.undoLastMigration();
    expect(await column(a)).toBeUndefined();
    expect(await a.query(`SELECT count(*)::int AS n FROM user_two_factor WHERE user_id = $1`, [id])).toEqual([{ n: 1 }]);
    expect((await a.runMigrations()).map((m) => m.name)).toEqual([NEW_MIGRATION]);
    expect(await column(a)).toEqual({ data_type: 'bigint', is_nullable: 'YES' });
  });

  it('20 concurrent submissions of one TOTP code across two instances: exactly one succeeds', async () => {
    const userId = await enabledUser();
    const code = speakeasy.totp({ secret, encoding: 'base32' });
    const results = await both(userId, code, 20);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(Number(await stepOf(userId))).toBeGreaterThan(0);
  });

  it('a consumed code stays consumed after a restart, and another user is unaffected', async () => {
    const userId = await enabledUser();
    const other = await enabledUser();
    const code = speakeasy.totp({ secret, encoding: 'base32' });
    expect(await svcA.verifyCode(userId, code)).toBe(true);

    await b.destroy();
    b = await new DataSource(options()).initialize();
    svcB = new TwoFactorService(b.getRepository(UserTwoFactor));
    expect(await svcB.verifyCode(userId, code)).toBe(false);
    expect(await svcB.verifyCode(other, code)).toBe(true);
  });

  it('10 concurrent submissions of one backup code across two instances: exactly one succeeds', async () => {
    const userId = await enabledUser(['A1B2C3D4', 'E5F60718']);
    const results = await both(userId, 'A1B2C3D4', 10);
    expect(results.filter(Boolean)).toHaveLength(1);
    const row = await b.getRepository(UserTwoFactor).findOneOrFail({ where: { userId } });
    expect(JSON.parse(row.backupCodes as string)).toHaveLength(1);
  });

  it('a failing write consumes nothing: the same TOTP and backup code work once the database recovers', async () => {
    const userId = await enabledUser(['0BADC0DE']);
    const code = speakeasy.totp({ secret, encoding: 'base32' });
    await a.query(`CREATE FUNCTION "${SCHEMA}".fail_2fa_write() RETURNS trigger LANGUAGE plpgsql AS
                   $$ BEGIN RAISE EXCEPTION 'injected write failure'; END $$`);
    await a.query(`CREATE TRIGGER fail_2fa_write BEFORE UPDATE ON user_two_factor FOR EACH ROW
                   EXECUTE FUNCTION "${SCHEMA}".fail_2fa_write()`);
    try {
      await expect(svcA.verifyCode(userId, code)).rejects.toThrow('injected write failure');
      await expect(svcB.verifyCode(userId, '0BADC0DE')).rejects.toThrow('injected write failure');
      expect(await stepOf(userId)).toBeNull();
    } finally {
      await a.query(`DROP TRIGGER fail_2fa_write ON user_two_factor`);
    }
    expect(await svcB.verifyCode(userId, code)).toBe(true);
    expect(await svcA.verifyCode(userId, '0BADC0DE')).toBe(true);
  });
});
