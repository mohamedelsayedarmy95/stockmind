import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TOTP replay protection: the time-step of the last accepted code per user. Nullable without a default, so the
 * column is added without rewriting the table and existing factors keep working (their next valid code is accepted
 * and recorded). Code that predates this column ignores it, so a rollback of the application needs no schema change.
 */
export class TotpLastAcceptedStep1792473600000 implements MigrationInterface {
  name = 'TotpLastAcceptedStep1792473600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user_two_factor" ADD COLUMN IF NOT EXISTS "last_totp_step" bigint`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user_two_factor" DROP COLUMN IF EXISTS "last_totp_step"`);
  }
}
