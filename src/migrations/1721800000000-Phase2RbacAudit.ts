import { MigrationInterface, QueryRunner } from 'typeorm';

export class Phase2RbacAudit1721800000000 implements MigrationInterface {
  name = 'Phase2RbacAudit1721800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Roles ──────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "roles" (
        "id"          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        "company_id"  UUID NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "name"        VARCHAR(100) NOT NULL,
        "description" TEXT,
        "is_system"   BOOLEAN NOT NULL DEFAULT false,
        "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE ("company_id", "name")
      );
    `);

    // ── Permissions ────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "permissions" (
        "id"          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        "name"        VARCHAR(100) NOT NULL UNIQUE,
        "description" TEXT
      );
    `);

    // ── Role Permissions ──────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "role_permissions" (
        "role_id"       UUID NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
        "permission_id" UUID NOT NULL REFERENCES "permissions"("id") ON DELETE CASCADE,
        PRIMARY KEY ("role_id", "permission_id")
      );
    `);

    // ── User Roles ─────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_roles" (
        "user_id"     UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "role_id"     UUID NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
        "assigned_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY ("user_id", "role_id")
      );
    `);

    // ── Audit Logs ─────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "audit_logs" (
        "id"             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        "actor_user_id"  UUID,
        "company_id"     UUID,
        "action"         VARCHAR(50) NOT NULL,
        "entity_type"    VARCHAR(100),
        "entity_id"      UUID,
        "old_values"     JSONB,
        "new_values"     JSONB,
        "ip_address"     VARCHAR(45),
        "user_agent"     TEXT,
        "correlation_id" VARCHAR(100),
        "http_method"    VARCHAR(10),
        "http_path"      TEXT,
        "status_code"    INTEGER,
        "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_audit_logs_company_created"
        ON "audit_logs" ("company_id", "created_at" DESC);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_audit_logs_entity"
        ON "audit_logs" ("entity_type", "entity_id");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_audit_logs_correlation"
        ON "audit_logs" ("correlation_id");
    `);

    // ── Seed canonical permissions ─────────────────────────────
    const permissions = [
      'CREATE_PRODUCT', 'UPDATE_PRODUCT', 'DELETE_PRODUCT', 'VIEW_PRODUCT',
      'CREATE_WAREHOUSE', 'UPDATE_WAREHOUSE', 'DELETE_WAREHOUSE', 'VIEW_WAREHOUSE',
      'STOCK_INBOUND', 'STOCK_OUTBOUND', 'STOCK_ADJUSTMENT', 'STOCK_TRANSFER',
      'VIEW_BALANCE', 'VIEW_MOVEMENTS',
      'MANAGE_USERS', 'MANAGE_ROLES', 'VIEW_AUDIT_LOG',
    ];
    for (const p of permissions) {
      await queryRunner.query(
        `INSERT INTO "permissions" ("name") VALUES ($1) ON CONFLICT (name) DO NOTHING`,
        [p],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_audit_logs_correlation"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_audit_logs_entity"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_audit_logs_company_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_roles"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "role_permissions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "permissions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "roles"`);
  }
}
