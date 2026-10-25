# STOCKMIND — AI CONTINUITY (canonical)

> **ACTIVE canonical location (since Series 09, 2026-10-25):** `docs/handoff/STOCKMIND_AI_CONTINUITY.md` on branch **`feature/series09-access-foundation`**, worktree `D:\Projects\StockMind-wt\series09-access-foundation`. This branch is a **superset of `design/series08-enterprise-blueprint`** (Series 07 code + `docs/product/`) **plus the Series 09 code** (S0 cost-price privacy, S1 member lifecycle and immediate revocation) and its handoff.
> **The copies of this file and of the bridge on `design/series08-enterprise-blueprint`, `feature/series07-recovery-integrity`, `hardening/series06-release-safety`, `preflight/series05-rc-admission` and `integration/series04` are OLDER and stale.** Do not read them as current.
> **Portable copy (identical to the canonical file):** `C:\Users\Name\Desktop\StockMind_Handoff\STOCKMIND_AI_CONTINUITY_MASTER.md`.
> **Last updated:** 2026-10-25 (after Series 09: S0 + S1 implemented and tested on a development environment; no device run by safety decision; Production NO-GO). Last product-code commit `00b494e`, last tested commit `3b9bb69`; later commits are docs/evidence only.
>
> This file is a map, not proof. **Git history and the code win over this file.** Labels: VERIFIED, PARTIAL, UNVERIFIED,
> NOT DONE.

---

## MANDATORY AI SESSION START / END PROTOCOL

**At session start**
1. Read this file first, then `docs/handoff/STOCKMIND_AI_BRIDGE.md` (the ChatGPT↔Claude bridge: current task, approvals, risks, next step).
2. Read **only** the linked checkpoint or source needed for the task (section H). Do not re-audit the repo.
3. Check reality before acting:
   ```powershell
   git -C D:\Projects\StockMind worktree list
   git -C D:\Projects\StockMind-wt\series09-access-foundation status -sb
   git -C D:\Projects\StockMind-wt\series09-access-foundation log --oneline -10
   git -C D:\Projects\StockMind status --porcelain=v1
   ```
4. If anything here conflicts with Git or the code, trust the repo, fix this file, and say so.
5. Continue from the last validated checkpoint. Do not repeat completed phases.

**During work**
- Follow sections D and E.
- Record newly discovered facts and changed decisions here, briefly.

**At each significant milestone and before ending a session**
1. Update section C (status, commits, tests, blockers) and section G (next action).
2. Append a dated entry to the Change log (section I).
3. Link to evidence instead of pasting large reports.
4. Update `docs/handoff/STOCKMIND_AI_BRIDGE.md` (all current-state sections plus its changelog); mirror it to `C:\Users\Name\Desktop\StockMind_Handoff\STOCKMIND_AI_BRIDGE.md`.
5. Save this file, commit both on the working branch if allowed, and copy this file to the Desktop path above.
6. Verify each canonical/Desktop pair has an identical SHA-256, and report whether the change is committed and pushed.

Update only on meaningful state changes. Do not rewrite the whole file for small edits.

**Copy-ready startup line for any AI:**
> Before any work on StockMind, read `D:\Projects\StockMind-wt\series09-access-foundation\docs\handoff\STOCKMIND_AI_CONTINUITY.md` (branch `feature/series09-access-foundation`; the `series08-enterprise-blueprint`, `series07-recovery-integrity`, `series06-release-safety`, `series05-rc-preflight` and `series04-integration` copies are stale) or the Desktop copy `StockMind_Handoff\STOCKMIND_AI_CONTINUITY_MASTER.md`). Follow its start/end protocol and its approval boundaries. If a message says something is "attached" and nothing is, stop and ask; do not guess the scope.

---

## A. Product vision

- **What it is.** StockMind is a cross-platform inventory/WMS app (React Native) with a NestJS + PostgreSQL backend.
  - It serves shop owners, warehouse managers and staff who receive, dispatch and transfer stock.
- **Business model.** Freemium SaaS:
  - **Free**: individuals; 1 seat, 1 warehouse, no team sharing.
  - **Pro**: 3 seats, 3 warehouses.
  - **Business/Team**: 15 seats, 10 warehouses.
  - **Enterprise**: unlimited.
  - These limits are in the code (`src/infrastructure/billing/entitlements.service.ts`), but enforcement is **off** (`ENTITLEMENTS_ENFORCED`). No real billing exists yet. Future billing: Google Play Billing, then StoreKit, as backend receipt-verification adapters.
- **Core value.** Several authorized employees share one **server-authoritative** stock ledger:
  - Admin, Manager and Staff roles (RBAC), with warehouse-scoped access for Staff;
  - idempotent writes;
  - offline intents that never fake committed stock;
  - honest sync states.
- **Platforms.** Android is tested on a physical device. iOS is a goal: the code is kept portable, but iOS has never been built.
- **Infrastructure strategy.** Free tiers first and portable: Render (free web service, sleeps; ~42 s cold start measured), Neon PostgreSQL, Firebase (FCM, Google sign-in).
  - Redis is optional (the cache disables itself without `REDIS_URL`).
  - Upgrade only on measured triggers: the first paying team gets an always-on instance; p95 `/stock/changes` above ~300 ms or sustained DB CPU above ~70% gets a bigger DB or a cache.

## B. Technical architecture

- **Backend** (repo root):
  - NestJS `^10.3`, TypeORM `^0.3.20`, PostgreSQL (tested on 15.19), CQRS for stock commands, pino logs.
  - Entry: `src/main.ts` (global prefix `api/v1`); module wiring in `src/app.module.ts` (`migrationsRun: true`, `synchronize: false`).
  - Layers: `src/presentation` (controllers, guards, decorators, interceptors), `src/application` (DTOs, commands, queries), `src/infrastructure` (services, security, billing, cache), `src/domain/entities`, `src/migrations`.
- **Auth.**
  - JWT access + refresh. Refresh tokens are stored as a SHA-256 hash.
  - TOTP 2FA: `/auth/login` returns `{requires_2fa, temp_token}`, then `/auth/2fa/login`. The 2FA replay guard is in migration `1792473600000`.
  - Brute-force lockout, Google sign-in through Firebase, optional SAML.
- **RBAC.**
  - `src/shared/constants/permissions.constant.ts`: Admin has all permissions; Manager has everything except users/roles; Staff has view, inbound, outbound, balance and movements.
  - Warehouse scope is checked on every request: `WarehouseAccessService` / `@WarehouseScoped`.
- **Mobile** (`mobile/`):
  - Expo SDK 51, React Native 0.74.5, expo-router (`mobile/app/`), TanStack Query, zustand.
  - Encrypted MMKV for session, outbox and caches; SQLCipher (`op-sqlite`) for offline data.
  - Domain rules in `mobile/src/domain` (Node-tested); sync runtime in `mobile/src/sync`.
- **Migrations, in order:**
  1. `1721700000000` Phase1Foundation
  2. `1721800000000` Phase2RbacAudit
  3. `1721900000000` Phase4Security
  4. `1722000000000` SamlSso
  5. `1722345600000` FcmTokens
  6. `1792473600000` TotpLastAcceptedStep
  7. `1792560000000` SharedWarehouseFoundation (warehouse access, invitations, idempotency keys, revisions)
  8. `1792570000000` CompanyEntitlements
  9. `1792580000000` StockRevisionGuard (Series 06: revision trigger, repair, unique index)
  10. `1792590000000` RecoveryIntegrity (Series 07: `companies.history_generation`, `warehouses.history_floor_revision`, `history_generation_events`, `stock_replacements`; fail-closed `down()`)

  Series 03 and 04 added none.
- **Key API contracts** (details: `docs/handoff/SERIES_04_CHECKPOINT.md` §3):
  - `POST /stock/{inbound,outbound,adjustment,transfer}` with `Idempotency-Key`. A replay returns `replayed:true`; the same key with a different body gets 422; insufficient stock gets 409.
  - `GET /stock/changes/:w?since&anchor&limit` returns a delta, or a snapshot with `reset` when the cursor is invalid.
  - `POST /stock/operations/lookup` returns present / absent / indeterminate / unavailable.
  - **Series 07:** `GET /stock/changes/:w` also takes `generation` and returns `generation`, `resetReason` (no-store); `POST /stock/operations/lookup` returns `{generation, operations[]}` with `superseded` and `coexisting-replacement`; `POST /stock/replacements/{inbound,outbound}` (Idempotency-Key required; structured 409 `code`s); Admin-only `POST /recovery/history-generation/rotate` (+ `GET`), off unless `RECOVERY_OPERATIONS_ENABLED=true`. Write responses carry `historyGeneration`. Full contract: `docs/handoff/SERIES_07_RECOVERY_CONTRACT.md`.
  - Team (Admin only): `POST/GET/DELETE /team/invitations`, `GET /team/members`, `PUT /team/members/:id/warehouses`, `GET /team/entitlements`. Public: `POST /auth/accept-invitation`.
- **Environments.**
  - Production: Render service from `release/prod-hotfix-f4` @ `bb071ed`, auto-deploy off (**reported, UNVERIFIED this series**). Production has none of Series 02–04.
  - The mobile release build shows online mode as "Cloud sync coming soon".
  - **Online Preview** works only in a `__DEV__` build with `EXPO_PUBLIC_ONLINE_MODE=1` and an explicit `EXPO_PUBLIC_API_BASE_URL` (`mobile/src/lib/dev-flags.ts`), against a **local** backend.

## C. Engineering state (2026-10-25, after Series 09)

**Branches** (all pushed except local `main`; nothing merged into RC/main; nothing deployed):

| Ref | HEAD | Worktree | Notes |
|---|---|---|---|
| **`feature/series09-access-foundation`** | from `af7f61f`; product-code commit **`00b494e`** (S0 `dc83f6b`, S1 backend `7f55d09`, mobile `00b494e`), last tested **`3b9bb69`** (tests only); later commits docs/evidence: `git diff --name-only 3b9bb69 HEAD` (all under `docs/`) | `D:\Projects\StockMind-wt\series09-access-foundation` | **ACTIVE canonical handoff.** Series 09: migration `1792600000000`, `item.view_cost`, DB-backed `JwtStrategy`, membership lifecycle, Team screen, revoked-access outbox. Both `node_modules` are junctions (tsc/Jest work; Metro does not). Future implementation branches should start from this branch |
| `design/series08-enterprise-blueprint` | based on `dc4ff4d`; **code = Series 07 code baseline `b3d824f` unchanged**; commits after `dc4ff4d` are docs only: `git diff --name-only dc4ff4d HEAD` (all under `docs/`) | `D:\Projects\StockMind-wt\series08-enterprise-blueprint` | Series 08 handoff (now stale). `docs/product/` (Product Bible v2, gap matrix, RBAC spec, movement governance spec, UX blueprint, ADRs, roadmap). No `node_modules` here on purpose (no build or test in this series). Future implementation branches should start from this branch |
| `feature/series07-recovery-integrity` | `dc4ff4d` (code baseline `b3d824f`) | `D:\Projects\StockMind-wt\series07-recovery-integrity` | Series 07 code + its handoff (now stale). Nothing changed here in Series 08 |
| (Series 07 detail, same branch as the row above) | verified code baseline **`b3d824f`** (`cbad45b` backend, `9a79b1c` mobile, `b3d824f` i18n fix, all on top of `6d4613b`); later commits are docs/evidence only: `git diff --name-only b3d824f HEAD` | `D:\Projects\StockMind-wt\series07-recovery-integrity` | **(Detail of the Series 07 line; no longer the canonical handoff.)** Series 07: S1 safe replacement + S2 history generation (backend, mobile, migration `1792590000000`). No dependency changed. `mobile/node_modules` here is a real copy (Metro does not resolve a junction across worktrees) |
| `hardening/series06-release-safety` | `6d4613b` (code baseline `9b1f9dd`) | `D:\Projects\StockMind-wt\series06-release-safety` | Series 06: CP-1 production equivalence (6/6) + CP-2 migration hardening. **Not modified by Series 07; its handoff files are stale** |
| `preflight/series05-rc-admission` | `e517d82` (code baseline `e20cf93`) | `D:\Projects\StockMind-wt\series05-rc-preflight` | Series 05 preflight (report, runbook v0.1, tests). **Not modified by Series 06.** Its handoff files are stale |
| `integration/series04` | `84faa31` (last code commit `d69f6e8`) | `D:\Projects\StockMind-wt\series04-integration` | The RC candidate. **Not modified by Series 05 or 06.** Its handoff files are stale |
| `feature/series03-sync` | `55348a6` | `D:\Projects\StockMind-wt\series03-backend` | parent `02c53f5` |
| `mobile/offline-outbox` | `ac9ba6b` | `D:\Projects\StockMind\.claude\worktrees\clever-poincare-ebc43f` (disposable) | contains `0510bc9`, `905f535`, `dbf43a6` |
| `feature/shared-warehouse` | `02c53f5` | `D:\Projects\StockMind-wt\shared-warehouse` | Series 02 backend; base `cf5a881` |
| `rc4/release-candidate` | `1447ade` | `D:\Projects\StockMind-wt\combined` | RC; promotion **DEFERRED** |
| `hotfix/rc41-credential-redaction` | `bb071ed` | `D:\Projects\StockMind-wt\wp-h0-f4` | production line |
| `main` (local) | `45d9e18` (origin `5b32df3`) | `D:\Projects\StockMind` | **dirty, the Director's work; never touch** |

Ancestry notes:
- The merge base of the backend and mobile lines is `14804c4`.
- `integration/series04` = `55348a6` + `--no-ff` merge of `ac9ba6b`. It has no conflicts, and the two sides touch disjoint paths.
- RC commit `1447ade` is omitted because its content is already present.

**What each series delivered** (details in the linked checkpoints):

| Series | Delivered |
|---|---|
| 01 | RC4 hardening: F4 credential leak fix in movement history, 2FA replay fix, balance contract, audit events, gated API docs, dependency patches, tenant/concurrency/atomicity PG tests; mobile device fixes (`dbf43a6`) |
| 02 | Team invitations, Admin/Manager/Staff roles, Staff warehouse grants enforced server-side, idempotent stock writes, per-warehouse revision cursor (delta/snapshot), entitlements behind a flag; mobile online preview (login, 2FA, invitation, live stock, Idempotency-Key) |
| 03 | Cursor anchors and explicit reset; durable encrypted offline outbox (receipt/dispatch only), account scope, pending/rejected UI, revoked-warehouse purge, offline relaunch cache, tour fix |
| 04 | Integration branch; **P0 restore reconciliation**: lookup endpoint, receipts "re-checking", "Needs review · history changed" never re-sent, human re-entry with a ledger note; 60 s timeouts with an 8 s "Sending…"; lookup excluded from audit; supertest listen-once harness fix |
| 05–06 | RC admission preflight; release-line reconciliation (production hotfix behaviours 6/6 on the candidate), fail-closed `down()`, revision trigger + unique index (details in their reports) |
| 08 | **Documentation only** (`docs/product/`): code-to-capability gap matrix, Product Bible v2 (ADOPT/MODIFY/DEFER/REJECT per proposal), organization/RBAC spec, movement governance spec (approvals, custody, 12 workflows), mobile UX blueprint, ADRs A–J with Director decisions Q-01..Q-18, roadmap S0–S9 with Milestone R and a Production blocker register. No code, test, dependency or migration change |
| 07 | **S1:** server-enforced replacement of an operation the history lost (one transaction: key claim, access, generation, fence on the original key, ledger check, write, provenance); unsafe client re-entry removed; review screen. **S2:** per-company `history_generation` in sync/lookup/receipts, authenticated + audited rotation (Admin, flag-gated), legacy-client floor. Contract, report, runbook v0.3 |

**Capability status**

| Capability | Status | Evidence |
|---|---|---|
| Offline app (products, warehouses, sections, receive/dispatch, lots, serials, transfers, reservations, AR/EN) | VERIFIED (device, Series 01–02) | `.ai-handoff` evidence in main |
| Tenant isolation, RBAC, warehouse scope | VERIFIED (real PG) | backend suite |
| Idempotent writes, concurrent dispatch, atomic transfer | VERIFIED (real PG) | backend suite |
| Login + 2FA, invitation acceptance (mobile) | VERIFIED (device) | Series 02–04 |
| Live sync, anchors, reset | VERIFIED (PG + device) | Series 03–04 |
| Offline outbox exactly-once, slow server, app-kill persistence | VERIFIED (device + ledger, one phone + API client) | Series 03–04 |
| Restore reconciliation (P0) | VERIFIED (PG + device) | Series 04 |
| Upgrade from a **reconstruction** of the production schema (4 migrations → 9) in one run, without the `uuid-ossp` extension; tenant-scoped backfills; permission scope exact | VERIFIED (PG, synthetic data only) | Series 06 `release-safety.migration.pg.spec.ts` (17 tests) |
| Fresh install = upgraded production = previously-upgraded environment (schema parity) | VERIFIED (PG) | Series 06 (only difference: the `user_fcm_tokens.id` default of environments that ran the old FCM text) |
| Invitation expiry (single use and revoke were already covered) | VERIFIED (PG) | Series 05, `shared-warehouse.pg.spec.ts` |
| `down()` of `1792560000000`/`1792570000000` | **fail-closed** since Series 06: refuses, changing nothing, when it would delete invitations, idempotency records, plans or customised grants. No override; going back = restore a backup or fix forward | VERIFIED (PG) |
| Movements written without a revision (older release) | numbered by a DB trigger under the warehouse lock; unique `(warehouse, revision)`; existing NULLs repaired. **Application rollback is still unsupported as a way back** (degraded mode) | VERIFIED (PG, concurrent writers) |
| Production hotfix (`bb071ed`) behaviours present in the candidate | **VERIFIED 6/6** (executable specs + negative controls: `tests/equivalence/production-bb071ed/`, 40 tests). Not mergeable mechanically (11 files / 21 conflict hunks); recommended strategy = ancestry-preserving merge on a NEW branch (not executed) | Series 06 matrix |
| Safe replacement of an operation the history lost (S1): one replacement per original, never while the original is present, repeat/concurrent requests = one movement, late original refused, stale generation refused, revoked access refused, provenance recorded | **VERIFIED (PG)**; **device PARTIAL** (one full flow incl. dropped response + app kill) | Series 07 `recovery-integrity.pg.spec.ts` (32), negative controls 6/6, `series07-evidence/` |
| History generation (S2): changes only by an authenticated, audited operator rotation; carried in sync/lookup/receipts; a change resets clients even when revisions repeat; ETag/304 cannot hide it; legacy clients reset once from the floor | **VERIFIED (PG + device)**. **A database marker does NOT detect a restore by itself (it rolls back with the DB): the operator rotation after a restore is the control** | Series 07; contract §6 |
| Original and replacement coexisting after a later restore/import | **Flagged** (lookup `coexisting-replacement`, mobile `duplicate-risk`, runbook §15 SQL); **not preventable** across physical histories | Series 07 PG + mobile unit |
| "Catching up" state on device | PARTIAL (unit only) | — |
| Online transfer on device | UNVERIFIED | — |
| Two physical devices | NOT DONE | — |
| iOS build | UNVERIFIED (never built) | — |
| Real Redis | UNVERIFIED | — |
| Google sign-in / AI assistant locally | UNVERIFIED | — |
| Team-management UI on mobile | NOT DONE (API only) | — |
| Offline↔online data migration, multi-org, Viewer role, billing | NOT DONE | — |

**Latest verified gates (Series 09, last tested commit `3b9bb69`, product code `00b494e`):** backend real PG 15, **3 consecutive fresh-DB full runs: 54 suites + 2 skipped, 395 passed + 2 skipped** (Series 07 baseline 51/347); backend `tsc` 0 and a clean build with 11/11 migrations; mobile `tsc` 0 and Jest **18/18 suites, 273/273** (was 252); `package.json`/lockfiles unchanged; backend negative controls 9/9 red (one needed an extra test first), mobile 4/4 red; per-request member lookup measured at +0.33 ms median locally. **No device run (safety rule: no interaction with the Huawei phone); device scenarios are DEFERRED — DIRECTOR PHYSICAL UNLOCK REQUIRED.** Evidence: `docs/handoff/series09-evidence/`.
**Series 07 gates (code baseline `b3d824f`):** backend real PG 15, **3 consecutive fresh-DB full runs: 51/51 suites, 347/347 tests** (313 + 32 recovery + 2 migration); backend `tsc` 0 and a clean build with 10/10 migrations compiled; mobile `tsc` 0 and Jest **16/16 suites, 252/252**; `package.json`/lockfiles identical to Series 06; backend negative controls 6/6 red, mobile 4 red; one Huawei device run (debug build, local throwaway backend, synthetic data; **one phone + API scripts, not a two-phone test**). Evidence: `docs/handoff/series07-evidence/`.
**Series 06 gates (code baseline `9b1f9dd`; Series 05 numbers in brackets):**
- Backend real PG 15, **3 consecutive fresh-DB full runs: 50/50 suites, 313/313 tests** [Series 05: 42/42, 264/264]. Arithmetic: 264 − 8 (old characterization spec) + 17 (release-safety) + 40 (equivalence) = 313.
- Backend `tsc` 0 and a clean build with **9/9 migrations** compiled. Mobile `tsc` 0 and Jest **203/203**. `package.json`, lockfiles, app and tsconfig files identical to Series 05.
- No full-suite run failed in Series 06. Development-time test-authoring errors and one incomplete-build incident are listed honestly in `SERIES_06_RELEASE_SAFETY_REPORT.md` §5.
- No device test in Series 06 (no app code changed). Device evidence remains `docs/handoff/series04-evidence/`.

**Risks and known issues:**
- **Series 09 results:** **D1 confirmed at runtime and closed** (Staff received `costPrice`; now the key is absent without `item.view_cost`, which only Admin holds by default); **D10 (new):** `audit_logs` stored the cost in clear text (4 rows in the test) — new writes redacted, **old rows may still hold it (operator cleanup not performed)**; **D2/D3 closed** (member lifecycle + per-request member lookup, role from the DB). Open: companies with 0 or ≥2 Admins have no owner after the migration (no Admin-on-Admin actions until an operator designates the owner from evidence); Manager lost cost visibility (intended); role changes are not closed inside the write transaction (suspension is); a removed member's e-mail cannot be re-invited (reactivate instead); Team/revoked-access UI never ran on a device or in RTL; D7 (one refresh token per user) now matters more. Contract: `SERIES_09_AUTHORIZATION_AND_PRIVACY_CONTRACT.md`.
- **Series 08 findings (static reading; D1–D3 are now resolved, see above; see `docs/product/STOCKMIND_CODE_TO_CAPABILITY_GAP_MATRIX.md` §2):** **D1** `costPrice` is encrypted at rest but `GET /products` returns decrypted `Product` entities to any role with `VIEW_PRODUCT` (no serializer, no cost permission); **D2/D3** no member suspend/remove/role-change endpoint, and the role comes from the JWT claim (≤ 15 min window); D4 company-wide product catalogue for every role; D5 `ApiStoreRepository.create` calls a non-existent endpoint; D6 `register-device` excludes Manager; D7 one refresh token per user (UNVERIFIED with two devices); D8 audit is best-effort and outside the movement transaction; D9 `VIEW_AUDIT_LOG` has no endpoint. By design **Manager = every warehouse** (conflicts with a scoped warehouse manager). No Postgres RLS, no server-side audit hash chain (the only hash chain is device-local in offline mode), no CHECK constraint on balances (non-negativity is enforced by the application).
- **Series 07 (S1/S2 built):** a restore rolls back the generation, the provenance and the fence too; database-local uniqueness cannot prevent duplicates across physical histories (detection only: coexisting-replacement). The operator's rotation after a restore is a manual step that can be forgotten and is not detected; it has no step-up, no tested SQL path if the API is down, and was never rehearsed on a real database. Old clients can still re-enter normally (unlinked to the original); a client with neither anchor nor generation sitting exactly on the rotation floor is not detected. Original details in a replacement are client claims (no privilege escalation). Details: `SERIES_07_RECOVERY_CONTRACT.md` §5, report §7. S5/S6 (retention, manager report) remain proposals.
- Restore detection assumes point-in-time restores; receipts are kept 7 days.
- Jest cannot catch UI/i18n integration bugs (a duplicate i18n key was found only on the device in Series 07; a duplicate-key test now guards locale files). No component tests exist.
- `stock_idempotency_keys` has no cleanup job.
- Migrations (Series 06): the three Series 05 hazards are closed in code and tests (fail-closed `down()`; no `uuid-ossp` dependency; DB-enforced revisions). Still true: application rollback is a degraded mode, not a way back; `1792580000000` makes the boot fail if duplicate `(warehouse, revision)` pairs exist; the read-only pre-deploy checklist (runbook §13) has NOT been run on any real database; the FCM migration's `CREATE TABLE` fails if the table already exists. Never run `migration:revert` on production.
- **R12 (open, needs a decision before Production):** `ssl: { rejectUnauthorized: false }` when `DB_SSL=true`, in `src/app.module.ts` and `src/config/data-source.ts`, identical in production. Not tested against Neon.
- Warehouses created after the rollout are not visible to existing Staff until granted, and there is no grant UI.
- The production hotfix line (`bb071ed`) is not an ancestor of the RC or the candidate; merging it gives 11 conflicts. The Director's dirty `main` files collide with tracked files of the candidate (3 files).
- Gotcha (hit again in Series 06): stale `tsconfig*.tsbuildinfo` makes `nest build` exit 0 with an INCOMPLETE `dist`. Delete the `*.tsbuildinfo` files in the worktree you build and check `dist/main.js` and the migration count, not only the exit code.

## D. How the Director expects AI engineers to work

- Act as a **proactive Principal Engineer**. Fix valuable, relevant issues found along the way when it is safe, and report them.
- Work in **isolated branches/worktrees** (`D:\Projects\StockMind-wt\…`). Never edit the dirty `main` tree. Never mutate original feature branches to resolve integration.
- Make focused commits, run **real tests** (real PostgreSQL for backend invariants, a physical device when relevant), and report actual counts and evidence labelled by level: device, API client, PG integration, unit.
- Characterize flakes with repeated runs. Never rerun until green, and never weaken assertions.
- Commit and push feature/integration branches after gates pass, without force.
- Report in concise Egyptian Arabic with English technical terms.
- Pick tools by capability, and use the fewest:
  - shell/Git/psql for repo and DB;
  - adb for the device;
  - no unnecessary subagents, repeated audits or web searches.
- **AI Council / FreeLLMAPI:**
  - follow the global guardrails in `~/.claude/ORCHESTRATION.md`;
  - Reviewer A (RA-4) is **not** approved;
  - never send source externally without `APPROVE-DELEGATION` / `APPROVE-EXTERNAL-REVIEW`;
  - never present simulated reviews as real ones.
- Never invent test results, deployments, receipts or model responses.

## E. Approval and safety boundaries (unchanged; they need fresh explicit Director approval)

- **No Android AAB** build or upload, no Google Play release, no Internal Testing. Debug APK + USB/ADB/Metro device testing **is** allowed.
- **No production** deploy, promotion, Render/Neon/Firebase production config change or production migration. Read-only production checks are allowed only when already authorized.
- No merge or force-push to `main`, RC or release branches. No `git reset --hard`, `git clean`, worktree prune/remove, or bare `git stash`.
- Never expose credentials, keys, tokens, `.env` contents or customer data. **Never read `.env` files.**
- No paid services, EULA acceptance, admin installs or system services (Memurai, WSL, Docker) without consent.
- **Never connect StockMind to `ironlink-redis`**: it belongs to another project.
- Respect repository hooks. A hook blocks writes into the base checkout (`D:\Projects\StockMind`), so use worktrees.
- Do not bypass biometric or fingerprint gates. Ask the Director for a physical unlock when needed.
- Preserve the Director's device data: the offline "Device Tester" profile, including the user-created "Weapon", "s" and "akm" records.

## F. Operational knowledge

- **Local test tooling (durable, outside the repo):** `D:\Projects\StockMind-wt\_local-tools\`
  - `pg15\pgsql\bin`: official EDB PostgreSQL 15.19 portable;
  - `pgdata-s04`: throwaway cluster on 127.0.0.1:55433;
  - `scripts\`: `backend-gate.ps1` (accepts only `stockmind_s04_*` or `stockmind_gate_*` DBs; extra args are passed to jest, e.g. one spec path), `start-backend.ps1` (port 3000, throwaway secrets, no `.env`), `start-metro.ps1` (online preview flag), `lossy-proxy.mjs` (:3001; drop/delay flags), `online-slice.mjs` (seed/totp/restore-to/ledger), `ui.js` (adb driver);
  - `logs\`, `evidence-s04\`.

  Temp scratchpads get wiped, so keep tooling here.
- **Verified commands** (Series 04):
  ```powershell
  # PostgreSQL
  D:\Projects\StockMind-wt\_local-tools\pg15\pgsql\bin\pg_ctl.exe -D D:\Projects\StockMind-wt\_local-tools\pgdata-s04 -o "-p 55433 -c listen_addresses=127.0.0.1" start
  # Backend gate on a fresh throwaway DB
  & D:\Projects\StockMind-wt\_local-tools\scripts\backend-gate.ps1 D:\Projects\StockMind-wt\series04-integration stockmind_s04_check_1
  # Mobile gates
  cd D:\Projects\StockMind-wt\series04-integration\mobile; npx tsc --noEmit; npx jest
  # Device: adb is not on PATH
  & "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices
  & "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" reverse tcp:8081 tcp:8081
  & "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" reverse tcp:3000 tcp:3000   # or tcp:3001 through the proxy
  ```
  The integration worktree has `node_modules` as a junction to `StockMind-wt\shared-warehouse\node_modules` (backend) and a real copy under `mobile\node_modules`.
- **Device.**
  - Huawei JSN-L22, Android 10, debug APK `io.stockmind.app`. It loads JS from Metro.
  - A fingerprint is enrolled, so a cold start with an online session needs the Director.
  - A full Metro reload (for example after a JSON edit) re-runs that gate.
  - The ADB server is on `127.0.0.1:5037`.
  - Android MCP was reported **Running** by the Director but **not exercised** in Series 04; adb was used directly.
- **MCPs and tools** (this machine, as observed in Series 02–04):
  - **Used and working:** git/GitHub over HTTPS push, adb, PowerShell, the claude-mem memory files.
  - **Problems:** `mem_search` returned errors in Series 04 → UNVERIFIED.
  - **Degraded:** ai-council (RA-4 not granted).
  - **Failed to connect:** firebase MCP, activecampaign.
  - **Need OAuth:** GitHub plugin and several marketing/engineering connectors.
  - **Available but unused:** Maestro, Android MCP, computer-use, browser pane.
- **Checkpoints and evidence:**
  - Series 07 (tracked, this branch): `docs/handoff/SERIES_07_RECOVERY_INTEGRITY_REPORT.md`, `SERIES_07_RECOVERY_CONTRACT.md`, `docs/handoff/series07-evidence/` (device ledger and screenshots without third-party overlays, gate summaries, negative controls); logs in `D:\Projects\StockMind-wt\_local-tools\logs\stockmind_gate_s07_*.log`; full device screenshots in `_local-tools\evidence-s07\`.
  - Series 06 (tracked, on `hardening/series06-release-safety`): `docs/handoff/SERIES_06_RELEASE_SAFETY_REPORT.md`, `docs/handoff/SERIES_06_PRODUCTION_EQUIVALENCE_MATRIX.md`, `docs/handoff/series06-evidence/`; the recovery runbook is v0.2; logs in `D:\Projects\StockMind-wt\_local-tools\logs\stockmind_gate_s06_*.log` and `s06-final3.summary.txt`.
  - Series 05 (tracked, preflight branch): `docs/handoff/SERIES_05_RC_PREFLIGHT_REPORT.md` and `docs/handoff/STOCKMIND_DATABASE_RECOVERY_RUNBOOK.md`; test logs in `D:\Projects\StockMind-wt\_local-tools\logs\stockmind_gate_s05_*.log` and `s05-final3.summary.txt`.
  - Series 04 (tracked): `docs/handoff/SERIES_04_CHECKPOINT.md` + `docs/handoff/series04-evidence/`.
  - Series 03 backup: `D:\StockMind_Backups\Checkpoints\SERIES_03_CHECKPOINT_2026-10-20.md` (SHA-256 `B555D4D2…26A6`).
  - Series 02 and earlier: `D:\Projects\StockMind\.ai-handoff\` (**untracked in dirty main; read only**; `SERIES_02_CHECKPOINT.md`, `CURRENT_STATE.md`, `DECISIONS.md`, `evidence\`).
  - Desktop handoff: `C:\Users\Name\Desktop\StockMind_Handoff\` (USER_MANUAL, RESUME_CHECKPOINT, this MASTER copy).
- **Branding.** `D:\Projects\StockMind\Glossy Neon Inventory Analytics Icon.png` is reserved for a future app icon. **Do not modify or adopt it yet.**

## G. Next actions

**Series 09 (S0 + S1) is done:** PASS for its scope on a development environment, device DEFERRED, Production NO-GO. Report `docs/handoff/SERIES_09_ACCESS_FOUNDATION_REPORT.md`, contract `SERIES_09_AUTHORIZATION_AND_PRIVACY_CONTRACT.md`. **Recommended next (not authorized): Series 10 = S2 (capabilities, scoped grants, `/me/capabilities`, CP-4, scoped warehouse manager), preceded by a device check of Series 09 when the Director can be physically present**, plus a decision on cleaning old `audit_logs`, on ownerless companies, and on whether Manager should hold `item.view_cost`. **Device safety rule for AI sessions while the Director is remote: do not touch the phone or adb at all.**
**Series 08 (enterprise architecture blueprint, documentation only) is done.** Read `docs/product/README.md` for the index. **Recommended next IMPLEMENTATION milestone (not authorized): Series 09 = Access Foundation Part 1 (S0 close the cost-price exposure after proving it at runtime + S1 member lifecycle with immediate token revocation, Owner flag, simple Team screen)**, with **Milestone R** (operational readiness: rehearsal on a NON-production database, R12, step-up for rotation/override, two devices, release-line decision) in parallel under separate approvals. Pending Director decisions: `docs/product/STOCKMIND_ARCHITECTURE_DECISIONS.md` (Q-01..Q-18, each with a recommended default). Production remains NO-GO.
**Series 07 (recovery integrity: S1 safe replacement + S2 history generation) is done:** PASS for its scope on a development environment, device PARTIAL. Production = **NO-GO**. Details: `docs/handoff/SERIES_07_RECOVERY_INTEGRITY_REPORT.md` and `SERIES_07_RECOVERY_CONTRACT.md`. (Series 06 is also done: CP-1 6/6, CP-2 PASS; `docs/handoff/SERIES_06_RELEASE_SAFETY_REPORT.md`.)

1. **Waiting for the Director's decisions** (report §8): the release-line strategy (recommended: Option A, an ancestry-preserving `-s ours` merge on a NEW branch, then a fast-forward; not executed) plus a hotfix freeze on the production branch; the Director's dirty `main` files and the 3 unpushed local commits; authorisation of the read-only pre-deploy checks on the real database (runbook §13); authorisation to assess R12 (TLS) against a non-production branch.
2. **(Superseded by item 1 above for naming: this became "Milestone R" because the Director used the name Series 08 for the design phase.) Operational readiness of recovery, no Production:** rehearse runbook §14 (restore, rotation, measurement, §13 checklist) on a NON-production database the Director authorizes (a temporary Neon branch if allowed); assess R12 there; a two-device run of the replacement scenarios (concurrent, revoked access, Arabic, Retry, slow server); and the release-line decision. Alternatives: CP-4/CP-5, the Director's manager-dashboard proposal (not yet received), or an external review of S1/S2 (needs the Director's own `APPROVE-EXTERNAL-REVIEW`). New branch from `feature/series07-recovery-integrity`.
   Open Director decisions from Series 07: the rotation operating policy (who/when; step-up or CLI?), whether the replacement flow needs extra limits (e.g. manager approval above a quantity; proposed, not built), whether the app stays in online mode on the Huawei (it is signed in as a local Staff test user; the offline "Device Tester" profile is untouched).
3. Then: entitlements grandfathering (CP-5), two-device / iOS / Redis / Google Sign-In checks, a mobile team-management screen, Viewer role, multi-org.
4. **Deferred until approved:** production deploy, executing the release line, RC promotion, AAB/Play, billing, iOS build (needs macOS/EAS), real Redis, logo adoption.
5. **First minimal verification commands for the next session:** the four `git` commands in the protocol, then `Test-Path D:\Projects\StockMind-wt\_local-tools\pg15\pgsql\bin\pg_ctl.exe`. After Series 07 the local PostgreSQL is **still running** on 127.0.0.1:55433 with scratch databases `stockmind_gate_s07_*` and `stockmind_s04_s07dev`; the backend, proxy and Metro are stopped and `adb reverse` was removed. Stop it with `pg_ctl -D D:\Projects\StockMind-wt\_local-tools\pgdata-s04 stop` when finished.
6. **Device notes (Series 07):** the 4-hour device access token expires during long pauses and needs the Director's fingerprint twice (cold start/reload, then re-authenticate). A reload re-runs the biometric gate. `mobile/node_modules` must be a real copy for Metro. Series 07 device scripts: `_local-tools\scripts\{start-backend-s07,start-metro-s07}.ps1`, `lossy-proxy-s07.mjs`, `s07-slice.mjs` (seed, rotate, gen, replacements, proof, restore-to), `s07-negative-controls.ps1`.
## H. Where to look (read only what the task needs)

| Need | Read |
|---|---|
| Product vision, capability gap matrix, RBAC and privacy, movement/approval/custody governance, mobile UX, ADRs and pending Director decisions, roadmap S0–S9, Production blocker register (Series 08) | `docs/product/README.md` (index) → `STOCKMIND_PRODUCT_BIBLE_V2.md`, `STOCKMIND_CODE_TO_CAPABILITY_GAP_MATRIX.md`, `STOCKMIND_ORGANIZATION_RBAC_SPEC.md`, `STOCKMIND_MOVEMENT_GOVERNANCE_SPEC.md`, `STOCKMIND_ENTERPRISE_UX_BLUEPRINT.md`, `STOCKMIND_ARCHITECTURE_DECISIONS.md`, `STOCKMIND_IMPLEMENTATION_ROADMAP.md` |
| Series 09 verdict, exploit evidence, tests, negative controls, perf, risks, next step | `docs/handoff/SERIES_09_ACCESS_FOUNDATION_REPORT.md` (+ `series09-evidence/`) |
| Series 09 API/DB contract: `item.view_cost`, member lifecycle, revocation, policy, lock order, legacy ownership, operator procedures | `docs/handoff/SERIES_09_AUTHORIZATION_AND_PRIVACY_CONTRACT.md` |
| Series 07 verdict, invariants, scenarios, tests, device run, risks, next task | `docs/handoff/SERIES_07_RECOVERY_INTEGRITY_REPORT.md` |
| Series 07 API/DB contract, transaction and lock order, guarantees and limits, generation trust model, client behaviour, rollout | `docs/handoff/SERIES_07_RECOVERY_CONTRACT.md` |
| Series 06 verdict, migration changes, tests, remaining risks, Director decisions | `docs/handoff/SERIES_06_RELEASE_SAFETY_REPORT.md` |
| Which production fix is where in the candidate, with its test; release-line strategy options and evidence | `docs/handoff/SERIES_06_PRODUCTION_EQUIVALENCE_MATRIX.md` |
| RC admission verdict, ancestry, security gates, corrective phases (Series 05) | `docs/handoff/SERIES_05_RC_PREFLIGHT_REPORT.md` |
| What operators do after a database restore (incl. §14 history-generation rotation and §15 coexisting replacements); duplicate investigation; fail-closed down(); pre-deploy read-only checklist | `docs/handoff/STOCKMIND_DATABASE_RECOVERY_RUNBOOK.md` (v0.3 draft, not an approved Production policy) |
| Integration, P0 contract, gates, device evidence | `docs/handoff/SERIES_04_CHECKPOINT.md` |
| Series 03 outbox/anchors | Series 03 backup (path in section F) |
| Series 02 APIs, migrations, cost model | `D:\Projects\StockMind\.ai-handoff\SERIES_02_CHECKPOINT.md` (read only) |
| User-facing behaviour | Desktop `StockMind_USER_MANUAL.md` |
| Short resume | Desktop `StockMind_RESUME_CHECKPOINT.md` |
| Current task, approvals, risks, next step, briefing for ChatGPT | `docs/handoff/STOCKMIND_AI_BRIDGE.md` (Desktop mirror: `StockMind_Handoff\STOCKMIND_AI_BRIDGE.md`) |

## I. Change log
- **2026-10-21:** created after Series 04. `integration/series04` @ `322e8a0` (this file is committed on top of it). Next step: RC preflight after Director review.
- **2026-10-21 (maintenance):** C: disk cleanup reclaimed 6.85 GB (npm/pip caches, the idle Gradle 9.1.0 cache, Gradle daemon logs). No tool, config or project data was touched.
  - Report: Desktop `StockMind_Handoff\C_DRIVE_CLEANUP_REPORT.md`.
  - Inventories and quarantine: `D:\StockMind_Backups\Maintenance\2026-10-21_C_cleanup\`.
- **2026-10-24:** onboarding on a new Claude account. Added `docs/handoff/STOCKMIND_AI_BRIDGE.md` (ChatGPT↔Claude bridge, Egyptian Arabic) with a Desktop mirror. Corrected the `integration/series04` HEAD in section C (`322e8a0` → `eb19ab0`; docs-only since `d69f6e8`). No code, tests, branches or tools changed.
- **2026-10-24 (Series 05):** RC admission preflight on the new isolated branch `preflight/series05-rc-admission` (worktree `series05-rc-preflight`). Verdict CONDITIONAL GO (RC) / NO-GO (Production). Added the report, the recovery runbook, a migration-safety spec and an invitation-expiry test, and fixed a spec-order dependency in the test harness. **The canonical handoff files moved to this branch**; the copies on `integration/series04` are stale. No application code or migration changed; nothing merged or deployed.
- **2026-10-24 (Series 06):** release-line reconciliation and migration safety hardening on the new isolated branch `hardening/series06-release-safety` (worktree `series06-release-safety`). CP-1: the six production hotfix behaviours pass as executable specs on the candidate (40 tests, negative controls red). CP-2: the FCM migration no longer needs `uuid-ossp`; `down()` of `1792560000000` and `1792570000000` is fail-closed; new migration `1792580000000` (revision trigger, repair, unique partial index); 17-test migration suite replaces the Series 05 characterization spec. Backend PG ×3: 50/50 suites, 313/313 tests. **The canonical handoff files moved to this branch**; the copies on the Series 05 and Series 04 branches are stale. Nothing merged, no release branch created, nothing deployed.
- **2026-10-25 (Series 07):** recovery integrity on the new isolated branch `feature/series07-recovery-integrity` (worktree `series07-recovery-integrity`, from `6d4613b`). S1: server-enforced replacement (migration `1792590000000`, `stock_replacements`, fence on the original key, structured 409 refusals), the unfenced client re-entry removed, review screen. S2: per-company `history_generation` in sync/lookup/receipts, Admin-only flag-gated audited rotation, legacy floor; trust model stated (a DB marker does not detect a restore; the operator step is the control). Backend PG ×3: 51/51 suites, 347/347; mobile 252/252; negative controls 6 + 4; one Huawei device run (PARTIAL). A duplicate i18n key found only on the device was fixed and guarded. **The canonical handoff files moved to this branch**; the copies on the Series 06, 05 and 04 branches are stale. Nothing merged, no release branch, nothing deployed, no Production/Neon access. The Director's first message said a mandate was "attached" but none was; work waited for the full mandate.
- **2026-10-25 (Series 08):** enterprise product architecture, governance and UX blueprint on the new isolated branch `design/series08-enterprise-blueprint` (worktree `series08-enterprise-blueprint`, from `dc4ff4d`). **Documentation only**: the `docs/product/` package (8 files). No application code, migration, test, dependency or configuration changed and no test was run (Series 07 results stay attributed to `b3d824f`). Static findings D1–D9 recorded (notably possible `costPrice` exposure and no member offboarding); recommended next implementation milestone Series 09 = S0 + S1, plus Milestone R. **The canonical handoff files moved to this branch**; the copies on the Series 07, 06, 05 and 04 branches are stale. Nothing merged, no release branch, nothing deployed, no Production/Neon access, no external model.
- **2026-10-25 (Series 09):** Access Foundation S0 + S1 on the new isolated branch `feature/series09-access-foundation` (worktree `series09-access-foundation`, from `af7f61f`). S0: cost-price exposure reproduced at runtime, then closed (allowlist DTO, `item.view_cost` Admin-only by default, audit redaction; D10 found). S1: migration `1792600000000` (status, token_version, is_owner, last-owner trigger, `membership_events`), per-request member lookup with the role from the DB, suspend/reactivate/remove/revoke-sessions/role change with an owner-aware policy, in-transaction actor re-check for writes, replacements and rotation, Team screen, revoked-access handling in the outbox. Backend PG ×3: 54 suites + 2 skipped, 395 passed; mobile 273; negative controls 9 + 4. **No device run (safety rule).** **The canonical handoff files moved to this branch**; the copies on the Series 08, 07, 06, 05 and 04 branches are stale. Nothing merged, no release branch, nothing deployed, no Production/Neon access.
