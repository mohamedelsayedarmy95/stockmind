import { AuthUser } from '@/store/auth.store';
import { getDb } from '@/db/database';
import { newId, now } from '@/db/util';

/**
 * Creates (or reuses) a local offline identity in the encrypted DB. No network,
 * no token — the account lives entirely on-device. `isGuest` only tags the row;
 * data is persisted the same way either way (offline data is never discarded).
 */
export async function createLocalUser(
  name: string,
  opts: { isGuest?: boolean; companyName?: string } = {},
): Promise<AuthUser> {
  const id = newId();
  const ts = now();
  const displayName = name.trim() || (opts.isGuest ? 'Guest' : 'Me');

  await getDb().execute(
    `INSERT INTO local_users (id, name, email, is_guest, company_name, created_at, updated_at, sync_status)
     VALUES (?, ?, NULL, ?, ?, ?, ?, 'pending')`,
    [id, displayName, opts.isGuest ? 1 : 0, opts.companyName ?? null, ts, ts],
  );

  return { id, name: displayName, email: '', role: 'Owner' };
}
