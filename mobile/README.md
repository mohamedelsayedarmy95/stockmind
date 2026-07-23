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

## Getting Started

> MMKV and Skia require a **dev build** — Expo Go will not work.

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
