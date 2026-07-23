# StockMind — Security Architecture (Phase 4: Zero-Trust)

This document describes the military-grade security controls added in Phase 4.
Every control is **additive** — no existing API contract changed.

---

## Backend

### 1. Two-Factor Authentication (TOTP)

- Tables: `user_two_factor` (`secret_key`, `is_enabled`, `backup_codes` — all
  encrypted at rest).
- Endpoints (all under `/api/v1/auth`, `PermissionsGuard`-protected except the
  public second-step login):
  - `POST /2fa/enable` → returns `{ secret, otpauthUrl, qrCodeDataUrl }`. The
    factor is **not** active yet.
  - `POST /2fa/verify` `{ otpCode }` → activates 2FA, returns one-time
    `backupCodes` (shown once; only bcrypt hashes are stored).
  - `POST /2fa/disable` `{ password }` → verifies password, deletes the secret.
  - `POST /2fa/login` (public) `{ tempToken, otpCode }` → final token pair.
- **Login flow:** when 2FA is enabled, `POST /auth/login` returns
  `{ requires_2fa: true, temp_token }` (2-minute TTL, signed with a **distinct**
  `JWT_2FA_SECRET` so it can never be replayed as an access token). Users without
  2FA get the exact same response as before — fully backward compatible.

### 2. Password Policy

`IsStrongPassword` (custom `class-validator`) on register + change-password:
≥12 chars, upper + lower + digit + special, and a built-in blacklist that also
catches the `word+digits` pattern (e.g. `Password123!` is rejected).

### 3. Brute-Force Protection

- `login_attempts` table records every attempt (email, IP, UA, success).
- Lockout, checked **before** any password comparison (no credential oracle):
  - ≥ 5 failures in 15 min → locked 15 min.
  - ≥ 10 failures in 1 hour → locked 1 hour.
- Every failed login also emits a `LOGIN_FAILED` audit event.

### 4. Audit Hardening

- New `audit_logs.session_id` (`sub`+`iat`) ties rows to a session for forensics.
- Dedicated events: `PASSWORD_CHANGED`, `2FA_ENABLED`, `2FA_DISABLED`,
  `2FA_ENROLMENT_STARTED`, `SESSIONS_TERMINATED`, `LOGIN_FAILED`.
- `maskSensitive()` redacts secrets (`password`, `otpCode`, `secretKey`,
  `backupCodes`, `tempToken`, …) at the audit **sink** — belt-and-braces on top
  of the interceptor-level redaction.

### 5. Encryption at Rest (AES-256-GCM)

- `encryptedColumn()` transformer: `[12-byte IV][16-byte tag][ciphertext]`,
  base64. GCM gives confidentiality **and** integrity (tampering fails to
  decrypt). Applied to `user_two_factor.secret_key` / `backup_codes` and
  `products.cost_price`.
- Key: SHA-256 of `DB_ENCRYPTION_KEY` (injected by the security team, never in
  the repo). **Unset in dev = passthrough**, so local flows keep working and no
  ciphertext is produced without a key.

### 6. Network Allowlist (on-premise)

`IpAllowlistGuard` (runs first, before auth): when `ALLOWED_IPS` is set, requests
from any other source get 403 before authentication. Empty = allow all (cloud/dev).

---

## Mobile

### 1. Encrypted Local Storage

MMKV is encrypted with a **per-device, per-install** 256-bit key generated on
device and stored in the **OS keystore** (iOS Keychain / Android Keystore) via
`expo-secure-store` — never in the MMKV file or JS bundle. A stolen data file is
useless without the hardware-held key.

### 2. Biometric Auto-Wipe (physical-theft defence)

On cold start with an active session, the app demands a biometric unlock. **Three
consecutive failures** trigger `wipeAllLocalData()` + session clear. The failure
counter lives in the encrypted store so it survives app restarts.

### 3. Session Management

- Axios interceptor: on `401`, raises the **Session-Expired** gate
  (`SessionExpiredOverlay`) requiring biometric re-auth, alongside the
  single-flight transparent token refresh.
- Settings → **Terminate all sessions** calls `POST /auth/sessions/terminate-all`,
  invalidating the refresh token server-side everywhere.

### 4. Anti-Reverse-Engineering

- `babel-plugin-transform-remove-console` strips all `console.*`/`debugger` from
  production bundles.
- Metro `minifierConfig`: `drop_console`, `drop_debugger`, top-level mangle,
  comments removed.
- `proguard-rules.pro` (apply after `expo prebuild`): R8 shrinks + obfuscates the
  Android bytecode and strips `android.util.Log`.

---

## Deployment

`docker-compose.on-premise.yml`: API bound to **127.0.0.1 only**; Postgres/Redis
have **no published ports** (internal Docker network). Front with a hardened
proxy/VPN and set `ALLOWED_IPS`.

---

---

## Certificate Pinning (Mobile — requires production TLS cert)

**Status: Fully implemented. Blocked only on the production certificate.**

### Architecture

- `mobile/src/lib/pinned-http.ts` — custom Axios adapter that routes production
  requests through `react-native-ssl-pinning` (native OkHttp/NSURLSession layer).
- `mobile/src/api/client.ts` — swaps to the pinned adapter when `shouldPin()` is
  true (`!__DEV__ && PINNING.enforce`). In development the standard adapter is used.
- `mobile/certificates/pinning.ts` — host + hashes config; `enforce: !IS_DEV`.

### Activating pinning for production

1. **Extract the DER cert** from the live server once the TLS cert is provisioned:
   ```bash
   openssl s_client -connect api.stockmind.io:443 \
                    -servername api.stockmind.io </dev/null \
     | openssl x509 -outform DER -out mobile/certificates/stockmind-prod.cer
   ```

2. **Copy to native bundles** (run after `expo prebuild`):
   - Android: `android/app/src/main/assets/stockmind-prod.cer`
   - iOS: Xcode → target → Build Phases → Copy Bundle Resources → add `.cer`

3. **Generate the SPKI backup hash** and update `pinning.ts`:
   ```bash
   openssl s_client -connect api.stockmind.io:443 \
                    -servername api.stockmind.io </dev/null \
     | openssl x509 -pubkey -noout \
     | openssl pkey -pubin -outform der \
     | openssl dgst -sha256 -binary | openssl enc -base64
   ```
   Replace both placeholder values in `publicKeyHashes` (primary leaf + backup
   intermediate so a cert rotation doesn't brick users).

4. **Test**: build a production APK/IPA against a staging server with a
   _different_ cert. The app must close with an SSL error; the valid-cert build
   must succeed.

### Rotation procedure
1. ≥ 30 days before expiry: add the new cert hash as a second `publicKeyHashes`
   entry and ship the app update.
2. After ≥ 90 % of users have updated: rotate the live cert.
3. After 100 % adoption: remove the old hash in the next release.

---

## SAML 2.0 SSO (Backend — requires IdP / Active Directory)

**Status: Fully implemented. Blocked only on IdP metadata.**

### Architecture

| File | Role |
|---|---|
| `src/domain/entities/user-sso-link.entity.ts` | Links an IdP nameID to a local user |
| `src/infrastructure/auth/saml.strategy.ts` | Passport SAML strategy (validates assertion, auto-links by email) |
| `src/presentation/controllers/saml.controller.ts` | SP endpoints (login redirect, ACS callback, SLO) |
| `src/modules/saml.module.ts` | NestJS module, registered only when `SAML_ENABLED=true` |
| `src/migrations/1722000000000-SamlSso.ts` | `user_sso_links` table migration |

### Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/auth/saml/login` | Redirect to IdP login page |
| `POST` | `/api/v1/auth/saml/callback` | ACS — IdP posts assertion here, returns `{accessToken, refreshToken}` |
| `GET` | `/api/v1/auth/saml/logout` | SP-initiated SLO |

### Configuration (add to `.env` / CI secrets)

```env
SAML_ENABLED=true
AUTH_PROVIDER=saml          # set 'local' to allow password login in parallel
SAML_ENTRY_POINT=https://idp.example.com/saml/sso
SAML_ISSUER=https://api.stockmind.io
SAML_CALLBACK_URL=https://api.stockmind.io/api/v1/auth/saml/callback
SAML_CERT=-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----
```

> **`AUTH_PROVIDER`** controls `POST /auth/login` behaviour:
> - `local` (default): password login works normally; SAML is an _additional_ option.
> - `saml`: `/auth/login` returns `{ code: 'SSO_REQUIRED', loginUrl: '/auth/saml/login' }` and rejects passwords entirely.

### First-time user linking

When a user authenticates via SSO for the first time:
1. Strategy looks for an existing `user_sso_links` row — not found.
2. Falls back to matching by email claim from the SAML assertion.
3. If a StockMind account exists with that email → creates the link automatically.
4. If no account exists → `401 Unauthorized` with a message to ask the admin.

Admins can pre-link accounts by inserting a row into `user_sso_links` before
the user's first SSO login.

### Running the migration

```bash
npm run migration:run
```
