import { MigrationInterface, QueryRunner } from 'typeorm';
import { refuseIfDataWouldBeLost } from '../shared/db/migration-guards';

/**
 * Series 09 / S1, member lifecycle and immediate access revocation. Additive; nothing existing is rewritten or deleted.
 *
 *  1. users.status ('active' | 'suspended' | 'removed', default 'active'): whether the member may use the company's data at
 *     all. It is checked on every authenticated request (JwtStrategy) and again inside every stock write transaction.
 *  2. users.token_version (integer, default 0): bumped on suspend, remove, role change and "revoke sessions". An access
 *     token carries the version it was issued under (`tv`, absent = 0 for tokens issued before this migration); a token
 *     whose version differs from the row is refused immediately, instead of living out its 15-minute expiry.
 *  3. users.is_owner (boolean): ownership as metadata, separate from the Admin role. It is backfilled ONLY where the
 *     evidence is authoritative: a company with exactly ONE Admin (Admin accounts originate solely from registration,
 *     which creates the company, so the sole Admin is its founder). Companies with none or several Admins are left
 *     ownerless on purpose (fail closed): nobody can then act on an Admin member until an operator designates the owner
 *     from evidence (see SERIES_09_AUTHORIZATION_AND_PRIVACY_CONTRACT.md, "Legacy ownership").
 *  4. A row trigger makes the invariant "a company that has an active owner keeps one" a property of the database, not of
 *     the application: it refuses (message `last_active_owner`) any change that would leave a company without an active
 *     owner, whoever issues the statement. It serializes on the company row, so two concurrent demotions cannot both pass.
 *  5. membership_events: append-only audit of every membership change (who, whom, what, why, before/after, sessions revoked).
 *     Actor and target ids are plain columns (no foreign key) with an email snapshot, so the evidence outlives the rows.
 *
 * down() is fail-closed like the earlier migrations: it refuses, changing nothing, once any membership event, suspension,
 * removal, session revocation or non-derivable ownership exists. Going back means restoring a backup or fixing forward.
 */
export class AccessLifecycle1792600000000 implements MigrationInterface {
  name = 'AccessLifecycle1792600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'active'`);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_users_status') THEN
          ALTER TABLE "users" ADD CONSTRAINT "ck_users_status" CHECK ("status" IN ('active', 'suspended', 'removed'));
        END IF;
      END $$`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "token_version" integer NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_owner" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "status_changed_at" timestamptz`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "status_changed_by" uuid`);

    // Ownership backfill: only where the evidence is authoritative (exactly one Admin in the company).
    await queryRunner.query(`
      UPDATE "users" u SET "is_owner" = true
      FROM (
        SELECT "company_id", (array_agg("id"))[1] AS "id"
        FROM "users" WHERE "role" = 'Admin'
        GROUP BY "company_id" HAVING count(*) = 1
      ) sole
      WHERE u."id" = sole."id" AND u."is_owner" = false`);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "ix_users_company_active_owner" ON "users" ("company_id") WHERE "is_owner" AND "status" = 'active'`,
    );

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "users_guard_last_owner"() RETURNS trigger AS $$
      BEGIN
        IF OLD."is_owner" AND OLD."status" = 'active' THEN
          IF TG_OP = 'DELETE' THEN
            -- A cascading delete of the whole company (the company row is already gone) is not a loss of ownership.
            IF NOT EXISTS (SELECT 1 FROM "companies" WHERE "id" = OLD."company_id") THEN
              RETURN OLD;
            END IF;
          ELSIF NEW."is_owner" AND NEW."status" = 'active' AND NEW."company_id" = OLD."company_id" THEN
            RETURN NEW;
          END IF;
          -- Serialize concurrent owner changes of one company, then require another active owner.
          PERFORM 1 FROM "companies" WHERE "id" = OLD."company_id" FOR UPDATE;
          IF NOT EXISTS (
            SELECT 1 FROM "users"
            WHERE "company_id" = OLD."company_id" AND "id" <> OLD."id" AND "is_owner" AND "status" = 'active'
          ) THEN
            RAISE EXCEPTION 'last_active_owner';
          END IF;
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_users_guard_last_owner" ON "users"`);
    await queryRunner.query(`
      CREATE TRIGGER "trg_users_guard_last_owner"
      BEFORE UPDATE OF "is_owner", "status", "company_id" OR DELETE ON "users"
      FOR EACH ROW EXECUTE FUNCTION "users_guard_last_owner"()`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "membership_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "actor_user_id" uuid,
        "target_user_id" uuid NOT NULL,
        "target_email" text NOT NULL,
        "event_type" text NOT NULL,
        "from_status" text,
        "to_status" text,
        "from_role" text,
        "to_role" text,
        "sessions_revoked" boolean NOT NULL DEFAULT false,
        "reason" text,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_membership_events" PRIMARY KEY ("id"),
        CONSTRAINT "ck_membership_events_type" CHECK ("event_type" IN
          ('suspend', 'reactivate', 'remove', 'change_role', 'revoke_sessions'))
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "ix_membership_events_company" ON "membership_events" ("company_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "ix_membership_events_target" ON "membership_events" ("target_user_id", "created_at" DESC)`,
    );
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "membership_events_append_only"() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'membership_events is append-only';
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_membership_events_no_update" ON "membership_events"`);
    await queryRunner.query(`
      CREATE TRIGGER "trg_membership_events_no_update"
      BEFORE UPDATE ON "membership_events"
      FOR EACH ROW EXECUTE FUNCTION "membership_events_append_only"()`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await refuseIfDataWouldBeLost(queryRunner, 'AccessLifecycle1792600000000', [
      { label: 'recorded membership event(s)', sql: `SELECT count(*)::int AS n FROM "membership_events"` },
      { label: 'suspended or removed member(s)', sql: `SELECT count(*)::int AS n FROM "users" WHERE "status" <> 'active'` },
      { label: 'member(s) whose sessions were revoked (token_version > 0)', sql: `SELECT count(*)::int AS n FROM "users" WHERE "token_version" > 0` },
      {
        label: 'owner designation(s) that the one-Admin rule cannot recreate',
        sql: `SELECT count(*)::int AS n FROM "users" u WHERE u."is_owner"
              AND (SELECT count(*) FROM "users" a WHERE a."company_id" = u."company_id" AND a."role" = 'Admin') <> 1`,
      },
    ]);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_membership_events_no_update" ON "membership_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "membership_events"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS "membership_events_append_only"()`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_users_guard_last_owner" ON "users"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS "users_guard_last_owner"()`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_users_company_active_owner"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "status_changed_by"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "status_changed_at"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "is_owner"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "token_version"`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "ck_users_status"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "status"`);
  }
}
