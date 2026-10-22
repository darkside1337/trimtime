# TrimTime — MVP Roadmap

Deliver the portfolio MVP through demoable slices: PRD → SPEC / ARCHITECTURE → ROADMAP → phase planning → implementation → verification.

Sources: [PRD](PRD.md) for product rules and journeys; [SPEC](SPEC.md) for technical behavior; [ARCHITECTURE](ARCHITECTURE.md) for approved mechanisms; [APP_ROUTES](APP_ROUTES.md) for approved versus proposed paths; [DESIGN](DESIGN.md) and [registered tokens](../app/globals.css) for visual design; [AGENTS](../AGENTS.md) for working instructions; [README](../README.md) and [package scripts](../package.json) for setup.

## Status

This table is the authoritative phase-status location. States are `not started`, `in progress`, `blocked`, and `done`. Existing assets or specimens do not establish completion of a product phase.

Phase 01 maintenance: [Proxy routing implementation review](reports/2026-10-22-proxy-routing-review.md) records the subsequent host-routing refactor, corrections, automated evidence, and pending provider/hosted checks. Phase statuses below are unchanged.

| Phase | Title                                               | Depends on | State       | Evidence / blocker                                                                                                                                                                                                                                                                                                    |
| ----- | --------------------------------------------------- | ---------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 00    | Runnable and verifiable foundation                  | none       | done        | [Phase 00 verification report](reports/2026-10-20-phase-00-foundation.md); the app baseline, lint/type/build, isolated database/migrations, and Chromium smoke checks passed.                                                                                                                                         |
| 01    | Google sign-in and isolated draft shops             | 00         | done        | [Phase 01 execution report](reports/2026-10-21-phase-01-owner-draft-shops.md); [UI fidelity follow-up](reports/2026-10-22-phase-01-ui-fidelity.md); [Proxy routing review](reports/2026-10-22-proxy-routing-review.md): latest 2026-10-22 evidence is 35 unit, 20 DB and 60 browser checks passed. Earlier reports retain real local Google/two-owner isolation, shared-demo ownership and Doop visual evidence; live Google was not repeated for the refactor. [Approved exception](reports/2026-10-21-phase-01-owner-draft-shops.md#approved-hosted-exception--2026-10-21): hosted callback/forwarding/cookie checks deferred until deployment. |
| 02    | Services and eligible barber profiles               | 01         | not started | No product verification evidence.                                                                                                                                                                                                                                                                                     |
| 03    | Recurring schedules and slot preview                | 02         | not started | Grid/DST/midnight boundaries remain open.                                                                                                                                                                                                                                                                             |
| 04    | Date-specific availability and time blocks          | 03         | not started | Restriction precedence/reopening remains open.                                                                                                                                                                                                                                                                        |
| 05    | Publication and shop sharing                        | 03         | not started | Detailed readiness and hosted wildcard routing need verification.                                                                                                                                                                                                                                                     |
| 06    | Public booking and immediate manage-link access     | 04, 05     | not started | Stale offers, request replay, expiry, and rate semantics need resolution.                                                                                                                                                                                                                                             |
| 07    | Email confirmations and truthful message status     | 06         | not started | Sender/recipient setup and send-budget accounting need resolution/evidence.                                                                                                                                                                                                                                           |
| 08    | Owner calendar and manual appointments              | 06         | not started | [Calendar specimen](reports/2026-10-14-calendar-specimen/README.md) is UI evidence only; product navigation/persistence remain unverified.                                                                                                                                                                            |
| 09    | Owner moves, cancellations, and conflict resolution | 08         | not started | Late-state permissions and conflicting-edit outcomes remain open.                                                                                                                                                                                                                                                     |
| 10    | Customer cancellation                               | 06         | not started | Repeated/stale change handling needs resolution.                                                                                                                                                                                                                                                                      |
| 11    | Customer service, barber, and time replacement      | 06         | not started | Stale offers and original-service terminology need resolution.                                                                                                                                                                                                                                                        |
| 12    | Owner restoration                                   | 09         | not started | Retained original interval/service semantics need resolution.                                                                                                                                                                                                                                                         |
| 13    | Attendance and booking activity                     | 08         | not started | Exact end boundary needs resolution; expanded activity scope remains open.                                                                                                                                                                                                                                            |
| 14    | Protected retries and delivery recovery             | 07         | not started | Retry/claim/unknown-result recovery policy remains open.                                                                                                                                                                                                                                                              |
| 15    | Schedule-aware reminders                            | 11, 12, 14 | not started | Schedule/restoration reminder identity needs resolution.                                                                                                                                                                                                                                                              |
| 16    | Restricted WhatsApp booking messages                | 15         | not started | Actual Meta booking-template capability is unverified.                                                                                                                                                                                                                                                                |
| 17    | Contact correction and owner-assisted recovery      | 07, 09     | not started | Contact effects, fresh consent, and resend attempt identity remain open.                                                                                                                                                                                                                                              |
| 18    | Shop address changes and customer updates           | 07         | not started | Address validation and message wording need resolution where not already established.                                                                                                                                                                                                                                 |
| 19    | Automatic historical cleanup                        | 07         | not started | Retention arithmetic, cadence, and late-result handling remain open.                                                                                                                                                                                                                                                  |

## How to use this file

Select a phase → resolve decisions that block its affected behavior → plan in plan mode → approve and execute the plan → verify → review → update this table and its acceptance criteria.

The twenty phases are a provisional delivery sequence, not fixed work packages. During planning, split, combine, or reorder slices when that produces a smaller complete outcome. Preserve requirement coverage, real dependencies, and the evidence needed for acceptance. A phase can contain smaller execution units; no ticket system is required.

Only declared prerequisites may be assumed. Branches can proceed independently: for example, customer cancellation does not require the owner calendar. Dependencies include the behavior a phase extends, not every lower phase number. Fixtures can exercise permitted states before all UI producers of those states exist; fixtures must not bypass the production rules being tested.

Phases are incremental demonstrations, not separate claims that the whole MVP is ready. A subset of a PRD scenario may pass while its coverage row remains partial. In particular, publication/reading, booking commitment, customer mutations, and channel delivery have separate evidence. Do not claim unavailable operations or unsent messages work.

Use each phase's **Decisions needed** to identify affected boundaries. An open question blocks only the behavior that requires its answer, not all independent work. Routine schema details, package fit, internal error codes, and test configuration can be settled in the phase plan within approved constraints. Product choices must be explicitly resolved in their owning documents; this roadmap does not choose defaults or become a second decision log.

The SPEC's historical unselected-mechanism wording is narrowed by [approved architecture](ARCHITECTURE.md#1-purpose-and-authority) and [approved route decisions](APP_ROUTES.md#1-authority-and-status). DESIGN now exists despite older references calling it planned. Installed calendar packages and the specimen do not approve a production calendar library. The remaining material source ambiguity is [OTQ-018 / PI-009](SPEC.md#16-open-technical-questions): FR-054's total-attempt wording versus BR-040/AC-025's automatic-attempt qualification leaves manual-resend counting unresolved. Preserve that question before implementing resend behavior.

## Definition of done

- Relevant phase acceptance criteria pass, including each required boundary and failure case.
- Applicable shared conventions and cross-phase gates pass.
- Required manual walkthroughs pass in the running app.
- Required automated checks pass; lint/type/build alone do not prove product acceptance.
- A concise report under `docs/reports/` records environment, commands/results, walkthrough evidence, unresolved checks, and any deviations. Link it from the status table. One report may cover several small phases; do not create empty reports.
- Any exception is explicitly approved by the project owner, linked with its impact, and distinguished from a passed criterion.

Check an acceptance criterion only after its required evidence passes. Leave unfinished criteria unchecked and summarize the remaining reason in the status table/report. Mark a phase done only after this full definition passes or an approved exception is linked. Keep journals, dated test output, audit details, deviations, and lessons out of phase bodies. Approved requirement/architecture changes belong in their authoritative documents.

Current commands, run from the repository root:

| Purpose                        | Runnable command                                              | Verification boundary                                               |
| ------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------- |
| Locked dependency installation | `pnpm install --frozen-lockfile`                              | Setup, not product acceptance.                                      |
| Development app                | `pnpm dev`                                                    | Running app for walkthroughs; startup is not acceptance.            |
| Lint                           | `pnpm lint`                                                   | Static lint checks.                                                 |
| Typecheck                      | `pnpm exec tsc --noEmit --incremental false`                  | Type checks without emitting files.                                 |
| Production build               | `pnpm build`                                                  | Build/route compilation; does not verify journeys or integrations.  |
| Unit tests                     | `pnpm test`                                                   | Vitest unit tests.                                                  |
| Disposable database            | `pnpm db:test:up`, `pnpm db:test:stop`, `pnpm db:test:down`   | Explicit project-owned local PostgreSQL lifecycle.                  |
| Database/migration tests       | `pnpm test:db`                                                | Requires the running owned disposable database; no shared fallback. |
| Browser tests                  | `pnpm exec playwright install chromium` once; `pnpm test:e2e` | Chromium smoke tests after a production build.                      |
| Serve production build         | `pnpm start`                                                  | Requires a successful existing production build.                    |

Vitest, Playwright, and disposable PostgreSQL are now configured as described in [architecture verification](ARCHITECTURE.md#9-verification-and-maintenance). Follow the [README setup instructions](../README.md); each phase adds only tests its behavior needs. Provider tests require dedicated approved accounts/recipients, not routine live sends from the general test suite.

## Shared conventions

- **Visual authority:** Reuse [Soft Welcome](DESIGN.md#overview), [semantic tokens](../app/globals.css), [shared Base UI/shadcn controls](../components/ui), and [TrimTimeLogo](../components/trimtime-logo.tsx). Extend existing controls only when needed. Keep specimen decoration local; do not introduce a parallel palette, fonts, theme, or component system.
- **Interaction states:** Follow [DESIGN components/accessibility](DESIGN.md#components) and [SPEC validation/errors](SPEC.md#8-validation-rules-and-error-handling). Cover relevant loading, empty, validation, disabled, conflict, and failed-save states. Keep entered values on failure and report committed state truthfully. Verify focus, labels, keyboard behavior, reduced motion, actual contrast, and responsive overlays; token export alone is not visual acceptance.
- **Owner navigation:** Use [approved paths](APP_ROUTES.md#2-page-inventory), including `/sign-in` and `/setup`, and the [calendar interaction contract](SPEC.md#661-owner-calendar-interaction-contract). Customer path proposals, token placement, and new pages still require explicit decisions. Introduce destinations with their capabilities; the complete six-destination owner navigation is verified with the calendar slice.
- **Domain and presentation:** Apply the [PRD scope](PRD.md#1-product-overview-and-problem-statement) and [required disclosures](PRD.md#8-non-functional-requirements): fictional demo, English/USD, shop time zone, explicit barber choice, cutoff/contact recovery, and accurate channel availability. Customer contact is not authenticated identity.
- **Feature boundaries:** Follow [architecture organization](ARCHITECTURE.md#3-code-organization), [ownership](ARCHITECTURE.md#4-feature-ownership-and-dependencies), and [action contracts](ARCHITECTURE.md#5-trust-and-action-contracts). Add shared infrastructure when the current slice uses it. Do not prebuild unrelated modules, dashboards, generalized audit systems, or messaging infrastructure.

## UI references

Use [DESIGN’s Doop reference index](DESIGN.md#doop-visual-references) for responsive layouts, state frames, and known visual conflicts. Each phase links to its relevant reference group below. Apply [visual verification](DESIGN.md#visual-verification-for-every-ui-phase) to every UI slice; record evidence in the phase report and enforce G8. Designs do not expand phase scope, approve routes, or resolve open decisions.

## Cross-phase gates

These gates enforce source requirements across slices. They are not additional product scope. Apply a gate when its behavior is introduced or changed, and repeat affected checks when extending it.

| Gate                                           | Applies / introduced                                                                                                                 | Required evidence and authority                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G1 — Authority and isolation                   | Owner operations from 01; public hosts from 05; capabilities from 06; jobs from 14; provider evidence from 07/16.                    | Direct-request and operation tests deny signed-out owner access, another owner's IDs, mixed-shop references, wrong-scope/expired/revoked links, invalid job credentials, and unverified provider evidence as applicable. Host routing and UI visibility never grant permission. Verify only linked booking data crosses a capability boundary. [SPEC §5](SPEC.md#5-authentication-authorization-and-access-control), [architecture §5](ARCHITECTURE.md#5-trust-and-action-contracts), NFR-001–NFR-003.                                                                                                                                                                                                                                                                               |
| G2 — Time and availability                     | Slot preview in 03; restrictions in 04; writes in 06/08–12; reminders in 15; expiry/cleanup in 06/19.                                | Controlled-clock tests cover shop-local dates, elapsed intervals, grid/full-duration fit, DST gaps/folds with offsets, and applicable equality boundaries. Query and commit use the same eligibility rules. Resolve only the relevant open predicates before claiming those cases. [SPEC §6.3](SPEC.md#63-availability-semantics-and-established-predicates), NFR-004/NFR-011.                                                                                                                                                                                                                                                                                                                                                                                                       |
| G3 — Reservation and edit consistency          | Shared block occupancy in 04; first appointments in 06; every subsequent scheduling/configuration write.                             | Real PostgreSQL competing-write tests prove no same-barber overlap, valid adjacency and different-barber capacity, and consistent booking versus hours/block/catalog/eligibility/zone edits. From 06, retrofit every existing affected configuration write before accepting appointments. Use approved shared occupancy and transaction-held shop locking; failed replacements keep the original. [Architecture §6](ARCHITECTURE.md#6-scheduling-and-transaction-integrity), [SPEC §9](SPEC.md#9-state-transitions-concurrency-and-consistency), NFR-004–NFR-006.                                                                                                                                                                                                                    |
| G4 — History and permanent settings            | Catalog lifecycle in 02; snapshots/first-booking lock in 06; replacement/restoration in 09/11/12; cleanup in 19.                     | Booking snapshots survive catalog edits/hiding. History-bearing resources are archived; affected protected bookings prevent retirement/eligibility removal. First creation and permanent zone lock commit consistently; cancellation, attendance, and deletion cannot unlock it. [SPEC §4.3](SPEC.md#43-reservation-and-historical-integrity), FR-012/FR-015–FR-017.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| G5 — Notification truth and bounded sends      | Work capture in 06; first sends in 07; event producers as introduced in 08–12/17/18; retries in 14; reminders in 15; WhatsApp in 16. | Each business change captures its applicable work transactionally. Failed business writes leave no work; provider failure cannot undo committed changes. Current event/contact/channel scope suppresses obsolete unsent work. Atomic shared accounting enforces the global budget, including competing last-unit sends; no automatic replay of budget skips. Distinguish actual attempt, acceptance, evidenced delivery, failure, skip, and unknown. Actor/source determines customer-action owner alerts, without inventing a general audit requirement. [Architecture §7](ARCHITECTURE.md#7-notification-work-and-shared-limits), [SPEC §11–12](SPEC.md#11-external-integrations-and-failure-handling), NFR-006–NFR-010/NFR-015.                                                   |
| G6 — Public abuse protection                   | Create/probe protection in 06; customer-change protection in 10/11; protected messaging/resend entry points in 07/17.                | Test authoritative bot checks, shared atomic counters, trusted IP/key handling, and the fixed creation/change limits. Resolve window/reset/unspecified thresholds only where used. Verify concurrent requests cannot exceed the approved bounds. [SPEC §10](SPEC.md#10-security-privacy-and-abuse-prevention), FR-027/FR-063, NFR-009.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| G7 — Migrations, retention, and test isolation | Database foundation in 00; every schema change; cleanup in 19.                                                                       | Apply versioned migrations to disposable local PostgreSQL, preserving the existing records/invariants affected by upgrades. Fixtures/tests never reset or drop shared databases. Cleanup removes the required linked history, preserves future/configuration/zone-lock evidence, and handles late evidence without recreating deleted bookings. [Architecture §2–3](ARCHITECTURE.md#2-system-and-deployment), [AGENTS](../AGENTS.md#working-constraints), [SPEC §6.7](SPEC.md#67-historical-cleanup), NFR-013.                                                                                                                                                                                                                                                                       |
| G8 — Rendered interaction and MVP evidence     | Every UI slice; full owner route/history behavior in 08 and every detail-operation extension; final MVP review.                      | Verify relevant desktop/tablet/phone states against DESIGN, the [phase-linked Doop references and screenshot comparison requirements](DESIGN.md#visual-verification-for-every-ui-phase), and the [owner browser scenarios](SPEC.md#143-owner-appointment-navigation-acceptance). Specimen evidence cannot substitute for product authorization/persistence/history tests. Actual domain/OAuth/email/WhatsApp/job evidence is required for corresponding hosted claims. Measure AC-030 only after OQ-014 defines its protocol. Run the agreed small pilot after OQ-015 defines it; do not infer business outcomes from passing technical tests. [PRD goals/metrics](PRD.md#92-success-metrics-and-evidence-limits), [SPEC §14](SPEC.md#14-testing-strategy-and-acceptance-scenarios). |

G8's timing protocol and pilot remain explicit MVP evidence gaps, not blockers to unrelated implementation. No WCAG level, browser matrix, load target, uptime SLA, or numeric business target is invented. DESIGN's already approved accessibility behavior still applies. Full MVP review requires complete coverage below or explicitly approved exceptions with their impact.

Proposed implementation safeguard: if cleanup uses an externally callable trigger, authorize it before deletion. The sources do not select that interface or its credential contract; approve those details during planning if needed. An internal-only schedule does not require a new public endpoint.

## Phase 00 — Runnable and verifiable foundation

**User outcome:** A contributor can run the existing app and verify changes using isolated local data.

**Requirements and journeys:** Enables [SPEC testing strategy](SPEC.md#14-testing-strategy-and-acceptance-scenarios) and [architecture verification](ARCHITECTURE.md#9-verification-and-maintenance); no product journey is claimed complete.

**Depends on:** none.

**Decisions needed:** none blocking. Test-container configuration, compatible package versions, and minimal environment wiring are phase-plan details within the approved architecture. Live domain/provider credentials are non-blocking for the local harness.

**Scope**

- Preserve the existing theme, components, logo, and runnable design-system baseline.
- Add only the database connection/migration setup needed by the first persisted slice.
- Configure Vitest, Playwright, and disposable PostgreSQL with meaningful startup/isolation checks.
- Document actual setup, environment requirements, and verification commands.

**UI references:** [Foundation](DESIGN.md#foundation). Preserve the existing theme and rendered baseline; no product screens are introduced. Specimen evidence cannot complete later journeys.

**Acceptance criteria**

- [x] Following the setup instructions starts the app and serves the existing baseline without rebuilding its design system.
- [x] Lint, typecheck, production build, and the newly documented harness commands pass.
- [x] Database verification uses disposable data; a missing/unreachable test database fails clearly without falling back to a shared database.

**Manual walkthrough**

1. Follow the project setup instructions, start the app, and open the existing design-system page; shared controls and assets render.
2. Run the documented checks against the disposable database; confirm the test data belongs to that environment.
3. Stop the disposable database and rerun its check; receive a clear failure without touching another database.

**Automated verification**

- Introduce harness smoke checks for app rendering, database connectivity/migration application, and isolation failure. Avoid placeholder tests that only assert constants.
- Verification evidence for this foundation is recorded in the [Phase 00 report](reports/2026-10-20-phase-00-foundation.md). These harness checks do not claim later product journeys.

**Out of scope:** Domain schemas beyond the first slice's needs, authentication, business features, provider setup, speculative CI/deployment systems, and redesigning existing specimens.

## Phase 01 — Google sign-in and isolated draft shops

**User outcome:** An owner signs in with Google, creates one private draft shop, and maintains their own basic shop settings.

**Requirements and journeys:** [FR-001–FR-006, FR-012](PRD.md#51-owner-access-and-shop-configuration), [FR-062](PRD.md#58-public-demo-protection-and-retention); [owner setup](PRD.md#41-owner-signs-in-and-prepares-a-shop); own-shop portions of [AC-001–AC-004](PRD.md#91-confirmed-behavior-acceptance-criteria).

**Depends on:** 00.

**Decision record and remaining evidence:** The approved [Phase 01 plan](.plans/phase-01.md#explicitly-approved-during-planning) selected slug grammar/reserved labels, basic shop contact/address validation, and `/sign-in`/`/setup`; its [request/session selections](.plans/phase-01.md#selections-approved-with-this-plan) established local owner host/session/origin policy. Remaining [OQ-008](PRD.md#11-open-questions-and-unresolved-decisions) validation/readiness questions apply when their features need them. Hosted forwarding/callback/cookie evidence remains deferred under the approved exception in the status table; keep [OTQ-002/OTQ-006](SPEC.md#16-open-technical-questions) open for that evidence. Unspecified optional field caps remain non-blocking; do not invent them.

**Scope**

- Provide a modest branded entry point and Google-only owner authentication on the approved host arrangement.
- Create the owner's single unpublished shop with required setup fields and a permanent subdomain warning.
- Permit own-shop name/contact and pre-first-booking time-zone settings; establish independent server authorization.
- Route owners without a shop into setup and owners with a shop to an honest empty today landing at the owner root.

**UI references:** [Owner entry and shop setup](DESIGN.md#owner-entry-and-shop-setup). Use only entry, sign-in, setup, basic settings, and the empty owner landing. Field bounds/subdomain rules remain their existing decisions; verify OAuth and persistence independently. Calendar/navigation and publication remain later work.

**Acceptance criteria**

- [x] Real Google sign-in distinguishes new and existing owners; sign-out removes owner access. No alternate login method appears.
- [x] Creating a shop persists its required fields and leaves it unpublished; duplicate/reserved subdomains and a second shop are rejected, including competing creates.
- [x] Another Google owner gets a separate shop and cannot read/change the first shop or the project owner's shared demo shop through direct requests.
- [x] Name/contact and pre-booking time-zone edits persist; the chosen subdomain cannot be renamed.

**Manual walkthrough**

1. Enter from the branded site and sign in with an approved Google account; create a fictional draft and reload its settings.
2. Sign out and sign in again; reach the own-shop today landing. Try creating a second shop or renaming its subdomain; both are unavailable/rejected.
3. Use a second owner and a signed-out session against the first shop's settings requests; neither receives its private data or mutation authority.

**Automated verification**

- Add Vitest/database tests for single-shop/subdomain races, required input, and G1 scopes. Add Playwright setup/settings/denial tests using isolated authenticated fixtures.
- Automate persisted state and denial criteria; actual Google callback/session-host behavior and the entry-point visual review require dedicated manual evidence. Fixtures do not prove Google integration.

**Out of scope:** Publication, catalog, full six-destination calendar navigation and appointment surfaces, post-booking time-zone locking proof, address-change broadcasts, and extra marketing pages.

## Phase 02 — Services and eligible barber profiles

**User outcome:** An owner defines services and the barber profiles eligible to offer them.

**Requirements and journeys:** [FR-013–FR-016](PRD.md#52-services-and-barber-profiles), [owner setup](PRD.md#41-owner-signs-in-and-prepares-a-shop), [AC-005](PRD.md#91-confirmed-behavior-acceptance-criteria).

**Depends on:** 01.

**Decisions needed:** none for the confirmed name/price/duration/eligibility behavior. Remaining field bounds and uniqueness in [OQ-008 / PI-013](SPEC.md#17-prd-issues) are non-blocking unless a proposed validation would impose a new product restriction; ask before adding that restriction.

**Scope**

- Create/edit services on the approved Services surface using shared price/duration rules.
- Create/edit barber profiles and explicit service assignments on the Barbers surface.
- Hide services and archive resources without treating barber profiles as authenticated users.

**UI references:** [Services and barbers](DESIGN.md#services-and-barbers). Use offering/profile management. Empty collections need confirmation during planning. Booking-bearing archive conflicts belong to 06/09; fixtures do not approve field constraints or staff accounts.

**Acceptance criteria**

- [ ] Services and selected barber eligibility persist across reload; service values are shared across eligible barbers.
- [ ] Zero price and a 35-minute duration succeed; negative/excess-decimal prices and non-integer/sub-30-minute durations fail server validation without losing form input.
- [ ] Hidden/archived offerings stop appearing as active choices; another owner cannot attach this shop's service/profile IDs.

**Manual walkthrough**

1. Create two barbers and a service; assign it to one, reload, and confirm the selected relationship.
2. Enter the accepted boundary values and then invalid prices/durations; observe saved valid values and actionable errors.
3. Hide/archive an unused offering and attempt a cross-shop assignment; active choices update and the foreign reference is rejected.

**Automated verification**

- Add focused Vitest value/schema tests, real-database scoped relationship tests, and a Playwright create/edit/hide journey.
- Automate all three criteria's data behavior; manually review form feedback and responsive shared controls.

**Out of scope:** Staff accounts, per-barber pricing, booking snapshots and booking-bearing retirement guards (activated with first bookings in 06), and scheduling forms.

## Phase 03 — Recurring schedules and slot preview

**User outcome:** An owner configures recurring working time and previews valid service/barber starts in the shop's time zone.

**Requirements and journeys:** [FR-018, FR-022–FR-023](PRD.md#53-availability), [owner setup](PRD.md#41-owner-signs-in-and-prepares-a-shop), recurring/time portions of [AC-006–AC-009](PRD.md#91-confirmed-behavior-acceptance-criteria).

**Depends on:** 02.

**Decisions needed:** Slot generation needs the grid anchor, DST working-interval conversion, and exact-midnight boundary from [OTQ-007 / PI-004](SPEC.md#16-open-technical-questions). Configuration forms can proceed independently. Schedule representation/time-library choice is a plan detail; it must preserve the approved semantics.

**Scope**

- Edit recurring weekly shop hours/breaks and individual schedules initially copied from shop hours.
- Preview full-duration service/barber slots bounded by both schedules.
- Apply public notice/local-date horizon and distinct shop-zone DST labels to the preview using [SPEC predicates](SPEC.md#63-availability-semantics-and-established-predicates).

**UI references:** [Availability](DESIGN.md#availability). Use recurring hours, breaks, and slot preview only. Resolve offset/zone labels after OTQ-007; public booking and dated edits remain later work.

**Acceptance criteria**

- [ ] New individual schedules initially match shop hours; subsequent individual edits persist without escaping shop limits.
- [ ] A 35-minute service is not rounded up; only grid starts with full fit appear, excluding breaks, closing overruns, and forbidden midnight crossings.
- [ ] Controlled-time previews include one-hour equality and the entire local date +30, exclude earlier/+31 starts, omit DST gaps, and distinguish repeated instants by offset.

**Manual walkthrough**

1. Save shop hours with a break, create/copy a barber schedule, and narrow one barber's hours; preview the same service for both.
2. Preview a 35-minute service near a break/closing boundary; invalid starts are absent and the displayed time zone is clear.
3. Use a controlled test clock/date around DST and the horizon boundary; verify the distinct offset labels and excluded starts.

**Automated verification**

- Introduce controlled-clock Vitest tests for each time boundary and real-database scoped schedule reads/writes. Add a Playwright preview journey for save/reload and labels.
- Automate all calculation/persistence criteria; visually inspect slot selection and zone/offset clarity. Fixture dates must not depend on the wall clock.

**Out of scope:** Dated restrictions/blocks, committed reservations, booking-bearing edit guards, overnight work, and configurable public booking windows.

## Phase 04 — Date-specific availability and time blocks

**User outcome:** An owner changes availability for one date and blocks unavailable barber time, with the slot preview reflecting the change.

**Requirements and journeys:** [FR-019–FR-022](PRD.md#53-availability), [owner manages the day](PRD.md#42-owner-manages-the-day), restriction portions of [AC-006–AC-007](PRD.md#91-confirmed-behavior-acceptance-criteria).

**Depends on:** 03.

**Decisions needed:** Resolve intersecting restriction/reopening semantics in [OQ-011 / PI-003](SPEC.md#17-prd-issues), and any unspecified block scope before exposing it. Approved shop/barber precedence remains fixed. Unrelated appointment lifecycle questions are non-blocking for dates without appointments.

**Scope**

- Manage barber days off, shop closures, and dated shop/barber schedule replacements.
- Add/remove time blocks through explicit forms and shared occupied-interval storage.
- Recompute the preview using the combined restrictions and shop limits.

**UI references:** [Availability](DESIGN.md#availability). Use dated exceptions and blocks. Required reasons are not approved by fixtures; reopening/precedence explanations await OQ-011. Booking-bearing conflicts belong to 06/09.

**Acceptance criteria**

- [ ] A dated override replaces that date's recurring schedule without changing other dates; barber hours remain inside shop availability.
- [ ] A shop closure removes starts for every barber, while barber-only restrictions leave other valid barbers available.
- [ ] A time block removes overlapping full-duration starts; conflicting same-barber block reservations fail without overwriting existing data.
- [ ] The resolved reopening/precedence rules are observable; changing an override does not silently bypass another hard restriction.

**Manual walkthrough**

1. Compare a normal date with a dated shop/barber override; verify only the selected date changes.
2. Apply a barber day off, then a shop closure; compare availability for two barbers.
3. Add a block and try a conflicting block/reopening edit; observe the approved rejection or restricted result without lost data.

**Automated verification**

- Add Vitest restriction-combination tests, PostgreSQL block-overlap tests, and a Playwright date-edit/preview flow.
- Automate all four criteria; manually review conflict explanations and date/time controls. Booking-versus-edit races become mandatory with G3's first appointments.

**Out of scope:** Booking-bearing protection added in 06, implicit overtime overrides, automatic appointment cancellation, and calendar drag/resize.

## Phase 05 — Publication and shop sharing

**User outcome:** An owner publishes a sufficiently configured fictional shop and shares its public shop page and eligible starts through a link or QR code.

**Requirements and journeys:** [FR-007–FR-011](PRD.md#51-owner-access-and-shop-configuration), [owner setup](PRD.md#41-owner-signs-in-and-prepares-a-shop), publication/routing portions of [AC-002–AC-003](PRD.md#91-confirmed-behavior-acceptance-criteria).

**Depends on:** 03.

**Decisions needed:** Resolve any readiness detail beyond the confirmed minimum in [OQ-008](PRD.md#11-open-questions-and-unresolved-decisions) and the known-unpublished presentation in OQ-010 before finalizing those behaviors. Proposed public paths need approval through [APP_ROUTES](APP_ROUTES.md#2-page-inventory). Actual domain/DNS configuration under OQ-002 blocks hosted proof, not local hostname tests.

**Scope**

- Expose publication/unpublication and readiness feedback in Settings.
- Serve the correct fictional shop, active offerings, and slot preview from its hostname.
- Provide its canonical booking-page link and scannable QR code.
- Verify actual Vercel wildcard routing without treating a hostname as owner permission.

**UI references:** [Publication and shop sharing](DESIGN.md#publication-and-shop-sharing). Use readiness, publication, sharing, and public read/slot presentation only. Paused-booking policy remains OQ-010. Contact forms, quota/provider counters, and exports do not expand scope; verify QR/hostname behavior independently.

**Acceptance criteria**

- [ ] Missing required setup prevents publication with actionable feedback; completing the approved minimum permits it.
- [ ] The link and QR open the same published shop on the intended host with its time zone and demo label; unknown/invalid shop hosts return a clean 404.
- [ ] Unpublishing persists and uses the agreed public presentation; public access still cannot reveal owner settings or customer lists.

**Manual walkthrough**

1. Attempt publication while incomplete, complete the missing setup, and publish successfully.
2. Copy the link and scan the QR on a phone; both open the correct shop. Visit an unknown shop host and observe the 404.
3. Unpublish and revisit the public host; observe the approved result. Attempt owner access from that host without authorization; access is denied.

**Automated verification**

- Add readiness unit tests, scoped host/publication integration tests, and Playwright published/unpublished/unknown-host journeys. Decode the generated QR and compare its canonical destination.
- Automate readiness/routing/data exposure; physical QR scanning and real wildcard DNS/TLS/deployment require manual evidence.

**Out of scope:** Submitting public bookings (06), verification of existing appointments/manage links/notifications surviving unpublication (G1/G5 as introduced), custom domains, and additional marketing pages.

## Phase 06 — Public booking and immediate manage-link access

**User outcome:** A customer reserves a specific service, barber, and time without an account and immediately receives a usable link to that booking's current details.

**Requirements and journeys:** [FR-024–FR-030](PRD.md#54-public-booking), [FR-041/FR-045–FR-046](PRD.md#56-customer-management-links), [FR-062–FR-063](PRD.md#58-public-demo-protection-and-retention), first-booking [FR-012](PRD.md#51-owner-access-and-shop-configuration); [customer booking](PRD.md#43-customer-creates-a-booking); [AC-004/AC-008–AC-011](PRD.md#91-confirmed-behavior-acceptance-criteria) and link-view portions of AC-018/AC-020.

**Depends on:** 04, 05.

**Decisions needed:** Before commitment, resolve stale offers [OQ-006 / PI-001](SPEC.md#17-prd-issues), replay/lost-response handling [OTQ-019 / PI-015](SPEC.md#16-open-technical-questions), and protected occupancy/edit predicates PI-002. Link validity needs [OQ-009 / OTQ-014](PRD.md#11-open-questions-and-unresolved-decisions); public enforcement needs applicable OQ-003 window/key/probe rules. Token parameters, bot integration, trusted IP inputs, and proposed token placement are plan choices requiring the applicable approvals. Provider setup is non-blocking for booking/link behavior; unavailability must be truthful.

**Scope**

- Deliver explicit service → eligible barber → date/start → contact/consent → bot check → confirmation.
- Commit snapshots, occupancy, first-booking time-zone lock, capability, and initial notification work consistently.
- Activate G3/G4 protection on all existing schedule/catalog/time-zone writes before accepting the first appointment.
- Display confirmation/manage link independently of messaging and provide a safe booking-scoped read view.
- Enforce shared public limits, bot checks, capability/probe protection, and required zone/cutoff/channel disclosures.

**UI references:** [Customer booking and management](DESIGN.md#customer-booking-and-management). Use account-free booking and the initial booking-scoped read view. Lost-response/replay and stale-offer outcomes await existing decisions. Customer mutations wait for 10/11; existing catalog/schedule guards activate here. Verify bot integration, commitment, and delivery independently.

**Acceptance criteria**

- [ ] Valid public input creates one confirmed booking with saved details and an immediate manage link, including when delivery is unavailable; no account/OTP step is added.
- [ ] Authoritative checks reject an unavailable/stale slot, failed bot check, excess attempt, foreign-shop reference, or invalid contact/consent input without a partial booking/work record. Repeated email is permitted within limits.
- [ ] Same-barber competing overlaps cannot both commit; different-barber simultaneous bookings and valid adjacency succeed. Booking/configuration races preserve availability, resource eligibility, and permanent zone locking.
- [ ] The link reveals only its booking/current shop details, opening it makes no mutation, and invalid/expired/wrong-scope authority reveals no booking. Short-notice/contact and test-WhatsApp unavailability are clearly disclosed.
- [ ] Catalog edits/hiding preserve booked snapshots; protected retirement/eligibility/hours edits are rejected. Unpublication prevents new creation while preserving existing link reads.

**Manual walkthrough**

1. Book through the public flow using a short-notice valid start; inspect the restriction disclosure and immediate confirmation/link, then reload the link.
2. Submit the same selected interval from two sessions; one wins and the other gets a choose-another-time result. Repeat with separate barbers to demonstrate independent capacity.
3. Try an invalid link and excessive/bot-rejected submission; no unauthorized booking access or success is shown. Hide/edit the booked service and verify saved booking details remain.
4. Attempt a conflicting configuration edit and a post-booking zone change; both fail. Unpublish and confirm the existing link still reads while a new public create fails.

**Automated verification**

- Add Vitest contact/consent/window/expiry tests, real-PostgreSQL G3/G4 races and atomic rollback tests, and concurrent shared-counter tests.
- Add Playwright full creation/confirmation/link/denial/unpublication journeys and stale-selection feedback. Automate all five criteria's state/access results; manually assess disclosures, mobile flow, and token-safe sharing. AC-030 timing remains unmeasured until G8's protocol exists.

**Out of scope:** Customer cancel/replace (10/11), real sending/budget dispatch (07), owner calendar/manual creation (08), and automatic reminders. Captured work and unavailable status do not claim delivery.

## Phase 07 — Email confirmations and truthful message status

**User outcome:** A customer receives a real booking confirmation/manage link, and the owner sees truthful email status and receives an alert for a customer-created booking.

**Requirements and journeys:** Email/creation portions of [FR-047–FR-049, FR-054–FR-060](PRD.md#57-notifications-and-automation), [FR-038](PRD.md#55-owner-calendar-and-appointment-operations); [customer booking](PRD.md#43-customer-creates-a-booking); email/budget portions of [AC-021/AC-025–AC-026](PRD.md#91-confirmed-behavior-acceptance-criteria).

**Depends on:** 06.

**Decisions needed:** Sending requires applicable budget reset/reservation/actual-attempt accounting from [OQ-003 / OTQ-008](SPEC.md#16-open-technical-questions), owner recipient and confirmation wording from [OQ-013 / PI-011](SPEC.md#17-prd-issues), and prompt dispatch/evidence correlation from OTQ-009/OTQ-012. Resend sender/account setup blocks real delivery proof. Retry backoff and manual-resend counters are non-blocking for an initial attempt.

**Scope**

- Deliver initial Resend customer confirmations and customer-booking owner alerts from committed work.
- Introduce the atomic demo-wide outbound budget and protected send boundary.
- Show actual acceptance/delivery/failure/skip evidence and reasons in Activity and relevant customer feedback.

**UI references:** [Activity and messaging](DESIGN.md#activity-and-messaging). Introduce Activity with email before calendar phase 08, exposing only available event producers. Confirm delivery outcome presentations during planning; designs do not establish message templates or provider evidence.

**Acceptance criteria**

- [ ] A real permitted creation sends the customer's saved booking details/current manage link and the correct owner alert; reported delivery matches attributable evidence.
- [ ] Provider rejection, missing eligibility, and budget exhaustion leave the booking/link usable, expose accurate status, and never claim a skipped message was sent.
- [ ] Competing sends with one unit left cannot exceed the shared budget; all actual customer/owner attempts count and a reservation alone is not reported as an attempt.
- [ ] A budget reset does not automatically replay skipped work. Unpublishing does not discard existing booking work, and forged delivery evidence cannot change status.

**Manual walkthrough**

1. Create a booking with an approved test email; inspect customer/owner messages and follow the manage link.
2. Use controlled provider failure and exhausted-budget conditions; confirm booking success plus truthful unavailable/failure/skip feedback.
3. Compare Activity with actual provider evidence and test a forged outcome request; no unproven delivery appears.

**Automated verification**

- Add real-database budget-boundary/concurrency and transactional-work tests; use provider doubles for deterministic acceptance/failure/evidence/suppression cases.
- Add Playwright status/booking-independence checks for all four criteria. Actual email delivery, sender configuration, and message rendering require dedicated provider/manual evidence; simulated acceptance does not satisfy the first criterion's live portion.

**Out of scope:** Automatic retries (14), scheduled reminders (15), WhatsApp (16), owner resend (17), and notification events whose business operation has not yet been introduced.

## Phase 08 — Owner calendar and manual appointments

**User outcome:** An owner inspects the real own-shop day/week schedule and records a walk-in or phone appointment through the approved calendar and standalone presentations.

**Requirements and journeys:** [FR-031–FR-033/FR-038](PRD.md#55-owner-calendar-and-appointment-operations), [owner manages the day](PRD.md#42-owner-manages-the-day), [AC-012–AC-013](PRD.md#91-confirmed-behavior-acceptance-criteria), [SPEC owner navigation acceptance](SPEC.md#143-owner-appointment-navigation-acceptance).

**Depends on:** 06.

**Decisions needed:** Resolve new-manual hidden-service eligibility [OQ-007 / PI-007](SPEC.md#17-prd-issues) before finalizing that selector, and applicable ongoing/end boundaries [OQ-010 / PI-014](PRD.md#11-open-questions-and-unresolved-decisions). Calendar-library fit/week presentation are plan details under OTQ-017; the installed specimen is reusable evidence, not an approved library decision. Broader support/measurement targets remain non-blocking for the already specified phone/keyboard contract.

**Scope**

- Replace the empty owner landing with persisted today/all-barber day/week views, filtering, and the six approved navigation destinations.
- Reuse shared controls and useful [specimen work](reports/2026-10-14-calendar-specimen/README.md) while enforcing server-owned scheduling.
- Implement [intercepted/parallel appointment navigation](ARCHITECTURE.md#21-owner-appointment-navigation), responsive Dialogs, standalone direct/refresh pages, and history/discard behavior.
- Create exact-minute future/ongoing appointments with optional contacts using existing reservation rules; capture channel work/activity and identify missing channels truthfully.

**UI references:** [Owner calendar and appointments](DESIGN.md#owner-calendar-and-appointments). Use calendar navigation and both appointment presentations. Verify creation validation, optional-contact walk-ins, exact-minute fields, history, dismissal, focus restoration, and persistence. Move/cancel/restore/attendance/contact recovery remain later work.

**Acceptance criteria**

- [ ] Owners with either published or unpublished shops land on today's all-barber calendar; day/week/filter work and details show recorded contact/service/barber information.
- [ ] Appointment URLs open Dialogs from the calendar, preserving date/view/filter/scroll. Back closes, Forward reopens, navigation away clears the Dialog, and direct/refresh visits show standalone pages with a calendar link.
- [ ] New appointment and slot entry work; slot date/time and individual barber prefill correctly, while all-barber entry requires explicit selection. Successful creation returns to the refreshed calendar from either presentation.
- [ ] Dirty close/Escape/outside-click/Back prompts discard; declining preserves input and URL. Failed validation/conflicts preserve input. Phone sizing, focus containment/restoration, and keyboard entry pass the source scenarios.
- [ ] Valid ongoing/future exact-minute entries can bypass public notice/horizon, including contactless entries; ended, conflicting, unavailable, or unauthorized creates fail without partial state or a false notification claim.

**Manual walkthrough**

1. Sign in with a shop and exercise today/day/week/barber filtering and all six navigation destinations; open a real appointment and use Back/Forward.
2. Open creation from a filtered slot, then from all-barber view; inspect prefills and explicitly choose the barber where required. Create a contactless walk-in and verify its saved calendar entry/status.
3. Enter unsaved changes and try each dismissal path, both keeping and discarding changes. After each result, exercise subsequent Back/Forward history.
4. Directly visit/refresh both appointment routes on desktop and phone; verify standalone forms, keyboard focus, save/failure outcomes, and no stale Dialog after leaving the calendar.
5. Attempt an ended/out-of-hours/conflicting create and direct access to another owner's appointment; entered values remain and protected data is denied.

**Automated verification**

- Add Vitest/database owner-window/exact-minute/contactless tests and shared mutation denial/concurrency checks.
- Add Playwright [SPEC §14.3](SPEC.md#143-owner-appointment-navigation-acceptance) coverage for applicable read/create/history/discard/save paths at desktop and phone sizes. Automate all five criteria's route/state behavior; manually review calendar readability, real input interaction, focus, and layout. The specimen report does not satisfy these product checks.

**Out of scope:** Move/cancel (09), restoration (12), attendance (13), speculative counters/bell/profile actions, drag/resize, and barber-column layouts. Email sending is an independent slice (07); unavailable delivery stays explicit until enabled.

## Phase 09 — Owner moves, cancellations, and conflict resolution

**User outcome:** An owner changes or cancels an appointment and explicitly resolves conflicts before changing the affected schedule or resource.

**Requirements and journeys:** [FR-034](PRD.md#55-owner-calendar-and-appointment-operations), [FR-015–FR-017](PRD.md#52-services-and-barber-profiles), [FR-021](PRD.md#53-availability), [owner manages the day](PRD.md#42-owner-manages-the-day); [AC-013–AC-015](PRD.md#91-confirmed-behavior-acceptance-criteria).

**Depends on:** 08.

**Decisions needed:** Resolve affected started/ended/cancelled transitions and original-service meaning in [OQ-010 / OTQ-016 / PI-014](SPEC.md#17-prd-issues), and conflicting/replayed edits in OTQ-019/PI-015. Only affected transitions are blocked; future confirmed operations and UI work can proceed within confirmed rules.

**Scope**

- Extend existing appointment details with explicit owner move/cancel operations and authoritative current-state checks.
- Preserve saved-service rules and intact originals on failed replacement, with owner window exceptions but no availability override.
- Record owner actions and capture customer update work without self-alerts.
- Surface conflicting bookings on blocked schedule/retirement/eligibility edits and permit valid edits after explicit resolution.

**UI references:** [Owner calendar and appointments](DESIGN.md#owner-calendar-and-appointments). Use owner moves, cancellations, and conflict resolution. Late-state permissions and stale-edit outcomes remain unresolved; verify failed replacement/input preservation in Dialog and standalone views and real conflict resolution.

**Acceptance criteria**

- [ ] Owner move/cancel can bypass public notice/horizon/cutoff but cannot violate availability, resource eligibility, or overlap rules.
- [ ] A rejected replacement preserves the original booking/occupancy; successful edits keep updated details open, clear dirty state, and refresh the calendar.
- [ ] Cancellation releases the reservation and preserves retained details/link; activity identifies the owner action without an owner self-email.
- [ ] A conflicting resource/schedule edit names the affected bookings; moving/cancelling them allows the valid edit without deleting history. Another owner cannot perform any operation.

**Manual walkthrough**

1. Move a booking inside the customer cutoff using an explicit owner form; verify updated details and the calendar underneath.
2. Try an occupied/unavailable target; the form retains input and the original remains. Cancel a separate future booking and verify the slot becomes available.
3. Try retiring its still-booked barber or shortening hours around another booking; resolve the listed conflicts, then retry successfully. Check owner activity and the absence of a self-alert.

**Automated verification**

- Extend database replacement/cancel/configuration race tests and operation-level authorization tests; verify snapshot and notification-work effects.
- Add Playwright Dialog/standalone success/failure paths for all four criteria. Manually review conflict explanations and updated calendar readability; G5 controls any enabled real channel.

**Out of scope:** Customer changes, restoring cancelled records, attendance reclassification, force overrides, and automatic displacement/cancellation.

## Phase 10 — Customer cancellation

**User outcome:** An eligible link holder explicitly cancels their booking or sees shop contact guidance when self-service changes are unavailable.

**Requirements and journeys:** [FR-042/FR-045–FR-046](PRD.md#56-customer-management-links), [customer manages a booking](PRD.md#44-customer-manages-a-booking); [AC-018](PRD.md#91-confirmed-behavior-acceptance-criteria) and cancellation portions of AC-020.

**Depends on:** 06.

**Decisions needed:** Settle repeated/stale cancellation outcomes in [OTQ-019 / PI-015](SPEC.md#17-prd-issues) if not resolved for booking creation. Remaining invalid/expired presentation under OQ-010 affects only that feedback; it never permits access. No new link/account policy is needed.

**Scope**

- Add explicit POST cancellation with confirmation to the existing booking-scoped view.
- Enforce original-start cutoff and current confirmed state server-side.
- Release occupancy, retain ordinary link/interval details, and record the customer event and applicable notification work.

**UI references:** [Customer booking and management](DESIGN.md#customer-booking-and-management). Use customer cancellation only. Repeated/stale cancellation and unavailable-link wording await existing decisions; source-markup-only references cannot prove the operation.

**Acceptance criteria**

- [ ] Reading the link never cancels; confirmed POST cancellation at exactly twelve elapsed hours succeeds and releases the slot.
- [ ] Below cutoff, show current shop contact information and reject direct cancellation requests; cancelled/past/invalid/expired/wrong-scope authority cannot mutate.
- [ ] Successful cancellation retains the same link and a view-only cancelled booking. Existing management survives unpublication; failed messaging cannot reverse cancellation.

**Manual walkthrough**

1. Open a controlled booking exactly twelve hours away; view first, then explicitly cancel. Reopen the same link and see retained cancelled details.
2. Open a booking below cutoff and inspect contact guidance; attempt the POST directly and verify denial.
3. Repeat cancellation and use a wrong/expired link; observe the approved safe response and no new changes or duplicate event work.

**Automated verification**

- Add controlled-clock cutoff tests, database cancellation/repeated-request/revocation races, and Playwright view-versus-POST/contact/unpublished-shop flows.
- Automate all three criteria's mutation/access outcomes; manually verify confirmation wording and guidance. Test email hooks with doubles; live delivery remains subject to G5.

**Out of scope:** Customer replacement, owner restoration, public recovery lookup, and extra account/email-code checks.

## Phase 11 — Customer service, barber, and time replacement

**User outcome:** An eligible customer changes their service, barber, or time with a clear preview and without losing the original booking on failure.

**Requirements and journeys:** [FR-043–FR-045](PRD.md#56-customer-management-links), [FR-017](PRD.md#52-services-and-barber-profiles), [customer manages a booking](PRD.md#44-customer-manages-a-booking); [AC-015/AC-019](PRD.md#91-confirmed-behavior-acceptance-criteria).

**Depends on:** 06.

**Decisions needed:** Reuse or resolve stale-offer policy [OQ-006 / PI-001](SPEC.md#17-prd-issues), original/retained-service meaning after multiple changes PI-014, and same-booking stale/replayed edit outcomes OTQ-019/PI-015. No second cutoff against the replacement may be invented.

**Scope**

- Extend the existing linked view with service/barber/time replacement and explicit detail review.
- Apply old-booking cutoff and public rules to the replacement using existing availability/transaction mechanisms.
- Preserve or replace service snapshots according to the selected service and retain ordinary link identity.
- Capture the customer change and suppress obsolete unsent event work.

**UI references:** [Customer booking and management](DESIGN.md#customer-booking-and-management). Use customer replacement and review. Saved versus current service values and immediate-cutoff disclosure await existing stale-offer/original-service decisions; verify original-booking preservation transactionally.

**Acceptance criteria**

- [ ] An eligible holder can change service/barber/time; different-service current details are shown, same-service saved details persist, and the original-hidden-service exception is respected.
- [ ] A valid two-hour-away replacement is allowed with its immediate cutoff disclosure; replacement notice/horizon/grid checks match public creation.
- [ ] A taken or invalid replacement, concurrent edit, or revoked capability follows the approved response while preserving the original whenever replacement fails.
- [ ] Successful replacement retains the ordinary link with current details/expiry and commits only applicable change work, including while the shop is unpublished.

**Manual walkthrough**

1. Edit catalog values after a booking, then review same-service and different-service replacements; inspect the correct saved/current values before confirming.
2. Move an eligible booking into a valid two-hour-away slot; read the disclosure and reopen the same link to see the new cutoff condition.
3. Race a replacement against another reservation and try an ineligible/hidden different service; rejected changes leave the original intact and preserve useful form input.

**Automated verification**

- Extend Vitest cutoff/window/snapshot tests, PostgreSQL replacement/occupancy/current-authority races, and Playwright review/conflict/stable-link flows.
- Automate all four criteria's data/permission outcomes; manually review replacement agreement and cutoff disclosure. Reminder creation itself is not assumed by this phase's tests.

**Out of scope:** Customer cancellation (10), owner restoration, a new recovery lookup, and scheduled reminder dispatch (15).

## Phase 12 — Owner restoration

**User outcome:** An owner restores a future cancelled appointment only when its retained original reservation is still valid and available.

**Requirements and journeys:** [FR-035](PRD.md#55-owner-calendar-and-appointment-operations), [FR-017](PRD.md#52-services-and-barber-profiles), [owner recovery](PRD.md#45-owner-fixes-a-cancellation-or-contact-mistake); [AC-016](PRD.md#91-confirmed-behavior-acceptance-criteria).

**Depends on:** 09.

**Decisions needed:** Resolve original/retained interval and service meaning after prior changes in [OTQ-016 / PI-014](SPEC.md#17-prd-issues). Future-only, active/eligible, original-slot, and no-displacement rules are already fixed. Reminder identity is non-blocking for the restoration mutation; capture its restoration event consistently.

**Scope**

- Add the owner-only restore operation to existing cancelled details.
- Revalidate the original future interval, barber eligibility, and saved-service exception under the shared reservation lock.
- Preserve ordinary link identity/details and capture restoration activity/customer update work.

**UI references:** [Owner calendar and appointments](DESIGN.md#owner-calendar-and-appointments). Use restoration of the original future interval only. Plan missing denial presentations without adding a different-time restore flow; verify locking and eligibility independently.

**Acceptance criteria**

- [ ] A valid future cancellation restores into its retained interval with saved details and the same manage link.
- [ ] Rebooked time, inactive/ineligible barber, invalid availability, past original time, or foreign owner prevents restoration without displacing or changing another booking.
- [ ] Successful/failed restore follows the existing details/save behavior; enabled channel failures cannot undo a successful restore.

**Manual walkthrough**

1. Cancel a future booking, restore it, and verify original details, occupancy, and link identity.
2. Cancel again and reserve its slot elsewhere; restore fails and both records retain the correct states.
3. Exercise an inactive/ineligible or past fixture and unauthorized owner request; no reservation is created.

**Automated verification**

- Add real-database restoration-versus-booking races and state/eligibility/snapshot tests; add Playwright successful/denied restore in existing details.
- Automate all three criteria's state and scope checks; manually inspect failure explanations and enabled-channel evidence under G5.

**Out of scope:** Selecting a different restoration time, restoring past appointments, displacing reservations, and automated reminder scheduling (15).

## Phase 13 — Attendance and booking activity

**User outcome:** An owner identifies past unmarked appointments, records completed/no-show, and corrects attendance while reviewing booking activity.

**Requirements and journeys:** [FR-036–FR-038](PRD.md#55-owner-calendar-and-appointment-operations), [owner manages the day](PRD.md#42-owner-manages-the-day); attendance/activity portions of [AC-012/AC-017](PRD.md#91-confirmed-behavior-acceptance-criteria).

**Depends on:** 08.

**Decisions needed:** Resolve exact scheduled-end equality in [OQ-010 / PI-014](SPEC.md#17-prd-issues) before finalizing boundary behavior. General settings/profile audit scope and undefined reminder preferences [OQ-012 / PI-012](SPEC.md#17-prd-issues) are non-blocking; they do not expand this phase.

**Scope**

- Display past unmarked appointments without automatic attendance inference.
- Add authorized post-end marking and completed/no-show corrections to existing details.
- Show upcoming bookings and recorded booking/contact/attendance/message events as available, without fabricating missing channel status.

**UI references:** [Activity and messaging](DESIGN.md#activity-and-messaging). Use attendance and booking activity. Owner no-show/correction and rejected/early-write feedback need confirmation; end equality remains open. Do not add analytics, audit categories, or customer notifications.

**Acceptance criteria**

- [ ] A past unmarked booking remains visibly unclassified until an owner acts; early attendance writes fail.
- [ ] Permitted marking/correction persists and appears in activity, creates no customer notification, and never reactivates the reservation.
- [ ] Activity/upcoming views and direct requests remain shop-scoped; rejected changes add no successful action entry.

**Manual walkthrough**

1. Use a controlled past unmarked booking, inspect its label, and mark completed; correct it to no-show.
2. Inspect activity and notification work; the correction is recorded without a message or renewed booking.
3. Try early marking and another owner's appointment; both fail without changing the view's committed data.

**Automated verification**

- Add controlled-clock state-transition tests, database activity/no-notification/no-reactivation assertions, and a Playwright marking/correction/denial flow.
- Automate all three criteria; manually review labels and the activity view's useful empty/status states.

**Out of scope:** Automatic attendance, analytics/no-show dashboards, general settings audit expansion, reminder preferences, and new lifecycle transitions.

## Phase 14 — Protected retries and delivery recovery

**User outcome:** Eligible failed email notifications receive bounded retries, and the owner can distinguish recoverable, permanent, skipped, and uncertain outcomes.

**Requirements and journeys:** Retry/job portions of [FR-053–FR-060](PRD.md#57-notifications-and-automation), [system reminders/cleanup](PRD.md#46-system-reminders-and-cleanup); retry portions of [AC-024–AC-026](PRD.md#91-confirmed-behavior-acceptance-criteria).

**Depends on:** 07.

**Decisions needed:** Durable processing requires [OQ-004 / OTQ-010–OTQ-012 / PI-010](SPEC.md#16-open-technical-questions): transient/permanent/unknown treatment, retry timing, claim/crash recovery, and attributable outcome collection. Exact job path/header/batch bounds are plan details within that contract. [OTQ-018](SPEC.md#16-open-technical-questions) remains non-blocking for the fixed automatic three-attempt limit while manual resend is absent.

**Scope**

- Invoke a secret-protected retry worker through cron-job.org at the established ten-minute cadence.
- Claim committed eligible work and recover interrupted/uncertain processing according to the approved policy.
- Recheck current event/channel/budget eligibility and suppress obsolete unsent work.
- Persist per-attempt outcomes for existing Activity feedback.

**UI references:** [Activity and messaging](DESIGN.md#activity-and-messaging). Use existing Activity for retry/recovery outcomes. Labels await OTQ-010–OTQ-012; do not add a worker-control page. Provider and scheduled-job evidence remain separate requirements.

**Acceptance criteria**

- [ ] Missing/invalid secret performs no protected claim/send; an authorized scheduled invocation processes eligible retry work.
- [ ] Transient failures have at most three total automatic attempts/channel including initial; permanent failures stop, successful channels are not retried because another failed, and the budget remains global.
- [ ] Competing invocations and claim/send crashes follow the approved recovery policy without treating the same work as unrelated initial sends or inventing certain delivery.
- [ ] Superseded or budget-skipped work is suppressed as required; accepted/delivered/unknown outcomes remain distinguishable and never reverse a booking.

**Manual walkthrough**

1. Produce a controlled transient failure, invoke the authorized worker, and inspect attempts/status through retry completion or exhaustion.
2. Exercise permanent/unknown failures and an interrupted claim under the chosen recovery policy; compare the displayed results with evidence.
3. Invoke with an invalid secret and with exhausted budget; no unauthorized or excess send occurs. Verify an actual scheduled invocation's ten-minute configuration and result.

**Automated verification**

- Add real-database concurrent claim/budget/recovery tests and deterministic provider-failure classifications, including a multi-channel fixture for successful-channel independence.
- Add direct-request authorization and browser Activity status checks. Automate all four criteria's policy/state behavior; actual cron-job.org configuration/calls and live provider outcomes require dedicated manual evidence.

**Out of scope:** Reminder eligibility/schedule creation (15), WhatsApp capability (16), manual-resend counter policy (17), and exactly-once or ordered delivery guarantees.

## Phase 15 — Schedule-aware reminders

**User outcome:** A customer receives eligible reminders for the current appointment schedule, with no obsolete or post-start reminder sends.

**Requirements and journeys:** [FR-051–FR-055](PRD.md#57-notifications-and-automation), [system reminders](PRD.md#46-system-reminders-and-cleanup); [AC-023–AC-025](PRD.md#91-confirmed-behavior-acceptance-criteria).

**Depends on:** 11, 12, 14.

**Decisions needed:** Define schedule/restoration reminder identity and per-channel processing under [OTQ-009 / PI-009](SPEC.md#17-prd-issues). Existing >24-hour eligibility, due instant, future-only dispatch, and retry/budget bounds need no new decision.

**Scope**

- Extend creation, customer/owner replacement, and restoration to capture eligible reminder work transactionally.
- Process due reminders through the existing protected worker using current state/channel eligibility.
- Replace/suppress obsolete pending reminders when schedules or booking authority change.

**UI references:** [Activity and messaging](DESIGN.md#activity-and-messaging). Use reminder outcome presentation only. Due/suppressed/obsolete/too-late/rescheduled states await identity decisions; the local simulation proves neither cron nor provider success and approves no timing preferences.

**Acceptance criteria**

- [ ] Creation/replacement/restoration more than 24 elapsed hours ahead creates a reminder due at start minus 24 hours; exactly 24 or less creates no new reminder.
- [ ] A current eligible due reminder can be processed late while still future; cancellation or appointment start prevents dispatch.
- [ ] Rescheduling replaces old pending work and can qualify a new reminder after a prior schedule was reminded, without duplicate current-schedule processing beyond the approved best-effort/recovery policy.
- [ ] Unpublication preserves eligible existing reminders; retries, skips, and outcomes obey the existing worker/budget/evidence rules.

**Manual walkthrough**

1. Create controlled bookings on both sides of the 24-hour boundary and inspect due work/status.
2. Process a due reminder, then move that booking several days later; verify the new schedule qualifies and the old pending work cannot send.
3. Cancel or advance a booking to start before processing; observe suppression. Unpublish a separate eligible shop and confirm existing reminder processing remains available.

**Automated verification**

- Add Vitest elapsed/DST/equality predicates and database tests spanning create/move/restore/cancel, overlapping workers, and obsolete work.
- Add browser checks of reminder status using controlled time. Automate all four criteria's scheduling/state behavior; demonstrate an actual email reminder and scheduled-worker evidence manually.

**Out of scope:** Owner-configurable reminder timing, extra short-notice reminders, customer reminder preferences, and WhatsApp template proof (16).

## Phase 16 — Restricted WhatsApp booking messages

**User outcome:** Opted-in verified Meta test recipients receive actual booking confirmation, update, and reminder templates, while other visitors see an honest limitation.

**Requirements and journeys:** [FR-026](PRD.md#54-public-booking), WhatsApp portions of [FR-047–FR-048/FR-054–FR-061](PRD.md#57-notifications-and-automation), [customer booking](PRD.md#43-customer-creates-a-booking), [system reminders](PRD.md#46-system-reminders-and-cleanup); [AC-021/AC-025–AC-026/AC-029](PRD.md#91-confirmed-behavior-acceptance-criteria).

**Depends on:** 15.

**Decisions needed:** [OQ-001 / OTQ-011](SPEC.md#16-open-technical-questions) requires actual Meta sender/recipient/template capability and approved payloads; it blocks live completion, not independent adapter tests. Settle provider-specific outcome authentication/correlation under OTQ-012. Consent withdrawal/external opt-out [OTQ-020 / PI-017](SPEC.md#17-prd-issues) stays open unless the chosen protocol makes its handling necessary now; do not add unauthorized preference actions.

**Scope**

- Add the verified-recipient, explicit-consent WhatsApp channel to existing event/reminder work.
- Share current-state suppression, retries, evidence, and the global budget with email without replacing eligible email.
- Verify actual custom confirmation/update/reminder templates and expose eligibility/failure/skip status.

**UI references:** [Activity and messaging](DESIGN.md#activity-and-messaging). Use consent/channel disclosure and independent outcomes. Confirm no-consent, recipient/template restrictions, and mixed-channel feedback. Actual payloads and delivery need their own evidence; exclude SMS and new preference permissions.

**Acceptance criteria**

- [ ] Approved verified test recipients actually receive each of the three required template purposes with real booking data and a usable manage link; acceptance alone is insufficient proof.
- [ ] No consent, absent phone, or non-test recipient prevents WhatsApp sending with an accurate explanation; email remains independently eligible.
- [ ] One channel's failure does not resend a successful channel; combined sends/retries/owner alerts respect the shared budget and reflect genuine per-channel evidence.
- [ ] If required templates are unsupported, record the actual limitation and leave the integration incomplete/blocked unless an explicit scope exception is approved.

**Manual walkthrough**

1. Use an approved opted-in test recipient for a real confirmation, appointment update, and reminder; inspect payloads/messages and follow their links.
2. Try a non-test recipient and a no-consent booking; observe no WhatsApp send and truthful customer/owner feedback.
3. Fail one channel and exhaust the remaining shared budget; verify independent status, bounded retries, and intact bookings.

**Automated verification**

- Add deterministic eligibility/template-mapping/outcome tests, database multi-channel budget/suppression tests, and browser disclosure/status checks.
- Automate criteria two and three and the app's handling of unsupported capability. Criterion one and actual unsupported-capability evidence require dedicated approved Meta tests. Never substitute a generic smoke message for this evidence.

**Out of scope:** Production WhatsApp onboarding, arbitrary public recipients, marketing/SMS, generic-template substitution, and new consent/preference permissions.

## Phase 17 — Contact correction and owner-assisted recovery

**User outcome:** An owner corrects booking contact details, replaces prior link authority, and helps the customer recover through a protected resend.

**Requirements and journeys:** [FR-039–FR-040](PRD.md#55-owner-calendar-and-appointment-operations), [FR-045](PRD.md#56-customer-management-links), [FR-060](PRD.md#57-notifications-and-automation), [owner recovery](PRD.md#45-owner-fixes-a-cancellation-or-contact-mistake); [AC-020/AC-026–AC-027](PRD.md#91-confirmed-behavior-acceptance-criteria).

**Depends on:** 07, 09.

**Decisions needed:** Correction categories/save-triggered sends/fresh consent require [OQ-005 / PI-006 / OTQ-020](SPEC.md#17-prd-issues). Resend counters need explicit resolution of the [OTQ-018 / PI-009 source ambiguity](SPEC.md#16-open-technical-questions). Applicable messaging-endpoint thresholds remain OQ-003. Broader customer preference permissions remain unresolved, not implicitly authorized.

**Scope**

- Extend owner details with approved contact corrections and transactional capability replacement.
- Clear WhatsApp consent on phone changes and implement only the approved fresh-consent capture path.
- Add protected, budget-bound confirmation/manage-link resending using the existing delivery/status mechanisms.
- Suppress obsolete contact-bound work and record accepted corrections/recovery attempts.

**UI references:** [Customer booking and management](DESIGN.md#customer-booking-and-management). Use contact correction and owner-assisted recovery. Revocation/replacement, consent, and resend outcome presentations await OQ-005/OTQ-018/OTQ-020; do not infer save-triggered sends, public recovery, or new consent actions.

**Acceptance criteria**

- [ ] An accepted contact correction makes every old link invalid and issues a new booking-scoped link; phone changes clear consent before another WhatsApp attempt.
- [ ] Save/send behavior follows the explicit decision, and stale correction/customer-change races cannot restore revoked authority or overwrite protected state.
- [ ] Resend obeys approved attempt identity, endpoint limits, current eligibility, and the shared budget; ordinary resend preserves the current link and does not extend expiry from resend time.
- [ ] Another owner/public visitor cannot correct or resend; provider failure leaves corrected details/link valid, with truthful status and no public email lookup.

**Manual walkthrough**

1. Correct an email/phone on a booking whose earlier link is open in another session; confirm the old link is denied and the replacement opens current details.
2. Inspect cleared consent and use only the approved path to record fresh consent; observe the chosen save-versus-resend behavior.
3. Resend, then exercise exhausted budget/excess requests and unauthorized access; no forbidden send or rollback occurs.

**Automated verification**

- Add real-database revocation/current-authority races, consent/work-suppression and resend-counter/budget tests; add Playwright correction/recovery/denial flows in Dialog and standalone details.
- Automate all four criteria's state/permission effects; actual corrected-recipient delivery and consent wording require manual review. Exercise any enabled channel under G5 without requiring an unimplemented channel to send.

**Out of scope:** Public recovery lookup, email-code identity verification, general customer profiles, additional preference permissions, and blanket token rotation on ordinary appointment changes.

## Phase 18 — Shop address changes and customer updates

**User outcome:** An owner updates the shop address and eligible future customers receive the update without delivery failure undoing the saved address.

**Requirements and journeys:** Address-edit [FR-005](PRD.md#51-owner-access-and-shop-configuration), [FR-050/FR-057](PRD.md#57-notifications-and-automation), [FR-041](PRD.md#56-customer-management-links), [AC-022](PRD.md#91-confirmed-behavior-acceptance-criteria).

**Depends on:** 07.

**Decisions needed:** Resolve any address-specific validation not established during setup [OQ-008 / PI-013](SPEC.md#17-prd-issues) and the address-change message wording [OQ-013 / PI-011](SPEC.md#17-prd-issues). Provider restrictions are verification dependencies for enabled channels; no new notification channel or reminder schedule is implied.

**Scope**

- Extend existing Settings with persisted address edits and transactional future-confirmed customer work capture.
- Display current name/address in linked booking details while retaining saved service details.
- Apply existing channel/budget/evidence behavior without broadcasting name/contact-only edits.

**UI references:** [Shop address updates](DESIGN.md#shop-address-updates). Use address editing, current linked-booking address, and attributable update outcomes. Wording/validation await existing decisions; name/contact edits must not become broadcasts. Do not copy prototype counts or SMS claims.

**Acceptance criteria**

- [ ] Saving an address changes current shop/link details and targets future confirmed bookings, including when the shop is unpublished, without targeting cancelled/past records.
- [ ] Provider failure or budget skip preserves the new address and exposes per-recipient/channel results; no send is fabricated.
- [ ] Name/contact-only edits create no mass customer notifications, and another owner cannot update this shop or its targeted work.

**Manual walkthrough**

1. Use a shop with future confirmed, cancelled, and past fixtures; edit the address and inspect current linked details and targeted work.
2. Repeat with controlled provider failure/budget exhaustion; verify saved address plus truthful status.
3. Edit name/contact only and attempt a foreign-owner address write; no broadcast or unauthorized change occurs.

**Automated verification**

- Add database target-set/transaction rollback/scope tests, deterministic channel failures, and Playwright settings/link/status checks.
- Automate all three criteria's state/targeting results; inspect actual address-update email and any enabled WhatsApp template manually with approved recipients.

**Out of scope:** Marketing broadcasts, retrospective notifications, reminder resets, domain/subdomain changes, and new address/geography rules without approval.

## Phase 19 — Automatic historical cleanup

**User outcome:** Old demo bookings and associated activity/message history are removed automatically while future appointments and shop setup remain usable.

**Requirements and journeys:** [FR-064](PRD.md#58-public-demo-protection-and-retention), permanent-lock [FR-012](PRD.md#51-owner-access-and-shop-configuration), [system cleanup](PRD.md#46-system-reminders-and-cleanup); [AC-004/AC-028](PRD.md#91-confirmed-behavior-acceptance-criteria).

**Depends on:** 07.

**Decisions needed:** Cleanup needs [OQ-009 / OTQ-014 / PI-005](SPEC.md#16-open-technical-questions): elapsed/calendar day arithmetic, equality, cadence, and linked deletion. Settle late-result handling under OTQ-012/OTQ-014 without recreating deleted data. Sharing the reminder endpoint or selecting a daily cadence is not assumed; the operational entry point is a phase-plan choice needing its applicable authorization contract.

**Scope**

- Introduce automated scheduled-end-based deletion of eligible bookings and associated activity/message/work records.
- Preserve future bookings, shop/catalog configuration, historical archival requirements, and permanent first-booking zone-lock evidence.
- Make repeated execution and delayed message evidence safe under the approved deletion policy.

**UI references:** [Historical cleanup](DESIGN.md#historical-cleanup). Use existing views for cleanup effects; no dedicated cleanup UI is required. Confirm retained future records, removed history, and unavailable-link feedback after retention/presentation decisions. Search/load-error references do not establish cleanup behavior; verify destructive operations on disposable data.

**Acceptance criteria**

- [ ] Records before/at/after the approved thirty-day boundary follow the chosen arithmetic, including cancelled retained-end and past-unmarked cases across DST.
- [ ] Eligible bookings and their related activity/message history disappear; future bookings/configuration remain, and deleting all old bookings cannot unlock the time zone.
- [ ] Repeated cleanup is safe, any externally callable trigger follows its approved authorization contract, and delayed provider evidence cannot recreate a deleted booking or fabricate current delivery.

**Manual walkthrough**

1. In isolated local data, prepare boundary-aged bookings with related logs and a future booking; run the authorized cleanup entry point.
2. Inspect retained future bookings/settings and removed history, rerun cleanup, and attempt the time-zone edit; retained state survives and the zone stays locked.
3. If an external trigger is selected, invoke it without authority and verify no deletion. Submit delayed evidence for deleted history; no booking information is recreated. Verify the configured automatic caller/cadence separately.

**Automated verification**

- Add controlled-clock/DST retention tests and real-database linked-deletion, repeat-run, permanent-lock, authorization, and late-evidence tests. Fixtures remain disposable; never run destructive routine tests against shared databases.
- Add a browser/API check that future access survives and deleted links grant no booking access. Automate all three criteria's data/scope results; actual scheduled execution and the chosen deleted-record presentation require manual evidence.

**Out of scope:** Full demo resets, deleting future bookings/configuration, indefinite history, provider-account retention guarantees, and assuming a cleanup cadence not selected by the sources.

## MVP coverage

Coverage below is planned, not passed. Unless a status/report proves otherwise, every row remains unverified. Phase acceptance is deliberately narrower than a complete cross-phase PRD scenario. A shared gate is enforced whenever its referenced behavior is introduced or extended.

### Functional requirements and journeys

Requirement IDs link to their authoritative groups; journey headings are the existing journey references, not new product IDs.

| Requirement / journey                                                                   | Phase(s) or shared gate               | Coverage note                                                                                                                                            |
| --------------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [FR-001–FR-004](PRD.md#51-owner-access-and-shop-configuration)                          | 01; G1 throughout                     | Google-only, one shop, shared demo owner protection, independent own-shop authorization.                                                                 |
| [FR-005](PRD.md#51-owner-access-and-shop-configuration)                                 | 01, 18                                | Initial fields/name/contact edits; address-update targeting completed in 18.                                                                             |
| [FR-006](PRD.md#51-owner-access-and-shop-configuration)                                 | 01; G1                                | Permanent unique/reserved-safe namespace; grammar/list still open.                                                                                       |
| [FR-007–FR-008](PRD.md#51-owner-access-and-shop-configuration)                          | 05; G1/G8                             | Host resolution/clean 404 and actual Vercel wildcard proof; domain provisioning unverified.                                                              |
| [FR-009](PRD.md#51-owner-access-and-shop-configuration)                                 | 01–03, 05                             | Draft setup and publication guard; detailed readiness remains open.                                                                                      |
| [FR-010](PRD.md#51-owner-access-and-shop-configuration)                                 | 05, 06, 10–11, 15; G5                 | Publication toggle, no new public creation, existing links/changes/reminders survive; full scenario spans slices.                                        |
| [FR-011](PRD.md#51-owner-access-and-shop-configuration)                                 | 05                                    | Canonical link/QR; real phone scan required.                                                                                                             |
| [FR-012](PRD.md#51-owner-access-and-shop-configuration)                                 | 01, 06, 09, 13, 19; G3/G4             | Pre-booking edit, atomic permanent lock, survival after cancellation/attendance/cleanup.                                                                 |
| [FR-013–FR-014](PRD.md#52-services-and-barber-profiles)                                 | 02; G1/G4                             | Shared values, profiles, selected eligibility; no barber login.                                                                                          |
| [FR-015–FR-016](PRD.md#52-services-and-barber-profiles)                                 | 02, 06, 09; G3/G4                     | Catalog hide/archive begins in 02; booking-bearing guards/snapshots in 06; explicit resolution in 09.                                                    |
| [FR-017](PRD.md#52-services-and-barber-profiles)                                        | 09, 11, 12; G4                        | Existing original hidden-service exception and saved/current values; terminology/stale offers remain open.                                               |
| [FR-018](PRD.md#53-availability)                                                        | 03                                    | Weekly shop/barber hours, initial copy, breaks.                                                                                                          |
| [FR-019–FR-020](PRD.md#53-availability)                                                 | 04                                    | Days off, closures, blocks, dated replacements; precedence/reopening needs resolution.                                                                   |
| [FR-021](PRD.md#53-availability)                                                        | 06, 09; G3                            | First bookings activate all existing edit guards; explicit conflict resolution in 09.                                                                    |
| [FR-022–FR-023](PRD.md#53-availability)                                                 | 03–04, 06, 08–12; G2/G3               | Query/commit consistency, actor windows, full fit, UTC/IANA/DST offsets.                                                                                 |
| [FR-024–FR-025](PRD.md#54-public-booking)                                               | 06                                    | Explicit account-free sequence, required name/email, conditional phone; no OTP.                                                                          |
| [FR-026](PRD.md#54-public-booking)                                                      | 06, 16; G5                            | Consent/phone/disclosures first; actual eligible test sending in 16. Consent withdrawal remains an explicit policy gap, not a new action.                |
| [FR-027](PRD.md#54-public-booking)                                                      | 06; G6                                | Bot checks and atomic shared public creation limits.                                                                                                     |
| [FR-028–FR-030](PRD.md#54-public-booking)                                               | 06, 07; G2/G3/G5                      | Confirmed commit/immediate link, friendly conflicts, cutoff/unavailable-delivery feedback.                                                               |
| [FR-031–FR-032](PRD.md#55-owner-calendar-and-appointment-operations)                    | 01, 08, 09, 12–13, 17; G8             | Initial own-shop landing; full calendar, six navigation items, Dialog/standalone/history/discard in 08; operations extend the same views.                |
| [FR-033](PRD.md#55-owner-calendar-and-appointment-operations)                           | 08; G2/G3/G5                          | Exact-minute ongoing/future manual entry, optional contacts, both entry points and save outcomes.                                                        |
| [FR-034](PRD.md#55-owner-calendar-and-appointment-operations)                           | 09                                    | Owner move/cancel exceptions, no availability bypass; late-state rules open.                                                                             |
| [FR-035](PRD.md#55-owner-calendar-and-appointment-operations)                           | 12, 15–16; G3/G5                      | Original-slot restoration, customer updates, reminder/channel completion; no displacement.                                                               |
| [FR-036–FR-037](PRD.md#55-owner-calendar-and-appointment-operations)                    | 13; G4/G5                             | Post-end manual classification/correction, logged without messages or reactivation.                                                                      |
| [FR-038](PRD.md#55-owner-calendar-and-appointment-operations)                           | 07–09, 12–17; G5/G8                   | Activity/status introduced with email, calendar upcoming view, event visibility extended with producers; general settings audit/preferences remain open. |
| [FR-039–FR-040](PRD.md#55-owner-calendar-and-appointment-operations)                    | 17; G1/G5/G6                          | Contact effects/revocation, fresh consent, protected budget-bound resend; OTQ-018 must be resolved.                                                      |
| [FR-041](PRD.md#56-customer-management-links)                                           | 06, 18; G1                            | One-booking current view; current address after updates.                                                                                                 |
| [FR-042](PRD.md#56-customer-management-links)                                           | 10; G1/G2/G6                          | Explicit POST cancellation, old-start cutoff and contact guidance.                                                                                       |
| [FR-043–FR-044](PRD.md#56-customer-management-links)                                    | 11; G2–G4                             | Full replacement, review/disclosure, atomic intact-original failure.                                                                                     |
| [FR-045–FR-046](PRD.md#56-customer-management-links)                                    | 06, 09–12, 17, 19; G1/G2              | Stable ordinary identity/current-end expiry, read-only states, correction revocation, deleted/expired denial. Arithmetic/presentation gaps remain open.  |
| [FR-047](PRD.md#57-notifications-and-automation)                                        | 07, 08–12, 15–18; G5                  | Real email plus additional eligible test WhatsApp; contactless truth; channel integration is partial until 16.                                           |
| [FR-048](PRD.md#57-notifications-and-automation)                                        | 06–12, 16; G5                         | Each creation/change/cancel/restore producer captures applicable work; attendance excluded.                                                              |
| [FR-049](PRD.md#57-notifications-and-automation)                                        | 07, 10–11; G5                         | Customer-action owner emails only; owner actions remain activity, not self-alerts.                                                                       |
| [FR-050](PRD.md#57-notifications-and-automation)                                        | 18; G5                                | Future-confirmed address updates; no name/contact broadcast.                                                                                             |
| [FR-051–FR-052](PRD.md#57-notifications-and-automation)                                 | 15; G2/G5                             | >24 eligibility, elapsed due time, replacement/current schedule identity; restore identity open.                                                         |
| [FR-053](PRD.md#57-notifications-and-automation)                                        | 14–15; G1/G5/G8                       | Protected ten-minute caller, then due reminder predicates; actual cadence evidence required.                                                             |
| [FR-054](PRD.md#57-notifications-and-automation)                                        | 07, 14–17; G5                         | Prompt initial attempts, bounded retries, successful-channel independence, no late reminder; resend interpretation open.                                 |
| [FR-055](PRD.md#57-notifications-and-automation)                                        | 07, 09–12, 14–17; G5                  | Current-event/contact suppression and honest best-effort/in-flight/unknown outcomes.                                                                     |
| [FR-056–FR-057](PRD.md#57-notifications-and-automation)                                 | 06–18 where mutations/sends exist; G5 | Truthful evidence/skip reasons and committed business state independent of delivery.                                                                     |
| [FR-058–FR-059](PRD.md#57-notifications-and-automation)                                 | 07, 14–18; G5                         | Shared 100-attempt cap across all sources/channels; valid booking/link management continues at exhaustion.                                               |
| [FR-060](PRD.md#57-notifications-and-automation)                                        | 07, 14, 17; G5/G6                     | No automatic budget-skip replay; protected resend completed in 17.                                                                                       |
| [FR-061](PRD.md#57-notifications-and-automation)                                        | 16; G8                                | Actual three-purpose template proof; unsupported capability stays incomplete without an approved exception.                                              |
| [FR-062](PRD.md#58-public-demo-protection-and-retention)                                | 01, 05–07, 10–11; G1/G8               | Fictional public account-free creation/changes, real email where available, protected shared owner administration.                                       |
| [FR-063](PRD.md#58-public-demo-protection-and-retention)                                | 06–07, 10–11, 17; G6                  | Fixed limits and bot protection; remaining windows/keys/probe/messaging thresholds cannot be assumed.                                                    |
| [FR-064](PRD.md#58-public-demo-protection-and-retention)                                | 19; G7                                | Scheduled-end retention and linked deletion; arithmetic/cadence/late evidence remain open.                                                               |
| [Journey 4.1 — Owner setup](PRD.md#41-owner-signs-in-and-prepares-a-shop)               | 01–03, 05, 08                         | Draft/setup/share; complete today landing/navigation in 08.                                                                                              |
| [Journey 4.2 — Owner day](PRD.md#42-owner-manages-the-day)                              | 04, 08–09, 13; G8                     | Availability, real calendar/forms/history, conflict resolution, attendance/activity; details extended by 12/17.                                          |
| [Journey 4.3 — Customer booking](PRD.md#43-customer-creates-a-booking)                  | 05–07, 16; G2/G3/G5/G6/G8             | Explicit flow, on-screen link, independent real channels and disclosures.                                                                                |
| [Journey 4.4 — Customer management](PRD.md#44-customer-manages-a-booking)               | 06, 10–11; G1–G3/G6                   | Scoped read/cancel/replace, cutoff/contact guidance, intact original.                                                                                    |
| [Journey 4.5 — Owner recovery](PRD.md#45-owner-fixes-a-cancellation-or-contact-mistake) | 12, 17; G1/G3/G5                      | Future original-slot restore and contact/link/resend recovery.                                                                                           |
| [Journey 4.6 — Reminders/cleanup](PRD.md#46-system-reminders-and-cleanup)               | 14–16, 19; G5/G7                      | Protected retries/reminders, actual channels, bounded retention.                                                                                         |

### Business rules and non-functional requirements

| Requirement / journey                                                 | Phase(s) or shared gate           | Coverage note                                                                                                              |
| --------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| [BR-001–BR-005](PRD.md#6-business-rules-constraints-and-invariants)   | 01–02, 06; G1/G4                  | Shop/barber model, confirmed single-service booking, shared values and validation.                                         |
| [BR-006–BR-014](PRD.md#6-business-rules-constraints-and-invariants)   | 03–04, 06, 08–11; G2              | Grid/exact-minute, same-day fit, notice/horizon, cutoff, actor exceptions; unresolved boundaries retained.                 |
| [BR-015–BR-018](PRD.md#6-business-rules-constraints-and-invariants)   | 04, 06, 09–12; G3                 | Occupancy/adjacency/independent capacity, contact not identity, intact replacement originals.                              |
| [BR-019–BR-024](PRD.md#6-business-rules-constraints-and-invariants)   | 02–04, 06, 09, 11–12, 19; G3/G4   | Snapshots/hidden service, retirement/edit guards, schedule copy/overrides, permanent zone lock.                            |
| [BR-025–BR-026](PRD.md#6-business-rules-constraints-and-invariants)   | 03, 06, 08–12, 15; G2             | UTC/IANA, elapsed versus local date, DST gap/fold identity.                                                                |
| [BR-027–BR-030](PRD.md#6-business-rules-constraints-and-invariants)   | 06, 09–12, 17; G1/G2/G3           | Capability/read/POST safety, stable link/expiry/revocation, cutoff views and original-slot restoration.                    |
| [BR-031–BR-033](PRD.md#6-business-rules-constraints-and-invariants)   | 06, 08, 13, 17; G4/G5             | States/past-unmarked, attendance, public/manual contacts and consent clearing.                                             |
| [BR-034–BR-036](PRD.md#6-business-rules-constraints-and-invariants)   | 07–12, 16–18; G5                  | Independent eligible channels, customer-only owner alerts, address targeting.                                              |
| [BR-037–BR-039](PRD.md#6-business-rules-constraints-and-invariants)   | 15; G2/G5                         | Reminder eligibility, schedule identity and future due dispatch.                                                           |
| [BR-040–BR-042](PRD.md#6-business-rules-constraints-and-invariants)   | 07, 09–12, 14–18; G5              | Bounded retries, obsolete suppression/best effort, no business rollback.                                                   |
| [BR-043–BR-045](PRD.md#6-business-rules-constraints-and-invariants)   | 06–07, 10–11, 14–18; G5/G6        | Shared budget/no replay, continued booking, fixed public limits; definitions open where specified.                         |
| [BR-046](PRD.md#6-business-rules-constraints-and-invariants)          | 19; G7                            | Historical deletion without resetting future/configuration.                                                                |
| [BR-047–BR-049](PRD.md#6-business-rules-constraints-and-invariants)   | 01, 05–07, 10–11, 15–16; G1/G5/G8 | Draft/publication obligations, permanent safe namespace, actual WhatsApp templates.                                        |
| [NFR-001–NFR-003](PRD.md#8-non-functional-requirements)               | G1; 01, 05–06, 10–12, 14, 17      | Independent owner/shop/capability/job authority and non-mutating reads.                                                    |
| [NFR-004–NFR-006](PRD.md#8-non-functional-requirements)               | G2/G3/G5; 03–04, 06–12, 18        | Server/query parity, database protection, intact originals and no delivery rollback.                                       |
| [NFR-007–NFR-008](PRD.md#8-non-functional-requirements)               | G5; 07, 09–12, 14–18              | Genuine evidence, obsolete suppression, unknown/in-flight outcomes without fabricated success.                             |
| [NFR-009–NFR-010](PRD.md#8-non-functional-requirements)               | G5/G6; 06–07, 10–11, 14–18        | Atomic rate/bot/send limits with preserved booking access at the cap.                                                      |
| [NFR-011–NFR-012](PRD.md#8-non-functional-requirements)               | G2/G8; relevant UI/time phases    | Time correctness, demo/zone/cutoff/channel/conflict/contact disclosures.                                                   |
| [NFR-013](PRD.md#8-non-functional-requirements)                       | 19; G7                            | Cleanup isolation and preservation.                                                                                        |
| [NFR-014](PRD.md#8-non-functional-requirements)                       | 06; G8                            | Flow delivered in 06; under-one-minute claim remains unverified until OQ-014 protocol and actual measurement.              |
| [NFR-015](PRD.md#8-non-functional-requirements)                       | 16; G8                            | Dedicated actual template evidence, or explicitly incomplete capability.                                                   |
| [PRD goals: pilot and outcome observation](PRD.md#21-confirmed-goals) | G8                                | OQ-015 blocks pilot/outcome evaluation, not app implementation. No analytics dashboard or numeric business claim is added. |

### Acceptance scenario coverage

All scenarios link to [PRD acceptance criteria](PRD.md#91-confirmed-behavior-acceptance-criteria) and [SPEC's scenario/edge-case traceability](SPEC.md#142-acceptance-traceability). EC-001–EC-026 remain covered through those linked cases and their applicable gates, rather than copied into this document.

| Requirement / journey | Phase(s) or shared gate   | Coverage note                                                                                                  |
| --------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| AC-001                | 01–02; G1                 | Actual Google, one-shop/multiple profiles, cross-owner/shared-demo denial.                                     |
| AC-002                | 01, 05; G1/G8             | Namespace warning/uniqueness, real wildcard and clean host 404.                                                |
| AC-003                | 05–07, 10–11, 15          | Partial at publication; existing link/change/notification preservation verified as introduced.                 |
| AC-004                | 01, 06, 09, 13, 19; G3/G4 | Permanent-lock evidence spans create, lifecycle, and deletion.                                                 |
| AC-005                | 02                        | Catalog values and eligibility.                                                                                |
| AC-006–AC-009         | 03–04, 06, 11, 15; G2/G3  | Schedule/time cases first; commit/replacement/reminder parity completes coverage.                              |
| AC-010–AC-011         | 06–07; G3/G6/G8           | Flow/contact validation, immediate link, capacity and truthful delivery disclosures.                           |
| AC-012                | 08–09, 12–17; G8          | Full route/history/discard contract in 08; operation/activity extensions repeat affected checks.               |
| AC-013                | 08–09; G2/G3/G8           | Both creation presentations, prefills/save/failure, owner-window behavior.                                     |
| AC-014                | 06, 09; G3/G4             | Reject conflicting edits, then explicit move/cancel resolution.                                                |
| AC-015                | 06, 09, 11–12; G4         | Saved/current/hidden-service behavior across changes.                                                          |
| AC-016                | 12, 15–16; G3/G5          | Restore mutation first; reminder/additional-channel evidence completes messaging portions.                     |
| AC-017                | 13                        | Manual attendance/correction, no early marking/messages/reactivation.                                          |
| AC-018                | 06, 10; G1/G2             | Read safety/scope, POST and cutoff equality.                                                                   |
| AC-019                | 11; G2/G3                 | Replacement agreement/disclosure and intact-original races.                                                    |
| AC-020                | 06, 09–12, 17; G1/G2/G5   | Stable validity/read-only states first, correction/recovery completed in 17.                                   |
| AC-021                | 07, 08–13, 16; G5         | Email and event exclusions first; actual additional WhatsApp completes channel coverage.                       |
| AC-022                | 18; G5                    | Targeted address update independent of delivery success.                                                       |
| AC-023                | 15; G2/G5                 | Reminder thresholds, revised schedule and obsolete work.                                                       |
| AC-024                | 14–15; G1/G5/G8           | Protected cadence/worker first, full due-reminder eligibility in 15.                                           |
| AC-025–AC-026         | 07, 14–17; G5             | Initial evidence/budget, retries, real independent channels, manual resend; OTQ-018 unresolved until required. |
| AC-027                | 06–07, 10–11, 17; G6      | Public/probe controls, change limits, protected messaging/resend.                                              |
| AC-028                | 19; G7                    | Boundary-aged linked deletion with future/configuration/lock preservation.                                     |
| AC-029                | 16; G8                    | Actual required Meta template proof; generic success cannot pass.                                              |
| AC-030                | 06; G8                    | Account-free confirmation implemented with booking; measurement remains open under OQ-014.                     |

No deferred requirement in [PRD non-goals](PRD.md#22-explicitly-excluded-from-v1) is added to this release. Remaining OQ/OTQ/PI entries are not blanket blockers or permission to invent behavior. Record affected unresolved coverage in execution reports and keep the corresponding criteria open until the required evidence or an explicit approved exception exists.
