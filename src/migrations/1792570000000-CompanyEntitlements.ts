import { MigrationInterface, QueryRunner } from 'typeorm';
import { refuseIfDataWouldBeLost } from '../shared/db/migration-guards';

/**
 * Subscription-ready entitlements on the company: plan, subscription status, expiry and where the entitlement came
 * from (default, a trial grant, a store purchase verified by the backend, manual). Payment-provider state is not
 * stored here: a provider adapter verifies a purchase and then sets these columns.
 *
 * Additive with safe defaults ('free', 'active'). Limits are enforced only with ENTITLEMENTS_ENFORCED=true, and only
 * on new additions (seats, warehouses), never by removing access to existing data.
 *
 * down() drops the columns, which is lossless only while every company still has the defaults this migration wrote. Once a
 * plan, status, expiry or source has been set (a trial grant, a purchase), that cannot be rebuilt, so down() refuses,
 * before it changes anything, if any company differs from the defaults.
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
    await refuseIfDataWouldBeLost(queryRunner, this.name, [
      {
        label: 'company entitlement record(s) with a non-default plan, status, expiry or source',
        sql: `SELECT count(*)::int AS n FROM "companies"
               WHERE "plan" <> 'free' OR "subscription_status" <> 'active'
                  OR "plan_expires_at" IS NOT NULL OR "entitlement_source" <> 'default'`,
      },
    ]);
    await queryRunner.query(`
      ALTER TABLE "companies"
        DROP COLUMN IF EXISTS "entitlement_source",
        DROP COLUMN IF EXISTS "plan_expires_at",
        DROP COLUMN IF EXISTS "subscription_status",
        DROP COLUMN IF EXISTS "plan"
    `);
  }
}
