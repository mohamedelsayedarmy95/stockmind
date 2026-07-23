# Contributing to StockMind

Thank you for contributing to StockMind. Please read this document before opening a PR.

---

## Branch Strategy

```
main          ← production-ready, protected (squash-merge only)
  └── develop ← integration branch (all features merge here first)
        └── feature/<slug>   ← new features
        └── fix/<slug>        ← bug fixes
        └── chore/<slug>      ← tooling, deps, docs
```

**Rules:**
- Never push directly to `main` or `develop`.
- Branch off `develop`, not `main`.
- Delete the feature branch after merge.

---

## Commit Convention (Conventional Commits)

```
<type>(<scope>): <imperative summary, ≤72 chars>

[optional body — explain WHY, not WHAT]

[optional footer: BREAKING CHANGE, closes #N]
```

**Types:** `feat` · `fix` · `chore` · `refactor` · `test` · `docs` · `perf` · `security` · `ci`

**Examples:**

```
feat(stock): add atomic two-leg warehouse transfer endpoint
fix(rbac): prevent Staff from calling adjustment endpoint
chore(deps): upgrade TypeORM 0.3.20 → 0.3.21
```

---

## Pull Request Flow

1. Fork / branch off `develop`.
2. Write code + tests.
3. Run the full local check suite:
   ```bash
   npm run lint        # TypeScript type-check (zero errors)
   npm run test:unit   # unit tests (all green)
   npm run test:integration
   npm run build       # production build must succeed
   ```
4. Open a PR against `develop` (NOT `main`).
5. Fill in the PR template (What, Why, How to test).
6. All CI checks must be green before review.
7. At least one approval required.
8. Squash-merge — keep `main`/`develop` history linear.

---

## PR Template

```markdown
## What
<!-- One-sentence summary of the change. -->

## Why
<!-- Business or technical motivation. Link issue if applicable. -->

## How to test
- [ ] Step 1
- [ ] Step 2

## Breaking changes
<!-- List any API, DB schema, or notification-channel changes and their migration steps. -->

## Checklist
- [ ] `npm run lint` passes
- [ ] Unit + integration tests pass
- [ ] New user data wired into SyncWorker/RestoreWorker (if applicable)
- [ ] Migration file included (if DB schema changed)
- [ ] No hardcoded secrets or URLs
```

---

## Code Standards

- **No `TODO`s or commented-out code** in production paths.
- **No `!!`** (non-null assertion) outside of test files.
- **No `runBlocking`** inside a running coroutine scope.
- **Decimal.js everywhere** — never `number` for monetary/stock quantities.
- **Domain layer is pure TypeScript** — no framework imports.

### Finance parser changes (extra gate)

Every NON_TRANSACTION_PATTERN change requires:
1. A positive test: the exact format parses correctly.
2. A negative test: a similar-looking non-transaction returns `null`.

---

## Database

- Schema changes require a TypeORM migration file (`npm run migration:generate`).
- Never use `fallbackToDestructiveMigration()`.
- New entity fields need `@Column({ default: ... })` for safe add-column migrations.

---

## Security

- All secrets via environment variables — never in source code.
- Run `npm audit --omit=dev` before merging; no HIGH/CRITICAL unfixed vulnerabilities.
- `npm run build` must succeed with zero TypeScript errors.

---

## Local Development Setup

```bash
# 1. Start infrastructure
docker compose up -d

# 2. Install dependencies
npm install

# 3. Copy and configure environment
cp .env.example .env
# Edit .env — fill in secrets

# 4. Run database migrations
npm run migration:run

# 5. Seed demo data (optional)
npm run seed

# 6. Start dev server
npm run start:dev
```

---

## Getting Help

Open a GitHub Discussion or ping the maintainers in the project channel.
