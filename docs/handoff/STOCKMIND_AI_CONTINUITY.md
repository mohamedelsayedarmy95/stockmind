# STOCKMIND — AI CONTINUITY (canonical)

> **Canonical location:** `docs/handoff/STOCKMIND_AI_CONTINUITY.md` on branch `integration/series04`.
> **Portable copy:** `C:\Users\Name\Desktop\StockMind_Handoff\STOCKMIND_AI_CONTINUITY_MASTER.md`.
> **Last updated:** 2026-10-21, after Series 04.
>
> This file is a map, not proof. **Git history and the code win over this file.** Labels: VERIFIED, PARTIAL, UNVERIFIED,
> NOT DONE.

---

## MANDATORY AI SESSION START / END PROTOCOL

**At session start**
1. Read this file first.
2. Read **only** the linked checkpoint or source needed for the task (section H). Do not re-audit the repo.
3. Check reality before acting:
   ```powershell
   git -C D:\Projects\StockMind worktree list
   git -C D:\Projects\StockMind-wt\series04-integration status -sb
   git -C D:\Projects\StockMind-wt\series04-integration log --oneline -5
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
4. Save this file, commit it on the working branch if allowed, and copy it to the Desktop path above.
5. Verify both files are readable, and report whether the change is committed and pushed.

Update only on meaningful state changes. Do not rewrite the whole file for small edits.

**Copy-ready startup line for any AI:**
> Before any work on StockMind, read `D:\Projects\StockMind-wt\series04-integration\docs\handoff\STOCKMIND_AI_CONTINUITY.md` (or the Desktop copy `StockMind_Handoff\STOCKMIND_AI_CONTINUITY_MASTER.md`). Follow its start/end protocol and its approval boundaries.

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

  Series 03 and 04 added none.
- **Key API contracts** (details: `docs/handoff/SERIES_04_CHECKPOINT.md` §3):
  - `POST /stock/{inbound,outbound,adjustment,transfer}` with `Idempotency-Key`. A replay returns `replayed:true`; the same key with a different body gets 422; insufficient stock gets 409.
  - `GET /stock/changes/:w?since&anchor&limit` returns a delta, or a snapshot with `reset` when the cursor is invalid.
  - `POST /stock/operations/lookup` returns present / absent / indeterminate / unavailable.
  - Team (Admin only): `POST/GET/DELETE /team/invitations`, `GET /team/members`, `PUT /team/members/:id/warehouses`, `GET /team/entitlements`. Public: `POST /auth/accept-invitation`.
- **Environments.**
  - Production: Render service from `release/prod-hotfix-f4` @ `bb071ed`, auto-deploy off (**reported, UNVERIFIED this series**). Production has none of Series 02–04.
  - The mobile release build shows online mode as "Cloud sync coming soon".
  - **Online Preview** works only in a `__DEV__` build with `EXPO_PUBLIC_ONLINE_MODE=1` and an explicit `EXPO_PUBLIC_API_BASE_URL` (`mobile/src/lib/dev-flags.ts`), against a **local** backend.

## C. Engineering state (2026-10-21)

**Branches** (all pushed except local `main`; nothing merged into RC/main; nothing deployed):

| Ref | HEAD | Worktree | Notes |
|---|---|---|---|
| `integration/series04` | `322e8a0` | `D:\Projects\StockMind-wt\series04-integration` | **Current working line.** Series 03 backend + mobile, plus Series 04 P0 |
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
| "Catching up" state on device | PARTIAL (unit only) | — |
| Online transfer on device | UNVERIFIED | — |
| Two physical devices | NOT DONE | — |
| iOS build | UNVERIFIED (never built) | — |
| Real Redis | UNVERIFIED | — |
| Google sign-in / AI assistant locally | UNVERIFIED | — |
| Team-management UI on mobile | NOT DONE (API only) | — |
| Offline↔online data migration, multi-org, Viewer role, billing | NOT DONE | — |

**Latest verified gates** (Series 04):
- Backend real PG 15 on `d69f6e8`: **41/41 suites, 255/255 tests, 3 consecutive runs**. Later commits are docs only.
- Backend `tsc` 0 and clean build.
- Mobile `tsc` 0 and Jest **203/203**.
- Device evidence: `docs/handoff/series04-evidence/`.

**Risks and known issues:**
- Re-entry after a restore that is later undone would duplicate the action. This needs an operational runbook.
- Restore detection assumes point-in-time restores; receipts are kept 7 days.
- `stock_idempotency_keys` has no cleanup job.
- Gotcha: a stale `tsconfig.build.tsbuildinfo` makes `nest build` emit an empty `dist`. Delete it inside the worktree you are building.

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
  - `scripts\`: `backend-gate.ps1` (accepts only `stockmind_s04_*` DBs), `start-backend.ps1` (port 3000, throwaway secrets, no `.env`), `start-metro.ps1` (online preview flag), `lossy-proxy.mjs` (:3001; drop/delay flags), `online-slice.mjs` (seed/totp/restore-to/ledger), `ui.js` (adb driver);
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
  - Series 04 (tracked): `docs/handoff/SERIES_04_CHECKPOINT.md` + `docs/handoff/series04-evidence/`.
  - Series 03 backup: `D:\StockMind_Backups\Checkpoints\SERIES_03_CHECKPOINT_2026-10-20.md` (SHA-256 `B555D4D2…26A6`).
  - Series 02 and earlier: `D:\Projects\StockMind\.ai-handoff\` (**untracked in dirty main; read only**; `SERIES_02_CHECKPOINT.md`, `CURRENT_STATE.md`, `DECISIONS.md`, `evidence\`).
  - Desktop handoff: `C:\Users\Name\Desktop\StockMind_Handoff\` (USER_MANUAL, RESUME_CHECKPOINT, this MASTER copy).
- **Branding.** `D:\Projects\StockMind\Glossy Neon Inventory Analytics Icon.png` is reserved for a future app icon. **Do not modify or adopt it yet.**

## G. Next actions

1. **Next engineering task** (after the Director reviews `integration/series04`): RC preflight in a **new isolated branch**.
   - Prerequisites:
     - the Director's review of the P0 semantics (re-entry is human-only);
     - PG cluster started;
     - clean worktree.
   - Steps:
     - branch from `rc4/release-candidate` or from `integration/series04`, as the Director decides;
     - record merge bases with `1447ade`;
     - review migration order on a copy of legacy data (`up/down/up`);
     - run the full backend PG suite ×3 and mobile `tsc` + Jest.
   - Acceptance: no conflicts left unexplained, migrations reversible, gates green ×3, nothing merged into RC/main without approval.
2. Then:
   - a restore runbook / server "history epoch" marker;
   - a mobile team-management screen (invite, grants);
   - an `idempotency_keys` cleanup job;
   - Viewer role;
   - multi-org memberships.
3. **Deferred until approved:** production deploy, RC promotion, AAB/Play, billing, iOS build (needs macOS/EAS), real Redis, logo adoption.
4. **First minimal verification commands for the next session:** the four `git` commands in the protocol, then `Test-Path D:\Projects\StockMind-wt\_local-tools\pg15\pgsql\bin\pg_ctl.exe`.

## H. Where to look (read only what the task needs)

| Need | Read |
|---|---|
| Integration, P0 contract, gates, device evidence | `docs/handoff/SERIES_04_CHECKPOINT.md` |
| Series 03 outbox/anchors | Series 03 backup (path in section F) |
| Series 02 APIs, migrations, cost model | `D:\Projects\StockMind\.ai-handoff\SERIES_02_CHECKPOINT.md` (read only) |
| User-facing behaviour | Desktop `StockMind_USER_MANUAL.md` |
| Short resume | Desktop `StockMind_RESUME_CHECKPOINT.md` |

## I. Change log
- **2026-10-21:** created after Series 04. `integration/series04` @ `322e8a0` (this file is committed on top of it). Next step: RC preflight after Director review.
