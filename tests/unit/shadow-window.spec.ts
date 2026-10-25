/**
 * Series 13 / N-2: the judgement of one shadow window (pure). CLEAN only when comparisons happened, none diverged without
 * an explicit grant, nothing was missing and the engine stayed in shadow; every shortfall is named.
 */
import { emptyCounters, judgeWindow, WindowCounters } from '../../src/domain/authorization/shadow-window';

const SHADOW = { atOpen: 'shadow', now: 'shadow', guardedOutsideShadow: 0 };
const c = (over: Partial<WindowCounters>): WindowCounters => ({ ...emptyCounters(), ...over });

describe('judgeWindow', () => {
  it('equal decisions only: CLEAN, parity observed for this window', () => {
    expect(judgeWindow(c({ compared: 12, equal: 12 }), SHADOW)).toEqual({ verdict: 'CLEAN', reasons: [], parityObserved: true });
  });

  it('a grant-explained difference keeps the window CLEAN', () => {
    expect(judgeWindow(c({ compared: 5, equal: 4, expectedDifferences: 1 }), SHADOW).verdict).toBe('CLEAN');
  });

  it('nothing compared is NO_EVIDENCE, never parity', () => {
    expect(judgeWindow(emptyCounters(), SHADOW)).toEqual({ verdict: 'NO_EVIDENCE', reasons: ['nothing-compared'], parityObserved: false });
  });

  it('any unexpected difference fails the window, and the other shortfalls are still listed', () => {
    const j = judgeWindow(c({ compared: 3, equal: 2, unexpectedDifferences: 1, incomplete: 2, errors: 1 }), SHADOW);
    expect(j.verdict).toBe('UNEXPECTED_DIFFERENCES');
    expect(j.reasons).toEqual(['unexpected-differences:1', 'incomplete:2', 'errors:1']);
    expect(j.parityObserved).toBe(false);
  });

  it.each([
    ['an incomplete comparison', c({ compared: 9, equal: 9, incomplete: 1 }), SHADOW, 'incomplete:1'],
    ['an evaluation error', c({ compared: 9, equal: 9, errors: 1 }), SHADOW, 'errors:1'],
    ['the window opened outside shadow', c({ compared: 9, equal: 9 }), { ...SHADOW, atOpen: 'off' }, 'mode-not-shadow:off->shadow'],
    ['the engine left shadow', c({ compared: 9, equal: 9 }), { ...SHADOW, now: 'enforce' }, 'mode-not-shadow:shadow->enforce'],
    ['an unreadable mode', c({ compared: 9, equal: 9 }), { ...SHADOW, now: 'invalid' }, 'mode-not-shadow:shadow->invalid'],
    ['requests decided outside shadow during the window', c({ compared: 9, equal: 9 }), { ...SHADOW, guardedOutsideShadow: 3 }, 'requests-outside-shadow:3'],
    ['counters that do not add up', c({ compared: 9, equal: 8 }), SHADOW, 'counter-mismatch'],
  ])('%s makes the window INCONCLUSIVE', (_what, counters, modes, reason) => {
    const j = judgeWindow(counters, modes);
    expect(j.verdict).toBe('INCONCLUSIVE');
    expect(j.reasons).toContain(reason);
    expect(j.parityObserved).toBe(false);
  });

  it('missing evidence with nothing compared is INCONCLUSIVE (not merely "no evidence")', () => {
    const j = judgeWindow(c({ incomplete: 4 }), SHADOW);
    expect(j.verdict).toBe('INCONCLUSIVE');
    expect(j.reasons).toEqual(['incomplete:4', 'nothing-compared']);
  });
});
