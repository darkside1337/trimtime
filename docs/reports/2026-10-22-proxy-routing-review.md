# Proxy routing implementation review — 2026-10-22

## Scope and result

Reviewed the user-approved marketing/owner Proxy refactor against its execution plan. The existing implementation preserved public URLs, independent action/auth-handler checks, and strict configured-host/origin validation. Corrected the gaps below and verified the local implementation. Actual Google-provider and hosted verification remain pending; public shop routing is still outside this refactor.

## Corrections

- Marketing owner-page requests previously passed through Proxy. They now receive HTTP 404 before route/action dispatch; the captured-action replay assertion expects that response and still verifies unchanged A/B/shared-demo records.
- Matcher exclusions previously used unescaped dots and unbounded prefixes. They now match the exact icon filenames and framework/brand directory segments. Lookalikes such as `/faviconXico`, `/icon.png-extra`, and `/_next-example` no longer bypass routing. Direct `/owner/**` access remains blocked even for paths ending in an image extension.
- Added Proxy/matcher tests for canonical rewrites, GET/POST parity, query retention, internal paths, auth endpoints, shared specimens/resources, and invalid/conflicting hosts. Added a production-origin configuration case to the existing host tests.
- Added browser checks for HTTP statuses, resources on both configured hosts, callback queries, Back/Forward/refresh, canonical client navigation, and alternating owner A/B/marketing responses without disclosure or browser errors.
- Removed the marketing page's redundant Suspense/component wrapper. Request-dependent owner reads retain their existing Suspense boundaries.
- Browser screenshots now use Playwright's per-test output directory instead of overwriting historical UI-fidelity report images.
- Reconciled previously approved sign-in/setup paths and auth endpoints in APP_ROUTES, narrowed SPEC OTQ-002 without closing hosted questions, and documented the shared host policy in ARCHITECTURE. No product requirements, dependencies, migrations, or host-trust rules changed.

## Verification

| Check | Result |
| --- | --- |
| `pnpm test` | 35 passed, including 21 Proxy cases and the production-origin case |
| `pnpm test:db` | 20 passed against owned disposable PostgreSQL |
| `pnpm test:e2e` | 60 passed across desktop, tablet, and phone Chromium; runner built and served production output |
| `pnpm lint` | Passed |
| `pnpm exec tsc --noEmit --incremental false` | Passed |
| `git diff --check` | Passed |
| Browser fixture cleanup | Zero remaining users matching the browser fixture email prefix |

The production build prerenders the marketing root statically and owner destinations partially, with Proxy registered. Browser evidence includes valid setup/settings POSTs, signed-out and forged-field/origin replays, revoked-session denial, sign-out, own-shop isolation, shared-demo protection, keyboard/reduced-motion journeys, and overflow checks inherited from the existing suite. Fixture sessions are created using Better Auth's test utilities against real disposable PostgreSQL. Foreign-origin replays intentionally produce framework rejection diagnostics.

The initial unit run exposed six routing/matcher expectation failures after correcting a documentation/helper mismatch; all passed after the routing correction. The first full browser run passed 57/60: the three failures were a new alert selector also matching Next's route announcer. Narrowing that selector restored the complete 60/60 run. After resumption, the stopped disposable database was restarted using the owned test command; this was a setup issue, not a behavior failure.

## Limits and remaining evidence

- Live HTTPS Google login/cancellation and return navigation were not repeated after this refactor. Fixture/provider-error tests establish application behavior, not a real Google handshake.
- Production DNS, wildcard routing, forwarded-header behavior, HTTPS cookies, and the deployed callback remain covered by the earlier approved hosted-verification deferral. Any legitimate Host/forwarded-host mismatch requires a verified ingress contract before changing trust policy.
- Public booking and manage-link routes are deferred to their product phases. Unsupported shop hosts currently return 404.
- No changes to lifecycle states, mutation accounting, financial rules, database concurrency, or provider delivery were needed. UI styling was preserved; existing responsive interaction/overflow checks passed, but no new design comparison was performed.
- Installed Next.js 16.4.0's bundled Proxy guide names `unstable_doesProxyMatch`, while the package exports `unstable_doesMiddlewareMatch`. Tests use the actual installed export; this documentation mismatch was retained for the required framework-feedback pass.

Historical plans and reports were preserved. This report records local evidence and does not claim deployment acceptance.
