import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 4 — SAML SSO
 *
 * Creates the `user_sso_links` table that ties an IdP nameID to a local user.
 * Fully reversible: `down()` drops the table cleanly.
 * Safe to run against an existing database with no SAML users (no data loss).
 */
export class SamlSso1722000000000 implements MigrationInterface {
  name = 'SamlSso1722000000000';

  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE IF NOT EXISTS user_sso_links (
        id               UUID         NOT NULL DEFAULT gen_random_uuid(),
        user_id          UUID         NOT NULL,
        provider         VARCHAR(50)  NOT NULL,
        provider_user_id VARCHAR(500) NOT NULL,
        provider_email   VARCHAR(255),
        display_name     VARCHAR(255),
        created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
        updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),

        CONSTRAINT pk_user_sso_links PRIMARY KEY (id),
        CONSTRAINT fk_usl_user      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT uq_usl_provider  UNIQUE (provider, provider_user_id)
      )
    `);

    await qr.query(
      `CREATE INDEX IF NOT EXISTS idx_usl_user_id ON user_sso_links (user_id)`,
    );
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS user_sso_links`);
  }
}
