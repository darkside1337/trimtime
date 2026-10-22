# TrimTime

TrimTime is a public portfolio demo of barber-shop booking. Product scope and
delivery status are documented in [docs/PRD.md](docs/PRD.md) and
[docs/ROADMAP.md](docs/ROADMAP.md).

## Requirements

- Node.js 24 LTS (24.x, required by the test tooling and native TypeScript scripts)
- pnpm 12.6.0 (the version pinned in `package.json`)
- Docker Engine with Docker Compose v2 for disposable PostgreSQL
- Chromium for Playwright browser tests

Install dependencies and the browser once:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
```

## Run and verify

```sh
pnpm dev                         # plain HTTP; configure matching origins below
pnpm dev:https                   # follow Local Google sign-in setup below
pnpm dev:local                   # starts local DB, applies migrations, starts HTTPS app
pnpm db:dev:up                   # persistent dev PostgreSQL on 127.0.0.1:5433
pnpm db:dev:stop                 # stops dev PostgreSQL, retaining its volume
pnpm lint
pnpm exec tsc --noEmit --incremental false
pnpm build
pnpm test                        # Vitest unit tests
pnpm db:test:up                  # disposable PostgreSQL on 127.0.0.1:55432
pnpm test:db                     # verifies ownership, connectivity, and migrations
pnpm test:e2e                    # builds, then runs Chromium at desktop/tablet/phone sizes
pnpm db:test:down                # removes only the Phase 00 Compose project
```

For marketing and design-system inspection over plain HTTP, set matching origins
for the development process:

```sh
MARKETING_ORIGIN=http://localhost:3000 \
APP_ORIGIN=http://app.localhost:3000 \
BETTER_AUTH_URL=http://app.localhost:3000 \
pnpm dev
```

Open `http://localhost:3000/` or `http://localhost:3000/design-system`. These
process-level overrides take precedence over `.env`; the application rejects
unconfigured hosts. Use the HTTPS setup below for real Google sign-in. The
Playwright runner supplies its own origins on port 3100.

The database test URL is supplied by the repository's `.env.test` and
targets only the Compose-owned `trimtime_test` database. If it is stopped,
both `pnpm test:db` and `pnpm test:e2e` fail with an actionable error. Run
`pnpm db:test:up` before either suite. `pnpm db:test:stop` and
`pnpm db:test:up` are available for the stop/restart check. Database tests
verify the exact container before connecting and never fall back to
`DATABASE_URL`.

## Local Google sign-in

Copy `.env.example` to the ignored `.env` and populate the auth secret and Google
credentials. Its database URLs match `compose.dev.yml`; both URLs refer to the
same local dev database. Production should use separate roles where privileges
differ. The dev volume persists across `db:dev:stop` and `db:dev:up`.

With `mkcert` installed and its local CA trusted, generate the ignored certificate
files once:

```sh
mkdir -p certs/local
mkcert -key-file certs/local/trimtime-local-key.pem -cert-file certs/local/trimtime-local.pem localtest.me app.localtest.me
pnpm dev:local
```

`pnpm dev:local` starts the persistent dev database, applies any pending
migrations, then starts the HTTPS app. Run it again after stopping the app;
the migration step is safe to repeat and only applies unapplied migrations.

Marketing runs at `https://localtest.me:3000`; owner sign-in runs at
`https://app.localtest.me:3000/sign-in`. Google must authorize
`https://app.localtest.me:3000` and the exact redirect
`https://app.localtest.me:3000/api/auth/callback/google`.

Playwright remains separate on port 3100 with `localhost`/`app.localhost` and
the owned disposable database. Its runner overrides application and migration
URLs, auth secret, Google credentials, and the test-only lock timeout. Session
fixtures use Better Auth test utilities exclusively outside production routes.

The app database connection requires `DATABASE_URL`. The migration command
requires the separate `MIGRATION_DATABASE_URL` variable and applies versioned
migrations from `db/migrations`:

```sh
MIGRATION_DATABASE_URL='postgresql://…' pnpm db:migrate
```

Keep real application credentials in a local ignored environment file. Never
point routine tests at a shared or production database. See
[AGENTS.md](AGENTS.md) for contributor rules and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#9-verification-and-maintenance) for
verification boundaries.
