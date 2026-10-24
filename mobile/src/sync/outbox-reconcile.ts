import { api } from '@/api/client';
import { httpStatusOf } from '@/domain/auth-flow';
import { lookupRefs, markForRecheck, OperationLookup, recheckCandidates } from '@/domain/outbox';
import { applyLookups, unresolvedAttempts } from '@/domain/replacement';
import { currentScopeKey } from './account-scope';
import { replaceIntents, useOutboxStore } from './outbox-store';

/**
 * Re-checks receipts against the server's current history (POST /stock/operations/lookup). Read-only: it never sends a
 * stock write, and never resends a replacement. Triggers (see startOutboxRuntime):
 * - a sync reset in a warehouse (a cursor mismatch or a changed history generation): its receipts are marked
 *   "re-checking" first, then checked;
 * - once per account per app run: every kept receipt, every replaced operation and every operation waiting for review
 *   is checked quietly (a reset may have happened in a warehouse this device did not poll, and a later restore may have
 *   brought an original back); only a discrepancy changes what is shown;
 * - any later sign of network while receipts still wait to be re-checked, or a replacement's outcome is unknown (it is
 *   asked about by ITS key).
 * Single-flight per JS runtime (shared on globalThis, like the outbox engine).
 */
interface ReconcileEngine {
  running: Promise<void> | null;
  again: boolean;
  checkedScopes: Set<string>;
}

const engine: ReconcileEngine = ((globalThis as { __stockmindReconcileEngine?: ReconcileEngine })
  .__stockmindReconcileEngine ??= { running: null, again: false, checkedScopes: new Set() });

const LOOKUP_TIMEOUT_MS = 60_000;
/** Each intent asks about up to two keys (its own and its replacement's); the server accepts 100 per call. */
const MAX_INTENTS_PER_CALL = 50;

async function runOnce(all: boolean): Promise<void> {
  const scope = currentScopeKey();
  if (!scope) return;
  const intents = useOutboxStore.getState().intents;
  const candidates = [
    ...new Map(
      [...recheckCandidates(intents, scope, { all }), ...unresolvedAttempts(intents, scope)].map((i) => [i.id, i] as const),
    ).values(),
  ].slice(0, MAX_INTENTS_PER_CALL);
  if (candidates.length === 0) {
    if (all) engine.checkedScopes.add(scope);
    return;
  }
  const refs = [...new Map(candidates.flatMap(lookupRefs).map((r) => [r.key, r] as const)).values()];
  let results: OperationLookup[];
  try {
    const { data } = await api.post<{ operations: OperationLookup[] }>(
      '/stock/operations/lookup',
      { operations: refs },
      { timeout: LOOKUP_TIMEOUT_MS },
    );
    results = data.operations;
  } catch (err) {
    const status = httpStatusOf(err);
    if (status === 404 || status === 405) {
      // A server without the lookup endpoint cannot vouch for anything: say so instead of staying "re-checking".
      results = candidates
        .filter((i) => i.verification?.state === 'pending')
        .map((i) => ({ key: i.id, status: 'indeterminate' as const, reason: 'not-supported' }));
    } else {
      return; // offline, timeout, 5xx, 401: the next trigger retries; nothing is concluded from silence
    }
  }
  if (scope !== currentScopeKey()) return; // the account changed while we waited: do not touch its receipts
  const byKey = new Map(results.map((r) => [r.key, r]));
  const now = Date.now();
  const asked = new Set(candidates.map((c) => c.id));
  replaceIntents(
    useOutboxStore.getState().intents.map((i) => (i.scope === scope && asked.has(i.id) ? applyLookups(i, byKey, now) : i)),
  );
  if (all) engine.checkedScopes.add(scope);
}

export function reconcileReceipts(opts: { all?: boolean } = {}): Promise<void> {
  if (engine.running) {
    engine.again = true;
    return engine.running;
  }
  engine.running = (async () => {
    try {
      let all = Boolean(opts.all);
      do {
        engine.again = false;
        await runOnce(all);
        all = false;
      } while (engine.again);
    } finally {
      engine.running = null;
    }
  })();
  return engine.running;
}

/** A warehouse's history was reset: its receipts are "re-checking" until the server answers. */
export function onWarehouseReset(warehouseId: string) {
  const scope = currentScopeKey();
  if (!scope) return;
  replaceIntents(markForRecheck(useOutboxStore.getState().intents, scope, warehouseId, Date.now()));
  void reconcileReceipts({ all: true });
}

/** Once per account per app run, a quiet check of every kept receipt; afterwards only pending ones. */
export function reconcileOnActivity() {
  const scope = currentScopeKey();
  if (!scope) return;
  if (!engine.checkedScopes.has(scope)) {
    void reconcileReceipts({ all: true });
    return;
  }
  const intents = useOutboxStore.getState().intents;
  if (recheckCandidates(intents, scope).length > 0 || unresolvedAttempts(intents, scope).length > 0) void reconcileReceipts();
}
