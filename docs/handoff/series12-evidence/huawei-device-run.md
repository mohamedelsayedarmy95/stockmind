# Series 12 — Huawei device run (2026-10-25, Director physically present and authorizing the plan in chat)

Authorization: the Director chose "Yes, run the full plan" for: Phase 0 read-only; Phase 1 install ONLY `io.stockmind.app.qa`;
Phases 2–3 by the Director's hand with USB unplugged; optional Phase 4 local online. No uninstall, no clear, no force-stop of the
old app, no reboot, no settings change. Every command named the serial `XSQ4C19419000318` (never "the only device").
Times below are the phone's clock.

## Device
HUAWEI JSN-L22, Android 10 (SDK 29), build `JSN-L22 10.0.0.222(C185E2R6P1)`, ABIs `arm64-v8a,armeabi-v7a,armeabi`.

## Phase 0 — the installed app (read-only) and the root cause on the device itself
| Item | Value |
|---|---|
| `io.stockmind.app` | versionCode 1, versionName 1.0.0, **pkgFlags DEBUGGABLE**, firstInstall = lastUpdate = 2026-10-20 08:39:06, signatures `[51ed3f60]` |
| Its APK (`pm path` → `adb pull` of `base.apk`, the program file only; no app data read) | SHA-256 `ce9607502a796055c23b39055927558e3639a163a9b6592605bd65b0625f2d70`, 261,472,169 bytes = **byte-identical** to `D:\Projects\StockMind\mobile\android\app\build\outputs\apk\debug\app-debug.apk` (2026-07-24) |
| Embedded JS bundle | **none** (`assets/index.android.bundle` absent) |
| Signer | `CN=Android Debug`, SHA-256 `fac61745…033b9c` (public React Native template key) |

→ The phone's StockMind is a React Native debug build that loads its JavaScript from Metro over `adb reverse`; without both it shows
"Cannot connect to Metro" / "Unable to load script". Proven on the device, not inferred.

## Phase 1 — install StockMind QA (`qa-install.ps1 -Serial XSQ4C19419000318`)
- Pre-install inspection: all checks passed (APK `stockmind-qa-428472-f2747d6.apk`, SHA-256 `10b3fd47…aebc7213`).
- ABI check: device first ABI `arm64-v8a`, APK `arm64-v8a` = 56/56 libraries (complete) → allowed.
- `adb install -r` → `Success`. Packages after: `io.stockmind.app.qa`, `io.stockmind.app`.
- `io.stockmind.app` after the install: same versionCode, same first/last install time (2026-10-20 08:39:06), same signature → **untouched**.
- `io.stockmind.app.qa`: versionCode 428472, versionName 1.0.0-qa.f2747d6, primaryCpuAbi arm64-v8a, **not DEBUGGABLE**, firstInstall 2026-10-25 21:04:48.
- Before unplugging: phone `adb reverse --list` empty; PC port 8081 not listening.

## Phases 2–3 — Gate A and Gate B, USB unplugged, by the Director's hand
**Director's report (chat): "All passed, no fingerprint prompt"** — 10/10 opens from the StockMind QA icon with no error screen; warehouse
"Huawei QA WH", product "Huawei Rice" (HW-001), receive 10, dispatch 4, over-dispatch 7 refused, airplane mode + swipe away + reopen
(6 → receive 5 → 11 → dispatch 1 → 10 → reopen → 10), Arabic RTL after restart.

Independent phone-log evidence (read after replugging, from the 21:05:36 mark, complete coverage from 21:05:52; QA lines in
`huawei-gate-a-qa-log-lines.txt`):
| Check | Result |
|---|---|
| USB during the QA session | `mIsUsbPlugged = false` on every QA foreground change from 21:21:00 to 21:27 |
| QA foreground entries | **7** (21:21:00, 21:21:55, 21:22:06, 21:22:34, 21:22:40, 21:22:59, 21:26:23): **6 separate cold process starts** (distinct PIDs 29441, 29662, 29756, 29940, 30028, 30121) + 1 return |
| "Unable to load script" / "Cannot connect to Metro" / dev-server lines | **0** |
| FATAL EXCEPTION / AndroidRuntime | **0** |
| ANR for QA | **0** |
| crash buffer entries for StockMind | **0** |
| Google sign-in | `SignInHubActivity` + account picker opened at 21:23:19 and closed at 21:23:24; QA process continued (Google sign-in is unavailable in QA by design) |
| Old app | in the foreground 21:20:03–21:20:30, opened on the phone (no command of this session); install record unchanged |

Limits, stated plainly: the log corroborates **7 of the 10 opens** the Director reported (all 7 clean); the computer was disconnected
(USB unplugged) but not shut down; Gate B results are the Director's observations (QA is not debuggable, so its encrypted
database cannot and must not be read; EMUI did not log the airplane-mode change); no fingerprint prompt appeared, so the biometric
gate was not exercised on the device.

## Phase 4 — Gate C on the phone (USB plugged, `adb reverse tcp:3000 tcp:3000`)
| Step | Result |
|---|---|
| First attempt | the app showed "مش قادرين نوصل للخادم. اتأكد من الاتصال وجرب تاني." — **correct behaviour**: the reverse rule set at ~21:30 had been dropped by a USB reconnect (phone log: USB plugged again 21:57:50); the backend was healthy (HTTP 200) and received no request from the phone |
| Diagnosis / repair | backend `/health` 200 (node on :3000); Huawei `device`; `adb -s XSQ4C19419000318 reverse tcp:3000 tcp:3000`; phone `/proc/net/tcp` shows `0100007F:0BB8 … 0A` (LISTEN on the phone's 127.0.0.1:3000); `qa-backend-preflight.ps1 -Serial XSQ4C19419000318` → reachable. No code, auth or network-policy change. (The preflight later gained `-RestoreReverse`, commit `d63cfbe`.) |
| Staff sign-in (Director) | backend: `POST /auth/login` 200 at 22:15:14, then `/me/capabilities`, `/products`, `/warehouses`, `/stock/changes/<W1>` |
| Scope (Director) | Warehouses shows only "W1 QA Cairo (synthetic)"; Settings: Staff / Current: Online / 127.0.0.1:3000 |
| Online receipt +2 QA Oil @ W1 | backend `POST /stock/inbound` **201** once at 22:15:54; server QA Oil **53 → 55** |
| Not done on the device | Owner/Manager role screens and the disconnect → queue → reconnect → single delivery sequence (both verified on the emulator, `emulator-gate-ledger.md`) |
