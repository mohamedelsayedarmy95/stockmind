/**
 * A tiny signal so the HTTP client can say "the server just refused something about access" without importing the store
 * (which imports the client). The capability runtime subscribes and refreshes the member's snapshot; bursts are coalesced.
 */
type Listener = () => void;
const listeners = new Set<Listener>();
let lastSignal = 0;

export function onCapabilityRefresh(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function signalCapabilityRefresh(minGapMs = 2000, now = Date.now()): boolean {
  if (now - lastSignal < minGapMs) return false;
  lastSignal = now;
  listeners.forEach((l) => l());
  return true;
}

/** Test seam. */
export function resetCapabilitySignal(): void {
  lastSignal = 0;
  listeners.clear();
}
