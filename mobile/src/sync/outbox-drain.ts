import { AppState } from 'react-native';
import { api } from '@/api/client';
import { httpStatusOf } from '@/domain/auth-flow';
import { IntentKind, IntentPayload, markSending, nextToSend, SendOutcome, settle, StockIntent, wake } from '@/domain/outbox';
import { useAuthStore } from '@/store/auth.store';
import { currentScopeKey } from './account-scope';
import { enqueueIntent, getIntent, replaceIntents, updateIntent, useOutboxStore } from './outbox-store';
import { onOwnWriteRejected, onOwnWriteSucceeded, onPollSucceeded, resetWarehouseSync } from './warehouse-sync';

/**
 * Sends the signed-in account's queued intents to the server: one at a time, oldest first, each with its own id as
 * the Idempotency-Key and its stored payload unchanged. Single-flight; a request made while a pass runs gets one more
 * pass. A transient failure stops the pass and arms ONE timer for the backoff; nothing loops on its own.
 */
const SEND_TIMEOUT_MS = 20_000;

interface Engine {
  running: Promise<void> | null;
  again: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  started: boolean;
}

/**
 * One engine per JS runtime, even if this module is evaluated again (development Fast Refresh re-runs modules while
 * listeners registered by the earlier copy stay alive): every copy shares this state, so they coalesce instead of
 * sending in parallel. Seen on the device as a duplicate POST of one key, which the server collapsed to one movement.
 */
const engine: Engine = ((globalThis as { __stockmindOutboxEngine?: Engine }).__stockmindOutboxEngine ??= {
  running: null,
  again: false,
  timer: null,
  started: false,
});

function arm(waitMs: number) {
  if (engine.timer) clearTimeout(engine.timer);
  engine.timer = setTimeout(() => {
    engine.timer = null;
    void drainOutbox();
  }, Math.max(250, waitMs));
}

async function sendOne(intent: StockIntent): Promise<StockIntent> {
  // On disk as SENDING before the request leaves: a kill now resumes as "possibly recorded", same key.
  const sending = updateIntent(intent.id, markSending) ?? intent;
  let outcome: SendOutcome;
  try {
    const { data } = await api.post(`/stock/${sending.kind}`, sending.payload, {
      headers: { 'Idempotency-Key': sending.id },
      timeout: SEND_TIMEOUT_MS,
    });
    outcome = { ok: true, body: data };
  } catch (err) {
    outcome = { ok: false, status: httpStatusOf(err) };
  }
  return updateIntent(sending.id, (current) => settle(current, outcome, Date.now())) ?? sending;
}

async function runPass(): Promise<void> {
  for (;;) {
    const scope = currentScopeKey();
    if (!scope) return; // no online session: intents wait for their own account
    const next = nextToSend(useOutboxStore.getState().intents, scope, Date.now());
    if (!next) return;
    if ('waitMs' in next) {
      arm(next.waitMs);
      return;
    }
    const settled = await sendOne(next.intent);
    const warehouseId = settled.payload.warehouseId;
    if (settled.state === 'CONFIRMED') onOwnWriteSucceeded(warehouseId);
    else if (settled.state === 'REJECTED' && settled.lastError?.reason === 'insufficient-stock') {
      onOwnWriteRejected(warehouseId, 'insufficient-stock');
    } else if (settled.state === 'PENDING') {
      // Keep the order: nothing behind it goes first. 'auth' waits for a session; the rest for the backoff.
      if (settled.lastError?.reason !== 'auth') arm(settled.nextAttemptAt - Date.now());
      return;
    }
  }
}

export function drainOutbox(): Promise<void> {
  if (engine.running) {
    engine.again = true;
    return engine.running;
  }
  engine.running = (async () => {
    try {
      do {
        engine.again = false;
        await runPass();
      } while (engine.again);
    } finally {
      engine.running = null;
    }
  })();
  return engine.running;
}

/** The network seems back: due now, then drain. */
export function wakeOutbox(): Promise<void> {
  const scope = currentScopeKey();
  if (!scope) return Promise.resolve();
  const { intents } = useOutboxStore.getState();
  const woken = wake(intents, scope, Date.now());
  if (woken.some((i, k) => i !== intents[k])) replaceIntents(woken);
  return drainOutbox();
}

/**
 * Queues a receipt or dispatch for the signed-in account and tries to send it (and anything queued before it) now.
 * Resolves with the intent as it stands after that attempt: CONFIRMED, PENDING (saved, waiting for the network),
 * REJECTED or NEEDS_REVIEW. Calling it again with the same id never queues a second intent.
 */
export async function submitIntent(args: { id: string; kind: IntentKind; payload: IntentPayload }): Promise<StockIntent> {
  const scope = currentScopeKey();
  if (!scope) throw new Error('NO_ONLINE_SESSION');
  enqueueIntent({ ...args, scope });
  await wakeOutbox();
  return getIntent(args.id) as StockIntent;
}

/**
 * Once at startup (after the stores rehydrate): drain on foreground, after any successful poll (the network works),
 * and whenever the signed-in account changes. Switching accounts also drops the in-memory figures of the previous one.
 */
export function startOutboxRuntime() {
  if (engine.started) return;
  engine.started = true;
  let scope = currentScopeKey();
  AppState.addEventListener('change', (state) => {
    if (state === 'active') void wakeOutbox();
  });
  onPollSucceeded(() => void wakeOutbox());
  useAuthStore.subscribe(() => {
    const next = currentScopeKey();
    if (next === scope) return;
    scope = next;
    resetWarehouseSync();
    if (next) void wakeOutbox();
  });
  if (scope) void wakeOutbox();
}
