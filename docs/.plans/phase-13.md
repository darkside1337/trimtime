# Phase 13 — Attendance and booking activity, using TDD

## 1. Outcome, starting state, and approved decisions

Owners can identify past unmarked appointments, explicitly mark Completed or No-show, correct either classification, and review persisted booking activity and upcoming bookings.

**Scope:** Attendance writes and presentation, attendance activity, an upcoming-bookings section, shop isolation, and compatibility with existing calendar, details, manage-link, and message-status behavior.

**Non-goals:** Automatic attendance, attendance notifications, contact correction producers, reminders, resend/retries, analytics, general settings audit, different-time restoration, new routes, dependencies, or provider integrations.

### Verified starting state — 2026-11-01

- Repository: `/home/darkside/projects/trimtime`; HEAD `da27770`; tracked working tree clean before and after investigation. Preserve any subsequent unrelated changes.
- Phase 13 explicitly depends on Phase 08. Phase 12 is not an additional prerequisite.
- Phase 08 records historical local acceptance of persisted owner calendar/manual appointments and navigation. Its full browser and walkthrough evidence was **not reproduced** during planning.
- Current targeted unit verification: **38 passed** across `owner-schemas.test.ts`, `owner-time.test.ts`, and `appointment-read-error.test.ts`.
- Current real PostgreSQL verification: **139 passed** in `features/bookings/tests/operations.integration.test.ts`, using the owned disposable database.
- Initial unit execution failed because the required UTC clock was absent. Initial database execution failed because the disposable container was stopped. Both setup problems were repaired before successful reruns; neither is behavioral RED evidence.
- The owned disposable database was started and remains running.
- Full lint/typecheck/build/browser checks were not run during planning; their current results are **UNVERIFIED**.
- No project files were edited. `docs/.plans/phase-13.md` does not exist.
- Existing booking states and read types support only `confirmed`/`cancelled`. Existing `booking_changes` supports move/cancel/restore with revision, actor, snapshots, and operation-key recovery.
- Activity already reads persisted own-shop changes and notification evidence. Upcoming bookings and attendance producers are missing.
- Existing details/calendar/manage presentation already distinguishes past unmarked bookings, but needs four-state support.
- Installed Next.js is **16.4.2**, React **19.3.0**, Vitest **5.0.5**. Local Next.js Server Actions and `revalidatePath` guides were inspected. Reuse guarded actions and actual `/owner/...` revalidation destinations.

### Decisions explicitly selected during planning

1. Attendance requires authoritative server time **strictly later than scheduled end**. Equality rejects.
2. Persist attendance as booking states `completed` and `no_show`, matching BR-031.
3. Permit ended `confirmed → completed/no_show` and `completed ↔ no_show`. Cancelled bookings are excluded. Attendance never returns a booking to confirmed.
4. Reuse expected revisions and operation-key replay. An identical successful retry recovers its original event. A fresh same-state request returns `NO_CHANGE`, without a revision increment or successful activity entry.
5. Existing details use a Completed/No-show selector and **Save attendance**, with existing dirty-dismissal and pending protection.
6. Upcoming Activity lists own-shop confirmed bookings whose start is **at or after server time**, earliest first. Ongoing appointments remain in Calendar.
7. Approved test boundaries: deterministic validation in Vitest; real PostgreSQL mutation/read APIs with SQL integrity assertions; Playwright journeys/direct-request guards; executor visual and keyboard walkthrough.

These selections become implementation authority only when the complete plan is approved. No remaining product decision blocks this proposal.

### Existing constraints

Preserve FR-032 navigation/save/failure behavior, BR-031–BR-032 attendance rules, FR-048’s attendance-message exclusion, shop-derived authorization, existing link identity/expiry, and fictional-demo restrictions.

OQ-012/PI-012 settings audit/reminder preferences remain open and non-blocking. Resolve only attendance equality under OQ-010/OTQ-016/PI-014; retain their other unresolved portions.

## 2. Contracts and acceptance evidence

### Proposed contracts

Add to the bookings feature:

```ts
type SetOwnerAttendanceInput = {
  bookingId: string;
  expectedRevision: number;
  operationKey: string;
  status: "completed" | "no_show";
};
```

- `setOwnerAttendanceSchema`: strict object; UUID booking ID; nonnegative integer revision; existing 43-character base64url operation-key format; only the two attendance targets.
- `setOwnerAttendance(context, input: unknown): Promise<ActionResult<OwnerChangeReceipt>>`, exported through `features/bookings/mutations.ts`.
- `setOwnerAttendanceAction(input: unknown)`: existing owner-host, matching-origin, session-derived-context guards.
- Extend `OwnerChangeReceipt.operation.kind` and booking activity kinds with `"attendance"`.
- Extend booking status types in owner and customer projections to all four states.
- Add `getOwnUpcomingBookings(context, now = new Date())`, returning an `ActionResult` containing `{ timeZone, appointments }`, with appointments using `OwnerCalendarAppointment`.
- Upcoming order: `startAt ASC, id ASC`. No arbitrary truncation or pagination in this phase.

Mutation errors reuse `ActionResult` and existing owner error conventions: unauthenticated, shop required, `NOT_FOUND`, `VALIDATION_ERROR`, `STALE_BOOKING`, `RECOVERY_MISMATCH`, `INVALID_STATE`, `TOO_EARLY`, `NO_CHANGE`, and `UNAVAILABLE`. Foreign and absent booking IDs share `NOT_FOUND`.

For fresh valid requests, check revision before state/time/no-op checks. Successful replay precedes fresh revision checks after establishing authority and own-shop booking identity.

### Acceptance mapping

| Local criterion | Requirements | Boundary and scenarios | Evidence and owner |
|---|---|---|---|
| **P13-C1:** Past unmarked stays unclassified; early writes fail | FR-036, BR-031–BR-032, EC-023, AC-017 | Mutation/read APIs: end−1 ms and equality reject; end+1 ms allows classification. Reading/refreshing never changes attendance. Browser displays “Past, unmarked” before owner action. | **AUTOMATED:** executor, Vitest/PostgreSQL/Playwright. **EXECUTOR WALKTHROUGH:** labels and boundary feedback. |
| **P13-C2:** Mark/correct persists, appears in activity, sends no notification, never reactivates | FR-037–FR-038, FR-048, BR-032, AC-017, attendance exclusion in AC-021 | Both initial classifications and both correction directions; persisted details/calendar/manage status; one event per commit; unchanged capability, interval, and occupancy; no notification work/attempt/budget changes. Replay, stale, no-op, rollback and races. | **AUTOMATED:** executor, PostgreSQL plus browser journeys. **EXECUTOR WALKTHROUGH:** save/error/recovery and Activity wording. |
| **P13-C3:** Views/direct requests remain shop-scoped; rejection creates no success entry | FR-038, AC-012 activity portion, owner access rules | Upcoming boundaries/order/empty state; existing changes/message evidence; absent/foreign IDs, foreign owner, missing session, wrong host/origin, malformed requests. No data leak or committed changes. | **AUTOMATED:** executor, PostgreSQL and Playwright direct requests. **EXECUTOR WALKTHROUGH:** empty/error/status presentations. |

SQL assertions are deliberately approved for database guarantees that UI reads cannot fully expose. They do not replace exercising mutation APIs.

Browser provider doubles cannot establish actual delivery. This phase introduces no sends, so live provider access is unnecessary. Physical-device, dedicated screen-reader, and hosted-ingress evidence remain **USER/PROVIDER REQUIRED** where applicable to cross-phase gates; no earlier exception automatically applies to Phase 13.

## 3. Ordered execution slices

Run from the repository root. Execute one test and implementation cycle at a time, including within each slice.

### Setup and prerequisite verification

Read applicable AGENTS.md, this approved plan, relevant PRD/SPEC/ARCHITECTURE/APP_ROUTES/DESIGN sections, and current files.

Run:

```sh
git status --short
git rev-parse HEAD
pnpm db:test:up
TRIMTIME_E2E_NOW=2026-11-02T08:00:00Z pnpm exec vitest run --config vitest.config.mts features/bookings/tests/owner-schemas.test.ts features/bookings/tests/owner-time.test.ts features/bookings/tests/appointment-read-error.test.ts
TRIMTIME_E2E_NOW=2026-11-02T08:00:00Z node --env-file=.env.test node_modules/vitest/vitest.mjs run --config vitest.database.config.mts features/bookings/tests/operations.integration.test.ts
```

Install locked dependencies only if missing. Install Playwright Chromium only if missing.

Reuse `openTestDatabase`, global migration setup, existing Date-only fake timers, `database-locks` bounded waiter helpers, and unique per-test owners/shops. Keep Vitest isolation and three-worker database configuration. Cleanup only owned rows, tracked rate keys, users, and pools; restore clocks/spies in teardown.

Read local Next.js guides again before changing framework-facing code. No configuration changes are planned.

### S1 — Validate attendance submissions and persist the four-state model

**References:** FR-036–FR-037, BR-031–BR-032.  
**Dependencies:** Approved contracts; running disposable database for migration checks.

**Files**

- Modify `features/bookings/schemas.ts`.
- Create `features/bookings/tests/attendance-schemas.test.ts`.
- Modify `db/schema/bookings.ts`, `db/schema/booking-changes.ts`.
- Create `db/migrations/0013_attendance.sql`.
- Create `tests/database/attendance-migrations.test.ts`.

**First executable test, complete code**

```ts
import { describe, expect, it } from "vitest";
import { setOwnerAttendanceSchema } from "../schemas";

describe("owner attendance submissions", () => {
  it("rejects confirmed as an attendance target", () => {
    const result = setOwnerAttendanceSchema.safeParse({
      bookingId: "00000000-0000-4000-8000-000000000001",
      expectedRevision: 0,
      operationKey: "a".repeat(43),
      status: "confirmed",
    });

    expect(result.success).toBe(false);
  });
});
```

If the export is missing, establish only a compile-compatible strict-object schema with `status: z.string()` and the approved other field validators. The behavioral RED must be acceptance of `"confirmed"`, not a missing import.

Run:

```sh
TRIMTIME_E2E_NOW=2026-11-02T08:00:00Z pnpm exec vitest run --config vitest.config.mts features/bookings/tests/attendance-schemas.test.ts
```

Then individually test both valid targets; cancelled/unknown targets; negative/fractional revision; malformed UUID/key; extra fields and non-object input. Derive expected results from the contract.

**Migration behavior tests**

Use the existing migration-test isolation pattern. Verify:

1. Preexisting confirmed/cancelled rows and move/cancel/restore events survive migration.
2. Both attendance states and owner attendance events are accepted.
3. Unknown states/kinds reject.
4. Customer-attributed attendance events reject.
5. Existing uniqueness and shop/booking constraints remain enforced.
6. Migration runner rerun preserves data and does not reapply the migration.

**Minimal implementation:** Expand only the booking status and change-kind checks. Preserve actor restrictions, foreign keys, revisions, snapshots and notification constraints. No backfill/inferred attendance or new table.

Migration RED must be the old constraint rejecting an approved attendance value, or an assertion showing the missing expanded constraint behavior.

```sh
TRIMTIME_E2E_NOW=2026-11-02T08:00:00Z node --env-file=.env.test node_modules/vitest/vitest.mjs run --config vitest.database.config.mts tests/database/attendance-migrations.test.ts
```

**Regression:** the setup unit command and all existing booking-change/restoration migration tests.

### S2 — Commit one authorized attendance change atomically

**References:** P13-C1–C3, FR-036–FR-038, AC-017.  
**Dependencies:** S1.

**Files**

- Modify `features/bookings/owner-mutations.ts`, `mutations.ts`, `types.ts`, `queries.ts`.
- Extend `features/bookings/tests/operations.integration.test.ts`.
- Extend `features/bookings/tests/notification-reads.integration.test.ts`.

Use the existing integration suite’s fixture helpers and public creation operations. Create a valid appointment while it is future, then advance Date-only fake time past its end. Do not implement historical creation to prepare attendance fixtures.

**Ordered tests**

1. Ended confirmed → completed: call proposed mutation with revision 0, unique key and end+1 ms. Read own details: completed, revision 1, saved values unchanged. One owner attendance event records confirmed → completed.
2. Independently test confirmed → no_show, completed → no_show and no_show → completed.
3. At end−1 ms and equality, reject `TOO_EARLY`; state, revision, activity and all side effects unchanged.
4. Cancelled rejects `INVALID_STATE`. No supported input can restore confirmed state.
5. Missing session, owner without shop, foreign owner and missing booking reject through the established errors without exposing booking data.
6. Stale revision rejects `STALE_BOOKING`. A fresh same-state submission at the current revision returns `NO_CHANGE`; no new revision/event.
7. Same operation key and identical payload returns the same operation ID/revision, including after a subsequent correction. Same key with different status, booking or revision rejects recovery mismatch.
8. Submit competing completed/no-show requests from separate database connections with the same revision: exactly one commits; the loser is stale; one event exists.
9. Submit concurrent identical operation-key requests: both recover the same operation; only one commit/event.
10. Hold the shop lock, queue marking, advance time across end, release lock: time sampled after acquisition determines eligibility.
11. Force the attendance event insert to fail using an isolated fixture-scoped database failure mechanism following existing rollback tests. The mutation fails and the booking/revision remains unchanged.
12. Snapshot notification work/attempts, relevant budget records, manage capability and occupancy before successful classification/correction. Assert no changes afterwards. Test both retained historical occupancy and a fixture without occupancy.
13. Prior confirmation/move/restoration email evidence remains visible after attendance revisions; no fabricated new attendance message status appears.

**Minimal implementation**

Reuse the shop transaction lock and own-booking lock pattern. Sample time after acquiring the shop lock. Validate authority, recover identical operations, check fresh revision/state/time, and commit status, one revision increment and one owner attendance event together.

Do not insert/delete/update occupancy, stage/suppress notification work, reserve budget, dispatch providers, regenerate links, or revalidate schedules/catalog eligibility. Attendance concerns the recorded appointment.

Preserve the existing receipt snapshot and post-commit-read recovery pattern. Attendance replay must still recover its original event if current appointment state has since changed.

Extend read types honestly. For message summaries, resolve the latest applicable existing customer lifecycle work at or before the booking revision; attendance revisions must not hide the previous evidence. Preserve existing suppression and status semantics.

**Command and RED**

```sh
TRIMTIME_E2E_NOW=2026-11-02T08:00:00Z node --env-file=.env.test node_modules/vitest/vitest.mjs run --config vitest.database.config.mts features/bookings/tests/operations.integration.test.ts -t attendance
```

Name new tests with “attendance”. A minimum contract-compatible mutation stub may return `UNAVAILABLE`; first behavioral RED must show the permitted classification failing.

Run the full operations and notification-read suites after GREEN. After this first mutation slice, reconcile later slices with the actual approved interface.

### S3 — Show attendance in shop-scoped activity and upcoming bookings

**References:** FR-038, AC-012 activity portion, P13-C2–C3.  
**Dependencies:** S2.

**Files**

- Modify `features/notifications/queries.ts`, `types.ts`.
- Modify `features/bookings/queries.ts`.
- Extend `features/bookings/tests/operations.integration.test.ts`.
- Modify `app/owner/(management)/activity/page.tsx`.
- Modify `features/notifications/components/owner-activity.tsx`.

**Public boundaries:** Existing `getOwnBookingActivity` and proposed `getOwnUpcomingBookings`.

**Ordered tests**

1. After attendance commit, booking activity contains its recorded actor/time and before/after classification. A correction produces a separate event.
2. Rejected and no-op changes add no event.
3. Owner A’s reads never expose owner B’s upcoming bookings or attendance history.
4. Upcoming fixtures: start at now−1 ms excluded; start equal now included; future confirmed included; cancelled/completed/no_show excluded.
5. Sort independently specified fixtures by known start times, then ID for equal starts.
6. Empty shop returns a successful empty list. Missing session is denied; missing shop uses the existing shop-required behavior.
7. UI distinguishes no upcoming bookings, no recorded changes, no recorded message work, unavailable reminder capability, and a read failure. Failure is not an empty-success state.

Do not fabricate contact events: show existing recorded events only. Contact correction production remains later-phase work.

**RED command**

```sh
TRIMTIME_E2E_NOW=2026-11-02T08:00:00Z node --env-file=.env.test node_modules/vitest/vitest.mjs run --config vitest.database.config.mts features/bookings/tests/operations.integration.test.ts -t 'attendance|upcoming'
```

The proposed upcoming read may initially return an empty list to reach behavioral RED; populated fixtures must expose missing behavior.

**Implementation:** Server-derived owner scope; no client-supplied shop identifier; persisted projections; existing details links; readable attendance labels and before/after text. Preserve message filtering, evidence details, and existing refresh behavior.

**Regression:** Full operations and notification-read suites.

### S4 — Save attendance through existing details and preserve all consumers

**References:** FR-032, FR-036–FR-038, AC-017, AC-020 view-only compatibility.  
**Dependencies:** S2–S3.

**Files**

- Modify `features/bookings/actions.ts`.
- Modify `features/bookings/components/appointment-operations.tsx`, `appointment-details.tsx`, `owner-calendar-context.tsx`, `owner-calendar.tsx`.
- Create `features/bookings/components/appointment-attendance-form.tsx`.
- Modify `features/bookings/components/manage-booking/manage-booking-details.tsx`.
- Modify other existing managed-booking status consumers identified by a targeted four-state search, including `features/bookings/components/manage-booking.tsx`.
- Create `tests/e2e/phase13-attendance.spec.ts`.
- Extend `tests/e2e/owner-booking-fixtures.ts`.

Reuse existing dismissal hooks and draft context; do not create a second independent dirty-state system.

**Browser fixture contract:** Use existing isolated owner fixtures and valid booking creation. Freeze application time through the existing E2E clock. Prepare past rows through fixture-only controlled setup; never add an application bypass for historical creation. Preserve real capability data for customer manage assertions.

**Ordered browser tests**

1. Past unmarked details show the label, selector, and Save attendance; viewing/refreshing does not classify.
2. Select Completed, save, refresh: committed status persists in standalone details and calendar; Activity shows the event.
3. Correct to No-show, then back to Completed; Activity preserves both transitions.
4. Exercise intercepted details and standalone direct visits. Dirty Close/Escape/outside-click/Back prompts discard; declining preserves selection/URL. Pending blocks duplicate submission and dismissal.
5. Server rejection preserves selected target and committed details, with accessible feedback. Stale conflict requires refresh/review before a fresh request.
6. Lose the successful response; retry the retained operation key. Recover one operation without duplicate events, including after a revalidation remount.
7. Early/equality fixtures cannot save; a forged direct action request is rejected by server time.
8. Missing session, foreign owner, wrong host and mismatching origin direct requests fail without mutation/activity. Reuse the existing action-request capture pattern; do not hardcode generated Next action IDs.
9. Valid customer manage links show Completed/No-show accurately and remain view-only; expiry and revoked-link behavior is unchanged. No edit/cancel/restore action becomes available.
10. Upcoming bookings navigate to existing details. Empty and read-error Activity states remain distinguishable.

**Action implementation:** Guard host/origin/session, invoke mutation, revalidate `/owner`, `/owner/appointments/{id}`, and `/owner/activity`. No attendance `after()` dispatch. Existing details retain successful updated data and preserve failed input.

**Command and RED**

```sh
TRIMTIME_E2E_ALL_DEVICES=1 pnpm test:e2e tests/e2e/phase13-attendance.spec.ts
```

Prerequisites: owned disposable database, Chromium, and a fresh `pnpm build`; use the E2E runner’s default clock. Choose fixture dates relative to that clock. Initial RED must show missing attendance controls or incorrect persisted behavior, not server setup failure.

**Regression**

```sh
pnpm test:e2e tests/e2e/phase09-appointments.spec.ts tests/e2e/phase12-restoration.spec.ts tests/e2e/manage-booking.spec.ts tests/e2e/owner-navigation.spec.ts tests/e2e/owner-access.spec.ts
```

Rebuild before browser checks after production changes.

### S5 — Record approved decisions and acceptance evidence

**Files**

- Modify `docs/PRD.md`, `docs/SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DESIGN.md`, `docs/ROADMAP.md`.
- Create local-only `docs/reports/2026-11-01-phase-13-attendance.md`; if execution occurs later, use its actual execution date.
- Update `docs/APP_ROUTES.md` only if existing route-status descriptions need correction; introduce no route.

Record the selected equality boundary under existing IDs; document transaction/replay/state/UI choices and actual evidence. Keep unrelated open questions open.

The roadmap links to the tracked approved plan. **Do not link the ignored report from tracked documents**, per AGENTS.md. Summarize its dated results/blockers in the roadmap.

No artificial RED is required for documentation or setup.

## 4. Final checks, walkthrough, and completion

Run Prettier on modified supported files only, using the local version if installed or `pnpm dlx prettier` otherwise. Respect project configuration; do not format unrelated files or unsupported SQL.

Final automated commands:

```sh
pnpm lint
pnpm exec tsc --noEmit --incremental false
TRIMTIME_E2E_NOW=2026-11-02T08:00:00Z pnpm test
pnpm db:test:up
TRIMTIME_E2E_NOW=2026-11-02T08:00:00Z pnpm test:db
pnpm build
pnpm test:e2e
TRIMTIME_E2E_ALL_DEVICES=1 pnpm test:e2e tests/e2e/phase13-attendance.spec.ts
git diff --check
git status --short
```

Do not override the full browser suite’s established default clock. Reuse existing local transport doubles; no live sends are required for this phase.

### Numbered walkthrough — EXECUTOR WALKTHROUGH

1. Open a controlled past confirmed appointment from Calendar. Verify “Past, unmarked”, saved details, and no automatic classification after refresh.
2. Select Completed and save. Verify details, calendar, Activity actor/time/transition, and persistence after refresh.
3. Correct to No-show and back. Verify separate committed events; inspect DB evidence showing unchanged link/occupancy and no new notification work, attempts or budget usage.
4. Repeat in standalone details and intercepted Dialog. Check Back/Forward, dirty discard refusal/acceptance, pending dismissal protection and focus restoration.
5. Trigger early marking, stale revision, lost-response retry and server failure. Verify clear feedback, preserved selection, committed data, and exactly-once recovery.
6. Use another authenticated owner and direct action requests. Verify denial without data disclosure or success events.
7. Inspect upcoming ordering, start equality, excluded ongoing/cancelled/classified rows, own-shop scope, empty view, and read-error presentation.
8. Inspect a valid customer manage link after both classifications: accurate status, view-only behavior, unchanged identity and existing message evidence.
9. At 1440, 901, 900, 768, 390 and 320 px, inspect long content, scrolling and actions. Check keyboard labels/order, focus entry/containment/restoration, errors/live feedback, and reduced motion.

Record screenshots/traces where useful, commands/results, RED→GREEN chronology, deviations, and pending evidence in the dated local report.

### Completion checklist

- [ ] All three Phase 13 criteria have their required automated and walkthrough evidence.
- [ ] Fresh regression checks pass; failures are diagnosed without weakening safeguards.
- [ ] Applicable cross-phase authorization, transaction, notification-exclusion and accessibility gates pass.
- [ ] Authoritative decisions are recorded without closing unrelated questions.
- [ ] Report separates implementation, verified evidence, and pending checks.
- [ ] Physical-device, dedicated screen-reader and hosted evidence is either obtained where required or remains explicitly pending.
- [ ] Any completion exception is separately and explicitly approved; prior phase exceptions do not transfer.
- [ ] Roadmap criteria are checked only after evidence passes; phase done only after its full definition of done or an approved exception.
- [ ] Perform AGENTS.md’s Next.js feedback reporting pass if qualifying verified friction arose.

## 5. Executor instructions and approval boundary

Copy the following instructions verbatim into the saved plan:

- Read the plan and applicable AGENTS.md, inspect current files, and compare them with the recorded starting state. Report material drift before changing affected code; continue independent approved work.
- Execute one test → meaningful RED → minimal implementation → GREEN at a time. Never write the entire phase’s tests before implementation.
- RED must expose the intended missing behavior. Repair unrelated environment or configuration failures first. If a planned interface is missing, establish the minimum interface needed to reach a behavioral failure before implementing the behavior.
- Any stub introduced to reach behavioral RED must match the approved contract and contain only the placeholder logic needed to compile and exercise the test.
- If a test already passes, verify that it exercises the requirement and can detect a relevant regression. Record existing coverage and avoid unnecessary production changes.
- After the first slice is GREEN, reconcile remaining slices with the implemented interface. Report necessary adjustments and continue when they remain within approved scope and contracts; otherwise block affected work pending resolution.
- Run the specified regression checks. Simplify after GREEN only where useful.
- Test observable behavior through approved public boundaries. Do not couple assertions to private structure or calculate expected results using the implementation’s algorithm.
- Use isolated disposable database data and the existing harness where possible. Follow the planned cleanup and concurrent-test isolation strategy. Never reset or drop a shared database.
- Keep routine tests isolated from live provider sends. Mocks cannot prove database guarantees or actual delivery.
- Preserve validation, security, accessibility, and unrelated work.
- Diagnose unexpected failures within scope. Never weaken tests, disable checks, or bypass safeguards to obtain GREEN.
- Stop affected work when proceeding requires a product-rule change, contract or schema change, new dependency, or destructive action outside the approved plan. Never bypass security safeguards.
- When blocked, record the failing command or operation, evidence, affected work, and required resolution. Continue independent approved work.
- Report implemented behavior, verified results, and pending evidence separately.

**Approval boundary:** Await approval of this complete scope, contracts, consequential choices and evidence boundaries. After approval, save the complete plan to `docs/.plans/phase-13.md`; inspect for a newly existing file before writing and preserve it if different. Approval to save authorizes no implementation.
