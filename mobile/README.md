# StockMind Mobile

Ultra-premium React Native client for the StockMind warehouse platform (Phase 3).

## Tech Stack

| Concern | Choice |
| --- | --- |
| Framework | Expo SDK 51 + React Native 0.74 |
| Navigation | Expo Router (typed routes) |
| Animation | Reanimated 3 + Gesture Handler 2 |
| Styling | NativeWind (Tailwind) + inline theme tokens |
| Graphics | React Native Skia (Bezier charts, glow fills) |
| Glassmorphism | expo-blur |
| Local storage | MMKV (session + settings, sync, sub-ms) |
| State | Zustand (auth, settings) |
| Server state | TanStack Query (5-min cache) |
| HTTP | Axios + transparent JWT-refresh interceptor |
| i18n | i18next + react-i18next + expo-localization (ar/en, instant RTL switch) |
| Haptics | expo-haptics |
| Barcode | expo-camera |

## Architecture

```
app/                    Expo Router file-based routes
  _layout.tsx           providers + AuthGate (redirects on session)
  (auth)/login.tsx      sign-in
  (tabs)/               Dashboard · Scan · Analytics · Settings
  movement/[productId]  Inbound / Outbound execution (slider + confetti)
src/
  api/                  axios client, interceptor, response types
  query/                React Query hooks (auth, products, stock, warehouses, ai)
  store/                Zustand stores backed by MMKV
  theme/                design tokens + useTheme (dark/light/system)
  i18n/                 i18next config + ar/en catalogs
  components/           GlassCard, KpiCard, PremiumButton, QuickAction,
                        AskMeFab, AskMeSheet, QuantitySlider, SkiaLineChart,
                        Confetti, ScreenBackground
  lib/                  haptics wrapper
```

## Design System

- **Dark (default):** deep space `#0A0E17`, frosted glass cards (`bg-white/5`, blur), hairline borders.
- **Light:** `#F8FAFC` with soft Apple-Music shadows.
- **Brand gradient:** `#00D2FF → #7B2FBE` on all primary actions and the status bar accents.
- **Status:** emerald success · ruby error · amber warning.
- **Type:** Inter (LTR) + Cairo (RTL). Layout mirrors automatically on language switch.
- **Micro-interactions:** spring press on every button/card, selection haptic per slider step, heavy + success haptic + confetti on a completed stock operation.

## Builds: Dev, standalone QA, public release (Series 12)

| Build | Identity | JavaScript | Needs Metro / USB | Online |
| --- | --- | --- | --- | --- |
| **Old development client** | `io.stockmind.app` (debug) | loaded from Metro | **always** (USB `adb reverse tcp:8081`, or LAN) | dev preview flags |
| **StockMind QA** (standalone) | `io.stockmind.app.qa`, label "StockMind QA" | embedded (Hermes) | **no** | optional, local backend on a loopback/private address only |
| **Public release** | `io.stockmind.app` (release) | embedded | no | off — **NOT AUTHORIZED** (no AAB, no Play) |

The debug/development build has no JavaScript inside it. Opened without Metro it shows "Cannot connect to Metro" /
"Unable to load script ... index.android.bundle": that is how a React Native debug build works, not a crash. For everyday
testing without a computer, use StockMind QA:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\qa-signing-init.ps1        # once: local QA signing key (outside Git)
powershell -ExecutionPolicy Bypass -File scripts\qa-build.ps1               # build + inspect the QA APK (offline-only)
powershell -ExecutionPolicy Bypass -File scripts\qa-build.ps1 -Online       # + Online Preview to 127.0.0.1:3000 (adb reverse)
powershell -ExecutionPolicy Bypass -File scripts\qa-install.ps1 -Serial <serial>   # with the phone in your hands
powershell -ExecutionPolicy Bypass -File scripts\dev-metro.ps1              # Metro for the development build
```

Contract and safeguards: `docs/handoff/SERIES_12_STANDALONE_QA_CONTRACT.md`. A QA build refuses to run with a
`mobile/.env*` file present (it could inject build-time values such as a production URL).

## Getting Started (development build)

> MMKV and Skia require a **dev build** — Expo Go will not work. If `mobile/android` was last generated for StockMind QA
> (`android/.stockmind-variant` exists), regenerate it first: `npx expo prebuild --platform android --clean`.

```bash
# 1. Install
npm install

# 2. Point at your backend (Phase 0–2.5)
cp .env.example .env
#   Android emulator → http://10.0.2.2:3000/api/v1
#   iOS simulator    → http://localhost:3000/api/v1

# 3. Create the native dev build
npx expo prebuild
npm run android      # or: npm run ios

# 4. Start Metro
npm start
```

## Backend Contract

Consumes the StockMind REST API:

- `POST /auth/login`, `POST /auth/refresh-token`, `POST /auth/logout`
- `GET /products`, `GET /warehouses`
- `POST /stock/inbound`, `POST /stock/outbound`, `GET /stock/balance/:productId/:warehouseId`
- `POST /ai/ask` (Ask-Me → Hugging Face)

The Axios interceptor attaches the JWT and `Accept-Language`, and transparently
refreshes the access token on a `401` (single-flight).
