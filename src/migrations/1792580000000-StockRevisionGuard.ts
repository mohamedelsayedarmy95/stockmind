import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Keeps the per-warehouse stock revision consistent even when a writer does not set it, and makes a duplicate revision
 * impossible. Additive; down() removes only what this migration added and deletes no rows.
 *
 * Why: the revision is the sync cursor. The current release assigns it under the warehouse row lock (UPDATE warehouses
 * SET stock_revision = stock_revision + 1) and inserts the movement with it. A release from before 1792560000000 (an
 * application rollback, or an old instance still running during a rolling deploy) inserts movements WITHOUT a revision
 * and never touches the counter; those movements were then invisible to every delta (`revision > since`).
 *
 * What it does:
 *  1. Refuses, before changing anything, if two movements of one warehouse already share a revision (the unique index
 *     below could not be built). The error names the pairs; resolve them first (runbook section 8).
 *  2. Repairs movements that already have no revision: under the warehouse row lock they get the next revisions after
 *     everything already issued, in (created_at, id) order. That is deterministic, never renumbers an issued revision, and
 *     is the same rule the original backfill used; the true commit order of such rows is unknowable, and the cursor
 *     protocol only needs them numbered above every revision a client may already have read.
 *  3. A BEFORE INSERT trigger fills a missing revision the same way the application does: bump the counter under the
 *     warehouse row lock and use it. An insert that sets its revision (the current release) is left alone, so nothing is
 *     numbered twice. Concurrent inserts into one warehouse queue on that lock and commit in revision order.
 *  4. A partial unique index on (warehouse_id, revision) turns "revisions are unique" from a convention of the locking
 *     protocol into a constraint of the database.
 *
 * Not covered, and still unsupported: an older release also lacks the idempotency records and warehouse grants, so an
 * application rollback is a degraded mode to ride out while fixing forward, not a supported way back. See the runbook.
 */
export class StockRevisionGuard1792580000000 implements MigrationInterface {
  name = 'StockRevisionGuard1792580000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const duplicates: Array<{ warehouse_id: string; revision: string; n: number }> = await queryRunner.query(`
      SELECT "warehouse_id", "revision"::text AS "revision", count(*)::int AS "n"
      FROM "stock_movements" WHERE "revision" IS NOT NULL
      GROUP BY "warehouse_id", "revision" HAVING count(*) > 1
      ORDER BY "warehouse_id", "revision" LIMIT 5`);
    if (duplicates.length) {
      const sample = duplicates.map((d) => `warehouse ${d.warehouse_id} revision ${d.revision} x${d.n}`).join('; ');
      throw new Error(
        `Cannot add the unique revision index: stock_movements already holds duplicate (warehouse, revision) pairs (${sample}). ` +
          'Nothing was changed. Find and resolve them first; see docs/handoff/STOCKMIND_DATABASE_RECOVERY_RUNBOOK.md section 8.',
      );
    }

    // Repair movements written without a revision. Lock their warehouses first (stable id order), so no writer can
    // allocate a revision in between.
    await queryRunner.query(`
      SELECT "id" FROM "warehouses"
      WHERE "id" IN (SELECT DISTINCT "warehouse_id" FROM "stock_movements" WHERE "revision" IS NULL)
      ORDER BY "id" FOR UPDATE`);
    await queryRunner.query(`
      WITH "base" AS (
        SELECT w."id" AS "warehouse_id",
               GREATEST(w."stock_revision", COALESCE((SELECT max(x."revision") FROM "stock_movements" x
                                                      WHERE x."warehouse_id" = w."id"), 0)) AS "issued"
        FROM "warehouses" w
        WHERE w."id" IN (SELECT DISTINCT "warehouse_id" FROM "stock_movements" WHERE "revision" IS NULL)
      ), "todo" AS (
        SELECT "id", "warehouse_id",
               row_number() OVER (PARTITION BY "warehouse_id" ORDER BY "created_at", "id") AS "rn"
        FROM "stock_movements" WHERE "revision" IS NULL
      )
      UPDATE "stock_movements" m SET "revision" = b."issued" + t."rn"
      FROM "todo" t JOIN "base" b ON b."warehouse_id" = t."warehouse_id"
      WHERE m."id" = t."id"`);
    await queryRunner.query(`
      UPDATE "warehouses" w SET "stock_revision" = m."max_revision"
      FROM (SELECT "warehouse_id", max("revision") AS "max_revision" FROM "stock_movements" GROUP BY "warehouse_id") m
      WHERE m."warehouse_id" = w."id" AND m."max_revision" > w."stock_revision"`);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "stock_movements_assign_revision"() RETURNS trigger AS $$
      BEGIN
        IF NEW."revision" IS NULL THEN
          UPDATE "warehouses" SET "stock_revision" = "stock_revision" + 1
          WHERE "id" = NEW."warehouse_id" RETURNING "stock_revision" INTO NEW."revision";
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_stock_movements_assign_revision" ON "stock_movements"`);
    await queryRunner.query(`
      CREATE TRIGGER "trg_stock_movements_assign_revision"
      BEFORE INSERT ON "stock_movements"
      FOR EACH ROW EXECUTE FUNCTION "stock_movements_assign_revision"()`);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_stock_movements_warehouse_revision"
      ON "stock_movements" ("warehouse_id", "revision") WHERE "revision" IS NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Removes only the guard. The repaired revisions stay: they are valid and already part of the sync history.
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_stock_movements_warehouse_revision"`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_stock_movements_assign_revision" ON "stock_movements"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS "stock_movements_assign_revision"()`);
  }
}
