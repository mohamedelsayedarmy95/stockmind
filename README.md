---
title: StockMind Backend
emoji: 📦
colorFrom: blue
colorTo: indigo
sdk: docker
dockerfile: Dockerfile.prod
app_port: 3000
pinned: false
---

# StockMind v0.1.0

Intelligent Warehouse Operating System — Atomic Ledger Engine.

## Deploying to Render.com (free, no card required)

This repo ships a `render.yaml` Blueprint that builds `Dockerfile.prod`
directly — no code changes needed. Render's free web-service tier does not
require a payment method (unlike Hugging Face Spaces' Docker SDK, which now
gates Docker Spaces behind billing verification). Trade-off: the free
instance sleeps after 15 minutes idle and cold-starts (~30-50s) on the next
request — fine for dev/staging, worth knowing for production traffic.

Pair it with a free [Neon](https://neon.tech) Postgres instance (no card).

1. Create a Neon project. Copy the connection string it gives you:
   `postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require` — split it into
   `DB_HOST` / `DB_USERNAME` / `DB_PASSWORD` / `DB_DATABASE`.
2. On [render.com](https://render.com), **New → Blueprint**, connect the
   `mohamedelsayedarmy95/stockmind` GitHub repo, branch `main`. Render reads
   `render.yaml` and creates the `stockmind-api` web service automatically.
3. In the service's **Environment** tab, fill in the secrets marked
   `sync: false` in `render.yaml`:

   | Key | Value |
   |---|---|
   | `DB_HOST` / `DB_USERNAME` / `DB_PASSWORD` / `DB_DATABASE` | from the Neon connection string |
   | `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` / `JWT_2FA_SECRET` | random 64-char strings |
   | `CORS_ORIGIN` | comma-separated allowed origins |
   | `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` | from the Firebase service-account JSON |

   (`NODE_ENV`, `DB_SSL`, `DB_PORT` are already set in `render.yaml`.)
4. Run migrations once against Neon (locally, with the same `DB_*` vars in
   `.env` and `DB_SSL=true`):
   ```bash
   npm run migration:run
   ```
5. Once deployed, confirm `https://<your-service>.onrender.com/api/v1/health`
   returns `200 OK`.

## Alternative: Hugging Face Spaces (Docker SDK)

The repo is also HF-Space-ready via the `README.md` front matter above
(`sdk: docker`, `dockerfile: Dockerfile.prod`). As of 2026, HF requires a
verified payment method on the account before it unlocks Docker Spaces (the
free-tier hardware itself stays free unless you upgrade) — use this path only
if you're fine adding a card for verification. Steps:

1. Create a Neon project as above.
2. On the Space, go to **Settings → Repository secrets** and add:

   | Secret | Value |
   |---|---|
   | `DB_HOST` | the `HOST` part of the Neon string |
   | `DB_PORT` | `5432` |
   | `DB_USERNAME` | the `USER` part |
   | `DB_PASSWORD` | the `PASSWORD` part |
   | `DB_DATABASE` | the `DBNAME` part |
   | `DB_SSL` | `true` |
   | `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` / `JWT_2FA_SECRET` | random 64-char strings |
   | `CORS_ORIGIN` | comma-separated allowed origins |
   | `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` | from the Firebase service-account JSON |
   | `NODE_ENV` | `production` |

3. Push this repo to the Space's `main` branch — it builds `Dockerfile.prod`
   and serves the API on port 3000.
4. Run migrations once against Neon (locally, with the same `DB_*` vars in
   `.env` and `DB_SSL=true`):
   ```bash
   npm run migration:run
   ```

## Quick Start (local development)

### 1. Start Infrastructure

```bash
docker compose up -d
```

This starts PostgreSQL 15 (port 5432), Redis 7 (port 6379), and pgAdmin (port 5050).

### 2. Install Dependencies

```bash
npm install
```

### 3. Run Database Migration

```bash
npm run migration:run
```

Creates all tables, enums, indexes, and Phase 1 columns (public_id, soft delete, optimistic locking).

### 4. Start the Server

```bash
npm run start:dev
```

Server starts on `http://localhost:3000`.

### 5. (Optional) Seed Demo Data

```bash
npm run seed
```

Creates a demo company, warehouses, admin user (`admin@stockmind.io` / `admin123`), categories, and two products.

---

## API Testing (cURL)

All endpoints are prefixed with `/api/v1`.

### Auth

**Register** (creates company + admin + default warehouse):

```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "companyName": "My Company",
    "name": "Admin User",
    "email": "admin@test.com",
    "password": "password123"
  }'
```

Save the returned `accessToken`, `defaultWarehouse.id` for subsequent requests.

**Login:**

```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@test.com", "password": "password123"}'
```

**Refresh Token:**

```bash
curl -X POST http://localhost:3000/api/v1/auth/refresh-token \
  -H "Content-Type: application/json" \
  -d '{"refreshToken": "<REFRESH_TOKEN>"}'
```

**Logout:**

```bash
curl -X POST http://localhost:3000/api/v1/auth/logout \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

### Products

**Create Product:**

```bash
curl -X POST http://localhost:3000/api/v1/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{
    "name": "Product A",
    "sku": "PROD-A",
    "unitsOfMeasure": [{"uomType": "piece", "code": "PCS", "conversionFactorToBase": "1"}]
  }'
```

**List Products:**

```bash
curl http://localhost:3000/api/v1/products \
  -H "Authorization: Bearer <TOKEN>"
```

### Warehouses

**Create Warehouse:**

```bash
curl -X POST http://localhost:3000/api/v1/warehouses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{"name": "Warehouse B", "address": "456 St"}'
```

### Stock Operations (The Core)

**Inbound (receive goods):**

```bash
curl -X POST http://localhost:3000/api/v1/stock/inbound \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{
    "productId": "<PRODUCT_ID>",
    "warehouseId": "<WAREHOUSE_ID>",
    "quantity": "100",
    "notes": "Initial purchase order"
  }'
```

**Outbound (dispatch goods):**

```bash
curl -X POST http://localhost:3000/api/v1/stock/outbound \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{
    "productId": "<PRODUCT_ID>",
    "warehouseId": "<WAREHOUSE_ID>",
    "quantity": "30"
  }'
```

**Transfer (move stock between warehouses — atomic two-leg):**

```bash
curl -X POST http://localhost:3000/api/v1/stock/transfer \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{
    "productId": "<PRODUCT_ID>",
    "fromWarehouseId": "<SRC_WAREHOUSE_ID>",
    "toWarehouseId": "<DST_WAREHOUSE_ID>",
    "quantity": "10"
  }'
```

**Adjustment (inventory count correction):**

```bash
curl -X POST http://localhost:3000/api/v1/stock/adjustment \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{
    "productId": "<PRODUCT_ID>",
    "warehouseId": "<WAREHOUSE_ID>",
    "quantity": "-5",
    "reason": "Damaged goods found during count"
  }'
```

**Get Balance:**

```bash
curl http://localhost:3000/api/v1/stock/balance/<PRODUCT_ID>/<WAREHOUSE_ID> \
  -H "Authorization: Bearer <TOKEN>"
```

**Get Movement History:**

```bash
curl http://localhost:3000/api/v1/stock/movements/<PRODUCT_ID> \
  -H "Authorization: Bearer <TOKEN>"
```

---

## Acceptance Test Scenario

Run these commands in order to verify the system:

```bash
# 1. Register company + admin
curl -s -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"companyName":"TestCo","name":"Admin","email":"admin@test.com","password":"password123"}'

# Save TOKEN and WAREHOUSE_ID from response

# 2. Create Product A
curl -s -X POST http://localhost:3000/api/v1/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"Product A","sku":"A-001","unitsOfMeasure":[{"uomType":"piece","code":"PCS"}]}'

# Save PRODUCT_A_ID from response

# 3. Create Product B
curl -s -X POST http://localhost:3000/api/v1/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"Product B","sku":"B-001","unitsOfMeasure":[{"uomType":"piece","code":"PCS"}]}'

# 4. Inbound 100 pieces of Product A
curl -s -X POST http://localhost:3000/api/v1/stock/inbound \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"productId":"'$PRODUCT_A_ID'","warehouseId":"'$WAREHOUSE_ID'","quantity":"100"}'

# 5. Outbound 30 pieces of Product A
curl -s -X POST http://localhost:3000/api/v1/stock/outbound \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"productId":"'$PRODUCT_A_ID'","warehouseId":"'$WAREHOUSE_ID'","quantity":"30"}'

# 6. Check balance → expect 70.000000
curl -s http://localhost:3000/api/v1/stock/balance/$PRODUCT_A_ID/$WAREHOUSE_ID \
  -H "Authorization: Bearer $TOKEN"

# 7. Try outbound 100 more → expect HTTP 409 "Insufficient stock"
curl -s -X POST http://localhost:3000/api/v1/stock/outbound \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"productId":"'$PRODUCT_A_ID'","warehouseId":"'$WAREHOUSE_ID'","quantity":"100"}'
```

---

## Phase 1 — Architectural Hardening

### Database
- **UUID v7 public_id**: time-ordered external identifiers on Company, Warehouse, Product, User. Internal PK (UUID v4) untouched.
- **Optimistic Locking**: `@VersionColumn` on Product and ProductWarehouse — concurrent saves throw `OptimisticLockVersionMismatchError`.
- **Soft Delete**: `deleted_at` + `deleted_by` on Company, Warehouse, Product, User. `DELETE` endpoints fill `deleted_at` instead of removing rows. Soft-deleted records auto-excluded from queries.
- **Migration-first**: `synchronize: false`. Schema managed by `npm run migration:run`.

### Security
- **Helmet**: HTTP security headers (XSS, HSTS, clickjacking).
- **Rate Limiting**: 100 requests/minute per IP via `@nestjs/throttler`.
- **CORS**: locked to `CORS_ORIGIN` env var (comma-separated origins).
- **Global JWT Guard**: every route requires Bearer token by default. Public routes (register, login, refresh, health) annotated with `@Public()`.

### Observability
- **Structured Logging**: `nestjs-pino` with JSON output (pino-pretty in dev).
- **Correlation ID**: auto-generated UUID v7 per request. Propagated via `X-Correlation-ID` header (request + response). All log lines tagged.
- **Health Check**: `GET /api/v1/health` — returns database connectivity status (no auth required).

### Performance Indexes
- `stock_movements(product_id, warehouse_id)` — movement queries
- `stock_movements(created_at DESC)` — timeline queries
- `users(company_id)` — multi-tenant isolation
- `warehouses(company_id, is_active)` — active warehouse lookups

## Phase 2 — Global Enterprise Transformation

### Architecture: Clean Architecture + CQRS
```
src/
├── domain/         entities, repository interfaces, domain events, service contracts
├── application/    commands, queries, handlers, event listeners, DTOs (business logic)
├── infrastructure/ TypeORM services, storage adapters, audit writer, tenant context, subscribers
├── presentation/   controllers (thin), guards, decorators, interceptors, middleware, filters
├── shared/         cross-cutting utils + constants (permissions, enums)
└── modules/        NestJS wiring only
```

### CQRS Commands & Queries
- **Commands**: `InboundStockCommand`, `OutboundStockCommand`, `AdjustStockCommand`, `TransferStockCommand`, `CreateProductCommand`
- **Queries**: `GetBalanceQuery`, `GetMovementHistoryQuery`, `GetProductListQuery`
- Controllers are orchestrators only — every write goes through `CommandBus`, every read through `QueryBus`.
- Every command handler wraps the sacred atomic transaction and emits a domain event on success.

### Domain Events (EventEmitter2 + `@nestjs/cqrs` EventBus)
- `StockReceivedEvent` (from `InboundStockCommand` and TransferIn leg)
- `StockIssuedEvent` (from `OutboundStockCommand` and TransferOut leg)
- `StockAdjustedEvent` (from `AdjustStockCommand`)
- `ProductCreatedEvent` (from `CreateProductCommand`)
- Listeners persist events to `audit_logs` and emit structured logs with the same correlation ID.

### Multi-Tenancy Hardening
- `TenantMiddleware` decodes the JWT and populates `AsyncLocalStorage` with `{userId, companyId, correlationId, ipAddress, userAgent}`.
- `TenantSubscriber` (TypeORM `EntitySubscriberInterface`):
  - `beforeInsert` auto-fills `company_id` if the caller forgot.
  - `afterLoad` throws if a loaded row's `company_id` does not match the active tenant — cross-company leaks fail loud.
- Every service still passes `companyId` explicitly in WHERE clauses; the subscriber is a belt-and-braces safety net.

### RBAC (advanced)
- Tables: `roles`, `permissions`, `role_permissions`, `user_roles` (Phase 2 migration).
- 17 canonical permissions in [`permissions.constant.ts`](src/shared/constants/permissions.constant.ts).
- `@RequirePermissions(PERMISSIONS.STOCK_INBOUND)` decorator + `PermissionsGuard`.
- Legacy `role` enum (Admin/Manager/Staff) still works via `DEFAULT_ROLE_PERMISSIONS` fallback — no breaking change for existing JWTs.

### Enterprise Audit Log
- `audit_logs` table (JSONB `old_values`/`new_values`, `ip_address`, `user_agent`, `correlation_id`).
- `AuditLogInterceptor` (global) records every POST/PUT/PATCH/DELETE with request/response diff.
- Sensitive fields (`password`, `passwordHash`, `refreshToken`) auto-redacted before storage.
- Correlation ID from Phase 1 propagates end-to-end: HTTP header → Pino log → audit row → domain event listener log.

### File Storage Abstraction
- `IFileStorageService` interface in `domain/services/`.
- Three implementations: `LocalStorageService`, `S3StorageService`, `CloudinaryStorageService`.
- Driver chosen via `STORAGE_DRIVER` env (`local` / `s3` / `cloudinary`).
- Product image upload now streams to the configured backend (no direct disk write).

### Testing
- Jest + Supertest + `@nestjs/testing`, ts-jest.
- 5 test suites, 13 tests, 100% passing.
- Unit tests for CQRS handlers, guards, UUID v7 generator.
- Integration test for audit log interceptor covering success, error, GET skip, and redaction.
- Factories in `tests/factories/` for entities.
- Scripts: `npm test`, `npm run test:unit`, `npm run test:integration`, `npm run test:cov`.

### CI/CD (`.github/workflows/ci.yml`)
On every push/PR to `main`/`master`/`dev`:
1. `npm ci`
2. `npm run lint` (tsc typecheck)
3. `npm run build`
4. `npm run migration:run` against a real ephemeral Postgres 15 service
5. `npm run test:unit`
6. `npm run test:integration`

## Environment Variables

See `.env.example` for all configurable values.

## pgAdmin

Access at `http://localhost:5050` with `admin@stockmind.io` / `admin123`.
Add server: host=`postgres`, port=`5432`, user=`stockmind`, password=`stockmind123`.
