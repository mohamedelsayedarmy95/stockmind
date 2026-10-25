# Series 12 — emulator gate ledger (isolated emulator, NOT the Huawei)

- Emulator: AVD `stockmind_qa_api29`, `system-images;android-29;default;x86_64` (Android 10, same version as the Huawei JSN-L22), serial `emulator-5560`, no Google Play, WHPX.
- APK: `stockmind-qa-428472-f2747d6.apk`, SHA-256 `10b3fd473bf7d1fc4e4b612dcbb1b10397d8e63492ff438bde2a7aafaebc7213`, `io.stockmind.app.qa` 1.0.0-qa.f2747d6 (code 428472), release, not debuggable, Hermes bundle `b0fa0fe5…94e3b9` (byte-identical in an independent second build), signer `65b206f5…be74b72` (local QA key). Full record: `apk-inspection-f2747d6.json`.
- Installed with `mobile/scripts/qa-install.ps1 -Serial emulator-5560` (inspection + ABI check + `install -r`).
- Every device command in Series 12 named `emulator-5560` explicitly. The Huawei (`XSQ4C19419000318`) was connected over USB the whole time and received **no** command.

## Gate A — Metro-independent startup (emulator)
Preconditions checked before and during the runs: host port 8081 not listening, no `expo start`/Metro process, `adb reverse --list` empty on the emulator.

| Check | Result |
|---|---|
| First cold launch (`am start -W`) | COLD 918 ms, process alive, real onboarding UI (screenshot), 0 Metro/bundle/fatal lines in logcat |
| 10 consecutive cold launches (force-stop + start) | 10/10 alive, 675–790 ms, 0 errors (`emulator-launches.json`) |
| 5 warm launches (HOME + start) | 5/5 HOT, 83–99 ms, 0 errors |
| Swipe away from Recents, reopen from the launcher intent | process gone after the swipe, reopened, 0 errors |
| Crash buffer for the package | 0 entries |

## Gate B — functional offline use (emulator, synthetic QA data)
| Step | Result (read back from the app after each step) |
|---|---|
| Onboarding: English → Offline → profile "QA Tester" | dashboard, Products 0 |
| Create warehouse "QA Warehouse A" | listed with the default "Main Warehouse" |
| Create product "QA Rice 5kg" (SKU QA-RICE-001) | Products 1 |
| Receive 10 | balance 10; local events 4 |
| Dispatch 4 | balance 6 |
| Dispatch 7 (over-dispatch) | **refused**: "Enter a whole number from 1 to 6", confirm disabled, balance stays 6, no record in the Activity Log |
| Force-stop (process death) + cold start | profile, product, balance 6, both warehouses back; Activity Log = inbound 10, outbound 4, product, 2 warehouses |
| Airplane mode ON (`ping 8.8.8.8` → Network is unreachable) + kill + cold start | app opens; receive 5 → 11; dispatch 1 → 10; kill + cold start → **10** |
| Arabic | labels switch at once (QA card included); after the requested restart the whole layout is RTL; data intact (7 local changes) |
| Back to English | ok |

## Gate C — controlled local Online Preview (emulator)
Backend: this worktree's `dist/main.js` via `qa-local-backend.ps1` on throwaway DB `stockmind_qa_local`, `CAPABILITY_MODE=shadow` (log line "Capability engine mode: shadow"), synthetic data from `qa-seed-synthetic.mjs`. Route: `adb -s emulator-5560 reverse tcp:3000 tcp:3000`. `qa-backend-preflight.ps1` refused the production host; it also correctly reported a missing reverse route once (the route had been dropped while airplane mode was switched off) before passing.

| Check | Result |
|---|---|
| Mode screen / login | "QA PREVIEW · Server: 127.0.0.1:3000" |
| Owner (Admin·Owner) | 2 server products (not the 1 offline product), W1+W2, Settings "Current: Online", Team screen with Manager/Staff actions |
| Staff warehouse access screen under shadow | "Warehouse manager · not active on this server", greyed out; Staff = Operator on W1, no access on W2 |
| Manager | W1+W2 (company-wide by design), no Team entry |
| Staff | W1 only, no "+" for warehouses |
| Server truth per role (`gate-c-role-api-check.json`) | Owner receives `costPrice`; Manager and Staff receive **no `costPrice` key** (R-20); Team API 403 for Manager/Staff; `/me/capabilities` engine `shadow`, `enforced:false` |
| Backend unreachable (reverse removed), Staff receives 3 Oil @ W1 | "Offline · no data yet", "1 actions waiting to send"; **server unchanged (Oil 50)** |
| Route restored, app brought to the foreground | outbox delivered: server Oil **53** (exactly +3), app "Synced · rev 3", "Received · QA Oil +3 by you" (rev 3 = one new movement after the 2 seed movements) |
| Switch back to offline ("QA Tester") | offline data intact: Products 1, 7 local changes, Rice balance 10; no server data mixed in |

## Observations recorded as findings (not fixed in Series 12)
1. While the backend is unreachable, the online Receive screen shows "Current balance: 0" for a product whose server balance is unknown (50); online it shows the true value (53). A display-honesty issue in the existing online screen.
2. Banner copy "1 actions waiting to send" (singular/plural; known since before Series 07).
3. `ErrorBoundary` fallback text is English-only.
4. English profile text "Transfers between warehouses **he** has access to" is gendered.
5. Maestro's on-device driver lost its connection after an airplane-mode toggle; later steps were driven with `adb shell input` + screenshots. `uiautomator dump` never works on this app (the UI never idles because of continuous animations), which also limits future automated UI tests.
