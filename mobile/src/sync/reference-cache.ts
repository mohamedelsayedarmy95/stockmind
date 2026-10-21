import { getStorage } from '@/store/secure-storage';
import { httpStatusOf } from '@/domain/auth-flow';
import { currentScopeKey } from './account-scope';

/**
 * Last server copy of an account's reference lists (warehouses it may see, product names), so the app can still
 * navigate to its cached stock and queued actions after a relaunch without network. Used only when NO answer came
 * back; any server answer (including 401/403/404) wins, so a revoked warehouse is never resurrected from the cache.
 * Scoped per account, in the encrypted store, and deleted on sign-out.
 */
type Kind = 'warehouses' | 'products';
const PREFIX = 'stockmind-ref-v1|';

export async function withReferenceFallback<T>(kind: Kind, fetch: () => Promise<T[]>): Promise<T[]> {
  const scope = currentScopeKey();
  try {
    const list = await fetch();
    if (scope && scope === currentScopeKey()) getStorage().set(`${PREFIX}${scope}|${kind}`, JSON.stringify(list));
    return list;
  } catch (err) {
    if (scope && httpStatusOf(err) === undefined) {
      const raw = getStorage().getString(`${PREFIX}${scope}|${kind}`);
      if (raw) {
        try {
          return JSON.parse(raw) as T[];
        } catch {
          // unreadable cache: fall through to the original error
        }
      }
    }
    throw err;
  }
}

export function forgetReferences(scope: string | null) {
  if (!scope) return;
  for (const kind of ['warehouses', 'products'] as Kind[]) getStorage().delete(`${PREFIX}${scope}|${kind}`);
}
