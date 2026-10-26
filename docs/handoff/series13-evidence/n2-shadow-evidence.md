# Series 13 — N-2 shadow evidence windows (real PostgreSQL 15.19 + real HTTP + unit)

Raw observations: `n2-shadow-observability.jsonl` (spec `tests/integration/shadow-observability.pg.spec.ts`). Unit specs:
`tests/unit/shadow-window.spec.ts`, `tests/unit/capability-shadow.window.spec.ts`, `tests/unit/capability-shadow.service.spec.ts`
(Series 11 suite, extended), `tests/unit/http-logger.redaction.spec.ts` (extended), `tests/unit/tenant-middleware.auth-contract.spec.ts`
(public-route allowlist + guard assertion).

## Before
`CapabilityShadowService.snapshot()` had **no caller** in `src/` (Mission 00 N-2, re-verified: `grep -rn "snapshot()" src` → only the
definition). `incomplete` was a counter only (never logged). The 50-entry ring dropped older differences without a count; `reset()`
left no trace; nothing identified the process or the period. A rehearsal could not prove "0 unexpected / 0 errors / 0 incomplete".

## After — what an out-of-process reader saw (HTTP, operator diagnostics)

| Window (label) | Traffic | compared | equal | expected | unexpected | errors | incomplete | Verdict |
|---|---|---|---|---|---|---|---|---|
| `legacy-traffic` | owner + Staff, 9 requests each | 31 | 31 | 0 | 0 | 0 | 0 | **CLEAN** (`parityObserved: true`) |
| `scoped-grant` | Staff with a `warehouse_manager` grant tries an adjustment (legacy 403) | 1 | 0 | 1 (names the grant) | 0 | 0 | 0 | **CLEAN** |
| `widening` | loader replaced: Staff judged as Manager | 15 | 8 | 0 | **7** (6 `unjustified-expansion` on `WarehouseAccessService.scope`, 1 `unexplained` on `StockController.adjustment`) | 0 | 0 | **UNEXPECTED_DIFFERENCES** |
| `missing-principal` | loader returns null | 0 | 0 | 0 | 0 | 0 | **15** (`no-principal`) | **INCONCLUSIVE** (`incomplete:15`, `nothing-compared`) |
| `failing-model` | loader throws (message echoes an e-mail) | 0 | 0 | 0 | 0 | **15** | 0 | **INCONCLUSIVE**; the e-mail is in no report or log line |

In every window the **answers were the legacy ones** (Staff: own warehouse 200, other 404, adjustment 403).

Access (all from the same loopback connection): unknown route 404; route with the token unset 404; wrong token 404; the owner's JWT
404 (GET and POST); operator with token 200 + `Cache-Control: no-store`; invalid label 400. Every refusal body =
`Cannot <METHOD> <path>` exactly like an unknown route.

Privacy (HTTP report JSON): contains none of the three member ids, two e-mails, two JWTs, the diagnostics token, the cost
sentinel `7319.47`, or the word `costPrice`. Members appear as a 16-hex per-process pseudonym.

Evidence script (`scripts/shadow-evidence.mjs`), end to end: `open s13-script` → traffic → `close` = exit 0, `trusted: true`,
`CLEAN`, report file SHA-256 verified against its `.sha256` file, token absent from the file. Then `open s13-restart` → **the app
was closed (shutdown line `capability-shadow-window-closed` with `closeReason: shutdown` logged)** → a new app booted → `close` =
exit **3** `RESTART_DETECTED` (expected instance ≠ got instance; the new one is at window sequence 1). A non-loopback base URL is
refused before any request (exit 64).

## Unit-level behaviour (examples)
- `judgeWindow`: every branch; reasons listed most severe first; nothing-compared with incomplete = INCONCLUSIVE.
- 130 unexpected + 60 expected differences: counters exact, first 100 unexpected kept (`R.0` first), 30 dropped counted; last 50
  expected kept, 10 dropped counted; 130 routes counted exactly; 100 warn lines written, 30 counted as suppressed.
- reset + operator window: closed windows summarized (`UNEXPECTED_DIFFERENCES` window kept on record) and logged.
- guard: requests in `off` are counted (`guardedByMode {shadow:1, off:1}` → INCONCLUSIVE `requests-outside-shadow:1`).
- access: token < 32 chars or unset = off; only the socket peer counts (`X-Forwarded-For: 127.0.0.1` from 10.1.2.3 is refused).

## Limits
In-memory, per process; no aggregation across instances; not an audit trail or monitoring. A multi-instance rehearsal must read
every instance and match instance ids. Timing-dependent counts (e.g. how many requests a window saw) are what the window observed,
nothing more.
