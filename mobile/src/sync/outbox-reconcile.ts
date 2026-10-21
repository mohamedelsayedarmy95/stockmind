import { api } from '@/api/client';
import { httpStatusOf } from '@/domain/auth-flow';
import { applyLookup, markForRecheck, OperationLookup, recheckCandidates } from '@/domain/outbox';
import { currentScopeKey } from './account-scope';
import { replaceIntents, useOutboxStore } from './outbox-store';

/**
 * Re-checks CONFIRMED receipts against the server's current history (POST /stock/operations/lookup). Read-only: it
 * never sends a stock write. Triggers (see startOutboxRuntime):
 * - a sync reset in a warehouse: its receipts are marked "re-checking" first, then checked;
 * - once per account per app run: every kept receipt is checked quietly (a reset may have happened in a warehouse
 *   this device did not poll); only a discrepancy changes what is shown;
 * - any later sign of network while receipts still wait to be re-checked.
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

async function runOnce(all: boolean): Promise<void> {
  const scope = currentScopeKey();
  if (!scope) return;
  const candidates = recheckCandidates(useOutboxStore.getState().intents, scope, { all });
  if (candidates.length === 0) {
    if (all) engine.checkedScopes.add(scope);
    return;
  }
  let results: OperationLookup[];
  try {
    const { data } = await api.post<{ operations: OperationLookup[] }>(
      '/stock/operations/lookup',
      { operations: candidates.map((i) => (i.result?.movementId ? { key: i.id, movementId: i.result.movementId } : { key: i.id })) },
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
  replaceIntents(
    useOutboxStore.getState().intents.map((i) => {
      const r = i.scope === scope ? byKey.get(i.id) : undefined;
      return r ? applyLookup(i, r, now) : i;
    }),
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
  void reconcileReceipts();
}

/** Once per account per app run, a quiet check of every kept receipt; afterwards only pending ones. */
export function reconcileOnActivity() {
  const scope = currentScopeKey();
  if (!scope) return;
  if (!engine.checkedScopes.has(scope)) {
    void reconcileReceipts({ all: true });
    return;
  }
  if (recheckCandidates(useOutboxStore.getState().intents, scope).length > 0) void reconcileReceipts();
}
