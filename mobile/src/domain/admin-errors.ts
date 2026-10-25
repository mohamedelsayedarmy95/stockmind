/**
 * Series 13 / N-3: the two structured refusals of the administrative endpoints (Series 11) that must not read as a vague
 * "something went wrong":
 *  - 503 AUTHORITY_BUSY: another change to the same people's access was in flight (or the database broke a lock cycle).
 *    TEMPORARY: nothing was changed, the same action can succeed a moment later;
 *  - 409 SCOPED_GRANTS_PRESENT: the member holds warehouse-manager grants that the plain warehouse list does not cover. NOT
 *    temporary: trying again does the same; the change has to be made where both kinds of access are managed.
 * The app never re-sends either request by itself (the mutations are not retried): the person decides, after the screen
 * re-read the state the refusal may concern. A 503 without that code is the server being unavailable, said as such.
 * Pure; shared by the Team screen, the warehouse-access screen and the new-warehouse form.
 */
export type AdminFailureKind = 'busy' | 'grant-conflict' | 'unavailable' | 'network' | 'refused';

export interface AdminFailure {
  kind: AdminFailureKind;
  /** A copy key, in both languages (the surface's own key for 'refused' and 'network'). */
  messageKey: string;
  /** Doing the same thing again later can succeed (the person decides; the app never re-sends by itself). */
  retryLater: boolean;
  /** The screen should re-read what the refusal may concern before the person decides again. */
  refresh: boolean;
  /** How the notice is shown: a temporary condition is a warning, a refusal is an error. */
  tone: 'warning' | 'error';
}

export const AUTHORITY_BUSY = 'AUTHORITY_BUSY';
export const SCOPED_GRANTS_PRESENT = 'SCOPED_GRANTS_PRESENT';
export const ADMIN_ERROR_KEYS = ['admin.error.authorityBusy', 'admin.error.scopedGrantsPresent', 'admin.error.unavailable'] as const;

/**
 * Classifies a failed administrative request. `surfaceKey` gives the surface's own copy for everything this module does not
 * special-case (its existing code map), so the two structured refusals read the same everywhere.
 */
export function adminFailure(status: number | undefined, code: string | undefined, surfaceKey: (status: number | undefined, code: string | undefined) => string): AdminFailure {
  if (status === 503 && code === AUTHORITY_BUSY) {
    return { kind: 'busy', messageKey: 'admin.error.authorityBusy', retryLater: true, refresh: true, tone: 'warning' };
  }
  if (code === SCOPED_GRANTS_PRESENT) {
    return { kind: 'grant-conflict', messageKey: 'admin.error.scopedGrantsPresent', retryLater: false, refresh: true, tone: 'error' };
  }
  if (status === 502 || status === 503 || status === 504) {
    return { kind: 'unavailable', messageKey: 'admin.error.unavailable', retryLater: true, refresh: false, tone: 'warning' };
  }
  if (status === undefined) {
    return { kind: 'network', messageKey: surfaceKey(status, code), retryLater: true, refresh: false, tone: 'warning' };
  }
  return { kind: 'refused', messageKey: surfaceKey(status, code), retryLater: false, refresh: true, tone: 'error' };
}
