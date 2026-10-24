import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The id default is gen_random_uuid() (built into PostgreSQL 13+, like in every other migration of this project), not
 * uuid_generate_v4(): that one needs the uuid-ossp extension, which no migration creates and only the application's own
 * TypeORM connection installs on connect, so on a bare database this migration failed and rolled the whole upgrade back.
 * Databases that already ran the earlier text keep a uuid_generate_v4() default on this table; both produce random v4
 * UUIDs, TypeORM tracks migrations by name (no checksum), so nothing re-runs and nothing needs to change there.
 */
export class CreateUserFcmTokenTable1722345600000 implements MigrationInterface {
  name = 'CreateUserFcmTokenTable1722345600000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "user_fcm_tokens" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "fcmToken" character varying NOT NULL,
        "deviceType" character varying NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_fcm_tokens" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_user_fcm_tokens_userId" ON "user_fcm_tokens" ("userId")
    `);
    await queryRunner.query(`
      ALTER TABLE "user_fcm_tokens"
      ADD CONSTRAINT "FK_user_fcm_tokens_userId"
      FOREIGN KEY ("userId")
      REFERENCES "users"("id")
      ON DELETE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_fcm_tokens" DROP CONSTRAINT "FK_user_fcm_tokens_userId"
    `);
    await queryRunner.query(`
      DROP INDEX "IDX_user_fcm_tokens_userId"
    `);
    await queryRunner.query(`
      DROP TABLE "user_fcm_tokens"
    `);
  }
}
