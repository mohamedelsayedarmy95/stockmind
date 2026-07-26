# Inventory Event Engine — Event Schema

Design document for UWOS Master Spec §0. **Nothing here is built yet.** This is
the artifact §7.1 requires to exist and be agreed before the first line of
event-engine code.

Status: proposed · Targets local schema v7 · Author: design pass 2026-07-25

---

## 1. What changes, and the invariant this reverses

Today StockMind is a CRUD system: `stock_balances.quantity` is authoritative
and is mutated in place with `UPDATE`. `stock_movements` exists alongside it as
a log, but nothing reads it to determine truth.

The spec inverts that. After this change:

- **`inventory_events` is the only source of truth.** Append-only. No `UPDATE`,
  no `DELETE`, ever. A mistake is corrected by appending a compensating event.
- **`stock_balances`, `stock_balances_by_store`, `stock_batch_balances` become
  projections** — caches that can be dropped and rebuilt from the event log at
  any time without data loss.

> ⚠️ This directly reverses the invariant documented in the v6 work
> ("stock_balances is the single source of truth for how much can move"). That
> invariant was correct for a CRUD design and is wrong for this one. Every
> insufficient-stock check that currently reads `stock_balances` keeps working
> unchanged, because the projection still holds the same number — what changes
> is *who owns it*.

### What we already have that survives

`stock_movements` already records product, warehouse, store, storage unit,
batch, type, quantity, balance_after, notes and timestamps. Roughly 70% of an
event row already exists. The gap is semantic (it isn't authoritative) plus
nine missing envelope fields and thirteen missing event types — a data-layer
refactor, not a rewrite.

---

## 2. Event envelope

Every event, regardless of type, carries exactly these columns.

| Column | Type | Notes |
|---|---|---|
| `seq` | INTEGER PK AUTOINCREMENT | **Ordering key.** Replay order is `seq`, never `occurred_at` — wall-clock timestamps collide and can move backwards. |
| `id` | TEXT NOT NULL UNIQUE | UUID. Stable across sync, so the server can dedupe. |
| `event_type` | TEXT NOT NULL | One of §3. |
| `occurred_at` | INTEGER NOT NULL | Epoch ms, business time (may be backdated by the user). |
| `recorded_at` | INTEGER NOT NULL | Epoch ms, when the device actually wrote it. Never backdated. |
| `product_id` | TEXT | NULL for events not about one product (e.g. `CycleCountOpened`). |
| `warehouse_id` | TEXT | Source location for movements. |
| `store_id` | TEXT | |
| `storage_unit_id` | TEXT | |
| `batch_id` | TEXT | |
| `dest_warehouse_id` | TEXT | Destination side of a transfer/relocate. |
| `dest_store_id` | TEXT | |
| `dest_storage_unit_id` | TEXT | |
| `quantity` | REAL | Signed **delta in base units**. See §4. |
| `reason` | TEXT | Mandatory for the types marked ⚠ in §3. Enforced in code, not by SQL. |
| `reference` | TEXT | Invoice / order / transfer no. |
| `created_by` | TEXT NOT NULL | Local user id. |
| `approved_by` | TEXT | Set by Maker-Checker (Premium §3.1). |
| `status` | TEXT NOT NULL | `pending` \| `confirmed` \| `cancelled` \| `reversed`. Only `confirmed` events affect projections. |
| `reverses_event_id` | TEXT | Set on a compensating event; points at what it undoes. |
| `cost_impact` | REAL | Unit cost × quantity at event time. |
| `financial_impact` | REAL | Valuation effect (Premium §3.4). |
| `payload` | TEXT | Canonical JSON for type-specific fields that don't deserve a column (§3). |
| `prev_hash` | TEXT NOT NULL | §5. |
| `hash` | TEXT NOT NULL | §5. |
| `sync_status` | TEXT NOT NULL | `pending` \| `synced` \| `conflict`. |

Deliberately **absent**: `deleted_at`. Events are never soft-deleted; that is
the whole point.

---

## 3. Event types

⚠ = `reason` is mandatory. Δ = changes on-hand quantity.

| Type | Δ | ⚠ | Payload fields | Notes |
|---|---|---|---|---|
| `Receive` | ✓ | | `unit_cost`, `supplier_id`, `expiry_date`, `serials[]` | Creates the batch on first use. |
| `Issue` | ✓ | | `pick_strategy`, `picks[]`, `customer_id`, `serials[]` | `picks[]` = the FEFO/FIFO/LIFO split actually taken. |
| `Transfer` | ✓ | | `picks[]` | Emitted as **one** event with both source and dest set — not two half-events. |
| `Relocate` | | | | Moves stock between units inside the same warehouse. On-hand unchanged; per-unit projection changes. |
| `Reserve` | | | `expires_at`, `customer_id` | Reduces available, not on-hand. |
| `ReleaseReservation` | | | `reservation_event_id` | |
| `ConfirmReservation` | ✓ | | `reservation_event_id` | Converts a hold into a real `Issue`-equivalent deduction. |
| `Adjust` | ✓ | ⚠ | `counted_qty`, `expected_qty` | Never a plain deduction — must stay separable from sales in reports (§2.2). |
| `Count` | | | `cycle_count_id`, `counted_qty` | Records a count observation; emits `Adjust` only if it differs. |
| `Dispose` | ✓ | ⚠ | `photo_uri` | |
| `Return` | ✓ | ⚠ | `original_event_id`, `condition` | `condition` routes to sellable vs. quarantine. |
| `SplitLot` | | ⚠ | `into[]` | Conserves total; redistributes across new batch ids. |
| `MergeLot` | | ⚠ | `from[]` | |
| `Repack` | | ⚠ | `from_uom`, `to_uom`, `factor` | Quantity in base units is conserved. |
| `FreezeStock` | | ⚠ | | Blocks the quantity from being issued without deducting it. |
| `UnfreezeStock` | | ⚠ | `freeze_event_id` | |

**Invariant:** for every Δ type, `SUM(quantity)` over all `confirmed` events
for a (product, warehouse) pair equals that pair's projected on-hand. Any drift
means a projection bug, and the rebuild in §6 is the fix.

---

## 4. Sign and unit conventions

Two rules that prevent the most common event-sourcing bug in inventory systems:

1. **`quantity` is always a signed delta**, never an absolute. `Receive` is
   positive, `Issue` / `Dispose` negative, `Adjust` either. This makes a
   projection a plain `SUM` and makes reversal trivial (`-quantity`).
2. **`quantity` is always in the product's base unit.** Unit conversion
   (spec §2.2, `1 carton = 24 pieces`) happens at the UI/command boundary and
   the factor used is recorded in `payload.entered_uom` / `payload.factor` for
   audit. The event store never holds mixed units — otherwise every projection
   would need conversion logic and they would drift apart.

---

## 5. Hash chain (spec §2.4)

Tamper *evidence*, not tamper prevention.

```
prev_hash = hash of the row with the next-lower seq  (genesis: 64 × '0')
hash      = SHA256(prev_hash + '|' + id + '|' + event_type + '|'
                   + occurred_at + '|' + canonicalJson(chainedFields))
```

`chainedFields` = every envelope column in §2 **except** `seq`, `prev_hash`,
`hash`, `sync_status`. Excluding `sync_status` matters: syncing must be able to
update it without breaking the chain.

`canonicalJson` = keys sorted lexicographically, no whitespace, numbers in
shortest round-trip form. Both writer and verifier must use the identical
implementation or every check fails.

Implementation: `expo-crypto`'s `digestStringAsync(CryptoDigestAlgorithm.SHA256, …)`
— already a dependency, no new package.

**Verification** walks the chain and, on the first mismatch, marks that row and
raises a `Data Integrity Alert` (spec §4). It does **not** delete or block
anything — per the spec's explicit rule that detection never triggers
destruction.

Cost: one SHA-256 per write. Verification is O(n) and belongs in a background
job (spec §5.2), not on the hot path.

---

## 6. Projections (Read Models)

Every table below is derived and disposable.

| Projection | Built from | Used by |
|---|---|---|
| `stock_balances` | `SUM(quantity)` per (product, warehouse) | availability, insufficient-stock checks |
| `stock_balances_by_store` | same, per (product, store) | section breakdown |
| `stock_batch_balances` | same, per (batch, location) | FEFO/FIFO/LIFO picking |
| `available_qty` | on-hand − active `Reserve` − active `Freeze` | dispatch cap |
| `inventory_ledger` | ordered events per product | opening → receipts → issues → adjustments → closing |
| `cost_ledger` | `cost_impact` replayed under the chosen valuation method | §3.4 |
| `lot_trace` | events filtered by `batch_id`, ordered by `seq` | §2.2 lot traceability |
| `dashboard_kpis` | aggregates over events | §3.11 |

**Rebuild procedure** (must be a single callable function from day one, because
it is the only thing that makes projection bugs cheap):

```
BEGIN
  DELETE FROM <all projection tables>
  FOR each event ORDER BY seq WHERE status = 'confirmed'
      apply(event)          -- the same reducer the live write path uses
COMMIT
```

The live write path and the rebuild **must call the same reducer**. Two
implementations of "apply an event" will diverge; that divergence is the classic
way event-sourced systems start lying.

---

## 7. State machines (spec §0.2)

Transitions are themselves events, so history is preserved. Illegal jumps are
rejected by a transition table, not by scattered `if`s.

```
Reservation:    draft → pending → reserved → confirmed
                          ↘ cancelled    ↘ expired
Transfer Order: created → approved → picked → in_transit → received → completed
                     ↘ cancelled (only before picked)
Return:         requested → received → inspection → accepted → disposed
                                              ↘ rejected
```

---

## 8. Migration from schema v6 — must not lose live data

There is **real user data on a physical device already** (products, warehouses,
sections, storage units, batches, an active reservation). The migration must
preserve it, so it cannot start with an empty event log.

Plan for v7:

1. Create `inventory_events` empty.
2. **Backfill history** from `stock_movements` in `created_at` order: map
   `inbound`→`Receive`, `outbound`→`Issue`, carrying across store/unit/batch/
   strategy/notes. `created_by` = the local user, `reason` = `'migrated'`,
   `status` = `'confirmed'`.
3. **Emit a genesis reconciliation event** per (product, warehouse) whose
   quantity is `current_balance − SUM(backfilled deltas)`, typed `Adjust` with
   `reason = 'opening balance (migration v7)'`. This absorbs any stock that
   exists without a movement behind it — which is the case for anything seeded
   before the movements ledger was complete. Without this step, projections
   would rebuild to a *smaller* number than the user sees today, i.e. apparent
   data loss.
4. Convert the existing active `reservations` rows into `Reserve` events.
5. Compute the hash chain over the backfilled rows in `seq` order.
6. Run the §6 rebuild and **assert** every projected balance equals the
   pre-migration value. Abort the transaction on any mismatch rather than ship a
   silently wrong ledger.

Step 6 is the acceptance test for the whole migration and should be automated,
not eyeballed.

---

## 9. Out of scope for the first cut

Named so they don't get smuggled in: Maker-Checker approvals, cost/financial
impact beyond storing the columns, cloud sync of events, WebSocket
collaboration, ABC classification, supplier performance. All read from the same
log later without schema change — which is the point of doing this now.

---

## 10. Open questions for sign-off

1. `Relocate` and `Repack` don't change on-hand but do change per-unit
   projections. Confirm they should be full events (audit value) rather than
   projection-only updates.
2. Should `Count` always be persisted, or only when it produces an `Adjust`?
   Persisting always gives inventory-accuracy KPIs (§3.11) real input.
3. Hash-chain verification cadence: on every app start (slow as the log grows)
   or only in the nightly background job?
4. `Reserve` expiry — enforced by a background job emitting
   `ReleaseReservation`, or evaluated lazily on read?
