/**
 * Series 13 / N-2: what one window of shadow comparisons proves, and what it does not. Pure.
 *
 * A window is a bounded stretch of ONE process's life (from its start, or from an operator's "open a new window", to now or to
 * the next one). Its verdict is deliberately conservative:
 *  - UNEXPECTED_DIFFERENCES: at least one comparison the classifier could not explain (shadow-classifier.ts). A failure.
 *  - INCONCLUSIVE: evidence is missing or unreliable: a comparison that could not be made (incomplete), an evaluation that
 *    failed (error), the engine was not in shadow for the whole window, or the counters do not add up.
 *  - NO_EVIDENCE: nothing was compared at all. Silence is not parity.
 *  - CLEAN: comparisons were made, every one was equal or explained by an explicit grant, and nothing was missing.
 * CLEAN is a statement about this process and this window only: never about other instances, earlier windows or a restart.
 */
export type WindowVerdict = 'CLEAN' | 'UNEXPECTED_DIFFERENCES' | 'INCONCLUSIVE' | 'NO_EVIDENCE';

export interface WindowCounters {
  compared: number;
  equal: number;
  expectedDifferences: number;
  unexpectedDifferences: number;
  errors: number;
  incomplete: number;
}

export interface WindowModes {
  /** CAPABILITY_MODE when the window opened and when it is judged ('invalid' when it could not be read). */
  atOpen: string;
  now: string;
  /** Guarded requests decided while the engine was NOT in shadow during the window (they were never compared). */
  guardedOutsideShadow: number;
}

export interface WindowJudgement {
  verdict: WindowVerdict;
  /** Every reason that applies, most severe first, so nothing that made the window fall short is hidden behind another. */
  reasons: string[];
  /** True only for CLEAN: comparisons happened and none diverged without an explanation, with no evidence missing. */
  parityObserved: boolean;
}

export const emptyCounters = (): WindowCounters =>
  ({ compared: 0, equal: 0, expectedDifferences: 0, unexpectedDifferences: 0, errors: 0, incomplete: 0 });

export function judgeWindow(c: WindowCounters, modes: WindowModes): WindowJudgement {
  const reasons: string[] = [];
  if (c.unexpectedDifferences > 0) reasons.push(`unexpected-differences:${c.unexpectedDifferences}`);
  if (c.incomplete > 0) reasons.push(`incomplete:${c.incomplete}`);
  if (c.errors > 0) reasons.push(`errors:${c.errors}`);
  if (modes.atOpen !== 'shadow' || modes.now !== 'shadow') reasons.push(`mode-not-shadow:${modes.atOpen}->${modes.now}`);
  if (modes.guardedOutsideShadow > 0) reasons.push(`requests-outside-shadow:${modes.guardedOutsideShadow}`);
  if (c.equal + c.expectedDifferences + c.unexpectedDifferences !== c.compared) reasons.push('counter-mismatch');
  if (c.compared === 0) reasons.push('nothing-compared');

  let verdict: WindowVerdict;
  if (c.unexpectedDifferences > 0) verdict = 'UNEXPECTED_DIFFERENCES';
  else if (reasons.some((r) => !r.startsWith('nothing-compared'))) verdict = 'INCONCLUSIVE';
  else if (c.compared === 0) verdict = 'NO_EVIDENCE';
  else verdict = 'CLEAN';
  return { verdict, reasons, parityObserved: verdict === 'CLEAN' };
}
