import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Subscription-ready entitlements on the company: plan, subscription status, expiry and where the entitlement came
 * from (default, a trial grant, a store purchase verified by the backend, manual). Payment-provider state is not
 * stored here: a provider adapter verifies a purchase and then sets these columns.
 *
 * Additive with safe defaults ('free', 'active'). Limits are enforced only with ENTITLEMENTS_ENFORCED=true, and only
 * on new additions (seats, warehouses), never by removing access to existing data. down() drops the columns.
 */
export class CompanyEntitlements1792570000000 implements MigrationInterface {
  name = 'CompanyEntitlements1792570000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "companies"
        ADD COLUMN IF NOT EXISTS "plan" varchar(20) NOT NULL DEFAULT 'free'
          CONSTRAINT "chk_companies_plan" CHECK ("plan" IN ('free', 'pro', 'business', 'enterprise')),
        ADD COLUMN IF NOT EXISTS "subscription_status" varchar(20) NOT NULL DEFAULT 'active'
          CONSTRAINT "chk_companies_subscription_status"
          CHECK ("subscription_status" IN ('active', 'trialing', 'grace', 'read_only', 'canceled')),
        ADD COLUMN IF NOT EXISTS "plan_expires_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "entitlement_source" varchar(30) NOT NULL DEFAULT 'default'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "companies"
        DROP COLUMN IF EXISTS "entitlement_source",
        DROP COLUMN IF EXISTS "plan_expires_at",
        DROP COLUMN IF EXISTS "subscription_status",
        DROP COLUMN IF EXISTS "plan"
    `);
  }
}
