import {
  applyLookup, canDiscard, createIntent, markForRecheck, markSending, OperationLookup, pendingEffects, prune,
  recheckCandidates, settle, StockIntent,
} from './outbox';
import {
  applyLookups, applyReplacedLookups, beginReplacement, canRetryReplacement, markReplacementSending, recoverReplacementAttempts,
  replacementAvailability, replacementRequest, resolveAttempt, REVIEW_TTL_MS, ReviewSnapshot, settleReplacement,
  unresolvedAttempts,
} from './replacement';

const A = 'localhost:3000|company-1|user-a';
const B = 'localhost:3000|company-1|user-b';
const W1 = 'w1';
const G1 = '11111111-1111-4111-8111-111111111111';
const G2 = '22222222-2222-4222-8222-222222222222';
const RK = 'rpl-0000-0000-0001';
let n = 0;
const key = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

/** A dispatch of 5, confirmed by the server in generation G1 and then found missing from the history (NEEDS_REVIEW). */
function lost(opts: { scope?: string } = {}): StockIntent {
  const id = key();
  const created = createIntent({ id, scope: opts.scope ?? A, seq: n, kind: 'outbound', payload: { productId: 'p1', warehouseId: W1, quantity: '5' }, now: 1_000 });
  const confirmed = settle(markSending(created), { ok: true, body: { id: `m-${id.slice(-4)}`, revision: '9', runningBalance: '95.000000', historyGeneration: G1 } }, 2_000);
  return applyLookup(confirmed, { key: id, status: 'absent' }, 3_000);
}
const review = (i: StockIntent, over: Partial<ReviewSnapshot> = {}): ReviewSnapshot => ({
  intentId: i.id, status: 'absent', generation: G2, checkedAt: 10_000, ...over,
});
const NOW = 10_500;
const begun = (i = lost()) => beginReplacement(i, review(i), RK, NOW);
const lk = (k: string, over: Partial<OperationLookup> = {}): OperationLookup => ({ key: k, status: 'absent', ...over });
const mv = (id: string, rev = '4') => ({ id, warehouseId: W1, productId: 'p1', movementType: 'OUTBOUND', quantityChange: '-5.000000', revision: rev });
const ok = (id = 'm-repl') => ({ ok: true as const, body: { id, revision: '12', runningBalance: '90.000000', historyGeneration: G2, outcome: 'replaced' } });

describe('availability of a replacement (advice only - the server decides)', () => {
  it('is offered only for a lost operation, with a receipt, after a FRESH check that found it absent', () => {
    const i = lost();
    expect(replacementAvailability(i, review(i), NOW)).toEqual({ available: true });
    expect(replacementAvailability(i, null, NOW)).toEqual({ available: false, reason: 'needs-check' });
    expect(replacementAvailability(i, review(i, { checkedAt: 10_000 }), 10_000 + REVIEW_TTL_MS + 1)).toEqual({ available: false, reason: 'check-stale' });
    expect(replacementAvailability(i, review(i, { intentId: 'other' }), NOW)).toEqual({ available: false, reason: 'needs-check' });
    expect(replacementAvailability({ ...i, result: null }, review(i), NOW)).toEqual({ available: false, reason: 'no-receipt' });
    expect(replacementAvailability({ ...i, state: 'CONFIRMED' }, review(i), NOW)).toEqual({ available: false, reason: 'not-lost' });
  });

  it('absent is the ONLY status that opens it; every other state is blocked with its own explanation', () => {
    const i = lost();
    expect(replacementAvailability(i, review(i, { status: 'present' }), NOW)).toEqual({ available: false, reason: 'original-present' });
    expect(replacementAvailability(i, review(i, { status: 'unavailable' }), NOW)).toEqual({ available: false, reason: 'unavailable' });
    expect(replacementAvailability(i, review(i, { status: 'indeterminate', reason: 'receipt-without-movement' }), NOW)).toEqual({ available: false, reason: 'indeterminate' });
    expect(replacementAvailability(i, review(i, { status: 'indeterminate', reason: 'in-progress' }), NOW)).toEqual({ available: false, reason: 'indeterminate' });
    expect(replacementAvailability(i, review(i, { status: 'indeterminate', reason: 'superseded' }), NOW)).toEqual({ available: false, reason: 'superseded' });
  });

  it('is not offered again while a decision is on its way', () => {
    const i = begun();
    for (const state of ['SENDING', 'UNKNOWN'] as const) {
      expect(replacementAvailability({ ...i, replacement: { ...i.replacement!, state } }, review(i), NOW)).toEqual({ available: false, reason: 'attempt-in-progress' });
    }
  });
});

describe('the decision and its key', () => {
  it('is written with the person\'s key and the generation they reviewed; nothing is sent by creating it', () => {
    const i = begun();
    expect(i.replacement).toMatchObject({ key: RK, expectedGeneration: G2, state: 'READY', attempts: 0, result: null });
    expect(i.state).toBe('NEEDS_REVIEW');
  });

  it('never gets a second key: a repeated confirmation (double tap) returns the same decision', () => {
    const first = begun();
    const again = beginReplacement(first, review(first), 'rpl-another-key-xx', NOW + 1);
    expect(again).toBe(first);
    const inFlight = markReplacementSending(first);
    expect(beginReplacement(inFlight, review(first), 'rpl-another-key-xx', NOW + 1)).toBe(inFlight);
  });

  it('refuses to begin on a stale or blocked check', () => {
    const i = lost();
    expect(beginReplacement(i, review(i, { status: 'present' }), RK, NOW)).toBe(i);
    expect(beginReplacement(i, review(i), RK, 10_000 + REVIEW_TTL_MS + 1)).toBe(i);
  });

  it('produces the same request every time, with the receipt as evidence and the explicit decision', () => {
    const i = begun();
    const r = replacementRequest(i)!;
    expect(r).toEqual({
      path: '/stock/replacements/outbound',
      idempotencyKey: RK,
      body: {
        originalKey: i.id, originalMovementId: i.result!.movementId, productId: 'p1', warehouseId: W1, quantity: '5',
        expectedGeneration: G2, acknowledge: true, receiptRevision: '9',
        receiptConfirmedAt: new Date(2_000).toISOString(), receiptGeneration: G1,
      },
    });
    expect(replacementRequest(i)).toEqual(r);
  });

  it('survives an app kill: written to disk as SENDING, comes back UNKNOWN with the SAME key and request', () => {
    const sending = markReplacementSending(begun());
    expect(sending.replacement).toMatchObject({ state: 'SENDING', attempts: 1 });
    const reopened = recoverReplacementAttempts(JSON.parse(JSON.stringify([sending])))[0];
    expect(reopened.replacement).toMatchObject({ state: 'UNKNOWN', key: RK });
    expect(replacementRequest(reopened)).toEqual(replacementRequest(sending));
    expect(canRetryReplacement(reopened)).toBe(true);
    expect(canDiscard(reopened)).toBe(false); // the only copy of the key is never thrown away
  });

  it('a READY or UNKNOWN decision can be resent (same key); a SENDING one cannot be sent twice at once', () => {
    const i = begun();
    expect(canRetryReplacement(i)).toBe(true);
    expect(canRetryReplacement(markReplacementSending(i))).toBe(false);
    expect(markReplacementSending(markReplacementSending(i)).replacement!.attempts).toBe(1);
  });
});

describe('what each answer does to the decision', () => {
  const sent = () => markReplacementSending(begun());

  it('success: the operation is REPLACED, the replacement receipt is kept apart from the original and carries its generation', () => {
    const r = settleReplacement(sent(), ok(), 20_000);
    expect(r).toMatchObject({
      state: 'REPLACED', replacedRisk: null,
      replacement: { state: 'CONFIRMED', key: RK, result: { movementId: 'm-repl', revision: '12', generation: G2 } },
      result: { revision: '9', generation: G1 }, // the original receipt is untouched: different generation, different movement
    });
    expect(canDiscard(r)).toBe(true);
  });

  it('a replay of the same request is the same success', () => {
    const r = settleReplacement(sent(), { ok: true, body: { ...ok().body, replayed: true } }, 20_000);
    expect(r.state).toBe('REPLACED');
    expect(r.replacement!.result!.replayed).toBe(true);
  });

  it('no answer, timeout or 5xx: the server may have recorded it - key kept, UNKNOWN, never dropped', () => {
    for (const status of [undefined, 408, 500, 502, 503, 504]) {
      const r = settleReplacement(sent(), { ok: false, status }, 20_000);
      expect(r.replacement).toMatchObject({ state: 'UNKNOWN', key: RK });
      expect(r.state).toBe('NEEDS_REVIEW');
      expect(r.replacementBlock ?? null).toBeNull();
    }
  });

  it('refused before running (sign-in, rate limit): READY with the same key', () => {
    for (const status of [401, 429]) {
      expect(settleReplacement(sent(), { ok: false, status }, 20_000).replacement).toMatchObject({ state: 'READY', key: RK });
    }
  });

  it.each([
    ['stale-generation'], ['original-present'], ['original-indeterminate'], ['original-unavailable'],
    ['insufficient-stock'], ['in-progress'],
  ])('409 %s: proof nothing was recorded - the decision and its key are dropped and the reason is shown', (code) => {
    const r = settleReplacement(sent(), { ok: false, status: 409, code, details: { currentGeneration: G1 } }, 20_000);
    expect(r.replacement).toBeNull();
    expect(r.state).toBe('NEEDS_REVIEW');
    expect(r.replacementBlock).toMatchObject({ code, at: 20_000 });
    expect(canDiscard(r)).toBe(true);
  });

  it('409 already-replaced: resolved as REPLACED (another attempt of this user recorded it)', () => {
    const r = settleReplacement(sent(), { ok: false, status: 409, code: 'already-replaced', details: { replacementKey: 'other-rkey-0001', replacementMovementId: 'm-x' } }, 20_000);
    expect(r).toMatchObject({ state: 'REPLACED', replacement: { state: 'CONFIRMED', key: 'other-rkey-0001', result: { movementId: 'm-x' } } });
  });

  it('403/404/422/400: refused, nothing recorded', () => {
    expect(settleReplacement(sent(), { ok: false, status: 404 }, 1).replacementBlock?.code).toBe('no-access');
    expect(settleReplacement(sent(), { ok: false, status: 403 }, 1).replacementBlock?.code).toBe('no-access');
    expect(settleReplacement(sent(), { ok: false, status: 422 }, 1).replacementBlock?.code).toBe('key-reused');
    expect(settleReplacement(sent(), { ok: false, status: 400 }, 1).replacementBlock?.code).toBe('invalid');
    expect(settleReplacement(sent(), { ok: false, status: 409 }, 1).replacementBlock?.code).toBe('invalid'); // a 409 without a known code
  });

  it('after a refusal the person can decide again and gets a NEW key (the old one proved nothing)', () => {
    const refused = settleReplacement(sent(), { ok: false, status: 409, code: 'stale-generation' }, 20_000);
    const again = beginReplacement(refused, review(refused, { generation: G1, checkedAt: 30_000 }), 'rpl-fresh-key-02', 30_100);
    expect(again.replacement).toMatchObject({ key: 'rpl-fresh-key-02', expectedGeneration: G1, state: 'READY' });
    expect(again.replacementBlock).toBeNull();
  });

  it('timeout after the server committed: the lookup of ITS key resolves the decision; a retry is the same request', () => {
    const unknown = settleReplacement(sent(), { ok: false, status: undefined }, 20_000);
    // read-only resolution through the replacement's own key
    const recorded = resolveAttempt(unknown, lk(RK, { status: 'present', movement: mv('m-repl', '12') }), 21_000);
    expect(recorded).toMatchObject({ state: 'REPLACED', replacement: { state: 'CONFIRMED', result: { movementId: 'm-repl' } } });
    // not recorded: back to READY with the SAME key, resent only by the person's tap
    const notRecorded = resolveAttempt(unknown, lk(RK, { status: 'absent' }), 21_000);
    expect(notRecorded.replacement).toMatchObject({ state: 'READY', key: RK });
    expect(replacementRequest(notRecorded)).toEqual(replacementRequest(unknown));
    // the server cannot tell: stays unknown
    expect(resolveAttempt(unknown, lk(RK, { status: 'indeterminate', reason: 'receipt-without-movement' }), 21_000)).toBe(unknown);
    // an answer about another key never resolves it
    expect(resolveAttempt(unknown, lk('someone-else-key', { status: 'present', movement: mv('m') }), 21_000)).toBe(unknown);
  });

  it('a late answer for a REPLACED operation changes nothing', () => {
    const done = settleReplacement(sent(), ok(), 20_000);
    expect(settleReplacement(done, { ok: false, status: 500 }, 21_000)).toBe(done);
  });
});

describe('re-checking lost and replaced operations against later history changes', () => {
  const replaced = () => settleReplacement(markReplacementSending(begun()), ok(), 20_000);
  const orig = (i: StockIntent, over: Partial<OperationLookup> = {}) => lk(i.id, over);

  it('a lost operation is re-checked at session start, a replaced one too; other accounts and settled receipts are not', () => {
    const l = lost();
    const r = replaced();
    const other = lost({ scope: B });
    expect(recheckCandidates([l, r, other], A).map((i) => i.id)).toEqual([]); // nothing pending, no sweep
    expect(recheckCandidates([l, r, other], A, { all: true }).map((i) => i.id).sort()).toEqual([l.id, r.id].sort());
    const [marked] = markForRecheck([r], A, W1, 5);
    expect(recheckCandidates([marked], A).map((i) => i.id)).toEqual([r.id]);
  });

  it('decisions of unknown outcome are asked about by their own key, per account', () => {
    const u = settleReplacement(markReplacementSending(begun()), { ok: false, status: undefined }, 1);
    expect(unresolvedAttempts([u], A).map((i) => i.id)).toEqual([u.id]);
    expect(unresolvedAttempts([u], B)).toEqual([]);
  });

  it('the original comes back before anything was sent: the lost operation is verified again and the unsent decision dropped', () => {
    const i = begun();
    const back = applyLookups(i, new Map([[i.id, orig(i, { status: 'present', movement: mv(i.result!.movementId, '4') })]]), 30_000);
    expect(back).toMatchObject({ state: 'CONFIRMED', replacement: null, verification: { state: 'verified' }, result: { revision: '4' } });
  });

  it('the original comes back while a decision may already be recorded: nothing is concluded from the original alone', () => {
    const unknown = settleReplacement(markReplacementSending(begun()), { ok: false, status: undefined }, 20_000);
    const same = applyLookups(unknown, new Map([[unknown.id, orig(unknown, { status: 'present', movement: mv(unknown.result!.movementId) })]]), 30_000);
    expect(same).toBe(unknown);
  });

  it('replaced elsewhere (another device of the same user): this device learns it from the superseded answer', () => {
    const l = lost();
    const r = applyLookups(l, new Map([[l.id, orig(l, { status: 'indeterminate', reason: 'superseded', replacement: { key: 'rk-other-dev', movementId: 'm-r', present: true } })]]), 30_000);
    expect(r).toMatchObject({ state: 'REPLACED', replacedRisk: null, replacement: { key: 'rk-other-dev', state: 'CONFIRMED', result: { movementId: 'm-r' } } });
  });

  it('REPLACED, normal: the original is gone and the replacement is in the history - verified, no risk', () => {
    const r = replaced();
    const out = applyReplacedLookups(r, orig(r, { status: 'indeterminate', reason: 'superseded' }), lk(RK, { status: 'present', movement: mv('m-repl', '12') }), 40_000);
    expect(out).toMatchObject({ state: 'REPLACED', replacedRisk: null, verification: { state: 'verified' } });
  });

  it('REPLACED, a later restore/import brought the original back next to its replacement: duplicate risk is flagged, nothing is changed', () => {
    const r = replaced();
    const out = applyReplacedLookups(
      r,
      orig(r, { status: 'present', reason: 'coexisting-replacement', movement: mv(r.result!.movementId), replacement: { key: RK, movementId: 'm-repl', present: true } }),
      lk(RK, { status: 'present', reason: 'coexisting-replacement', movement: mv('m-repl', '12') }),
      40_000,
    );
    expect(out.replacedRisk).toBe('duplicate-risk');
    expect(out.state).toBe('REPLACED');
    expect(canDiscard(out)).toBe(false); // a flagged risk is not dismissed silently
    expect(prune([out], 40_000 + 30 * 24 * 3600_000)).toEqual([out]); // and not pruned
  });

  it('REPLACED, the second restore removed the replacement but returned the original: replacement-missing', () => {
    const r = replaced();
    const out = applyReplacedLookups(r, orig(r, { status: 'present', movement: mv(r.result!.movementId) }), lk(RK, { status: 'absent' }), 40_000);
    expect(out.replacedRisk).toBe('replacement-missing');
  });

  it('REPLACED, both are gone (a third restore): the history changed again and a person decides again', () => {
    const r = replaced();
    const out = applyReplacedLookups(r, orig(r, { status: 'absent' }), lk(RK, { status: 'absent' }), 40_000);
    expect(out).toMatchObject({ state: 'NEEDS_REVIEW', lastError: { reason: 'history-changed' }, replacement: null, replacedRisk: null });
    expect(replacementAvailability(out, review(out), NOW).available).toBe(true);
  });

  it('REPLACED, the server cannot say: shown as unverifiable, never as clean', () => {
    const r = replaced();
    const out = applyReplacedLookups(r, orig(r, { status: 'indeterminate', reason: 'superseded' }), lk(RK, { status: 'unavailable', reason: 'no-access' }), 40_000);
    expect(out.verification).toMatchObject({ state: 'unverifiable' });
    expect(out.replacedRisk ?? null).toBeNull();
  });

  it('a replacement counts like a confirmed receipt in "waiting for sync" until the synced cursor reaches it; the lost original never does', () => {
    const r = replaced();
    expect(pendingEffects([r], A, W1, '10')).toEqual({ p1: { pending: 0, awaitingSync: -5, count: 1 } });
    expect(pendingEffects([r], A, W1, '12')).toEqual({});
    expect(pendingEffects([lost()], A, W1, '1')).toEqual({});
  });

  it('settled replaced operations are pruned after 7 days from the REPLACEMENT receipt', () => {
    const r = replaced();
    expect(prune([r], 20_000 + 6 * 24 * 3600_000)).toEqual([r]);
    expect(prune([r], 20_000 + 8 * 24 * 3600_000)).toEqual([]);
  });
});

describe('copy', () => {
  const en = require('../i18n/locales/en.json').online.outbox;
  const ar = require('../i18n/locales/ar.json').online.outbox;
  const leaves = (o: unknown, p = ''): string[] =>
    o && typeof o === 'object' ? Object.entries(o).flatMap(([k, v]) => leaves(v, `${p}${p ? '.' : ''}${k}`)) : [p];

  it('Arabic and English cover exactly the same keys for the review and replacement flows', () => {
    for (const part of ['reviewFlow', 'replaced', 'replacement']) {
      expect(leaves(ar[part]).sort()).toEqual(leaves(en[part]).sort());
    }
    for (const k of ['reviewReplace', 'openReview', 'acknowledge', 'sending']) expect(typeof ar[k]).toBe('string');
    expect(ar.state.REPLACED).toBeTruthy();
    expect(en.state.REPLACED).toBeTruthy();
  });

  it('every refusal code, availability reason, status and risk the code can produce has a message in both languages', () => {
    const blocks = ['stale-generation', 'original-present', 'original-indeterminate', 'original-unavailable', 'already-replaced', 'insufficient-stock', 'in-progress', 'no-access', 'invalid', 'key-reused'];
    const why = ['not-lost', 'no-receipt', 'attempt-in-progress', 'needs-check', 'check-stale', 'original-present', 'indeterminate', 'unavailable', 'superseded'];
    for (const lang of [en, ar]) {
      for (const k of blocks) expect(lang.reviewFlow.blocked[k]).toBeTruthy();
      for (const k of why) expect(lang.reviewFlow.why[k]).toBeTruthy();
      for (const k of ['absent', 'present', 'indeterminate', 'unavailable', 'superseded']) expect(lang.reviewFlow.status[k]).toBeTruthy();
      for (const k of ['offline', 'denied', 'server', 'unsupported']) expect(lang.reviewFlow.failure[k]).toBeTruthy();
      for (const k of ['duplicate-risk', 'replacement-missing']) {
        expect(lang.reviewFlow.risk[k]).toBeTruthy();
        expect(lang.replaced.risk[k]).toBeTruthy();
      }
      for (const k of ['READY', 'SENDING', 'UNKNOWN', 'CONFIRMED']) expect(lang.replacement.state[k]).toBeTruthy();
    }
  });

  it('no locale file defines a key twice, and the banner still finds its plain-text "Review" (a duplicate key silently wins - seen on the device)', () => {
    const fs = require('fs');
    const path = require('path');
    for (const lang of ['en', 'ar']) {
      const text: string = fs.readFileSync(path.join(__dirname, '..', 'i18n', 'locales', `${lang}.json`), 'utf8');
      const frames: Array<Set<string>> = [];
      const duplicates: string[] = [];
      let i = 0;
      let expectKey = false;
      const stack: boolean[] = []; // true: object
      while (i < text.length) {
        const c = text[i];
        if (c === '"') {
          let j = i + 1;
          while (text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
          const s = text.slice(i + 1, j);
          const top = stack.length - 1;
          if (top >= 0 && stack[top] && expectKey) {
            if (frames[top].has(s)) duplicates.push(s);
            frames[top].add(s);
            expectKey = false;
          }
          i = j + 1;
          continue;
        }
        if (c === '{') { stack.push(true); frames.push(new Set()); expectKey = true; }
        else if (c === '[') { stack.push(false); frames.push(new Set()); }
        else if (c === '}' || c === ']') { stack.pop(); frames.pop(); expectKey = false; }
        else if (c === ',' && stack[stack.length - 1]) expectKey = true;
        i++;
      }
      expect({ lang, duplicates }).toEqual({ lang, duplicates: [] });
    }
    expect(typeof en.review).toBe('string');
    expect(typeof ar.review).toBe('string');
  });
  it('never calls a lost operation "never happened", and Arabic has no leftover English placeholders', () => {
    expect(en.reviewFlow.whatHappened).toMatch(/does not prove it never happened/);
    expect(leaves(ar.reviewFlow).map((k) => k.split('.').reduce((o: any, p) => o[p], ar.reviewFlow) as string).every((s) => /[؀-ۿ]/.test(s))).toBe(true);
  });
});
