import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUserFcmTokenTable1722345600000 implements MigrationInterface {
  name = 'CreateUserFcmTokenTable1722345600000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "user_fcm_tokens" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
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
