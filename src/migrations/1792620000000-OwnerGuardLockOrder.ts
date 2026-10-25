import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Series 13 / N-1: the last-owner guard follows the global lock order. Forward-only; it replaces the trigger function of
 * 1792600000000 (which stays as it was applied) and touches no row.
 *
 * Before: `users_guard_last_owner` serialized owner changes with `SELECT ... FROM companies ... FOR UPDATE`, taken inside the
 * UPDATE of the member row, i.e. AFTER a membership action already holds the member authority locks. Every stock write, grant
 * and replacement takes the company row in a shared mode FIRST and then queues for the member lock, so an owner's suspension
 * and that owner's own write deadlocked (reproduced: one side got a 503 or a 500), and a stream of other members' writes kept
 * the FOR UPDATE out for as long as it lasted (reproduced: a 1.5 s lock_timeout did not bound it, every new key-share restarts
 * the wait). Two direct-SQL holes were reproduced as well: the sole owner could be demoted out of the Admin role, and two
 * REPEATABLE READ sessions could each remove one of two owners (both checks read a snapshot older than the other's commit).
 *
 * After:
 *  1. The guard serializes on the fair per-company MEMBERSHIP lock (`stockmind:company-members:<company>`, member-lock.ts
 *     step 0). A membership action already holds it, first in its transaction, so for the application the guard waits for
 *     nothing new; a direct SQL change takes it on the spot and is serialized with the membership actions of that company.
 *     The company row is no longer locked exclusively by the guard; no lock of another company is ever taken.
 *  2. An owner's seat is lost when the member stops being an active owner of the company OR leaves the Admin role while
 *     still flagged owner; leaving the Admin role while staying owner is refused outright (ownership and the Admin role
 *     travel together, as the membership policy already says). The remaining owner must be a legitimate one: active,
 *     owner, Admin.
 *  3. A seat change under REPEATABLE READ is refused: such a session checks a snapshot that can predate a concurrent owner
 *     change, so the guard cannot be correct there. READ COMMITTED (the application, and psql's default) re-reads after the
 *     lock; SERIALIZABLE is protected by PostgreSQL's own conflict detection (verified by the Series 13 tests).
 *
 * down() restores the Series 09 function and trigger exactly (no data is involved; it brings the reproduced defects back).
 */
export class OwnerGuardLockOrder1792620000000 implements MigrationInterface {
  name = 'OwnerGuardLockOrder1792620000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
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
            IF OLD."role"::text = 'Admin' AND NEW."role"::text <> 'Admin' THEN
              RAISE EXCEPTION 'owner_requires_admin_role' USING ERRCODE = 'check_violation',
                HINT = 'Clear is_owner in the same statement; the last-owner rule then applies.';
            END IF;
            RETURN NEW;
          END IF;
          -- The seat is lost. Under REPEATABLE READ the check below would read a snapshot that can predate a concurrent change.
          IF current_setting('transaction_isolation') = 'repeatable read' THEN
            RAISE EXCEPTION 'owner_change_requires_read_committed' USING ERRCODE = 'object_not_in_prerequisite_state';
          END IF;
          -- Serialize with every membership change of this company (member-lock.ts step 0; re-entrant for the application).
          PERFORM pg_advisory_xact_lock(hashtextextended('stockmind:company-members:' || OLD."company_id"::text, 0));
          IF NOT EXISTS (
            SELECT 1 FROM "users"
            WHERE "company_id" = OLD."company_id" AND "id" <> OLD."id" AND "is_owner" AND "status" = 'active' AND "role"::text = 'Admin'
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
      BEFORE UPDATE OF "is_owner", "status", "company_id", "role" OR DELETE ON "users"
      FOR EACH ROW EXECUTE FUNCTION "users_guard_last_owner"()`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
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
  }
}
