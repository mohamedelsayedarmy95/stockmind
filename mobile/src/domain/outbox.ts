/**
 * Offline stock intents: what a user asked for while the server could not confirm it yet.
 *
 * An intent is NOT a movement. The server alone commits stock (its transaction checks access, balance and the
 * idempotency key); until it answers, the intent is shown as pending, apart from the confirmed figures, and never
 * changes them. Policy:
 * - only single-warehouse receipts and dispatches may wait for the network; transfers and adjustments stay
 *   online-only (they touch two balances or need a reviewed count);
 * - the intent's id IS its Idempotency-Key and its payload never changes, so every retry - after a timeout, a crash
 *   or a relaunch - is the same request, and the server applies it at most once;
 * - intents of one account are sent one at a time, in creation order (a receipt queued before a dispatch is sent
 *   first); a transient failure stops the queue and retries later with exponential backoff and jitter;
 * - a refusal is final for that intent and shown to the user, who may retry it unchanged (only when the refusal
 *   proves nothing was recorded) or discard it; nothing is ever re-sent with a changed payload under the same key.
 */
import { IDEMPOTENCY_KEY_PATTERN } from './idempotent-write';

export type IntentKind = 'inbound' | 'outbound';

/** Writes that may wait for the network. Anything else must be done online. */
export const QUEUEABLE_KINDS: readonly IntentKind[] = ['inbound', 'outbound'];

export type IntentState = 'PENDING' | 'SENDING' | 'CONFIRMED' | 'REJECTED' | 'NEEDS_REVIEW';

export type IntentReason =
  | 'network' // no answer: offline, timeout, connection dropped
  | 'server' // 5xx: the server failed or a proxy gave up
  | 'busy' // 429: try later
  | 'auth' // 401: signed out or session expired; waits for the same account to sign in
  | 'insufficient-stock' // 409
  | 'no-access' // 403/404: warehouse or product no longer accessible
  | 'invalid' // 400 and other 4xx
  | 'key-reused' // 422: should never happen with immutable payloads
  | 'plan-limit' // 402: entitlement
  | 'too-old'; // never sent and older than MAX_UNSENT_AGE_MS

export interface IntentPayload {
  productId: string;
  warehouseId: string;
  /** Positive decimal string, as the API expects. */
  quantity: string;
  notes?: string;
}

export interface IntentResult {
  movementId: string;
  /** Warehouse revision of the movement: once the synced cursor reaches it, the confirmed figures include it. */
  revision: string | null;
  runningBalance: string | null;
  replayed: boolean;
  at: number;
}

export interface StockIntent {
  v: 1;
  /** Also the Idempotency-Key. */
  id: string;
  /** Account scope key (server | company | user); see session-scope. */
  scope: string;
  /** Creation order within the scope. */
  seq: number;
  kind: IntentKind;
  payload: IntentPayload;
  createdAt: number;
  state: IntentState;
  attempts: number;
  /** An attempt ended without a definite answer: the server may already have recorded it. */
  maybeCommitted: boolean;
  nextAttemptAt: number;
  lastError: { status: number | null; reason: IntentReason; at: number } | null;
  result: IntentResult | null;
}

/** A never-sent intent older than this is held for review instead of being posted days later. */
export const MAX_UNSENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_CAP_MS = 5 * 60_000;
/** Confirmed intents are kept this long for the review list, then pruned. */
const CONFIRMED_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_KEPT = 500;

export class IntentError extends Error {
  constructor(public readonly code: 'NOT_QUEUEABLE' | 'INVALID_QUANTITY' | 'INVALID_KEY') {
    super(code);
    this.name = 'IntentError';
  }
}

export function createIntent(args: {
  id: string;
  scope: string;
  seq: number;
  kind: string;
  payload: IntentPayload;
  now: number;
}): StockIntent {
  if (!(QUEUEABLE_KINDS as readonly string[]).includes(args.kind)) throw new IntentError('NOT_QUEUEABLE');
  if (!IDEMPOTENCY_KEY_PATTERN.test(args.id)) throw new IntentError('INVALID_KEY');
  if (!/^\d+(\.\d{1,6})?$/.test(args.payload.quantity) || Number(args.payload.quantity) <= 0) {
    throw new IntentError('INVALID_QUANTITY');
  }
  const payload: IntentPayload = {
    productId: args.payload.productId,
    warehouseId: args.payload.warehouseId,
    quantity: args.payload.quantity,
    ...(args.payload.notes ? { notes: args.payload.notes } : {}),
  };
  return {
    v: 1,
    id: args.id,
    scope: args.scope,
    seq: args.seq,
    kind: args.kind as IntentKind,
    payload,
    createdAt: args.now,
    state: 'PENDING',
    attempts: 0,
    maybeCommitted: false,
    nextAttemptAt: args.now,
    lastError: null,
    result: null,
  };
}

/** Full-jitter exponential backoff, capped: 2 s, 4 s, 8 s … 5 min, each scaled by 0.5–1.0. */
export function backoffMs(attempt: number, random: () => number): number {
  const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1));
  return Math.round(ceiling * (0.5 + random() / 2));
}

export function markSending(intent: StockIntent): StockIntent {
  return { ...intent, state: 'SENDING', attempts: intent.attempts + 1 };
}

export type SendOutcome = { ok: true; body: unknown } | { ok: false; status: number | undefined };

function resultOf(body: unknown, now: number): IntentResult {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : null);
  return {
    movementId: str(b.id) ?? '',
    revision: str(b.revision),
    runningBalance: str(b.runningBalance),
    replayed: b.replayed === true,
    at: now,
  };
}

/** What one send outcome does to the intent that was sent. */
export function settle(
  intent: StockIntent,
  outcome: SendOutcome,
  now: number,
  random: () => number = Math.random,
): StockIntent {
  if (outcome.ok) {
    return { ...intent, state: 'CONFIRMED', lastError: null, result: resultOf(outcome.body, now) };
  }
  const status = outcome.status;
  const fail = (reason: IntentReason) => ({ status: status ?? null, reason, at: now });
  const retryLater = (reason: IntentReason, maybeCommitted: boolean): StockIntent => ({
    ...intent,
    state: 'PENDING',
    maybeCommitted: intent.maybeCommitted || maybeCommitted,
    nextAttemptAt: now + backoffMs(intent.attempts, random),
    lastError: fail(reason),
  });
  const final = (state: 'REJECTED' | 'NEEDS_REVIEW', reason: IntentReason): StockIntent => ({
    ...intent,
    state,
    lastError: fail(reason),
  });

  if (status === undefined || status === 408) return retryLater('network', true);
  if (status === 429) return retryLater('busy', false);
  if (status >= 500) return retryLater('server', true);
  // The guard refused before anything ran; due again as soon as the same account has a session.
  if (status === 401) return { ...intent, state: 'PENDING', nextAttemptAt: now, lastError: fail('auth') };
  // The key claim is rolled back with the refused write: this key recorded nothing.
  if (status === 409) return final('REJECTED', 'insufficient-stock');
  if (status === 402) return final('REJECTED', 'plan-limit');
  if (status === 422) return final('NEEDS_REVIEW', 'key-reused');
  // Access removed: if an earlier attempt may have landed, we cannot know whether it did.
  if (status === 403 || status === 404) return final(intent.maybeCommitted ? 'NEEDS_REVIEW' : 'REJECTED', 'no-access');
  return final('REJECTED', 'invalid');
}

/** The next intent to send for this account, or how long to wait, or null when nothing is waiting. */
export function nextToSend(
  intents: readonly StockIntent[],
  scope: string,
  now: number,
): { intent: StockIntent } | { waitMs: number } | null {
  const queue = intents
    .filter((i) => i.scope === scope && (i.state === 'PENDING' || i.state === 'SENDING'))
    .sort((a, b) => a.seq - b.seq);
  const head = queue[0];
  if (!head) return null;
  // Strict order: a head waiting for its backoff holds the rest (a dispatch may depend on an earlier receipt).
  if (head.nextAttemptAt > now) return { waitMs: head.nextAttemptAt - now };
  return { intent: head };
}

/** Never-sent intents past MAX_UNSENT_AGE_MS are held for review. Possibly-recorded ones are still resolved. */
export function expireStale(intents: readonly StockIntent[], now: number): StockIntent[] {
  return intents.map((i) =>
    i.state === 'PENDING' && i.attempts === 0 && !i.maybeCommitted && now - i.createdAt > MAX_UNSENT_AGE_MS
      ? { ...i, state: 'NEEDS_REVIEW' as const, lastError: { status: null, reason: 'too-old' as const, at: now } }
      : i,
  );
}

export interface PendingEffect {
  /** Signed quantity of intents not confirmed yet. */
  pending: number;
  /** Signed quantity confirmed by the server but not yet in the synced figures. */
  awaitingSync: number;
  count: number;
}

const signed = (i: StockIntent) => (i.kind === 'outbound' ? -1 : 1) * Number(i.payload.quantity);

/**
 * Per product, what this account's intents would change in one warehouse - shown next to, never added into, the
 * confirmed server figures. A confirmed intent stops counting once the synced revision includes its movement, so it
 * is never counted twice.
 */
export function pendingEffects(
  intents: readonly StockIntent[],
  scope: string,
  warehouseId: string,
  syncedRevision: string | null,
): Record<string, PendingEffect> {
  const out: Record<string, PendingEffect> = {};
  const add = (productId: string, key: 'pending' | 'awaitingSync', qty: number) => {
    const e = (out[productId] ??= { pending: 0, awaitingSync: 0, count: 0 });
    e[key] += qty;
    e.count += 1;
  };
  for (const i of intents) {
    if (i.scope !== scope || i.payload.warehouseId !== warehouseId) continue;
    if (i.state === 'PENDING' || i.state === 'SENDING') add(i.payload.productId, 'pending', signed(i));
    else if (
      i.state === 'CONFIRMED' &&
      i.result?.revision &&
      (syncedRevision === null || BigInt(i.result.revision) > BigInt(syncedRevision))
    ) {
      add(i.payload.productId, 'awaitingSync', signed(i));
    }
  }
  return out;
}

/** Discarding is safe only when the intent cannot have been recorded, or its outcome is already known. */
export function canDiscard(intent: StockIntent): boolean {
  if (intent.state === 'REJECTED' || intent.state === 'NEEDS_REVIEW' || intent.state === 'CONFIRMED') return true;
  return intent.state === 'PENDING' && intent.attempts === 0 && !intent.maybeCommitted;
}

/**
 * "Retry now", unchanged. Allowed for a pending intent (skips the backoff) and for a refusal that proves nothing was
 * recorded under the key and may pass later (insufficient stock: someone may have received stock since).
 */
export function retryNow(intent: StockIntent, now: number): StockIntent | null {
  if (intent.state === 'PENDING') return { ...intent, nextAttemptAt: now };
  if (intent.state === 'REJECTED' && intent.lastError?.reason === 'insufficient-stock') {
    return { ...intent, state: 'PENDING', nextAttemptAt: now };
  }
  return null;
}

/**
 * Backoff paces automatic retries only. A sign that the network is back (the user acts, the app returns to the
 * foreground, a poll succeeds) makes this account's waiting intents due now; the queue order is unchanged.
 */
export function wake(intents: readonly StockIntent[], scope: string, now: number): StockIntent[] {
  return intents.map((i) =>
    i.scope === scope && i.state === 'PENDING' && i.nextAttemptAt > now ? { ...i, nextAttemptAt: now } : i,
  );
}

/** An interrupted send (app killed while SENDING) is resent with the same key: the server replays or applies it. */
export function recoverInterrupted(intents: readonly StockIntent[]): StockIntent[] {
  return intents.map((i) => (i.state === 'SENDING' ? { ...i, state: 'PENDING' as const, maybeCommitted: true } : i));
}

/** Drops confirmed intents after a day (and the oldest confirmed ones past MAX_KEPT). Nothing unresolved is dropped. */
export function prune(intents: readonly StockIntent[], now: number): StockIntent[] {
  const kept = intents.filter((i) => !(i.state === 'CONFIRMED' && i.result && now - i.result.at > CONFIRMED_RETENTION_MS));
  const excess = kept.length - MAX_KEPT;
  if (excess <= 0) return kept;
  const dropIds = new Set(
    kept
      .filter((i) => i.state === 'CONFIRMED')
      .sort((a, b) => a.seq - b.seq)
      .slice(0, excess)
      .map((i) => i.id),
  );
  return kept.filter((i) => !dropIds.has(i.id));
}
