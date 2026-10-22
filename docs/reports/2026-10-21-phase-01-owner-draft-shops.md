# Phase 01 execution report — owner draft shops

**Date:** 2026-10-21 (Africa/Algiers)

**Outcome:** Phase 01 complete locally, with the explicitly approved hosted-verification exception below. P01-C1–C4 and applicable G1/G7/G8 evidence are accounted for; this is not a claim of deployed acceptance or completion of the broader AC-001–AC-004 journeys.

**Environment/baseline:** Node 24.21.0, pnpm 12.6.0, Next.js 16.4.0, Better Auth 1.7.12, local PostgreSQL and Chromium. Preserved the dirty Phase 00/design/documentation baseline described in the approved plan; no reset, wholesale staging, or unrelated cleanup. Real-provider development uses trusted HTTPS on `app.localtest.me:3000`; isolated browser tests retain the approved HTTP `localhost`/`app.localhost:3100` pair, separate credentials and database.

## Implemented

- Added pinned Better Auth, Drizzle adapter, Zod, Vercel pool lifecycle support, generated auth schema, and additive auth/shop migrations.
- Added verified database-session owner context, Google-only client entry, exact owner/marketing host checks, host-only trusted owner origin enforcement for shop Server Actions, and guarded auth handler.
- Added strict shop setup/settings schemas; normalized DNS-label subdomains; reserved `app`, `www`, `api`, and `admin`; owner/subdomain database uniqueness; own-shop reads/writes; permanent stored time-zone locking.
- Added branded marketing, sign-in, setup, settings, and empty Today owner surfaces. No publication, bookings, calendar, services, or address editing was added.
- Split fixture and product migration ledgers, extended feature/server test discovery, and replaced the browser command with a runner that verifies and migrates only the owned disposable database before build/start.

## Verified local evidence

- RED→GREEN evidence recorded during execution for valid setup input, required text, IANA zone validation, subdomain normalization/grammar/reservations, real persisted sessions, shop creation, and settings persistence.
- `pnpm lint` passed.
- `pnpm exec tsc --noEmit --incremental false` passed.
- `pnpm test` passed: 13 tests.
- `pnpm test:db` passed: 20 tests, including auth/session revocation, authorization isolation, advisory availability/stale claims, constraints/races, migration ledgers, time-zone lock, and a real read-only transaction failure followed by retry.
- `pnpm build` passed with Cache Components request reads streamed behind Suspense.
- Final `pnpm test:e2e` passed: 45 Chromium checks across desktop/tablet/phone (6 foundation and 39 Phase 01 checks), including the production build. Repeated after the final auth/layout changes and again after correcting screenshot capture readiness.
- `pnpm install --frozen-lockfile` and `git diff --check` passed.
- Stopped-container and missing-`TEST_DATABASE_URL` checks both failed as expected, without falling back to the dev database. The disposable test container was then removed; its fixture data is intentionally disposable.

## Continuation: browser behavior and local HTTPS

- Added test-only Better Auth/real PostgreSQL browser fixtures with unique owners and subdomains, independent contexts, fixture-ID cleanup, owned database validation before connecting, and worker-pool teardown. A cleanup query after the browser suite returned zero users and shops.
- The runner now also overrides `MIGRATION_DATABASE_URL`, uses a test-only one-second row-lock timeout, and removes a leading pnpm `--` before forwarding Playwright filters. Production auth never registers the test-utils plugin or a test-login route.
- Browser coverage now includes Google-only signed-out entry, setup-to-Today and persisted settings reload, reserved-subdomain input retention/error association/focus, settings success, real save-failure/retry, existing-owner routing, revoked-cookie replay, sibling-host cookie isolation, and captured current-build Server Action replays. Replays cover signed-out requests, forged ownership/shop/publication fields across A/B/shared-demo fixtures, foreign/missing Origin, marketing-host writes, and query-string IDs; all three shops remain unchanged after denied requests.
- Setup and settings now use controlled input values, shared associated field errors, error focus, disabled saving controls, and announced settings success. Strict action validation removes only React's reserved `$ACTION_` metadata; application fields remain subject to the existing strict schemas.
- Added persistent dev PostgreSQL on port 5433 with `pnpm db:dev:up` / `pnpm db:dev:stop`. Applied product migrations to this new local dev database. Its initial shop count was zero. It is distinct from the disposable test database on port 55432.
- Generated ignored mkcert certificates for the two configured local HTTPS hosts. Existing local CA trust was verified. Normal certificate-validated HTTPS requests to marketing and owner sign-in returned 200. `pnpm dev:https` is running for the user walkthrough; dev credentials were not printed or copied into evidence.
- Added the local HTTPS hostnames to Next.js `allowedDevOrigins` after its dev-resource protection blocked the owner's browser. Restarted the dev server. The user confirmed successful real Google owner login, draft-shop creation, settings access, sign-out/return bypassing setup, and second-account fresh setup with its separate shop. Subsequent executor-observed real-account, cookie and direct-request results are recorded below.
- The initial read-only dev check found one unpublished shop; after the user's second-account setup, the final check found two unpublished shops. No account identifiers, tokens, or credentials are included in this report.
- Implemented the plan's server-only `checkSubdomainAvailability` operation. It requires a verified owner context, reuses strict normalized/reserved-subdomain validation, and returns only `{ available }`. Database tests verify denied signed-out/extra-field inputs, normalized checks, a stale available result losing at authoritative creation, and retry with a fresh namespace. No public lookup route or owner/shop disclosure was added.
- Extended browser coverage for required setup input, duplicate-subdomain retry, invalid settings with unchanged committed values, Google connecting/HTTP failure/network failure/retry, and complete forward Tab order through setup/settings under reduced motion. Network interception for auth UI states never contacts Google.

### RED/GREEN evidence from this continuation

1. Setup submission initially failed strict validation on React's framework metadata. After excluding that reserved metadata, creation succeeded; the required post-create navigation was still absent.
2. A Server Action `redirect` reached the wrong host presentation. Temporary diagnostics showed that the internal redirect fetch changed Host while preserving the original forwarded host, which correctly failed the existing strict host guard. Client `router.replace` after successful setup avoids that fetch; the setup/Today/settings journey then passed. Diagnostics were removed; no host validation was relaxed.
3. Reserved-subdomain browser test failed because the old uncontrolled form reset entered values. Controlled fields, associated error text, and focus handling made it pass.
4. Settings test failed because no success status was rendered. An announced success state and controlled settings fields made save/reload pass.
5. Dedicated single-connection application-pool read-only fault injection returned `SAVE_FAILED` and preserved old settings; normal writes succeeded after restoring that connection. The browser fault test separately locks only its own fixture row using a dedicated connection; the test server's lock timeout produces a real failed save, with retained input and a successful retry after releasing the lock. No shared container outage or mocked database result is used.
6. The direct-request test's initial injected multipart fields were appended after the Flight reference, so React did not decode them into action input. Moving them before the reference exercised the intended unknown-field rejection; no production authorization change was needed.
7. The new availability-contract test failed because the operation was absent, then passed after implementing its guarded query and strict input schema. The complete database suite passed afterward.
8. The auth UI test reproduced a network-abort failure leaving the button permanently connecting. Catching the rejected sign-in request and resetting pending state made HTTP failure, network failure, and retry pass at all three widths.
9. Required-field and invalid-settings browser checks passed with the existing validation behavior. The duplicate test initially matched both the application's alert and Next's route announcer; narrowing it by visible error text fixed the test without changing the product. The keyboard harness also needed to await the streamed form before pressing Tab. One failed-run worker lingered during teardown; it was terminated, and the following targeted and full runs exited normally. A cleanup query returned zero test users/shops.
10. Real Google cancellation initially reached Better Auth's generic error page. Supplying `/sign-in` as `errorCallbackURL` and rendering a safe callback-error message restored the branded retry path. The executor cancelled the real provider flow, observed the safe message, and successfully retried. Three viewport tests also verify that provider-supplied detail is not echoed and retry retains the explicit callback contract.
11. Screenshot inspection found blank streamed fallback captures despite passing later behavioral assertions. The shared capture helper now awaits non-empty main content and loaded fonts before measuring overflow/capturing. Regenerated screenshots show the actual pages; no arbitrary delay or product workaround was added.

### Screenshots and interaction evidence

Full-page screenshots are in [the matching evidence directory](2026-10-21-phase-01-owner-draft-shops/): marketing, sign-in, setup, setup error, Today, settings success/failure, keyboard focus, and auth connecting/failure states for each viewport. Viewports are desktop 1440×900, tablet 768×1024, and phone 390×664 (device pixel scale affects image dimensions). Each capture also checks for horizontal page overflow. Normal entry/sign-in/setup/settings/Today images at all three widths and representative error/failure/keyboard images were inspected. The final captures have no dev indicators.

Keyboard evidence includes Tab through header actions and all setup/settings controls, visible computed focus outlines, Enter submission, invalid-field/error focus and descriptions, duplicate retry, and reduced-motion transition timing at all three widths. Phase text-pair checks: ink/paper 15.523:1; muted/paper 4.830:1; muted/cloud 4.503:1; destructive-text/paper 5.260:1 and its pale error surface 4.524:1; success/paper 5.785:1; draft warning/pale warning 4.607:1; ink/blue wash 14.047:1; primary white/ink 15.523:1. Errors also have text and associated descriptions; focus retains DESIGN's normative Sky outline. This is scoped Phase 01 evidence, not a whole-product accessibility certification.

### Doop MCP comparison

Used Doop MCP (`get_guide`, `get_canvas`, relevant `get_guidelines`, and `get_frame_screenshot`), with stable identity `Codex`, on canvas `i6lCZ9U4mi`. Reviewed all selected references below, including connecting, failure and validation states; no reference frames were edited. Existing downloaded reference images predate the user's MCP-only instruction; the completed comparison used MCP-rendered references.

| Surface | Reference IDs, desktop / tablet / phone | Confirmed source dimensions | Phase adaptation / review result |
| --- | --- | --- | --- |
| Marketing | `Y2VSLZNRGs` / `tbUtEbXKK6` / `PcnFu28jqT` | 1440×3117 / 768×3297 / 390×4671 | Retained the approved modest branded entry, not the full marketing/calendar/booking demonstration. Existing logo, readable text and real owner link fit all widths. |
| Sign-in | `aJ6U098tXQ` / `ItLmNd-jyW` / `otK67wvMSW` | 1440×1000 / 768×900 / 390×1190 | Branded header, strong intro, numbered owner guidance and Google-only card; desktop two-column, smaller widths stacked. Demo/customer disclosures remain truthful. |
| Setup | `od9vamduSk` / `HibdAq-Djw` / `Xf6vOkTB6i` | 1440×1437 / 768×1931 / 390×2076 | Header/sign-out, clear heading and private-draft aside; form first, aside stacked below on smaller widths. Required free-text contact/address and permanent namespace follow approved contracts, not prototype fields. |
| Settings | `g1GkbadNik` / `x1ckjeGF0p` / `5Ri8RS-PhP` | 1440×2250 / 768×3700 / 390×4700 | Bordered details panel and draft aside; no full navigation, publication, QR, messaging or address editor. Pre-booking time zone remains editable. |
| Connecting / failed sign-in / setup errors | `mPaJu_SQ7g` / `h4UeLd7Wh3` / `BfZECGS8xd` | 1440×1040 / 1440×1100 / 1440×1687 | Disabled connecting button, announced state/error, visible retry and retained form values; captures and behavioral assertions at all three widths. |
| Pre-booking settings / empty schedule | `i-EqNPzspA` / `v8uLzCjHPw` | 1440×2050 / 1024×900 | Preserve editable-zone/permanent-subdomain/draft explanations and empty-state hierarchy. Today deliberately has no appointment/calendar controls or invented data. No separate responsive empty-state references exist in this selected set; app captures cover all three widths. |

Typography, spacing, hierarchy, wrapping, controls, error placement and action visibility were compared. Used existing tokens/shared controls and added one shared owner header; desktop sign-in/setup/settings hierarchy was strengthened without expanding behavior. Long readonly namespaces scroll within their input instead of overflowing the phone page. No pixel-perfect identity to out-of-scope prototypes is claimed.

### Real Google sessions, ownership and local HTTPS

- User performed new-owner creation for both accounts. Executor then selected each existing Google account in the user's authorized Chrome profile and observed direct return to its own Today/settings pages: `atelier-atlas` and `chopchoptrims`. Read-only database evidence confirms distinct owners with Google provider accounts.
- User authorized choosing either existing shop as the shared demo; selected `chopchoptrims` with its existing owner. No account creation, ownership reassignment or additional shop was needed.
- Captured a genuine unchanged settings submission for each real session and replayed it locally. Both A→B and B→A checks passed: signed-out denial, strict rejection of forged owner/shop/publication fields, foreign/missing Origin denial, marketing-host denial, and query IDs unable to switch shops. Responses disclosed no target shop name. Real B sign-out revoked its captured session; replaying its old cookie returned no session. Fixture revocation tests separately cover protected pages.
- Local HTTPS cookie metadata: `__Secure-better-auth.session_token`, HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age=604800, and no Domain attribute (host-only). Browser traffic contained the owner cookie on the owner host but not the marketing sibling. Sign-out cleared it with Max-Age=0. Fixture contexts also verify a shop sibling receives no owner session cookie. No cookie values were included in evidence.
- Both dev shop rows remained identical before/after the adversarial walkthrough and final verification: 2 shops, both unpublished; ordered-row JSON SHA-256 `c8c327dd2e7c7b41125c03725feda414743980b4748bc10b6563da34c2ad0950`.
- Temporary local request instrumentation, private capture and replay script were removed before the final production build; no diagnostic proxy or test sign-in route remains. Browser evidence includes real-account Today/query-denial and cancellation before/after images; it does not publish Google chooser details.

## Deviations and pending evidence

### Approved hosted exception — 2026-10-21

The user explicitly approved: “Defer hosted checks until deployment.” Hosted callback destination, forwarded-host behavior, and hosted Secure/host-only cookie checks are deferred to deployment. Local HTTPS evidence remains separate; this exception does not claim hosted success or waive visual review.

The user also authorized selecting either existing shop as the shared demo. Selected `chopchoptrims`, retaining its existing owner and data. Browser Google-account selection returned the second account directly to this shop; a read-only database check confirms the stored owner has a Google provider account. No ownership was inferred from a submitted email or reassigned.

- The Better Auth CLI cannot load a `server-only` config; `server/auth-cli.ts` is a CLI-only instance that reuses shared options. Production `server/auth.ts` retains `server-only`.
- pnpm added Better Auth package pins to `pnpm-workspace.yaml`'s minimum-release-age exclusion list as an installation side effect.
- Hosted forwarding/callback/cookie evidence is deferred by the explicit exception above. Local HTTPS results do not establish deployed behavior.
- Earlier browser-based Doop inspection was blocked by embedded-preview permissions; available Doop MCP supplied the actual frame dimensions/screenshots and closed that comparison gap. G8 was not waived.
- Automated builds/runs use fixed dummy Google credentials and do not contact Google. Passing fixture tests cannot establish provider configuration or real ownership.
- Phase 01 is done with the approved hosted exception, not hosted-verified. No remaining local implementation blocker. Publication/wildcard shops, barber/calendar functionality and actual first-booking lock production remain later phases.

## Final closeout checks

- Sequential locked install → disposable DB up → unit (13) → DB (20) → lint → typecheck → browser/build (45) passed. After the screenshot helper change, lint/typecheck/browser-build were repeated successfully.
- Fixture cleanup returned **0 users / 0 shops**. Stopped DB → `pnpm test:db` failed as expected with the stopped-container message; disposable container then removed. Missing `TEST_DATABASE_URL` with a dev sentinel failed as expected, without fallback. Persistent dev DB/server were left running.
- `git diff --check` passed. Existing unrelated dirty files were preserved. No new dependency was added during closeout.
- Pre-completion audit: signed-out/no-shop/draft and pending/error/success/zone-lock states covered; strict validation and reason codes preserved; uniqueness constraints and owner-row transactions exercised; thin routes/actions and server-only boundaries retained; Better Auth test utilities create actual persisted sessions; phone/keyboard/reduced-motion and no-overflow checks pass. Payment, delivery, retention and published-shop states are not introduced here and are inapplicable to this phase.
- Next.js feedback pass: the earlier internal-action-redirect/forwarded-host issue was processed during execution. No new qualifying framework candidate arose during closeout; intentional hostile-Origin rejections are expected behavior, not framework defects.

**Pending deployment evidence (approved deferral):** configure the actual hosted owner origin/callback, verify platform forwarded-host behavior, and repeat real Google callback, host-only/Secure cookie and post-sign-out denial checks on hosting before claiming deployed acceptance.
