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
  | 'too-old' // never sent and older than MAX_UNSENT_AGE_MS
  | 'history-changed' // once confirmed, but the server's current history no longer holds it (restore)
  | 'history-mismatch'; // the server's record under this key is not what was sent

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
  /** The server's receipt. For a NEEDS_REVIEW 'history-changed' intent it is the LAST KNOWN receipt, kept as evidence. */
  result: IntentResult | null;
  /**
   * What the client currently knows about a CONFIRMED receipt, separate from stock truth. Absent: never questioned.
   * 'pending': the server's history was reset and the receipt has not been re-checked yet; 'verified': the current
   * ledger holds it; 'unverifiable': the server could not say (no access, partial record, old server).
   */
  verification?: IntentVerification | null;
}

export interface IntentVerification {
  state: 'pending' | 'verified' | 'unverifiable';
  at: number;
  reason?: string;
}

/** A never-sent intent older than this is held for review instead of being posted days later. */
export const MAX_UNSENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_CAP_MS = 5 * 60_000;
/** Confirmed receipts are kept this long, so a later history reset can still be reconciled against them. */
const CONFIRMED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
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
      // After a history reset the receipt's revision may name another movement: only a re-checked one counts.
      (!i.verification || i.verification.state === 'verified') &&
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

/**
 * Drops confirmed intents after the retention period (and the oldest confirmed ones past MAX_KEPT). Nothing
 * unresolved is dropped, nor a receipt waiting to be re-checked.
 */
export function prune(intents: readonly StockIntent[], now: number): StockIntent[] {
  const settled = (i: StockIntent) => i.state === 'CONFIRMED' && i.verification?.state !== 'pending';
  const kept = intents.filter((i) => !(settled(i) && i.result && now - i.result.at > CONFIRMED_RETENTION_MS));
  const excess = kept.length - MAX_KEPT;
  if (excess <= 0) return kept;
  const dropIds = new Set(
    kept
      .filter(settled)
      .sort((a, b) => a.seq - b.seq)
      .slice(0, excess)
      .map((i) => i.id),
  );
  return kept.filter((i) => !dropIds.has(i.id));
}

// ── Reconciliation after a history reset ─────────────────────────────────────────────────────────────────────────
//
// A receipt says "the server committed this". A database restore can erase that commit (and its key record) and
// reuse its revision number, so after a reset a receipt is evidence of the PAST, not of the current ledger. Receipts
// are re-checked with POST /stock/operations/lookup:
// - present and matching → verified (its current revision replaces the old one);
// - absent → NEEDS_REVIEW 'history-changed'. Never PENDING: re-sending would apply it again as a NEW movement while
//   nobody can tell whether the loss was intended (e.g. a deliberate rollback). A person decides (re-enter or not);
// - present but different, or a server-side mismatch → NEEDS_REVIEW 'history-mismatch';
// - indeterminate / unavailable → 'unverifiable', shown as such, never as plainly confirmed.

/** The server's answer for one operation (see OperationLookupService on the backend). */
export interface OperationLookup {
  key: string;
  status: 'present' | 'absent' | 'indeterminate' | 'unavailable';
  reason?: string;
  movement?: {
    id: string;
    warehouseId: string;
    productId: string;
    movementType: string;
    quantityChange: string;
    revision: string | null;
  };
}

/** A reset in one warehouse (or everywhere, warehouseId null) puts that account's receipts back to "re-checking". */
export function markForRecheck(
  intents: readonly StockIntent[],
  scope: string,
  warehouseId: string | null,
  now: number,
): StockIntent[] {
  return intents.map((i) =>
    i.scope === scope && i.state === 'CONFIRMED' && i.result && (warehouseId === null || i.payload.warehouseId === warehouseId)
      ? { ...i, verification: { state: 'pending' as const, at: now } }
      : i,
  );
}

/** Receipts to re-check: those marked pending, or (all=true, at session start) every receipt still kept. */
export function recheckCandidates(
  intents: readonly StockIntent[],
  scope: string,
  opts: { all?: boolean; limit?: number } = {},
): StockIntent[] {
  return intents
    .filter(
      (i) =>
        i.scope === scope &&
        i.state === 'CONFIRMED' &&
        i.result !== null &&
        (opts.all || i.verification?.state === 'pending'),
    )
    .sort((a, b) => b.seq - a.seq)
    .slice(0, opts.limit ?? 100);
}

const MOVEMENT_TYPE: Record<IntentKind, string> = { inbound: 'INBOUND', outbound: 'OUTBOUND' };

function sameOperation(intent: StockIntent, m: NonNullable<OperationLookup['movement']>): boolean {
  if (intent.result?.movementId && intent.result.movementId !== m.id) return false;
  return (
    m.warehouseId === intent.payload.warehouseId &&
    m.productId === intent.payload.productId &&
    m.movementType === MOVEMENT_TYPE[intent.kind] &&
    Math.abs(Number(m.quantityChange)) === Number(intent.payload.quantity)
  );
}

/** Applies the server's answer to a CONFIRMED receipt. Anything else is returned unchanged. */
export function applyLookup(intent: StockIntent, lookup: OperationLookup, now: number): StockIntent {
  if (intent.state !== 'CONFIRMED' || lookup.key !== intent.id) return intent;
  const review = (reason: 'history-changed' | 'history-mismatch'): StockIntent => ({
    ...intent,
    state: 'NEEDS_REVIEW',
    lastError: { status: null, reason, at: now },
    verification: null,
  });
  switch (lookup.status) {
    case 'present':
      if (!lookup.movement || !sameOperation(intent, lookup.movement)) return review('history-mismatch');
      return {
        ...intent,
        verification: { state: 'verified', at: now },
        result: intent.result ? { ...intent.result, revision: lookup.movement.revision } : intent.result,
      };
    case 'absent':
      return review('history-changed');
    default:
      return { ...intent, verification: { state: 'unverifiable', at: now, reason: lookup.reason ?? lookup.status } };
  }
}

export type ReceiptDisplay = 'confirmed' | 'rechecking' | 'unverifiable';

/** How a CONFIRMED receipt may be described: never plainly "confirmed" while the server's history is in question. */
export function receiptDisplay(intent: StockIntent): ReceiptDisplay {
  if (intent.verification?.state === 'pending') return 'rechecking';
  if (intent.verification?.state === 'unverifiable') return 'unverifiable';
  return 'confirmed';
}

/**
 * The only way back for a receipt the server's history lost: a person re-enters it as a NEW action (new key), with
 * a note naming the original, so the ledger shows a deliberate re-entry and never a silent replay.
 */
export function reentryDraft(intent: StockIntent): { kind: IntentKind; payload: IntentPayload } | null {
  if (intent.state !== 'NEEDS_REVIEW' || intent.lastError?.reason !== 'history-changed') return null;
  return {
    kind: intent.kind,
    payload: {
      productId: intent.payload.productId,
      warehouseId: intent.payload.warehouseId,
      quantity: intent.payload.quantity,
      notes: `Re-entry of action ${intent.id.slice(0, 8)} (missing from server history after a reset)`,
    },
  };
}
