import { create } from 'zustand';
import { randomUUID } from 'expo-crypto';
import { api } from '@/api/client';
import { httpStatusOf } from '@/domain/auth-flow';
import { lookupRefs, OperationLookup } from '@/domain/outbox';
import {
  applyLookups, beginReplacement, canRetryReplacement, markReplacementSending, replacementAvailability,
  replacementRequest, ReplacementOutcome, ReviewSnapshot, settleReplacement,
} from '@/domain/replacement';
import { currentScopeKey } from './account-scope';
import { getIntent, updateIntent } from './outbox-store';
import { onOwnWriteSucceeded } from './warehouse-sync';

/**
 * Runtime of the safe replacement flow (see domain/replacement.ts for the rules).
 *
 * Two server calls, in this order, both needing the network:
 * 1. checkOriginal: POST /stock/operations/lookup for the lost operation. Read-only. It tells the screen whether the
 *    original is still absent from the CURRENT history and which history generation that answer is about.
 * 2. confirmReplacement: after the person's explicit confirmation, the decision (with its key) is written to disk and
 *    POSTed to /stock/replacements/{kind}. The SERVER re-checks everything inside one transaction; the screen's check
 *    only decides what to offer.
 *
 * Nothing here retries a replacement on its own: a decision whose outcome is unknown is resolved by asking the server
 * about ITS key (outbox-reconcile), and resent only when the person taps "Retry the same request".
 */

const REPLACEMENT_TIMEOUT_MS = 60_000;
const LOOKUP_TIMEOUT_MS = 60_000;

export type ReviewFailure = 'offline' | 'denied' | 'server' | 'unsupported';

interface ReviewEntry {
  phase: 'checking' | 'ready' | 'failed';
  snapshot: ReviewSnapshot | null;
  failure: ReviewFailure | null;
}

/** Transient (never persisted): what the server said a moment ago, per lost operation. */
export const useReviewStore = create<{ entries: Record<string, ReviewEntry> }>(() => ({ entries: {} }));

function setReview(intentId: string, entry: ReviewEntry) {
  useReviewStore.setState((s) => ({ entries: { ...s.entries, [intentId]: entry } }));
}

export function clearReview(intentId: string) {
  useReviewStore.setState((s) => {
    const { [intentId]: _gone, ...rest } = s.entries;
    return { entries: rest };
  });
}

const checking = new Set<string>();

/** Asks the server where the lost operation stands now. Applies any state change the answer implies. */
export async function checkOriginal(intentId: string): Promise<void> {
  const intent = getIntent(intentId);
  if (!intent || checking.has(intentId)) return;
  checking.add(intentId);
  const previous = useReviewStore.getState().entries[intentId];
  setReview(intentId, { phase: 'checking', snapshot: previous?.snapshot ?? null, failure: null });
  try {
    const { data } = await api.post<{ generation?: string; operations: OperationLookup[] }>(
      '/stock/operations/lookup',
      { operations: lookupRefs(intent) },
      { timeout: LOOKUP_TIMEOUT_MS },
    );
    if (intent.scope !== currentScopeKey()) return; // the account changed while we waited
    const byKey = new Map(data.operations.map((o) => [o.key, o]));
    const own = byKey.get(intent.id);
    const now = Date.now();
    updateIntent(intent.id, (i) => applyLookups(i, byKey, now));
    if (!own || !data.generation) {
      // A server without the generation contract cannot make the decision safe: do not offer it.
      setReview(intentId, { phase: 'failed', snapshot: null, failure: 'unsupported' });
      return;
    }
    setReview(intentId, {
      phase: 'ready',
      snapshot: { intentId, status: own.status, reason: own.reason, generation: data.generation, checkedAt: now },
      failure: null,
    });
  } catch (err) {
    const status = httpStatusOf(err);
    const failure: ReviewFailure = status === undefined ? 'offline' : status === 401 || status === 403 || status === 404 ? 'denied' : 'server';
    // Nothing is concluded from silence, and an old answer is not kept as if it were fresh.
    setReview(intentId, { phase: 'failed', snapshot: null, failure });
  } finally {
    checking.delete(intentId);
  }
}

const sending = new Set<string>();

/** Sends the decision stored on the intent (same key, same bytes every time). Single-flight per intent. */
export async function sendReplacement(intentId: string): Promise<void> {
  if (sending.has(intentId)) return;
  const intent = getIntent(intentId);
  if (!intent || !canRetryReplacement(intent)) return;
  sending.add(intentId);
  try {
    // On disk as SENDING before the request leaves: a kill now resumes as "may have been recorded", same key.
    const marked = updateIntent(intentId, markReplacementSending) ?? intent;
    const request = replacementRequest(marked);
    if (!request) return;
    let outcome: ReplacementOutcome;
    try {
      const { data } = await api.post(request.path, request.body, {
        headers: { 'Idempotency-Key': request.idempotencyKey },
        timeout: REPLACEMENT_TIMEOUT_MS,
      });
      outcome = { ok: true, body: data };
    } catch (err) {
      const body = (err as { response?: { data?: { code?: unknown; details?: unknown } } } | null)?.response?.data;
      outcome = {
        ok: false,
        status: httpStatusOf(err),
        code: typeof body?.code === 'string' ? body.code : null,
        ...(body?.details && typeof body.details === 'object' ? { details: body.details as Record<string, unknown> } : {}),
      };
    }
    // Recorded whatever account is signed in now: the server did (or did not) commit it for the intent's owner.
    const settled = updateIntent(intentId, (i) => settleReplacement(i, outcome, Date.now()));
    clearReview(intentId);
    if (settled?.state === 'REPLACED') onOwnWriteSucceeded(settled.payload.warehouseId);
  } finally {
    sending.delete(intentId);
  }
}

export type ConfirmResult = 'sent' | 'not-available';

/**
 * The person confirmed. Writes the decision to disk (key and reviewed generation) and sends it. Calling it again for
 * the same lost operation (a double tap) never creates a second key: an existing decision is only resent.
 */
export async function confirmReplacement(intentId: string): Promise<ConfirmResult> {
  const intent = getIntent(intentId);
  if (!intent) return 'not-available';
  if (intent.replacement) {
    void sendReplacement(intentId);
    return 'sent';
  }
  const snapshot = useReviewStore.getState().entries[intentId]?.snapshot ?? null;
  const now = Date.now();
  if (!snapshot || replacementAvailability(intent, snapshot, now).available !== true) return 'not-available';
  const begun = updateIntent(intentId, (i) => beginReplacement(i, snapshot, randomUUID(), now));
  if (!begun?.replacement) return 'not-available';
  await sendReplacement(intentId);
  return 'sent';
}
