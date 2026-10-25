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

/**
 * REPLACED (Series 07): the server's history lost this operation and a person replaced it through the server-checked
 * replacement flow (see replacement.ts). The original receipt stays as provenance; the replacement is its own movement.
 */
export type IntentState = 'PENDING' | 'SENDING' | 'CONFIRMED' | 'REJECTED' | 'NEEDS_REVIEW' | 'REPLACED';

export type IntentReason =
  | 'network' // no answer: offline, timeout, connection dropped
  | 'server' // 5xx: the server failed or a proxy gave up
  | 'busy' // 429: try later
  | 'auth' // 401: signed out or session expired; waits for the same account to sign in
  | 'access-revoked' // 401 ACCESS_REVOKED (Series 09): the member was suspended/removed or sessions were revoked; a person decides
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
  /** The history generation the server issued this receipt in (absent from servers older than Series 07). */
  generation?: string | null;
}

/**
 * A person's decision to replace a lost operation, kept on the lost intent. The key is created once, written to disk
 * BEFORE the request leaves, and reused for every retry of this same decision (after a timeout, a dropped response,
 * an app kill): a new key would be a second replacement. It is discarded only when the server's answer proves that
 * nothing was recorded under it.
 * - READY: on disk, not sent (or refused before running: sign-in needed, rate limit);
 * - SENDING: the request is in flight;
 * - UNKNOWN: it ended without a definite answer; the server may have recorded it;
 * - CONFIRMED: the server recorded it (`result` is the replacement movement's receipt).
 */
export type ReplacementState = 'READY' | 'SENDING' | 'UNKNOWN' | 'CONFIRMED';

export interface ReplacementAttempt {
  /** The replacement's own Idempotency-Key. */
  key: string;
  /** The history generation the person reviewed; the server refuses the request if it is no longer current. */
  expectedGeneration: string;
  createdAt: number;
  attempts: number;
  state: ReplacementState;
  lastError: { status: number | null; code: string | null; at: number } | null;
  result: IntentResult | null;
}

export type ReplacementBlockCode =
  | 'stale-generation' | 'original-present' | 'original-indeterminate' | 'original-unavailable'
  | 'already-replaced' | 'insufficient-stock' | 'in-progress' | 'no-access' | 'invalid' | 'key-reused';

/** The last refusal of a replacement: proof that nothing was recorded, shown to the person on the review screen. */
export interface ReplacementBlock {
  code: ReplacementBlockCode;
  at: number;
  details?: Record<string, unknown>;
}

/** Evidence, from the server, that a replaced operation is no longer in a clean state (see applyReplacedLookups). */
export type ReplacedRisk = 'duplicate-risk' | 'replacement-missing';

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
  /** Series 07: the person's replacement of this lost operation (NEEDS_REVIEW history-changed → REPLACED). */
  replacement?: ReplacementAttempt | null;
  /** Why the last replacement attempt was refused (nothing recorded). Cleared when a new attempt starts. */
  replacementBlock?: ReplacementBlock | null;
  /** Set on REPLACED intents when the server's evidence shows the original and replacement are not consistent. */
  replacedRisk?: ReplacedRisk | null;
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

export type SendOutcome = { ok: true; body: unknown } | { ok: false; status: number | undefined; code?: string };

export function resultOf(body: unknown, now: number): IntentResult {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : null);
  return {
    movementId: str(b.id) ?? '',
    revision: str(b.revision),
    runningBalance: str(b.runningBalance),
    replayed: b.replayed === true,
    at: now,
    ...(str(b.historyGeneration) ? { generation: str(b.historyGeneration) } : {}),
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
  // Series 09: the member's access was revoked. Unlike an expired session this must NEVER be retried automatically: after a
  // reactivation, replaying what was queued before the suspension would be the server acting on stale decisions. The intent
  // is held for a person (retry unchanged, or discard). If an earlier attempt may have landed, only a review can say.
  if (status === 401 && outcome.code === 'ACCESS_REVOKED') {
    return final(intent.maybeCommitted ? 'NEEDS_REVIEW' : 'REJECTED', 'access-revoked');
  }
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

/**
 * The server said this account's access is revoked: everything still waiting for it is held for a person, with no further
 * network attempt (each would be refused the same way, and none may be replayed on its own after a reactivation).
 */
export function holdQueueAfterRevocation(intents: readonly StockIntent[], scope: string, now: number): StockIntent[] {
  return intents.map((i) =>
    i.scope === scope && (i.state === 'PENDING' || i.state === 'SENDING')
      ? {
          ...i,
          state: i.maybeCommitted || i.state === 'SENDING' ? ('NEEDS_REVIEW' as const) : ('REJECTED' as const),
          lastError: { status: 401, reason: 'access-revoked' as const, at: now },
        }
      : i,
  );
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
    } else if (
      i.state === 'REPLACED' &&
      (!i.verification || i.verification.state === 'verified') &&
      i.replacement?.result?.revision &&
      (syncedRevision === null || BigInt(i.replacement.result.revision) > BigInt(syncedRevision))
    ) {
      // The replacement is a confirmed movement of its own, counted like any receipt until the synced cursor has it.
      add(i.payload.productId, 'awaitingSync', signed(i));
    }
  }
  return out;
}

/** Discarding is safe only when the intent cannot have been recorded, or its outcome is already known. */
export function canDiscard(intent: StockIntent): boolean {
  // A replacement decision that is READY/SENDING/UNKNOWN holds the only copy of its key: dropping it could make the
  // next attempt a second replacement. A replaced operation with a flagged risk stays until a person has dealt with it.
  if (intent.replacement && intent.replacement.state !== 'CONFIRMED') return false;
  if (intent.state === 'REPLACED') return !intent.replacedRisk;
  if (intent.state === 'REJECTED' || intent.state === 'NEEDS_REVIEW' || intent.state === 'CONFIRMED') return true;
  return intent.state === 'PENDING' && intent.attempts === 0 && !intent.maybeCommitted;
}

/**
 * "Retry now", unchanged. Allowed for a pending intent (skips the backoff) and for a refusal that proves nothing was
 * recorded under the key and may pass later (insufficient stock: someone may have received stock since).
 */
export function retryNow(intent: StockIntent, now: number): StockIntent | null {
  if (intent.state === 'PENDING') return { ...intent, nextAttemptAt: now };
  // A refusal for revoked access proves nothing was recorded; once access is restored the person may send it unchanged.
  if (intent.state === 'REJECTED' && (intent.lastError?.reason === 'insufficient-stock' || intent.lastError?.reason === 'access-revoked')) {
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
  const settled = (i: StockIntent) =>
    (i.state === 'CONFIRMED' || (i.state === 'REPLACED' && !i.replacedRisk)) && i.verification?.state !== 'pending';
  // A replaced operation ages from its replacement's receipt; the lost original's receipt is only provenance.
  const settledAt = (i: StockIntent) => (i.state === 'REPLACED' ? i.replacement?.result?.at ?? i.result?.at : i.result?.at);
  const kept = intents.filter((i) => {
    const at = settledAt(i);
    return !(settled(i) && at !== undefined && now - at > CONFIRMED_RETENTION_MS);
  });
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
//   nobody can tell whether the loss was intended (e.g. a deliberate rollback). A person decides, through the
//   server-checked replacement flow (replacement.ts), which refuses if the original is back;
// - present but different, or a server-side mismatch → NEEDS_REVIEW 'history-mismatch';
// - indeterminate / unavailable → 'unverifiable', shown as such, never as plainly confirmed;
// - superseded (the server holds a person's replacement of it) → REPLACED.
// "absent" means absent from the CURRENT history. It is not proof that the operation never happened.

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
  /** This operation was replaced: the replacement's key and movement, and whether that movement is in the ledger now. */
  replacement?: { key: string; movementId: string; present: boolean };
  /** This operation IS a replacement of an earlier one. */
  replacementOf?: { key: string; movementId: string; originalPresent: boolean };
}

const RECHECKABLE: readonly IntentState[] = ['CONFIRMED', 'REPLACED'];

/** A reset in one warehouse (or everywhere, warehouseId null) puts that account's receipts back to "re-checking". */
export function markForRecheck(
  intents: readonly StockIntent[],
  scope: string,
  warehouseId: string | null,
  now: number,
): StockIntent[] {
  return intents.map((i) =>
    i.scope === scope && RECHECKABLE.includes(i.state) && i.result && (warehouseId === null || i.payload.warehouseId === warehouseId)
      ? { ...i, verification: { state: 'pending' as const, at: now } }
      : i,
  );
}

const isLostOperation = (i: StockIntent) => i.state === 'NEEDS_REVIEW' && i.lastError?.reason === 'history-changed';

/**
 * Receipts to re-check: those marked pending, or (all=true, at session start) every receipt still kept, including
 * replaced operations and operations waiting for review (a second restore may have brought the original back).
 */
export function recheckCandidates(
  intents: readonly StockIntent[],
  scope: string,
  opts: { all?: boolean; limit?: number } = {},
): StockIntent[] {
  return intents
    .filter(
      (i) =>
        i.scope === scope &&
        i.result !== null &&
        ((RECHECKABLE.includes(i.state) && (opts.all || i.verification?.state === 'pending')) ||
          (opts.all && isLostOperation(i))),
    )
    .sort((a, b) => b.seq - a.seq)
    .slice(0, opts.limit ?? 100);
}

/** What to ask the server about one intent: its own key and receipt, and its replacement's key if it has one. */
export function lookupRefs(intent: StockIntent): Array<{ key: string; movementId?: string }> {
  const refs: Array<{ key: string; movementId?: string }> = [
    intent.result?.movementId ? { key: intent.id, movementId: intent.result.movementId } : { key: intent.id },
  ];
  const r = intent.replacement;
  if (r) refs.push(r.result?.movementId ? { key: r.key, movementId: r.result.movementId } : { key: r.key });
  return refs;
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

/** The server says another attempt (this device earlier, or another device of the same user) already replaced it. */
function replacedElsewhere(
  intent: StockIntent,
  replacement: NonNullable<OperationLookup['replacement']>,
  risk: ReplacedRisk | null,
  now: number,
): StockIntent {
  return {
    ...intent,
    state: 'REPLACED',
    verification: null,
    replacedRisk: risk,
    replacementBlock: null,
    replacement: {
      key: replacement.key,
      expectedGeneration: intent.replacement?.expectedGeneration ?? '',
      createdAt: intent.replacement?.createdAt ?? now,
      attempts: intent.replacement?.attempts ?? 0,
      state: 'CONFIRMED',
      lastError: null,
      result: { movementId: replacement.movementId, revision: null, runningBalance: null, replayed: false, at: now },
    },
  };
}

/** Applies the server's answer about the intent's OWN key. Anything it does not concern is returned unchanged. */
export function applyLookup(intent: StockIntent, lookup: OperationLookup, now: number): StockIntent {
  if (lookup.key !== intent.id) return intent;
  const review = (reason: 'history-changed' | 'history-mismatch'): StockIntent => ({
    ...intent,
    state: 'NEEDS_REVIEW',
    lastError: { status: null, reason, at: now },
    verification: null,
  });
  const verified = (): StockIntent => ({
    ...intent,
    state: 'CONFIRMED',
    lastError: null,
    replacement: null,
    replacementBlock: null,
    verification: { state: 'verified', at: now },
    result: intent.result && lookup.movement ? { ...intent.result, revision: lookup.movement.revision } : intent.result,
  });

  if (intent.state === 'CONFIRMED') {
    switch (lookup.status) {
      case 'present':
        if (!lookup.movement || !sameOperation(intent, lookup.movement)) return review('history-mismatch');
        // Replaced elsewhere and brought back: both are in the ledger, the stock was applied twice.
        if (lookup.reason === 'coexisting-replacement' && lookup.replacement) {
          return replacedElsewhere(intent, lookup.replacement, 'duplicate-risk', now);
        }
        return verified();
      case 'absent':
        return review('history-changed');
      default:
        if (lookup.reason === 'superseded' && lookup.replacement) {
          return replacedElsewhere(intent, lookup.replacement, lookup.replacement.present ? null : 'replacement-missing', now);
        }
        return { ...intent, verification: { state: 'unverifiable', at: now, reason: lookup.reason ?? lookup.status } };
    }
  }

  if (isLostOperation(intent)) {
    // A decision that may already have been recorded is resolved only through ITS key (resolveAttempt in replacement.ts).
    if (intent.replacement && intent.replacement.state !== 'READY') return intent;
    if (lookup.status === 'present' && lookup.movement && sameOperation(intent, lookup.movement)) {
      if (lookup.reason === 'coexisting-replacement' && lookup.replacement) {
        return replacedElsewhere(intent, lookup.replacement, 'duplicate-risk', now);
      }
      return verified(); // the original is back: nothing to replace (a READY, never-sent decision is dropped)
    }
    if (lookup.reason === 'superseded' && lookup.replacement) {
      return replacedElsewhere(intent, lookup.replacement, lookup.replacement.present ? null : 'replacement-missing', now);
    }
  }
  return intent;
}

export type ReceiptDisplay = 'confirmed' | 'rechecking' | 'unverifiable';

/** How a CONFIRMED receipt may be described: never plainly "confirmed" while the server's history is in question. */
export function receiptDisplay(intent: StockIntent): ReceiptDisplay {
  if (intent.verification?.state === 'pending') return 'rechecking';
  if (intent.verification?.state === 'unverifiable') return 'unverifiable';
  return 'confirmed';
}
