import { MigrationInterface, QueryRunner } from 'typeorm';
import { refuseIfDataWouldBeLost } from '../shared/db/migration-guards';

/**
 * Series 10 / S2, scoped access. Additive; no existing row is rewritten, renumbered or deleted, and nothing a member could
 * do before changes.
 *
 *  1. UNIQUE (id, company_id) on users and warehouses: lets the new tables carry tenant-safe composite foreign keys, so a
 *     grant can never join a user of one company to a warehouse of another.
 *  2. permission_profiles: versioned bundles of capabilities. System profiles (company_id NULL) are seeded here:
 *       operator v1           = exactly what a Staff member could already do on a warehouse they were granted;
 *       warehouse_manager v1  = operator + adjustments + transfers + warehouse editing, on granted warehouses only.
 *     A version is immutable (a trigger refuses to change its capabilities); a change is a NEW version. The arrays below are
 *     literals on purpose: a later change of the application constants must not rewrite what this migration installed (a
 *     test compares the two and fails on drift).
 *  3. access_grants: user + profile + warehouse scope + validity window + who/why + revocation. At most one ACTIVE grant per
 *     (user, warehouse). A grant never changes identity (trigger); it can only be revoked.
 *  4. access_grant_events: append-only evidence of every grant, replacement and revocation (including those made through the
 *     legacy warehouse endpoint and by membership changes), written in the same transaction as the change.
 *
 * The legacy warehouse_access rows are NOT copied: they stay the store of `operator` grants and the engine reads them as
 * implicit operator grants (dual read), so nothing can diverge and the rollback is "stop reading access_grants".
 *
 * down() is fail-closed like the earlier migrations: it refuses, changing nothing, once any grant, grant event or custom
 * profile exists. Going back means fixing forward or restoring a backup.
 */
export class ScopedAccess1792610000000 implements MigrationInterface {
  name = 'ScopedAccess1792610000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "uq_users_id_company" UNIQUE ("id", "company_id")`);
    await queryRunner.query(`ALTER TABLE "warehouses" ADD CONSTRAINT "uq_warehouses_id_company" UNIQUE ("id", "company_id")`);

    await queryRunner.query(`
      CREATE TABLE "permission_profiles" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "company_id" uuid REFERENCES "companies"("id") ON DELETE CASCADE,
        "key" text NOT NULL,
        "version" integer NOT NULL CHECK ("version" >= 1),
        "label_key" text NOT NULL,
        "capabilities" text[] NOT NULL,
        "is_system" boolean NOT NULL DEFAULT false,
        "retired_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_permission_profiles" PRIMARY KEY ("id"),
        CONSTRAINT "ck_permission_profiles_system" CHECK (("is_system" AND "company_id" IS NULL) OR (NOT "is_system"))
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_permission_profiles_system" ON "permission_profiles" ("key", "version") WHERE "company_id" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_permission_profiles_company" ON "permission_profiles" ("company_id", "key", "version") WHERE "company_id" IS NOT NULL`,
    );
    await queryRunner.query(`
      INSERT INTO "permission_profiles" ("company_id", "key", "version", "label_key", "capabilities", "is_system") VALUES
        (NULL, 'operator', 1, 'access.profile.operator',
         ARRAY['VIEW_WAREHOUSE','STOCK_INBOUND','STOCK_OUTBOUND','VIEW_BALANCE','VIEW_MOVEMENTS'], true),
        (NULL, 'warehouse_manager', 1, 'access.profile.warehouse_manager',
         ARRAY['VIEW_WAREHOUSE','STOCK_INBOUND','STOCK_OUTBOUND','VIEW_BALANCE','VIEW_MOVEMENTS',
               'STOCK_ADJUSTMENT','STOCK_TRANSFER','UPDATE_WAREHOUSE'], true)`);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "permission_profiles_guard"() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          IF OLD."is_system" THEN RAISE EXCEPTION 'system permission profiles cannot be deleted'; END IF;
          RETURN OLD;
        END IF;
        IF NEW."company_id" IS DISTINCT FROM OLD."company_id" OR NEW."key" <> OLD."key" OR NEW."version" <> OLD."version"
           OR NEW."capabilities" <> OLD."capabilities" OR NEW."is_system" <> OLD."is_system" OR NEW."label_key" <> OLD."label_key" THEN
          RAISE EXCEPTION 'a permission profile version is immutable; publish a new version instead';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(`
      CREATE TRIGGER "trg_permission_profiles_guard"
      BEFORE UPDATE OR DELETE ON "permission_profiles"
      FOR EACH ROW EXECUTE FUNCTION "permission_profiles_guard"()`);

    await queryRunner.query(`
      CREATE TABLE "access_grants" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "user_id" uuid NOT NULL,
        "profile_id" uuid NOT NULL REFERENCES "permission_profiles"("id") ON DELETE RESTRICT,
        "scope_type" text NOT NULL DEFAULT 'warehouse',
        "scope_id" uuid NOT NULL,
        "valid_from" timestamptz NOT NULL DEFAULT now(),
        "valid_until" timestamptz,
        "granted_by" uuid,
        "reason" text,
        "revoked_at" timestamptz,
        "revoked_by" uuid,
        "revoke_reason" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_access_grants" PRIMARY KEY ("id"),
        CONSTRAINT "ck_access_grants_scope_type" CHECK ("scope_type" = 'warehouse'),
        CONSTRAINT "ck_access_grants_window" CHECK ("valid_until" IS NULL OR "valid_until" > "valid_from"),
        CONSTRAINT "ck_access_grants_revocation" CHECK ("revoked_at" IS NOT NULL OR ("revoked_by" IS NULL AND "revoke_reason" IS NULL)),
        CONSTRAINT "fk_access_grants_user" FOREIGN KEY ("user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE CASCADE,
        CONSTRAINT "fk_access_grants_warehouse" FOREIGN KEY ("scope_id", "company_id") REFERENCES "warehouses"("id", "company_id") ON DELETE CASCADE
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_access_grants_active_scope" ON "access_grants" ("user_id", "scope_id") WHERE "revoked_at" IS NULL`,
    );
    await queryRunner.query(`CREATE INDEX "ix_access_grants_user_active" ON "access_grants" ("user_id") WHERE "revoked_at" IS NULL`);
    await queryRunner.query(`CREATE INDEX "ix_access_grants_scope" ON "access_grants" ("company_id", "scope_id")`);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "access_grants_guard"() RETURNS trigger AS $$
      DECLARE profile_company uuid;
      BEGIN
        IF TG_OP = 'INSERT' THEN
          SELECT "company_id" INTO profile_company FROM "permission_profiles" WHERE "id" = NEW."profile_id";
          IF profile_company IS NOT NULL AND profile_company <> NEW."company_id" THEN
            RAISE EXCEPTION 'a grant cannot use another company''s permission profile';
          END IF;
          IF NEW."revoked_at" IS NOT NULL THEN RAISE EXCEPTION 'a grant is created active'; END IF;
          RETURN NEW;
        END IF;
        IF NEW."company_id" <> OLD."company_id" OR NEW."user_id" <> OLD."user_id" OR NEW."profile_id" <> OLD."profile_id"
           OR NEW."scope_type" <> OLD."scope_type" OR NEW."scope_id" <> OLD."scope_id" OR NEW."valid_from" <> OLD."valid_from"
           OR NEW."granted_by" IS DISTINCT FROM OLD."granted_by" OR NEW."created_at" <> OLD."created_at" THEN
          RAISE EXCEPTION 'a grant never changes identity; revoke it and create another';
        END IF;
        IF OLD."revoked_at" IS NOT NULL AND (NEW."revoked_at" IS DISTINCT FROM OLD."revoked_at" OR NEW."valid_until" IS DISTINCT FROM OLD."valid_until") THEN
          RAISE EXCEPTION 'a revoked grant is final';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(`
      CREATE TRIGGER "trg_access_grants_guard"
      BEFORE INSERT OR UPDATE ON "access_grants"
      FOR EACH ROW EXECUTE FUNCTION "access_grants_guard"()`);

    await queryRunner.query(`
      CREATE TABLE "access_grant_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "actor_user_id" uuid,
        "target_user_id" uuid NOT NULL,
        "warehouse_id" uuid,
        "event_type" text NOT NULL,
        "profile_key" text,
        "profile_version" integer,
        "previous_profile_key" text,
        "source" text NOT NULL,
        "reason" text,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_access_grant_events" PRIMARY KEY ("id"),
        CONSTRAINT "ck_access_grant_events_type" CHECK ("event_type" IN ('grant', 'revoke', 'replace')),
        CONSTRAINT "ck_access_grant_events_source" CHECK ("source" IN ('api', 'legacy_api', 'membership', 'warehouse_create'))
      )`);
    await queryRunner.query(
      `CREATE INDEX "ix_access_grant_events_target" ON "access_grant_events" ("company_id", "target_user_id", "created_at" DESC)`,
    );
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "access_grant_events_append_only"() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'access_grant_events is append-only';
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(`
      CREATE TRIGGER "trg_access_grant_events_no_update"
      BEFORE UPDATE ON "access_grant_events"
      FOR EACH ROW EXECUTE FUNCTION "access_grant_events_append_only"()`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await refuseIfDataWouldBeLost(queryRunner, 'ScopedAccess1792610000000', [
      { label: 'recorded access grant(s)', sql: `SELECT count(*)::int AS n FROM "access_grants"` },
      { label: 'recorded access grant event(s)', sql: `SELECT count(*)::int AS n FROM "access_grant_events"` },
      { label: 'custom permission profile(s)', sql: `SELECT count(*)::int AS n FROM "permission_profiles" WHERE NOT "is_system"` },
    ]);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_access_grant_events_no_update" ON "access_grant_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "access_grant_events"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS "access_grant_events_append_only"()`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_access_grants_guard" ON "access_grants"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "access_grants"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS "access_grants_guard"()`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_permission_profiles_guard" ON "permission_profiles"`);
    // the system rows are seeded by up(): drop them with the table (the guard trigger is gone first)
    await queryRunner.query(`DROP TABLE IF EXISTS "permission_profiles"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS "permission_profiles_guard"()`);
    await queryRunner.query(`ALTER TABLE "warehouses" DROP CONSTRAINT IF EXISTS "uq_warehouses_id_company"`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "uq_users_id_company"`);
  }
}
