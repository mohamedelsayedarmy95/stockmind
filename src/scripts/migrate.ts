import 'reflect-metadata';
import dataSource from '../config/data-source';

/**
 * Standalone migration runner for production.
 *
 * Runs the COMPILED migrations (dist/migrations/*.js) via the shared DataSource
 * — no ts-node or the TypeORM CLI, which are devDependencies stripped from the
 * production image. Wired as the Render Pre-Deploy Command
 * (`node dist/scripts/migrate.js`) so the schema is always current before the
 * new release serves traffic. This is a belt-and-suspenders layer on top of the
 * app's `migrationsRun: true`; runMigrations() is idempotent (already-applied
 * migrations are skipped via the migrations table), so running both is safe.
 */
async function run(): Promise<void> {
  await dataSource.initialize();
  try {
    const applied = await dataSource.runMigrations();
    if (applied.length === 0) {
      console.log('[migrate] schema is up to date — nothing to run');
    } else {
      console.log(
        `[migrate] applied ${applied.length} migration(s): ${applied
          .map((m) => m.name)
          .join(', ')}`,
      );
    }
  } finally {
    await dataSource.destroy();
  }
}

run().catch((err) => {
  console.error('[migrate] migration run failed:', err);
  process.exit(1);
});
