import { MigrationInterface, QueryRunner } from 'typeorm';
import { refuseIfDataWouldBeLost } from '../shared/db/migration-guards';

/**
 * Series 07, recovery integrity. Additive; nothing existing is rewritten, renumbered or deleted.
 *
 *  1. companies.history_generation (uuid): the identity of the history the company's clients are synchronising with. It
 *     is opaque: clients only compare it for equality, so a revision number reused after a restore can never alias it.
 *     Existing companies get a random value from the column default. It changes only through an audited, authenticated
 *     rotation (HistoryGenerationService), which an operator performs after a restore.
 *  2. warehouses.history_floor_revision (bigint): the warehouse's stock revision at the last rotation. A client that
 *     predates the generation contract cannot say which generation it has seen; the server answers its cursor below this
 *     floor with a snapshot and `reset`, once, instead of letting it continue across the rotation.
 *  3. history_generation_events: append-only record of every rotation (who, why, previous and new generation, the floors).
 *  4. stock_replacements: durable provenance of every operator-free, human-confirmed replacement of an operation that a
 *     history change erased (original key and receipt claim, actor, decision time, generation, replacement movement).
 *     UNIQUE (company, actor, original_key) allows at most one replacement per source operation within one database
 *     history. The movement ids are deliberately NOT foreign keys: the evidence must outlive the movements it describes.
 *
 * down() is fail-closed like the Series 06 migrations: it refuses, changing nothing, once any rotation or replacement
 * has been recorded. Going back means restoring a backup taken before this migration, or fixing forward.
 */
export class RecoveryIntegrity1792590000000 implements MigrationInterface {
  name = 'RecoveryIntegrity1792590000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "history_generation" uuid NOT NULL DEFAULT gen_random_uuid()`,
    );
    await queryRunner.query(
      `ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "history_floor_revision" bigint NOT NULL DEFAULT 0`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "history_generation_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "previous_generation" uuid NOT NULL,
        "new_generation" uuid NOT NULL,
        "actor_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "kind" text NOT NULL DEFAULT 'rotation',
        "reason" text NOT NULL,
        "warehouse_floors" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_history_generation_events" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "ix_history_generation_events_company" ON "history_generation_events" ("company_id", "created_at" DESC)`,
    );
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "history_generation_events_append_only"() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'history_generation_events is append-only';
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_history_generation_events_no_update" ON "history_generation_events"`);
    await queryRunner.query(`
      CREATE TRIGGER "trg_history_generation_events_no_update"
      BEFORE UPDATE ON "history_generation_events"
      FOR EACH ROW EXECUTE FUNCTION "history_generation_events_append_only"()`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "stock_replacements" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id") ON DELETE CASCADE,
        "actor_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "original_key" text NOT NULL,
        "original_movement_id" uuid NOT NULL,
        "original_claim" jsonb NOT NULL,
        "replacement_key" text NOT NULL,
        "replacement_movement_id" uuid NOT NULL,
        "generation_at_decision" uuid NOT NULL,
        "original_status" text NOT NULL,
        "reason" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_stock_replacements" PRIMARY KEY ("id"),
        CONSTRAINT "uq_stock_replacements_original" UNIQUE ("company_id", "actor_user_id", "original_key"),
        CONSTRAINT "uq_stock_replacements_replacement" UNIQUE ("company_id", "actor_user_id", "replacement_key")
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "ix_stock_replacements_original_movement" ON "stock_replacements" ("original_movement_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "ix_stock_replacements_replacement_movement" ON "stock_replacements" ("replacement_movement_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await refuseIfDataWouldBeLost(queryRunner, 'RecoveryIntegrity1792590000000', [
      { label: 'recorded history-generation rotation(s)', sql: `SELECT count(*)::int AS n FROM "history_generation_events"` },
      { label: 'recorded operation replacement(s)', sql: `SELECT count(*)::int AS n FROM "stock_replacements"` },
      {
        label: 'warehouse(s) with a history floor from a rotation',
        sql: `SELECT count(*)::int AS n FROM "warehouses" WHERE "history_floor_revision" > 0`,
      },
    ]);
    await queryRunner.query(`DROP TABLE IF EXISTS "stock_replacements"`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_history_generation_events_no_update" ON "history_generation_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "history_generation_events"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS "history_generation_events_append_only"()`);
    await queryRunner.query(`ALTER TABLE "warehouses" DROP COLUMN IF EXISTS "history_floor_revision"`);
    await queryRunner.query(`ALTER TABLE "companies" DROP COLUMN IF EXISTS "history_generation"`);
  }
}
