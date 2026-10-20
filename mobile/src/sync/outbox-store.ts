import { create } from 'zustand';
import { getStorage } from '@/store/secure-storage';
import {
  createIntent,
  expireStale,
  IntentKind,
  IntentPayload,
  prune,
  recoverInterrupted,
  StockIntent,
} from '@/domain/outbox';

/**
 * Durable queue of offline stock intents, in the app's encrypted MMKV store. Every change is written through
 * synchronously before the caller goes on (an intent is marked SENDING on disk before its request leaves), so an
 * app kill at any point leaves a state the next launch can resume safely: see recoverInterrupted.
 *
 * Stored as one versioned document. A document this version cannot read is kept aside, never overwritten.
 */
const KEY = 'stockmind-outbox';
const VERSION = 1;

interface OutboxDoc {
  v: typeof VERSION;
  seq: number;
  intents: StockIntent[];
}

interface OutboxState {
  loaded: boolean;
  seq: number;
  intents: StockIntent[];
}

export const useOutboxStore = create<OutboxState>(() => ({ loaded: false, seq: 0, intents: [] }));

function write(seq: number, intents: StockIntent[]) {
  const doc: OutboxDoc = { v: VERSION, seq, intents };
  getStorage().set(KEY, JSON.stringify(doc));
  useOutboxStore.setState({ seq, intents });
}

/** Once at cold start, after secure storage is up. Interrupted sends become pending (possibly recorded). */
export function loadOutbox(now = Date.now()) {
  const raw = getStorage().getString(KEY);
  let doc: OutboxDoc = { v: VERSION, seq: 0, intents: [] };
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<OutboxDoc>;
      if (parsed.v !== VERSION || !Array.isArray(parsed.intents)) throw new Error('unsupported outbox document');
      doc = { v: VERSION, seq: Number(parsed.seq) || 0, intents: parsed.intents };
    } catch {
      // Keep the unreadable document for inspection instead of silently losing queued work.
      getStorage().set(`${KEY}-unreadable-${now}`, raw);
    }
  }
  const intents = prune(expireStale(recoverInterrupted(doc.intents), now), now);
  write(doc.seq, intents);
  useOutboxStore.setState({ loaded: true });
}

/** Adds an intent, or returns the existing one with the same id (a double tap cannot queue the action twice). */
export function enqueueIntent(args: {
  id: string;
  scope: string;
  kind: IntentKind;
  payload: IntentPayload;
  now?: number;
}): StockIntent {
  const { seq, intents } = useOutboxStore.getState();
  const existing = intents.find((i) => i.id === args.id);
  if (existing) return existing;
  const intent = createIntent({ ...args, seq: seq + 1, now: args.now ?? Date.now() });
  write(seq + 1, [...intents, intent]);
  return intent;
}

export function updateIntent(id: string, change: (intent: StockIntent) => StockIntent | null): StockIntent | null {
  const { seq, intents } = useOutboxStore.getState();
  const current = intents.find((i) => i.id === id);
  if (!current) return null;
  const next = change(current);
  if (!next) return null;
  write(seq, intents.map((i) => (i.id === id ? next : i)));
  return next;
}

export function replaceIntents(intents: StockIntent[]) {
  write(useOutboxStore.getState().seq, intents);
}

export function removeIntent(id: string) {
  const { seq, intents } = useOutboxStore.getState();
  write(seq, intents.filter((i) => i.id !== id));
}

export function getIntent(id: string): StockIntent | undefined {
  return useOutboxStore.getState().intents.find((i) => i.id === id);
}

/** Intents of one account that still need a person's attention or are not confirmed yet. */
export function openIntents(intents: readonly StockIntent[], scope: string | null): StockIntent[] {
  if (!scope) return [];
  return intents.filter((i) => i.scope === scope && i.state !== 'CONFIRMED');
}
