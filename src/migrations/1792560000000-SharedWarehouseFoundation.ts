import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Shared-warehouse foundations: per-warehouse access for team members, single-use team invitations, idempotent stock
 * writes and a per-warehouse stock revision that clients use as a sync cursor.
 *
 * Additive only. Existing Staff users get access to every warehouse of their company, so nobody loses access on
 * rollout (Admin and Manager see all warehouses without rows). Code that predates this migration ignores the new
 * tables and columns, so an application rollback needs no schema change; down() removes everything it added.
 */
export class SharedWarehouseFoundation1792560000000 implements MigrationInterface {
  name = 'SharedWarehouseFoundation1792560000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "warehouse_access" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id") ON DELETE CASCADE,
        "granted_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_warehouse_access" PRIMARY KEY ("id"),
        CONSTRAINT "uq_warehouse_access_user_warehouse" UNIQUE ("user_id", "warehouse_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_warehouse_access_company" ON "warehouse_access" ("company_id")`,
    );
    // Keep today's behaviour for existing Staff users: every warehouse of their company.
    await queryRunner.query(`
      INSERT INTO "warehouse_access" ("company_id", "user_id", "warehouse_id")
      SELECT u."company_id", u."id", w."id"
      FROM "users" u JOIN "warehouses" w ON w."company_id" = u."company_id"
      WHERE u."role" = 'Staff'
      ON CONFLICT ("user_id", "warehouse_id") DO NOTHING
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "team_invitations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "email" varchar(255) NOT NULL,
        "role" varchar(20) NOT NULL CHECK ("role" IN ('Manager', 'Staff')),
        "warehouse_ids" uuid[] NOT NULL DEFAULT '{}',
        "token_hash" char(64) NOT NULL,
        "invited_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "expires_at" timestamptz NOT NULL,
        "accepted_at" timestamptz,
        "accepted_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "revoked_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_team_invitations" PRIMARY KEY ("id"),
        CONSTRAINT "uq_team_invitations_token_hash" UNIQUE ("token_hash")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_team_invitations_company" ON "team_invitations" ("company_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "stock_idempotency_keys" (
        "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "idempotency_key" varchar(128) NOT NULL,
        "request_hash" char(64) NOT NULL,
        "response" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_stock_idempotency_keys" PRIMARY KEY ("company_id", "user_id", "idempotency_key")
      )
    `);

    // Per-warehouse revision: every stock write bumps it under the warehouse row lock, so revisions commit in order
    // and a client that read up to N never misses a later write numbered below N.
    await queryRunner.query(
      `ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "stock_revision" bigint NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(`ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "revision" bigint`);
    await queryRunner.query(`
      WITH ordered AS (
        SELECT "id", row_number() OVER (PARTITION BY "warehouse_id" ORDER BY "created_at", "id") AS rn
        FROM "stock_movements"
      )
      UPDATE "stock_movements" m SET "revision" = o.rn FROM ordered o WHERE o."id" = m."id"
    `);
    await queryRunner.query(`
      UPDATE "warehouses" w SET "stock_revision" =
        COALESCE((SELECT max(m."revision") FROM "stock_movements" m WHERE m."warehouse_id" = w."id"), 0)
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_stock_movements_warehouse_revision" ON "stock_movements" ("warehouse_id", "revision")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_stock_movements_warehouse_revision"`);
    await queryRunner.query(`ALTER TABLE "stock_movements" DROP COLUMN IF EXISTS "revision"`);
    await queryRunner.query(`ALTER TABLE "warehouses" DROP COLUMN IF EXISTS "stock_revision"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "stock_idempotency_keys"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "team_invitations"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "warehouse_access"`);
  }
}
