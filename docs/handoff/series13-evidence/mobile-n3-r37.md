# Series 13 — N-3 (administrative errors) and R-37 (balance truth) on mobile

## R-37 root cause (code, before)
`mobile/app/movement/[productId].tsx` (Receive and Dispatch), Series 12 code:

```ts
const onHand =
  syncedBalance !== undefined ? Math.floor(Number(syncedBalance))
  : balance ? Math.floor(Number(balance.baseQuantity))
  : 0;                                         // ← nothing arrived (loading, error, unreachable) = "0"
… {tr('common.currentBalance')}: {onHand}      // "Current balance: 0"
```
The same fallback was in `app/product/[productId].tsx` (`balance ? … : 0`, transfer card), and
`ApiStockRepository.availability` turned an unreadable figure into 0 (`Number(x) || 0`). The online stock list
(`OnlineWarehouseStock`) showed "Loading…" for ever when the first sync failed (loading and failure indistinguishable).
The Dispatch screen with an unknown balance said "Enter a whole number from 1 to 0".

## After
`mobile/src/domain/balance-truth.ts` (pure): `confirmed` (server / device; a confirmed 0 is real) · `last-known` (with the time of
the last successful sync) · `loading` · `unknown` (`unreachable`, `no-access`, `mismatch`, `invalid`, `no-warehouse`).
- an answer for another product or warehouse is never shown (`mismatch`); a denied warehouse shows no figure even from cache;
- after a snapshot a product without a row is a confirmed 0 (unless the direct request answered for exactly that product);
- `issuableOnline`: an unknown balance allows no dispatch; queued dispatches lower the limit; **queued receipts never raise the
  figure or the limit**;
- screens: Receive/Dispatch, product transfer card, online stock list. Copy in English and Arabic (`balance.*`,
  `online.stockUnreachable`, `online.stockEmptyLastKnown`).

## N-3
`mobile/src/domain/admin-errors.ts`: 503 `AUTHORITY_BUSY` → `busy` (warning, "nothing was changed — try again in a moment",
re-read); 409 `SCOPED_GRANTS_PRESENT` → `grant-conflict` (error, points to «صلاحيات المخازن» / Warehouse access, not retryable);
503 without a code → `unavailable`; no response → the surface's network copy; everything else → the surface's existing map.
Wired into Team, Warehouse access, New warehouse (CP-4). The mutations stay `retry: false`; the HTTP client re-sends only after a
401 refresh (static tests). Busy keeps the draft and re-reads the affected lists; no success state in any `onError`.
`SCOPED_GRANTS_PRESENT` is sent only by the legacy `PUT /team/members/:id/warehouses`, which no mobile screen calls (grep): mapped
defensively.

## Tests
`balance-truth.test.ts` (15), `admin-errors.test.ts` (12), plus updated `team-actions.test.ts`, `capabilities.test.ts`,
`access-revocation.test.ts` (now checks the key each code actually resolves to), `ui-contract.test.ts` (+2 screens). Mobile Jest:
24 suites / 387 tests at `7f47a36` (Series 12: 22 / 359). Device results: see the report §11.
