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

`pnpm test:e2e` defaults `TRIMTIME_E2E_NOW` to `2026-10-31T12:00:00Z` for a
deterministic server and browser clock. Set it to a UTC ISO instant ending in
`Z` to override for focused time-sensitive runs. Keep the default for the full
suite: an explicit `2026-11-02` clock makes the November 1 DST preview date
past.

Production builds and starts require explicit `MARKETING_ORIGIN` and
`APP_ORIGIN` values. Each must be a bare HTTPS origin; one trailing slash is
normalized away. Credentials, paths, queries, and fragments are rejected,
and the authorities (host and port) must differ. A custom
port is allowed. `BETTER_AUTH_URL` is optional and defaults to `APP_ORIGIN`;
when supplied, it must resolve to that same canonical origin. Set these values
for both build and runtime because routing rewrites and generated canonical
URLs use the configured origins. Local development may use HTTP and custom
ports. `pnpm test:e2e` builds and starts with its own HTTP `:3100` test origins
under `NODE_ENV=test`. It selects the `react-server` condition for Playwright's
server-side fixtures only. Direct Node tools importing the guarded auth
configuration also need that condition. Deploy with `NODE_ENV=production`;
test-mode HTTP configuration is not deployment configuration.

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
mkcert -key-file certs/local/trimtime-local-key.pem -cert-file certs/local/trimtime-local.pem localtest.me app.localtest.me '*.localtest.me'
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

Booking capability encryption uses `BOOKING_CAPABILITY_KEY_ID` and a
`BOOKING_CAPABILITY_ENCRYPTION_KEY` containing a base64-encoded 32-byte key.
Do not commit the key or store it in PostgreSQL.

## Local email capture

Mailpit is pinned in `compose.dev.yml` and its optional `email` profile is not
started by `pnpm db:dev:up`. Add these settings to your existing ignored `.env`
(copy `.env.example` once only if you do not already have an `.env`):

```dotenv
EMAIL_MODE=mailpit
MAILPIT_ORIGIN=http://127.0.0.1:8025
```

Then start the service with:

```sh
docker compose --project-name trimtime-dev -f compose.dev.yml up --detach mailpit
```

The web/API port `8025` binds only to loopback. Inspect captured messages at
<http://127.0.0.1:8025>. Mailpit mode requires a loopback Mailpit URL and local
application origins; invalid or hosted configuration, including any `VERCEL`
environment, disables email. The dispatcher runs after booking commit and
cannot undo the booking or its manage link. The global budget allows at most
100 reservations per UTC day. A reservation is not proof that an HTTP send was
invoked; uncertain reservations remain charged, and terminal work is never
replayed automatically after a budget reset or Mailpit restart. Transport
requests are best-effort and bounded to three seconds each.

Use fictional customer data. “Captured locally” means the app verified the Mailpit-stored recipient and
attempt-correlation header; it does not mean the message reached an inbox. The owner alert goes to the owner's stored account email and does not
contain the customer manage token. Routine tests use the isolated HTTP double
on `127.0.0.1:8027`; they must not contact this Mailpit instance. Hosted v1 has
no real email sender. Real delivery, provider setup, retry/backoff, future-event
templates, and manual resend remain deferred; Resend is tentative v2 only.
