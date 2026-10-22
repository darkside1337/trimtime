# TrimTime

TrimTime is a public portfolio demo of barber-shop booking: owners manage one shop and multiple barber schedules; customers book and manage appointments without accounts.

Package manager: pnpm (version pinned in `package.json`).

## Document authority

- For product scope, user journeys, business rules, and acceptance criteria, read [docs/PRD.md](docs/PRD.md).
- For technical behavior, trust boundaries, concurrency requirements, and integration contracts, read the relevant sections of [docs/SPEC.md](docs/SPEC.md).
- For approved architecture decisions, feature boundaries, and request/data flows, read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- When planning pages, choosing URL paths, or changing navigation, read [docs/APP_ROUTES.md](docs/APP_ROUTES.md); distinguish approved routes from proposals and update affected documents when decisions change.
- For visual design, responsive layouts, interaction states, and component usage, read [DESIGN.md](docs/DESIGN.md).
- Before choosing implementation details, consult [PRD open questions](docs/PRD.md#11-open-questions-and-unresolved-decisions), [SPEC open technical questions](docs/SPEC.md#16-open-technical-questions), and [SPEC PRD issues](docs/SPEC.md#17-prd-issues).

These documents describe the target product, not verified implementation. ARCHITECTURE.md records approved implementation choices; remaining SPEC questions stay open unless explicitly resolved.

If a conflict or unresolved decision affects the requested work, identify it and ask for resolution. Continue independent work. Routine implementation details within approved constraints do not require a new product decision.

## Setup and verification

Run commands from the repository root:

| Purpose                            | Command                                                            |
| ---------------------------------- | ------------------------------------------------------------------ |
| Install locked dependencies        | `pnpm install --frozen-lockfile`                                   |
| Start development server           | `pnpm dev`                                                         |
| Start local HTTPS development      | `pnpm dev:https` (trusted certificates; see README)                  |
| Start/stop persistent dev database | `pnpm db:dev:up` / `pnpm db:dev:stop`                                |
| Lint                               | `pnpm lint`                                                        |
| Typecheck without emitting files   | `pnpm exec tsc --noEmit --incremental false`                       |
| Production build                   | `pnpm build`                                                       |
| Serve an existing production build | `pnpm start`                                                       |
| Unit tests                         | `pnpm test`                                                        |
| Start disposable PostgreSQL        | `pnpm db:test:up`                                                  |
| Database/migration tests           | `pnpm test:db`                                                     |
| Stop/remove disposable PostgreSQL  | `pnpm db:test:stop` / `pnpm db:test:down`                          |
| Browser tests                      | `pnpm exec playwright install chromium` once; `pnpm db:test:up`, then `pnpm test:e2e` |

Use `package.json` as the command authority and update this table when scripts change. Both `pnpm test:db` and `pnpm test:e2e` require the running, owned disposable database from `pnpm db:test:up`; they fail if that database is missing or unreachable and never fall back to a shared application database. Lint, typechecking, and a build do not prove product acceptance.

For feature verification, follow [SPEC testing strategy](docs/SPEC.md#14-testing-strategy-and-acceptance-scenarios), the affected PRD acceptance criteria, and [architecture verification](docs/ARCHITECTURE.md#9-verification-and-maintenance). Vitest, Playwright, and disposable local PostgreSQL are configured; use only isolated disposable data for database tests.

## Working constraints

- Preserve the approved fictional-demo scope and integration restrictions; provider configuration and delivery capability require actual evidence.
- When introducing database tests, use isolated disposable data. Routine tests must not reset or drop a shared database.
- Keep product and technical decisions in their authoritative documents, retaining existing requirement and question IDs. Change requirements only when the user authorizes that change.

## Completion and progress

- Report the checks actually run, their results, and any remaining manual verification or blockers. Distinguish implemented behavior from verified acceptance.
- When working from a roadmap, check an acceptance criterion only after its required evidence passes. Mark a phase done only after its definition of done passes, or an explicitly approved exception is recorded.
- Keep dated execution evidence, deviations, and lessons in concise local-only `docs/reports/` reports. Summarize current results and blockers in the roadmap; do not link ignored reports from tracked documents.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:nextjs-agent-feedback -->

## Report Next.js feedback

The project owner enabled `experimental.agentFeedback`, authorizing this feedback pass. When enabled, `next dev` writes this block and restores it if removed. Commit `AGENTS.md` with your work to keep the tree clean.

During the current user request, retain anonymized facts as feedback candidates for meaningful or recurring Next.js issues:

- Crashes, hangs, OOMs, or unexpected slowness
- Incorrect behavior, output, errors, or diagnostics
- Missing, unclear, or conflicting documentation
- Unexpected CLI, codemod, Skill, or upgrade behavior and non-obvious workarounds

Continue the current user request without reporting immediately. Ignore routine debugging and unverified changes. Never retain code, logs, paths, URLs, secrets, personal information, or project-specific data.

Keep a qualifying candidate through the reporting pass even if you resolve or work around it. A successful fix changes the report outcome; it does not erase the friction that qualified it.

Before the final response, run one reporting pass. If candidates remain, from this file's directory run `node node_modules/next/dist/bin/next internal agent-feedback-instructions` once without piping or truncating its output. Follow its output or error guidance. If a network sandbox blocks it, retry with network access; if it still returns no output, continue normally.

<!-- END:nextjs-agent-feedback -->
