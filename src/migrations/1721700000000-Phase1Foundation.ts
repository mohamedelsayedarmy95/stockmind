import { MigrationInterface, QueryRunner } from 'typeorm';

export class Phase1Foundation1721700000000 implements MigrationInterface {
  name = 'Phase1Foundation1721700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Enums ───────────────────────────────────────────────────
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "user_role_enum" AS ENUM ('Admin', 'Manager', 'Staff');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "movement_type_enum" AS ENUM ('INBOUND', 'OUTBOUND', 'TRANSFER_OUT', 'TRANSFER_IN', 'ADJUSTMENT');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "reference_type_enum" AS ENUM ('PURCHASE', 'SALE', 'COUNT', 'TRANSFER');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    // ── Companies ───────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "companies" (
        "id"         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        "public_id"  UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
        "name"       VARCHAR(255) NOT NULL,
        "tax_id"     VARCHAR(100),
        "currency"   VARCHAR(10) NOT NULL DEFAULT 'USD',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ,
        "deleted_by" UUID
      );
    `);

    // ── Warehouses ──────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "warehouses" (
        "id"         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        "public_id"  UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
        "company_id" UUID NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "name"       VARCHAR(255) NOT NULL,
        "address"    TEXT,
        "is_active"  BOOLEAN NOT NULL DEFAULT true,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ,
        "deleted_by" UUID
      );
    `);

    // ── Categories ──────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "categories" (
        "id"         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        "company_id" UUID NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "name"       VARCHAR(255) NOT NULL,
        "parent_id"  UUID REFERENCES "categories"("id") ON DELETE SET NULL
      );
    `);

    // ── Users ───────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id"                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        "public_id"          UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
        "company_id"         UUID NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "warehouse_id"       UUID REFERENCES "warehouses"("id") ON DELETE SET NULL,
        "name"               VARCHAR(255) NOT NULL,
        "email"              VARCHAR(255) NOT NULL UNIQUE,
        "password_hash"      VARCHAR(255) NOT NULL,
        "role"               "user_role_enum" NOT NULL DEFAULT 'Staff',
        "refresh_token_hash" VARCHAR(255),
        "created_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at"         TIMESTAMPTZ,
        "deleted_by"         UUID
      );
    `);

    // ── Products ────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "products" (
        "id"          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        "public_id"   UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
        "company_id"  UUID NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "category_id" UUID REFERENCES "categories"("id") ON DELETE SET NULL,
        "name"        VARCHAR(255) NOT NULL,
        "sku"         VARCHAR(100) NOT NULL,
        "barcode"     VARCHAR(100),
        "image_url"   TEXT,
        "weight"      DECIMAL(18,6),
        "volume"      DECIMAL(18,6),
        "expiry_date" DATE,
        "version"     INTEGER NOT NULL DEFAULT 1,
        "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at"  TIMESTAMPTZ,
        "deleted_by"  UUID,
        UNIQUE ("company_id", "sku")
      );
    `);

    // ── Units of Measure ────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "units_of_measure" (
        "id"                         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        "product_id"                 UUID NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
        "uom_type"                   VARCHAR(50) NOT NULL,
        "code"                       VARCHAR(20) NOT NULL,
        "conversion_factor_to_base"  DECIMAL(18,6) NOT NULL DEFAULT 1
      );
    `);

    // ── Product Warehouse ───────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "product_warehouse" (
        "id"                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        "product_id"        UUID NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
        "warehouse_id"      UUID NOT NULL REFERENCES "warehouses"("id") ON DELETE CASCADE,
        "base_quantity"     DECIMAL(18,6) NOT NULL DEFAULT 0,
        "reserved_quantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
        "reorder_point"     DECIMAL(18,6),
        "max_stock"         DECIMAL(18,6),
        "version"           INTEGER NOT NULL DEFAULT 1,
        UNIQUE ("product_id", "warehouse_id")
      );
    `);

    // ── Stock Movements (Immutable Ledger) ──────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "stock_movements" (
        "id"              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        "product_id"      UUID NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT,
        "warehouse_id"    UUID NOT NULL REFERENCES "warehouses"("id") ON DELETE RESTRICT,
        "user_id"         UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "movement_type"   "movement_type_enum" NOT NULL,
        "reference_type"  "reference_type_enum" NOT NULL,
        "reference_id"    UUID,
        "quantity_change"  DECIMAL(18,6) NOT NULL,
        "running_balance"  DECIMAL(18,6) NOT NULL,
        "notes"           TEXT,
        "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    // ── Phase 1: Indexes ────────────────────────────────────────
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_stock_movements_product_warehouse"
        ON "stock_movements" ("product_id", "warehouse_id");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_users_company"
        ON "users" ("company_id");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_warehouses_company_active"
        ON "warehouses" ("company_id", "is_active");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_stock_movements_created_at"
        ON "stock_movements" ("created_at" DESC);
    `);

    // ── Phase 1: ALTER existing tables (safe for both fresh and existing DBs) ─
    // Add columns only if they don't exist (for databases created by synchronize: true)
    await queryRunner.query(`ALTER TABLE "companies"         ADD COLUMN IF NOT EXISTS "public_id"  UUID DEFAULT gen_random_uuid() UNIQUE`);
    await queryRunner.query(`ALTER TABLE "companies"         ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ`);
    await queryRunner.query(`ALTER TABLE "companies"         ADD COLUMN IF NOT EXISTS "deleted_by" UUID`);

    await queryRunner.query(`ALTER TABLE "warehouses"        ADD COLUMN IF NOT EXISTS "public_id"  UUID DEFAULT gen_random_uuid() UNIQUE`);
    await queryRunner.query(`ALTER TABLE "warehouses"        ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ`);
    await queryRunner.query(`ALTER TABLE "warehouses"        ADD COLUMN IF NOT EXISTS "deleted_by" UUID`);

    await queryRunner.query(`ALTER TABLE "products"          ADD COLUMN IF NOT EXISTS "public_id"  UUID DEFAULT gen_random_uuid() UNIQUE`);
    await queryRunner.query(`ALTER TABLE "products"          ADD COLUMN IF NOT EXISTS "version"    INTEGER NOT NULL DEFAULT 1`);
    await queryRunner.query(`ALTER TABLE "products"          ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ`);
    await queryRunner.query(`ALTER TABLE "products"          ADD COLUMN IF NOT EXISTS "deleted_by" UUID`);

    await queryRunner.query(`ALTER TABLE "users"             ADD COLUMN IF NOT EXISTS "public_id"  UUID DEFAULT gen_random_uuid() UNIQUE`);
    await queryRunner.query(`ALTER TABLE "users"             ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ`);
    await queryRunner.query(`ALTER TABLE "users"             ADD COLUMN IF NOT EXISTS "deleted_by" UUID`);

    await queryRunner.query(`ALTER TABLE "product_warehouse" ADD COLUMN IF NOT EXISTS "version"    INTEGER NOT NULL DEFAULT 1`);

    // Backfill any null public_id values from prior synchronize-created rows
    await queryRunner.query(`UPDATE "companies"  SET "public_id" = gen_random_uuid() WHERE "public_id" IS NULL`);
    await queryRunner.query(`UPDATE "warehouses" SET "public_id" = gen_random_uuid() WHERE "public_id" IS NULL`);
    await queryRunner.query(`UPDATE "products"   SET "public_id" = gen_random_uuid() WHERE "public_id" IS NULL`);
    await queryRunner.query(`UPDATE "users"      SET "public_id" = gen_random_uuid() WHERE "public_id" IS NULL`);

    // Ensure NOT NULL on public_id after backfill
    await queryRunner.query(`ALTER TABLE "companies"  ALTER COLUMN "public_id" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "warehouses"  ALTER COLUMN "public_id" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "products"   ALTER COLUMN "public_id" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "users"      ALTER COLUMN "public_id" SET NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ── Drop indexes ────────────────────────────────────────────
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_stock_movements_created_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_warehouses_company_active"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_users_company"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_stock_movements_product_warehouse"`);

    // ── Drop Phase 1 columns ────────────────────────────────────
    await queryRunner.query(`ALTER TABLE "product_warehouse" DROP COLUMN IF EXISTS "version"`);

    await queryRunner.query(`ALTER TABLE "users"    DROP COLUMN IF EXISTS "deleted_by"`);
    await queryRunner.query(`ALTER TABLE "users"    DROP COLUMN IF EXISTS "deleted_at"`);
    await queryRunner.query(`ALTER TABLE "users"    DROP COLUMN IF EXISTS "public_id"`);

    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "deleted_by"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "deleted_at"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "version"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "public_id"`);

    await queryRunner.query(`ALTER TABLE "warehouses" DROP COLUMN IF EXISTS "deleted_by"`);
    await queryRunner.query(`ALTER TABLE "warehouses" DROP COLUMN IF EXISTS "deleted_at"`);
    await queryRunner.query(`ALTER TABLE "warehouses" DROP COLUMN IF EXISTS "public_id"`);

    await queryRunner.query(`ALTER TABLE "companies" DROP COLUMN IF EXISTS "deleted_by"`);
    await queryRunner.query(`ALTER TABLE "companies" DROP COLUMN IF EXISTS "deleted_at"`);
    await queryRunner.query(`ALTER TABLE "companies" DROP COLUMN IF EXISTS "public_id"`);

    // ── Drop tables (reverse dependency order) ──────────────────
    await queryRunner.query(`DROP TABLE IF EXISTS "stock_movements"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "product_warehouse"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "units_of_measure"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "products"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "categories"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "warehouses"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "companies"`);

    // ── Drop enums ──────────────────────────────────────────────
    await queryRunner.query(`DROP TYPE IF EXISTS "reference_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "movement_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "user_role_enum"`);
  }
}
