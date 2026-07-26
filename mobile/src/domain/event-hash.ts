import { canonicalJson, CanonicalValue } from './canonical-json';
import { InventoryEvent } from './events';

/**
 * Hash-chain input construction (UWOS §2.4, docs/event-schema.md §5).
 *
 * Split from the digest itself on purpose: building the input is pure and
 * fully testable in Node, while SHA-256 comes from expo-crypto and needs a
 * device. If writer and verifier ever build different input strings, every
 * integrity check fails — so this is the part that must be pinned by tests.
 */

/** First link in the chain. */
export const GENESIS_HASH = '0'.repeat(64);

/**
 * Envelope fields that are covered by the hash.
 *
 * `seq`, `prevHash` and `hash` are excluded because they are chain metadata,
 * not event content. `syncStatus` is excluded deliberately: uploading an event
 * mutates it, and a sync must never invalidate the chain.
 */
function chainedFields(event: InventoryEvent): Record<string, CanonicalValue> {
  return {
    id: event.id,
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    recordedAt: event.recordedAt,
    productId: event.productId,
    warehouseId: event.warehouseId,
    storeId: event.storeId,
    storageUnitId: event.storageUnitId,
    batchId: event.batchId,
    destWarehouseId: event.destWarehouseId,
    destStoreId: event.destStoreId,
    destStorageUnitId: event.destStorageUnitId,
    quantity: event.quantity,
    reason: event.reason,
    reference: event.reference,
    createdBy: event.createdBy,
    approvedBy: event.approvedBy,
    status: event.status,
    reversesEventId: event.reversesEventId,
    costImpact: event.costImpact,
    financialImpact: event.financialImpact,
    payload: (event.payload ?? null) as CanonicalValue,
  };
}

/**
 * The exact string that gets SHA-256'd. The `prevHash` prefix is what links
 * one row to the previous one: altering any earlier event changes its hash,
 * which changes every hash after it.
 */
export function buildHashInput(event: InventoryEvent, prevHash: string): string {
  return [
    prevHash,
    event.id,
    event.eventType,
    String(event.occurredAt),
    canonicalJson(chainedFields(event)),
  ].join('|');
}

export interface ChainLink {
  seq: number;
  prevHash: string;
  hash: string;
}

export interface ChainBreak {
  seq: number;
  expectedPrevHash: string;
  actualPrevHash: string;
}

/**
 * Walks a chain and reports every link whose `prevHash` doesn't match the
 * previous row's `hash`.
 *
 * Returns findings; it never deletes or blocks anything. Per UWOS §4,
 * detecting tampering raises a Data Integrity Alert — destruction is not an
 * acceptable response to a suspicion.
 */
export function findChainBreaks(links: ChainLink[]): ChainBreak[] {
  const breaks: ChainBreak[] = [];
  let expected = GENESIS_HASH;

  for (const link of links) {
    if (link.prevHash !== expected) {
      breaks.push({ seq: link.seq, expectedPrevHash: expected, actualPrevHash: link.prevHash });
    }
    // Continue from what this row actually claims, so one break reports once
    // instead of cascading a false failure onto every later row.
    expected = link.hash;
  }

  return breaks;
}
