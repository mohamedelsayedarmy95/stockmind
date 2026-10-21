# StockMind Series 04: checkpoint (2026-10-21)

This file is **tracked** on branch `integration/series04`, unlike the Series 03 checkpoint, which only lived untracked in a worktree.

Status of the surroundings:
- Production is untouched: `bb071ed`, never contacted.
- RC `rc4/release-candidate` = `1447ade` is untouched.
- Local `main` = `45d9e18` is untouched, dirty files included (hashes below).
- No AAB was built or uploaded, nothing went to Google Play or Internal Testing, and nothing was deployed.

## 1. Branch topology and integration decision record

| Ref | SHA | Role |
|---|---|---|
| `feature/shared-warehouse` | `02c53f5` | Series 02 backend (team, warehouse access, idempotency, sync cursor, entitlements) |
| `feature/series03-sync` | `55348a6` | Series 03 backend (cursor anchors + reset); parent `02c53f5` |
| `mobile/offline-outbox` | `ac9ba6b` | Series 03 mobile; contains `mobile/shared-online` `0510bc9` and `mobile/shared-sync` `905f535` |
| `rc4/release-candidate` | `1447ade` | RC line (not merged) |
| **`integration/series04`** | see the push in section 8 | **new**: worktree `D:\Projects\StockMind-wt\series04-integration` |

- **Merge base** of the backend and mobile lines: `14804c4`.
  - Since `14804c4`, the backend line (8 commits) never touches `mobile/`, and the mobile line (15 commits) touches nothing outside `mobile/`.
  - Root `package-lock.json` is identical at `02c53f5` and `55348a6`. `mobile/package-lock.json` is identical at `14804c4`, `55348a6` and `ac9ba6b`.
- **Integration method:**
  - base `55348a6`, then `git merge --no-ff mobile/offline-outbox`, giving `5e4c5be`;
  - no conflicts, no resolutions, no double-applied history (ancestry verified with `merge-base`).
- **Omitted:** `1447ade` (an RC test-only commit). Its change (order the ledger chain by `running_balance`) is already in the integration tree's `tests/integration/tenant-concurrency.pg.spec.ts`.
- **Feature branches were not modified.** All new work is committed on `integration/series04` only.
- **Rollback:** delete the branch, or reset a consumer to `55348a6` (backend) or `ac9ba6b` (mobile). There are no migrations to reverse.

**Dirty `main` preserved.** SHA-256 prefixes were recorded before the work and re-checked at the end:

| File | SHA-256 prefix |
|---|---|
| `DEPLOYMENT_CHECKLIST.md` | `EC9C860261853797` |
| `tests/integration/notification.flow.spec.ts` | `B0C4BC087BDD8B25` |
| `PHASE_7_CHECKLIST.md` | `351A1324E88D4911` |
| `tests/integration/stock-cache.invalidation.spec.ts` | `FA4A1982AB28A393` |

Also unchanged: `scripts/` (4 files) and `.ai-handoff/` (58 files). The Series 03 backup `D:\StockMind_Backups\Checkpoints\SERIES_03_CHECKPOINT_2026-10-20.md` was verified (`B555D4D2…26A6`) and left untouched.

## 2. What changed in Series 04 (on `integration/series04`)

| Commit | Change |
|---|---|
| `5e4c5be` | merge of Series 03 mobile into the Series 03 backend line |
| `e43daad` | backend: `POST /stock/operations/lookup`, `@SkipAudit` for read-only POSTs, PG tests |
| `c84673f` | mobile domain: receipt knowledge vs stock truth; reconciliation rules; 7-day receipt retention |
| `2038e46` | mobile runtime/UI: re-check on reset and at session start; history-changed review with re-entry; slow-server sends |
| `6b975bc` | wording: "not confirmed yet" for pending lines |
| `d69f6e8` | test harness: listen once in concurrent PG specs (characterized supertest race) |

### P0: reconciliation after a server history restore

**Stock truth vs receipt knowledge.** Stock figures come only from the server (snapshot/delta; a reset snapshot replaces everything). A local receipt is evidence that the server *once* committed an operation. After a cursor reset, every receipt is "re-checking" until the server confirms it again.

**Server contract** (additive, older clients unaffected). `POST /stock/operations/lookup` takes `{operations: [{key, movementId?}]}` (at most 100). It is scoped to the caller's company and the caller's own operations, and reads one REPEATABLE READ snapshot. Statuses:

| Status | Meaning |
|---|---|
| `present` | The caller's own movement is in the ledger now, with its current revision. |
| `absent` | Neither the ledger nor the idempotency records hold a trace for this caller. **This means "not in current history", not "never happened".** |
| `indeterminate` | A key record exists without its movement, or the claim is unfinished, or the operation kind is not resolved. |
| `unavailable` | The movement is in a warehouse the caller can no longer use; nothing more is disclosed. |

- Another user's or another company's key or movement id reads as `absent`, the same as an unknown one.
- The endpoint is read-only and is not audited as a CREATE.

**Client rules:**

| Server answer | Client result |
|---|---|
| present + matching (movement id, warehouse, product, type, quantity) | verified; the receipt takes the server's current revision |
| absent | **NEEDS_REVIEW "history changed"** |
| mismatch | NEEDS_REVIEW "history mismatch" |
| indeterminate / unavailable | "could not be re-checked (reason)"; never shown as plain "Confirmed" |

A "history changed" action:
- is **never re-queued** and never retried automatically;
- keeps its last receipt (time, movement id, revision) as evidence;
- can be **acknowledged**, or **re-entered by a person** as a NEW action. A re-entry gets a new key and a ledger note naming the original action.

**What cannot be guaranteed:**
- After a destructive restore, nobody can tell from the database alone whether the lost operation should exist. That is a business decision, so it is left to a person.
- If a restore is later undone, a re-entered action would exist twice. That requires an operational procedure, not code.
- Detection assumes point-in-time restores (the history prefix is preserved). It triggers when this device polls the warehouse (cursor anchor), plus a quiet check of every kept receipt once per account per app run.
- Receipts are kept 7 days; older ones are not reconciled.

### Other fixes and hardening

- **Cold start** (Render free ~42 s): send and poll timeouts are 60 s. The screen waits at most 8 s, then says "Sending…" while the same-key send finishes in the background. One HTTP attempt and one movement were verified.
- **Audit:** read-only lookup POSTs are excluded from the audit interceptor (`@SkipAudit`, an optional `Reflector`). Otherwise each lookup would have been logged as a CREATE carrying the results.
- **Seats** (code review plus the existing `entitlements.pg.spec`): an invitation requires `seats + pending invitations < limit`, and acceptance counts only actual seats. `ENTITLEMENTS_ENFORCED` stays off by default (log-only).

## 3. Cross-layer contract (compact)

| Operation | Who | Request | Success | Refusals and client handling |
|---|---|---|---|---|
| Receipt/dispatch | Admin/Manager; Staff on granted warehouses | `POST /stock/{inbound,outbound}` with `Idempotency-Key` = intent id (UUID) | 201 movement `{id, revision, runningBalance}`; replay → same body + `replayed:true` | below |
| Transfer/adjustment | role permissions | same, online-only (never queued) | 201 | same codes |
| Changes | VIEW_MOVEMENTS + warehouse scope | `GET /stock/changes/:w?since&anchor&limit` | delta, or snapshot with `reset` | 404 → cached figures dropped from screen and device |
| Lookup | VIEW_MOVEMENTS | `POST /stock/operations/lookup` | per-operation status | 400 bad input; 401 → refresh |
| Sign-in | public | `/auth/login` → tokens or `{requires_2fa, temp_token}` → `/auth/2fa/login`; `/auth/accept-invitation` | tokens | 401 / 429 mapped |

Refusal handling for writes:
- **409** (insufficient stock): nothing was recorded, so retrying unchanged is allowed.
- **422** (same key, different request): held for review.
- **404/403** (no access): refused, or review if an earlier attempt may have landed.
- **401**: refresh the token, then wait for the same account.
- **402**: plan limit; only when enforcement is enabled.
- **Network failure, 408, 429, 5xx**: retried with the same key and backoff.

Types: `revision` is a decimal string (bigint-safe); `anchor` is a uuid or null. Old clients send no anchor and get the pre-Series-03 behaviour (tested).

## 4. Gates (fresh, this series, on the integrated tree)

| Gate | Result |
|---|---|
| Backend `tsc --noEmit` / clean `nest build` (ignored tsbuildinfo removed in this worktree only) | 0 / exit 0, `dist` complete |
| Backend real-PG full suite, integrated tree before the P0 commits | 40/40 suites, 246/246 (fresh DB `stockmind_s04_integration_1`) |
| Backend real-PG full suite, `6b975bc`, 3 runs on fresh DBs | runs 1–2: 41/41, 255/255. **Run 3: 1 failed (254/255)**, `read ECONNRESET` in the new concurrent cursor-reader test |
| Flake characterization (same spec, 8 runs each) | old harness 2/8 failed (both ECONNRESET); listen-once harness 0/8. Cause: supertest 7.2.2 `listen(0)`/`close()` per request on a shared server; Node 26 `close()` drops idle keep-alive sockets. Fixed in the harness (`d69f6e8`), assertions unchanged |
| Backend real-PG full suite, **HEAD `d69f6e8`, 3 consecutive runs** on fresh DBs | **41/41 suites, 255/255 tests, 3 of 3 runs** |
| New PG specs | `operation-lookup.pg.spec.ts` 8 tests; `sync-cursor-reset.pg.spec.ts` +1 concurrent-reader test (6 total) |
| Mobile `tsc --noEmit` / `jest` | 0 / 14 suites, 203/203 |
| Migrations | none added in Series 04. Existing round-trip specs (shared-warehouse, entitlements) run inside the full suite. |

Environment:
- PostgreSQL 15.19: official EDB portable zip, re-downloaded because temp cleanup had removed the earlier copy; size and SHA-256 match the recorded values. It runs as a throwaway cluster on 127.0.0.1:55433 under `D:\Projects\StockMind-wt\_local-tools\`.
- Gate script: `_local-tools\scripts\backend-gate.ps1`. It only accepts `stockmind_s04_*` databases, sets gate-only secrets, and reads no `.env`.

## 5. Physical device evidence

Setup: Huawei JSN-L22, Android 10, debug APK + Metro from the integration worktree, local backend on a throwaway DB. The second actor was an API client (Manager A). **This is not a two-phone test.**

| Capability | State | Evidence |
|---|---|---|
| Login + 2FA (Staff B) | PASS | phone |
| Offline dispatch saved, figure unchanged, pending shown apart | PASS | phone `06` |
| Reconnect → confirmed once | PASS | phone `07` + ledger rev 3 + HTTP trace |
| Slow server (45 s hold): "Sending…" after 8 s, 1 HTTP attempt, 1 movement | PASS | phone `08`/`09` + trace + ledger rev 4 |
| Restore erases a confirmed dispatch (movement + key), revision 4 reused by Manager A | PASS | ledger before/after |
| Reset detected; true figures; erased dispatch → "Needs review · history changed" with its receipt; the surviving one "Confirmed · re-checked" | PASS | phone `10`/`11` |
| Erased key never re-sent | PASS | trace: `d1b20f34` sent once, before the restore |
| App kill → (Director's fingerprint) → review state persisted, quiet re-check ran, no write sent | PASS | phone `13` + trace |
| Human re-entry: new key, ledger note naming the original | PASS | phone `15`/`16` + ledger rev 5 |
| Arabic review screen | PASS | phone `14` |
| Cross-user/company lookup isolation, revoked access | PASS (PG integration) | `operation-lookup.pg.spec.ts` |
| Revocation / account isolation / sign-out warning / cached-list fallback on device | PASS in Series 03 (device); unchanged code paths | Series 03 evidence |
| Two physical devices | NOT DONE | one phone |
| iOS build | UNVERIFIED | no macOS/Xcode |
| Real Redis | UNVERIFIED | not needed by any changed path |

Evidence: `docs/handoff/series04-evidence/` holds 12 screenshots, `server-ledger-W1.txt` and `http-trace-proxy.txt`. All data is dummy.

**Read-only "Weapon" investigation.** The phone's own offline activity log shows three items created in the app UI on 2026-10-20:
- "Weapon" at 22:00:41;
- "s" (its section) at 22:01:11;
- "akm" at 22:35:36.

These are before any Series 03 automation, which started at ~22:38. Only the warehouse counts toward "local changes", which explains 4→5 exactly. Nothing was modified. The screenshot is kept locally (`_local-tools\evidence-s04\01-offline-activity-log.png`), not pushed.

**Phone state at the end:** English, offline, "Device Tester", 1 product, 2375.00, 5 local changes (unchanged).

## 6. iOS portability (review only)

- No new platform-specific code: MMKV, expo-crypto, AppState and globalThis are cross-platform, and the new code has no `Platform.OS`.
- Gaps remain:
  - an iOS profile in `eas.json`;
  - the Google Sign-In `iosUrlScheme` (needs the iOS client id);
  - a real pinned certificate instead of the placeholder (no TLS bypass);
  - the iOS notification permission flow.
- An iOS build needs macOS/Xcode or a paid EAS build. Neither was attempted.

## 7. Free-tier cost and reliability

- **Load:**
  - polling is 1 GET per 45 s per open stock screen (about 80/hour); 20 active staff ≈ 1,600 indexed range scans per hour;
  - writes are 1 request each;
  - lookups are 1 per reset plus 1 per account per app start (only when receipts are kept);
  - the backoff cap is 5 min, so there are no storms;
  - no WebSocket and no instant push is claimed.
- **Reliability:** Render free sleeps (~42 s cold start), and the client tolerates it with 60 s timeouts and same-key sends.
- **Upgrade triggers (measured, no prices assumed):**
  - the first paying team → an always-on instance;
  - p95 `/stock/changes` latency above ~300 ms, or sustained database CPU above ~70%, → a bigger database or a cache (Redis still needs real verification first);
  - cold starts noticed by users → an always-on instance.

## 8. Release decision

- **(a) Development integration: CONDITIONAL GO.** `integration/series04` is coherent and gate-green, and is ready for Director review. Conditions:
  - the Director reviews the P0 semantics (re-entry is human-only);
  - the RC/main merge strategy is decided separately (`1447ade`-equivalent content is already present).
- **(b) Production: NO-GO / deferred.** Online mode stays a dev preview. The RC promotion conditions are unchanged, and production needs its own preflight and approval.

## 9. Services, ports, cleanup

- Started and stopped by this series: backend :3000, lossy proxy :3001, Metro :8081.
- `adb reverse` entries were added and then removed; the list was empty before and after.
- PostgreSQL :55433 (`_local-tools\pgdata-s04`) was stopped at the end; its data is kept on disk and holds throwaway data only.
  Restart it with:
  `_local-tools\pg15\pgsql\bin\pg_ctl.exe -D _local-tools\pgdata-s04 -o "-p 55433 -c listen_addresses=127.0.0.1" start`
- At the end, ports 3000, 3001, 8081 and 55433 were free and the `adb reverse` list was empty.
- Scripts in `_local-tools\scripts\`: `backend-gate.ps1`, `start-backend.ps1`, `start-metro.ps1`, `lossy-proxy.mjs`, `online-slice.mjs`, `ui.js`, `add-i18n-s04.js`.

## 10. Open items / next actions

1. Director review of `integration/series04` (P0 semantics, the human-only re-entry).
2. Server-side "history epoch" or a restore runbook, so operators can mark a restore explicitly; today it is detected through anchors.
3. Cleanup job for `stock_idempotency_keys` (P2). The lookup already falls back to the movement id.
4. Viewer role and multi-organization memberships (`users.company_id` is single). Path: a memberships table, a token per active company, and the scope key already includes `companyId`.
5. A real two-device test when a second phone exists, and an iOS build when macOS/EAS is approved.
6. The `tenant-concurrency` "suite failed to run" seen once in Series 03 did not recur in 6 full runs this series. The
   listen-once harness now also covers that spec. The Series 03 log was lost with the scratchpad, so its cause is not proven.
