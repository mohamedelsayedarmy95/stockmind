import { getDb, query } from '@/db/database';
import { newId, now } from '@/db/util';

/**
 * Local, dependency-free crash/error log. Persists to the encrypted SQLite DB
 * so a crash is captured even fully offline, with no external service or
 * native SDK — deliberately simple to avoid the native build risk a
 * third-party crash SDK (e.g. Sentry) carries in this already-hand-tuned
 * bare RN project. Revisit a hosted service post-launch once there's budget
 * to work through its native Gradle integration safely.
 */
export interface CrashEntry {
  id: string;
  message: string;
  stack: string | null;
  fatal: boolean;
  createdAt: string;
}

interface CrashRow {
  id: string;
  message: string;
  stack: string | null;
  fatal: number;
  created_at: number;
}

export async function captureException(error: unknown, options: { fatal?: boolean } = {}): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? (error.stack ?? null) : null;
  try {
    await getDb().execute(
      `INSERT INTO crash_log (id, message, stack, fatal, created_at) VALUES (?, ?, ?, ?, ?)`,
      [newId(), message, stack, options.fatal ? 1 : 0, now()],
    );
  } catch {
    // The DB itself may not be up yet (e.g. a crash during bootstrap) — the
    // crash is still visible in Metro/logcat via the console.error below.
  }
  // eslint-disable-next-line no-console
  console.error('[crash]', message, stack ?? '');
}

export async function listCrashes(limit = 50): Promise<CrashEntry[]> {
  const rows = await query<CrashRow>(
    `SELECT id, message, stack, fatal, created_at FROM crash_log ORDER BY created_at DESC LIMIT ?`,
    [limit],
  );
  return rows.map((r) => ({
    id: r.id,
    message: r.message,
    stack: r.stack,
    fatal: r.fatal === 1,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

/**
 * Hook the RN global error handler so crashes happening OUTSIDE a React
 * render (e.g. inside an async callback) are captured too, not just the
 * ones ErrorBoundary sees. Call once at app startup.
 */
export function installGlobalCrashHandler(): void {
  const g = global as unknown as {
    ErrorUtils?: { setGlobalHandler: (fn: (e: Error, isFatal?: boolean) => void) => void; getGlobalHandler: () => (e: Error, isFatal?: boolean) => void };
  };
  const errorUtils = g.ErrorUtils;
  if (!errorUtils) return;

  const previousHandler = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error, isFatal) => {
    void captureException(error, { fatal: Boolean(isFatal) });
    previousHandler(error, isFatal);
  });
}
