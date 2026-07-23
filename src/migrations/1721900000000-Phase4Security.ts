import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 4 — Zero-Trust security hardening.
 * All additive: new tables + nullable columns. No existing column is altered,
 * so every prior endpoint keeps its exact behaviour.
 */
export class Phase4Security1721900000000 implements MigrationInterface {
  name = 'Phase4Security1721900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 2FA secrets (encrypted at rest by the app-layer transformer) ─────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_two_factor" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "secret_key" text NOT NULL,
        "is_enabled" boolean NOT NULL DEFAULT false,
        "backup_codes" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_user_two_factor" PRIMARY KEY ("id")
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_two_factor_user"
        ON "user_two_factor" ("user_id");
    `);

    // ── Login attempts (brute-force lockout source of truth) ─────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "login_attempts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "email" character varying(255) NOT NULL,
        "ip_address" character varying(45),
        "user_agent" text,
        "successful" boolean NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_login_attempts" PRIMARY KEY ("id")
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_login_attempts_email_time"
        ON "login_attempts" ("email", "created_at");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_login_attempts_ip_time"
        ON "login_attempts" ("ip_address", "created_at");
    `);

    // ── Audit: session correlation ───────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "audit_logs"
        ADD COLUMN IF NOT EXISTS "session_id" character varying(100);
    `);

    // ── Product: encrypted cost price ────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "products"
        ADD COLUMN IF NOT EXISTS "cost_price" text;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "cost_price";`);
    await queryRunner.query(`ALTER TABLE "audit_logs" DROP COLUMN IF EXISTS "session_id";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "login_attempts";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_two_factor";`);
  }
}
