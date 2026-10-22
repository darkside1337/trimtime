# Phase 00 — Runnable and verifiable foundation

**Result:** Phase 00 acceptance criteria passed on 2026-10-20.

## Environment

- Node.js 24.21.0; pnpm 12.6.0 (the pinned package-manager version).
- Docker Engine 29.9.2; Docker Compose 5.6.0.
- Disposable database image: PostgreSQL 18.6, pinned by digest in `compose.test.yml`.
- Playwright Chromium installed successfully; this host used Playwright's Ubuntu 24.04 fallback browser build.

## Verification

- `pnpm install --frozen-lockfile` — passed.
- `pnpm dev`, then `GET /design-system` — app ready; HTTP 200 and the design-system heading rendered.
- `pnpm lint` — passed.
- `pnpm exec tsc --noEmit --incremental false` — passed.
- `pnpm build` — passed; `/` and `/design-system` prerendered.
- `pnpm test` — 1 file, 2 tests passed.
- `pnpm db:test:up` then `pnpm test:db` — owned-container verification passed; 1 file, 2 tests passed. The database test applies fixture DDL, checks the migration ledger, reruns migrations, and verifies saved test data remains.
- `MIGRATION_DATABASE_URL=<disposable URL> pnpm db:migrate` — passed against the disposable database. The application migration journal is intentionally empty until the first product schema is added.
- `pnpm test:e2e` — production build passed; all 6 Chromium tests passed across desktop, tablet, and phone. Checks cover home/design-system rendering, page errors, calendar specimen, tab selection, dialog dismissal/focus return, and the final navigation label fitting the viewport.
- Missing test URL with `DATABASE_URL` set — `node scripts/test-db.mjs verify` failed with `TEST_DATABASE_URL is required` before Docker/database access.
- Stopped-container check — `pnpm test:db` failed with `Disposable PostgreSQL is stopped; run pnpm db:test:up.`; it did not connect to a database.
- `pnpm db:test:down` — removed the owned container. A Docker label query confirmed no Phase 00 container remains.

Desktop and phone screenshots from the production build were reviewed against the saved design-system baseline: [desktop](2026-10-20-phase-00-foundation/desktop.png), [phone](2026-10-20-phase-00-foundation/phone.png). The app theme, components, logo, and specimen remained in place.

## Review correction — Node requirement (2026-10-20)

The README now requires Node.js 24 LTS, and `package.json` declares
`engines.node: "24.x"`. The previous Node.js 20.9 minimum did not support the
installed Vitest version or the scripts' native TypeScript imports. Engine
enforcement remains dependent on package-manager settings.

Verified on Node.js 24.21.0 with pnpm 12.6.0:

- `pnpm install --lockfile-only` and `pnpm install --frozen-lockfile` — passed;
  no lockfile update was needed.
- `pnpm test` — 2 tests passed.
- `pnpm db:test:up`, `pnpm test:db`, and migration execution against the
  disposable database — passed; 2 database tests passed.
- `pnpm db:test:stop`, then `pnpm test:db` — rejected the stopped database
  with the expected actionable error.
- `pnpm db:test:down` — passed; Compose confirmed no test container remains.

Build and browser checks were not repeated for this metadata/documentation
correction; their earlier results above remain the recorded evidence.

## Limits

This verifies the local harness and existing baseline only. It does not verify product persistence, authentication, provider delivery, or any later-phase journey. No shared or production database was used.
