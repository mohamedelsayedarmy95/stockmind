import { useCallback, useRef } from 'react';
import { randomUUID } from 'expo-crypto';
import { ActionKey, actionKeyFor, canonicalBody } from '@/domain/idempotent-write';

/**
 * Idempotency key for one user action on a screen. `keyFor(body)` returns the same key while the user resubmits the
 * same request (e.g. tapping Confirm again after a timeout) and a new key once the request changes; call `spend()`
 * after a success so the next identical action is a new action.
 */
export function useActionKey() {
  const current = useRef<ActionKey | null>(null);
  const keyFor = useCallback((body: Record<string, unknown>) => {
    current.current = actionKeyFor(current.current, canonicalBody(body), randomUUID);
    return current.current.key;
  }, []);
  const spend = useCallback(() => {
    current.current = null;
  }, []);
  return { keyFor, spend };
}
