# Trimtime — Technical Specification

**Date:** 2026-10-14

**Status:** Technical translation of the approved requirements; not a fully selected implementation architecture and not evidence of shipped behavior.

**Sources:** The complete docs/PRD.md was read before drafting. Available original interview evidence includes the user's explicit Q1–Q61 answers. Some answers accept earlier recommendations without reproducing their full text; those product outcomes are taken from the authoritative PRD, without reconstructing missing technical decisions. Conversation evidence is used only for explicitly confirmed technical choices and source comparisons. After context compaction, final verification uses the preserved review summary, the saved draft, and the PRD; it does not claim a fresh full-history interview review.

**Original drafting PRD snapshot SHA-256 (historical, before the 2026-10-14 owner-workflow amendment):** 19136daea958e2d8ba21612ddb4d852a5b0b6f8c1c6697ebb0aeeaaf9746d5a7

**Reading rules:** “Confirmed” means required by the approved PRD or an explicit accepted interview decision. “Derived behavior” is a logical translation of those requirements, not an additional feature or a selected storage/framework design. “Unconfirmed” means no implementation choice has been approved. Alternatives are not recommendations or defaults. OTQ identifiers refer to Open Technical Questions; PI identifiers refer to PRD Issues within this document, not external tickets. PRD FR/BR/NFR/AC/EC/OQ identifiers retain their existing meanings.

The original specification was documentation-only. The explicitly approved owner scheduling-workflow amendment on 2026-10-14 updates PRD FR-031–FR-033 and AC-012–AC-013 and is reflected in §6.6.1 and §14.3 here. [APP_ROUTES.md](APP_ROUTES.md) distinguishes approved paths from proposals; [ARCHITECTURE.md](ARCHITECTURE.md) records selected mechanisms. These documents do not establish shipped application behavior, provider configuration, or live integration acceptance.

## 1. System overview and technical context

Trimtime is an English/USD, USA-targeted public portfolio demonstration with fictional shops and barbers. The owner manages one shop and multiple independently scheduled barber profiles. Customers book without accounts or email verification. Actual Resend email delivery and restricted Meta WhatsApp test delivery are part of the demonstration. Production WhatsApp onboarding is excluded.

The externally established surfaces are the main site, an owner application host illustrated by app.trimtime.com, and shop-specific hosts such as sharpcuts.trimtime.com. Public requests resolve a shop from the hostname. Owner authority must be established separately, including on a system hostname that is not itself a shop slug. The shared demo shop is controlled by the project owner's Google account; other owners have isolated shops.

The system must preserve appointment state independently of external delivery. A successful reservation is confirmed and its manage link is available even when messaging fails or the daily budget is exhausted. Provider acceptance is not confirmed delivery.

This SPEC defines logical responsibilities and trust boundaries. The later approved [ARCHITECTURE.md](ARCHITECTURE.md) selects one Next.js App Router deployment and feature boundaries; it supersedes historical unselected-mechanism wording only for explicitly recorded choices. Remaining product and technical policies stay open.

**Traceability:** FR-001–FR-004, FR-007–FR-008, FR-028, FR-047, FR-057–FR-062; BR-001–BR-002, BR-034, BR-042–BR-044; NFR-001, NFR-006–NFR-008.

## 2. Confirmed technology stack

### 2.1 Confirmed integrations and technical constraints

| Area | Confirmed choice or constraint | Evidence |
| --- | --- | --- |
| Owner identity provider | Google OAuth only; no password/email-verification signup or GitHub provider. | FR-001; interview Q4. |
| Email provider | Resend for confirmations, updates, reminders, and available owner/customer message delivery. | FR-047–FR-050; Q11–Q12, Q37, Q56. |
| WhatsApp provider | Meta WhatsApp Cloud API, test environment with verified recipients only; actual booking templates must be proved. | FR-026, FR-047, FR-061; Q11, Q30, Q58. |
| Subdomain hosting | Vercel wildcard-domain routing in v1; shop resolved from hostname; custom domains excluded. | FR-006–FR-008; Q36. |
| Scheduled caller | cron-job.org, named in the original workflow and retained by the approved PRD; ten-minute reminder/retry cadence. | FR-053; Brief, Q35. |
| Job authorization | Verify a secret header before protected processing. Exact header name/secret lifecycle are unconfirmed. | FR-053; NFR-003. |
| Time semantics | UTC appointment instants; IANA shop zone for local schedules/display; actual elapsed durations, notice, cutoff, and reminders. Horizon uses local calendar dates. | BR-010–BR-011, BR-025–BR-026; NFR-011. |
| Authoritative validation | Server-side rules and database-level appointment conflict protection. | FR-022, FR-029; NFR-004–NFR-005. |
| Delivery contract | Best effort, three total attempts per notification/channel as qualified in the PRD, truthful outcomes, no ordering/exactly-once promise. Manual-resend counting is unresolved. | FR-054–FR-056; BR-040–BR-041; OTQ-018. |

### 2.2 Proposed but unconfirmed implementation choices

Next.js App Router/TypeScript, shadcn/ui/Tailwind, Neon Postgres/RLS, Better Auth, React Hook Form/Zod, FullCalendar or a custom week grid, React Email, and plain server fetch rather than a WhatsApp SDK appeared in the initial proposed stack. They are not promoted into selected versions, packages, schemas, or APIs here. In particular:

- Google OAuth does not establish Better Auth as the approved session implementation.
- Database overlap protection does not select Neon, an ORM, a PostgreSQL exclusion expression, or an RLS policy.
- Day/week filtering does not select a calendar package or custom rendering algorithm.
- Named providers do not establish an API version, webhook protocol, template schema, credential layout, or sender identity.
- Vercel hosting does not select a separate app per host, a particular runtime, or a deployment tier.

**Traceability:** PRD Section 10 and OQ-016; OTQ-001–OTQ-006, OTQ-011–OTQ-014, OTQ-017.

## 3. Architecture and module boundaries

These are responsibility boundaries implied by the requirements, not approved file/module names or separately deployed services.

| Logical responsibility | Required inputs/authority and outcome | PRD traceability |
| --- | --- | --- |
| Host/namespace resolution | Establish the intended shop from a valid shop host; distinguish system names; unknown/invalid shop host returns clean 404. Resolution alone grants no owner authority. | FR-004–FR-008; BR-048; NFR-001. |
| Owner identity and shop authorization | Authenticate Google principal and establish its own-shop association for each owner operation. Public payloads cannot designate themselves as owner operations. | FR-001–FR-004; BR-001; NFR-001. |
| Shop/catalog/profile management | Manage publication, permanent subdomain, time-zone lock, services, barber profiles/eligibility, and historical archival guards. | FR-005–FR-017; BR-003–BR-005, BR-019–BR-024, BR-047. |
| Availability evaluation | Resolve applicable shop/barber schedules, restrictions, and dated replacements; derive valid starts using correct zone/elapsed semantics and caller rules. | FR-018–FR-023; BR-004, BR-006–BR-016, BR-022–BR-026. |
| Appointment mutation | Validate current actor/state, reserve valid intervals, preserve snapshots, and make rescheduling lossless on failure. | FR-028–FR-037, FR-042–FR-044; BR-018–BR-021, BR-030–BR-032; NFR-005–NFR-006. |
| Booking capability | Authorize one booking, compute current validity, retain ordinary link identity, and revoke/replace on contact correction. | FR-039–FR-046; BR-027–BR-029; NFR-002. |
| Owner/customer presentation | Display required calendars/details, explicit forms, QR/link, demo/zone/cutoff/delivery disclosures, and lightweight activity. | FR-011, FR-024, FR-028–FR-032, FR-038, FR-046, FR-062; NFR-012, NFR-014. |
| Notification eligibility/submission/evidence | Determine channels/events, obey budget/consent/test scope, suppress obsolete work, record actual outcomes, and never undo committed booking state. | FR-047–FR-061; BR-034–BR-044, BR-049; NFR-006–NFR-008, NFR-010, NFR-015. |
| Scheduled processing | Authorize the ten-minute caller, claim due work, apply current-state checks/retry bounds, and handle operational failures under a selected recovery policy. | FR-053–FR-056; BR-039–BR-041; NFR-003. |
| Public abuse controls and cleanup | Enforce public bot/rate rules and global budget; delete eligible historical records/logs without erasing configuration/future bookings. | FR-058–FR-064; BR-043–BR-046; NFR-009–NFR-010, NFR-013. |

The trusted appointment validation/persistence boundary must enforce rules that a browser can bypass. The database must provide the established appointment-overlap backstop. External provider success cannot be a prerequisite for maintaining a committed appointment. These boundaries do not select a controller/service/repository pattern, Server Actions, message broker, or outbox.

The notification work representation, provider dispatch timing, and coordination between writes and background processing are implementation blockers in OTQ-009–OTQ-010. Adding complex messaging infrastructure is outside the accepted v1 scope.

## 4. Data models, relationships, and invariants

### 4.1 Logical information model

The implementation must represent the following facts somewhere. This is not SQL DDL, an ORM schema, a table-per-row decision, or an API DTO. Identifier types, column names, nullability syntax, indexes, precision, and storage encodings are unconfirmed.

| Concept | Established information and relationships | Invariants / traceability |
| --- | --- | --- |
| Owner principal | Google-authenticated principal and its shop association; an owner has no shop before creation and at most one afterward. | A shop has one owner; other owners cannot access it. No staff identities. FR-001–FR-004; BR-001. |
| Shop | Identity, owner association, unique permanent subdomain, name, address, public contact method, IANA zone, publication condition, recurring availability, and enduring evidence that a first appointment has occurred. | Zone-lock evidence survives booking deletion; publication requires the accepted minimum. FR-005–FR-012; BR-024, BR-047–BR-048. |
| Service | Offering identity, shop association, current name, whole-minute duration, non-negative USD price, and offered/hidden/history-bearing condition. | Shared values across eligible barbers; duration ≥30; price has at most two decimal places. FR-013, FR-016–FR-017; BR-003–BR-005. |
| Barber profile | Shop association, identifying display name, active/archive condition, recurring availability, and eligible-service relationships. | No login; many eligible services/barbers can be related within one shop. Future confirmed affected bookings guard retirement/assignment removal. FR-014–FR-015; BR-001, BR-021. |
| Recurring/date-specific availability | Shop/barber scope, weekly or dated applicability, working intervals, breaks, days off/closures, and dated schedule replacement. | Date overrides replace recurring date schedules; all applicable restrictions/shop limits hold. Physical normalized records versus another representation is unconfirmed. FR-018–FR-021; BR-009, BR-022–BR-023. |
| Time block | Affected scheduling scope and occupied/unavailable interval. | Same-barber managed intervals cannot overlap in ways forbidden by BR-015; scope/resolution details remain product-dependent. FR-019, FR-021. |
| Appointment | Shop, one barber, one service, UTC start/end, saved service name/price/duration, customer name/contact, WhatsApp consent, and logical booking state. | No customer account is required. Current/saved values cannot be confused. FR-025, FR-028, FR-033–FR-037; BR-002, BR-017–BR-020, BR-031–BR-033. |
| Manage capability | One-booking authority, current link identity/validity, revocation condition, and expiry derived from current/retained scheduled end. | Ordinary changes retain identity; contact corrections replace it. Opaque versus signed representation is unconfirmed. FR-039, FR-041–FR-046; BR-027–BR-029. |
| Notification work and attempt evidence | Relationship to the affected booking/event/channel/recipient authority, reminder eligibility/schedule context, actual attempts, provider evidence, failure/skip reasons, and retry/suppression eligibility. | These are information needs for truthful processing, not mandated column names, revision counters, payload storage, or a queue schema. FR-047–FR-061; BR-034–BR-044. |
| Activity | Accepted booking/owner/contact/attendance changes and associated message status. | General settings audit coverage remains OQ-012. Historical associated activity is deleted at the booking retention deadline. FR-038–FR-039, FR-064. |
| Rate/budget accounting | Logical IP/email-shop/manage-link hourly counters and a demo-wide daily provider-attempt limit. | Distributed/concurrent enforcement must respect hard limits. Storage, normalization, window/reset policy, and reservation accounting are unconfirmed. FR-063; BR-043–BR-045; NFR-009–NFR-010. |

Customer contact may be embedded with a booking or represented differently; a separate customer-profile table is not approved. An availability result is not an approved persisted slot/hold entity. No pending booking, payment, staff membership, invitation, or subscription model is introduced.

### 4.2 Exact logical value constraints

- Service duration is an integer count of minutes ≥30. The reserved end is the start plus that many actual elapsed minutes, using the relevant saved or newly selected service duration.
- USD price is non-negative and supports at most two decimal places, including zero. Catalog storage is selected as exact PostgreSQL `numeric` in the Phase 02 contract below; representations for other money-bearing data remain open. No representation may round a disallowed amount into acceptance.
- Booking states are the product labels confirmed, cancelled, completed, and no-show. Their SQL/API spellings and enum implementation are unconfirmed. “Past, unmarked” is a derived display condition, not a fifth persisted attendance state.
- Appointment start/end are UTC instants. Local calendar dates, local clock labels, and an IANA identifier have distinct meanings; a local time alone cannot identify a repeated DST instant.
- Service eligibility and every referenced barber/service/booking must belong to the authorized/resolved shop. A request cannot escape shop scope by combining foreign-shop identifiers.

**Phase 02 storage and write contract (approved 2026-10-22):** Catalog services use unconstrained PostgreSQL `numeric` price and duration columns with checks for finite nonnegative prices at scale ≤2 and finite integer durations ≥30. Barber profiles and services are shop-scoped; `barber_services` uses composite same-shop foreign keys. Catalog IDs are UUID values stored as text. Owner writes lock the owner's shop row before checking current resources and replace only relationships to active counterpart records in one transaction. Hiding is reversible; archival retains the record and relationship rows and exposes no restore/hard-delete operation. This resolves physical catalog choices only; availability, appointments, and other OTQ-003 areas remain open.

**Traceability:** FR-004, FR-013–FR-014, FR-023, FR-036; BR-002–BR-005, BR-025–BR-026, BR-031; NFR-001, NFR-004, NFR-011.

### 4.3 Reservation and historical integrity

Represent an occupied interval mathematically as [start, end). Two positive-duration intervals overlap exactly when:

~~~text
overlap(A, B) = A.start < B.end AND B.start < A.end
~~~

This predicate preserves the confirmed end-to-start adjacency rule; it does not select a database range type or SQL expression. Same-barber protected appointment intervals cannot overlap. Different barbers may overlap. Cancelled reservations release their slot; otherwise restoring into a rebooked interval could not be rejected as required. Do not silently discard historical non-cancelled interval conflicts when accepting an ongoing owner entry that starts in the past.

Database protection must survive competing writes. The exact database occupancy representation, state predicate, treatment of time blocks, and coordination with settings are unconfirmed in OTQ-003–OTQ-004. Availability restrictions cannot be enforced solely by an earlier UI slot query.

History-bearing profiles/services must be archived rather than deleted, and catalog edits must not rewrite saved booking details. Cleanup deletes the booking and associated activity/message logs at its retention deadline, without deleting shop configuration or unlocking its time zone. Link/retention day arithmetic is unresolved; do not assume seconds-per-day outside the rules explicitly defined as elapsed intervals.

**Traceability:** FR-015–FR-017, FR-029, FR-033, FR-035, FR-044, FR-064; BR-015–BR-024, BR-028, BR-046; NFR-005–NFR-006, NFR-013.

## 5. Authentication, authorization, and access control

### 5.1 Authority establishment

| Caller | Authority required | Permitted scope / restrictions |
| --- | --- | --- |
| Unauthenticated visitor | Valid resolved shop and public-operation preconditions. | Read public shop/services/eligible slots and create otherwise valid bookings for a published shop. No owner calendar/customer-list access. |
| Owner | Valid Google-authenticated principal plus own-shop association. | Own shop's accepted configuration/calendar/booking/contact/attendance operations. Owner exceptions apply only after authorization, never from a submitted actor flag. |
| Manage-link holder | Current valid capability bound to one booking and the resolved shop context. | That booking's view and confirmed/cutoff-eligible changes only. No other appointments, owner functions, contact-recovery lookup, or extra account/code check. |
| Job caller | Valid secret-header authorization. | Authorized notification processing across relevant bookings, with each item kept within its correct shop/context. This is not public or owner-admin authority. |
| Provider outcome source | Evidence attributable to the actual provider/attempt under an unconfirmed verification/correlation mechanism. | Update only the appropriate delivery evidence, not arbitrary booking state or permission. |

**Traceability:** FR-001–FR-004, FR-027, FR-041–FR-043, FR-053, FR-056, FR-062; BR-027–BR-029, BR-047–BR-048; NFR-001–NFR-004, NFR-007.

The app host cannot itself identify an owner's shop slug; the authenticated owner-to-shop relationship must be established independently. A host, customer email, request-supplied shop identifier, or request-supplied owner flag is not ownership proof. This follows the independent-authorization rule without choosing middleware or a query/context implementation.

### 5.2 Capability lifetime and revocation

- Reading/opening a link never mutates the booking. Customer cancellation is explicitly POST with confirmation.
- Ordinary rescheduling, cancellation, and restoration retain the link, but its validity tracks current scheduled end; cancellation uses retained scheduled end.
- Contact correction revokes previous links and issues a new one. Phone changes also clear consent; fresh-consent capture is not specified.
- Cancelled/past valid-link views remain read-only. A live confirmed booking still needs the original-start cutoff for mutation.
- Expiry is seven days after the relevant end, not seven days after resend/contact edit. The calculation of “days” remains PI-005/OTQ-014.
- The implementation must not let a static original-end expiry contradict a later reschedule's current-end lifetime. Signed and opaque alternatives require different ways to preserve current-state validity/revocation; neither is selected.

Remaining manage-link wire/cryptographic parameters and database-security details follow the selected mechanisms and open questions in [ARCHITECTURE.md](ARCHITECTURE.md#8-manage-link-protection). Owner database sessions, host-only cookies, owner-host OAuth callbacks, and owner host/origin checks are selected in [architecture deployment](ARCHITECTURE.md#2-system-and-deployment) and the approved Phase 01 plan; hosted forwarding/callback/cookie verification is still pending. Secure one-booking authorization, revocation, scope, and read safety remain required outcomes.

**Traceability:** FR-039–FR-046; BR-027–BR-029, BR-033; NFR-001–NFR-002; OTQ-002, OTQ-005–OTQ-006.

## 6. Feature-by-feature technical specifications

### 6.1 Shop creation, publication, sharing, and immutable settings

Create the owner's one shop only after owner authorization. Enforce subdomain uniqueness/reserved names at authoritative creation, not only the initial availability check. Show the permanence warning; no rename/redirect flow exists. Invalid/unknown shop hosts return clean 404; reserved system names cannot become shops. The approved Phase 01 slug and basic shop-text rules are recorded under [PRD OQ-008](PRD.md#11-open-questions-and-unresolved-decisions). Configured marketing/owner host and origin validation follow [ARCHITECTURE §2](ARCHITECTURE.md#2-system-and-deployment). Public shop routing and hosted forwarding verification remain future work; storing a slug does not implement shop-host resolution.

Publication requires the agreed minimum fields and an active service/barber pairing with usable hours. A new incomplete shop is unpublished. Owner unpublication prevents new public creation but preserves existing bookings, manage-link operation, and scheduled notifications. Provide the canonical shop booking address and QR code without selecting a QR library or route layout.

Changing the IANA zone is permitted only before the first successfully created appointment. First creation and the enduring lock must remain consistent under races; cleanup cannot unlock the zone. No post-booking migration is permitted.

An address edit targets future confirmed bookings for customer updates, without rollback on delivery failure. Name/contact-only shop edits update displayed current details without broadcasting. The owner recipient/template copy and exact readiness predicate are unresolved.

**Traceability:** FR-005–FR-012, FR-050; BR-024, BR-036, BR-047–BR-048; NFR-001, NFR-012; PI-002, PI-011, PI-013.

### 6.2 Catalog and barber lifecycle

Create/edit shared service values and eligibility under owner authority. Validate the duration/price rules. Public new booking uses offered services and eligible active barbers. Catalog edits/hiding do not rewrite existing service snapshots. Same-service rescheduling retains saved details; a different offered service uses current details shown before confirmation.

An existing booking can retain its original hidden service during rescheduling/restoration when the selected barber remains active/eligible and the interval remains valid. This exception does not establish permission for a new owner-created hidden-service appointment.

Barber archival or eligibility removal with affected future confirmed bookings is rejected with explicit resolution needs. Move/cancel the affected bookings first; do not silently remove their resource or cancel them. Archive history-bearing records. Multi-service booking, per-barber service values, staff identities, and automatic assignment are excluded. Eligibility is explicitly selected; selecting every active barber is not prohibited.

Stale price/duration/eligibility during checkout, terminology after several service changes, and validation bounds remain unresolved.

**Traceability:** FR-013–FR-017, FR-024, FR-043; BR-001–BR-005, BR-019–BR-021; PI-001, PI-002, PI-007, PI-013–PI-014.

### 6.3 Availability semantics and established predicates

The following are logical predicates, not approved source-code function names or a selected time library:

~~~text
N = authoritative server decision-time UTC instant
Z = shop's fixed IANA time zone
S = candidate start UTC instant
d = applicable whole-minute service duration
E = S plus d actual elapsed minutes
D = local calendar date of N in Z
C = local calendar date of S in Z

PublicWindow(S, N, Z):
    S - N >= 1 actual hour
    AND D <= C <= calendar_date_add(D, 30)

CustomerMayChange(existing, N, capability):
    capability is currently valid for this booking/shop
    AND existing.state is confirmed
    AND existing.start - N >= 12 actual hours

NewReminderEligible(S, N):
    S - N > 24 actual hours

ReminderDueInstant(S):
    S minus 24 actual hours
~~~

The inequalities for one hour, twelve hours, and greater-than twenty-four hours are confirmed. The date addition is local-calendar arithmetic; it must not become an elapsed 720-hour interval. Appointment duration remains actual elapsed time.

For a public start, also require the established fixed 15-minute grid, active/eligible pairing, the full-interval availability restriction, same-day/no-overnight rule, and no protected overlap. For owner entry, use exact whole-minute starts and the future/ongoing creation rule; public notice/horizon do not apply. Owners still satisfy full availability and conflict rules.

Effective availability must respect the applicable date schedule: individual recurring hours initially copy shop hours; shop/barber dated overrides replace recurring schedules for the date; breaks, days off, closures, and blocks still restrict booking as required. Shop limits constrain barbers and closures affect everyone. Proposed config edits cannot invalidate affected existing appointments.

DST handling must enumerate distinct valid instants for repeated local slot labels and no instants for nonexistent labels. Display the offset for repeated times. A local-time string without an offset/instant distinction cannot select which occurrence is being booked. Exact time-library APIs, grid anchor, boundary conversion for working intervals, midnight equality, and conflicting restriction edits remain OTQ-007 and PI-003–PI-004.

**Traceability:** FR-018–FR-023, FR-033–FR-034, FR-042–FR-044, FR-051; BR-004, BR-006–BR-016, BR-022–BR-026, BR-037; NFR-004–NFR-005, NFR-011.

### 6.4 Public booking and confirmation

Require a published resolved shop, an explicit service/barber selection, current valid offered start, customer name/email, phone when opting into WhatsApp, bot protection, and rate-limit eligibility. Validate email format but do not verify ownership or identify a unique customer account. Repeated email is permitted within limits.

Commit a valid booking as confirmed with its saved service details. The confirmation result contains the booking information and usable manage link immediately; it must not depend on successfully sending email/WhatsApp. Disclose when the selected start is inside the twelve-hour change window. Budget exhaustion does not block creation: return the same confirmed booking/link and disclose email unavailability, with a recorded skip.

If an interval is taken after the availability query, fail the reservation with the friendly choose-another-time behavior. No pending approval or temporary customer hold is established. Repeated submission after a lost response is unresolved; do not invent idempotency keys, duplicate recovery, or lookup by email.

**Traceability:** FR-024–FR-030, FR-057–FR-059, FR-062–FR-063; BR-002, BR-006, BR-010–BR-011, BR-017, BR-033–BR-034, BR-042–BR-045; NFR-004–NFR-005, NFR-012, NFR-014; PI-015.

### 6.5 Customer cancellation and rescheduling

Use current valid one-booking capability and current authoritative state. Cancellation is POST plus explicit confirmation. At exactly twelve hours before the original start allow changes; below it deny customer changes and show current shop contact details.

For replacement, check eligibility against the existing booking and public window/slot constraints against the proposed replacement. Service, barber, and time may all change. Same-service replacement retains the saved service details; changed service uses current offered details presented before confirmation. Apply the original-hidden-service exception only within its confirmed scope.

Accept the replacement only as one valid mutation of the authoritative booking. Failed validation/reservation leaves the original intact. A customer may move to a valid two-hour-away appointment and immediately lose self-service changes; show that before final confirmation.

Owner-created exceptions do not make a guest request an owner request. A customer replacement still follows public notice/horizon/grid constraints, even when the existing appointment was manually created outside them. Existing link operation survives shop unpublication; do not equate preserving an existing booking with creating a new public booking.

Normal changes keep the link; state/end govern its current view/mutation/expiry rules. Stale-client conflict handling and request replay remain unconfirmed.

**Traceability:** FR-010, FR-030, FR-041–FR-046; BR-006, BR-010–BR-014, BR-018–BR-020, BR-027–BR-029, BR-047; NFR-002, NFR-006; PI-001, PI-014–PI-015.

### 6.6 Owner appointments, attendance, and recovery

The owner calendar opens today in the shop's zone with all barbers, explicit names, day/week views, and a dropdown filter. Mutations use explicit forms, without drag/resize. Display recorded customer information and relevant service/barber/time; the activity view covers upcoming bookings, recent accepted changes, and message status.

Manual walk-in/phone creation requires name but may lack email/phone. Exact whole-minute future/ongoing entries are supported; fully ended creation is excluded. Public notice/horizon and customer cutoff are not owner gates. Full availability, no-overnight, service duration, and conflict protection still apply. Missing channels cannot be reported as successful notification.

Restore only a future cancelled booking at its retained original valid interval with active/eligible barber, permitted original service, and no conflict. Do not move another booking or select a different restore time. The meaning of “original” after multiple prior changes is flagged in PI-014 rather than defining a new history reconstruction rule.

Attendance is explicitly marked after end. Confirmed past unmarked bookings remain unclassified; owner corrections between completed/no-show are recorded, send no customer messages, and do not reactivate booking capacity.

Owner contact corrections revoke old links and issue a new one; phone changes clear consent. Owner resending is protected and budget-bound. Name-only correction scope, immediate-send behavior, late-state permissions, and fresh-consent capture are unresolved. Public recovery lookup is excluded.

**Traceability:** FR-031–FR-040; BR-007–BR-009, BR-014–BR-016, BR-028, BR-030–BR-033, BR-035; NFR-001–NFR-002, NFR-012; PI-006, PI-009, PI-014.

### 6.6.1 Owner calendar interaction contract

Approved on 2026-10-14; extends FR-031–FR-033 and AC-012–AC-013. Canonical path/status decisions are maintained in [APP_ROUTES.md](APP_ROUTES.md#2-page-inventory); customer paths remain proposed. Sign-in/setup paths were subsequently selected in the approved Phase 01 plan.

- **Entry and hierarchy:** After Google sign-in, an owner with a shop lands on today's own-shop calendar, all barbers selected, even if the shop is unpublished. An authenticated owner without a shop enters setup. The calendar is the main focus, with Calendar, Services, Barbers, Availability, Activity, and Settings navigation. Screenshot counters, bell, profile actions, and detailed styling remain deferred.
- **Calendar entry points:** Appointment clicks open details in a responsive shadcn Dialog. Empty-slot clicks and New appointment open the creation Dialog. Slot clicks prefill the displayed shop-zone date/time and the individually filtered barber; in all-barber view, require explicit barber selection. Prefills are editable inputs, not authority or proof of availability. Server validation still determines whether the complete reservation is allowed.
- **URL and history:** Opening either Dialog pushes its canonical appointment URL while retaining the calendar underneath, including date, view, filter, and scroll. Back closes and Forward reopens it. Closing via the UI returns to the retained calendar through the same history relationship. Direct visits and full refreshes render standalone pages instead, with a calendar link; no calendar-context restoration across a full refresh is promised. Navigation away clears the Dialog.
- **Dismissal and dirty forms:** Close button, Escape, outside click, and browser Back require explicit discard confirmation when unsaved changes exist. Choosing to keep changes preserves form/input, the Dialog, and its URL; choosing discard completes dismissal and restores calendar context. Clean forms dismiss without a prompt. Browser-history guarding requires dedicated implementation and browser verification, beyond native intercepted-route behavior. This custom prompt requirement covers these in-app/Dialog dismissals, not a guaranteed custom browser unload/refresh prompt.
- **Save outcomes:** Successful creation closes the Dialog and refreshes the calendar. Standalone creation also returns to the refreshed calendar. Successful detail edits retain the Dialog or standalone page with updated data, and the underlying calendar reflects committed changes. Clear the saved form's dirty state. Validation or reservation-conflict failures keep the form and entered values visible, with actionable feedback. No client-side save may bypass lifecycle, availability, overlap, or authorization rules.
- **Responsive and keyboard behavior:** Use the same Dialog/history contract on phones, allowing full-screen sizing as needed. Verify accessible naming, focus entry/containment, keyboard dismissal, and focus restoration to the triggering calendar control where it remains available. Standalone pages provide equivalent authorized operations without requiring a modal background.

The selected implementation mechanism is in [ARCHITECTURE §2.1](ARCHITECTURE.md#21-owner-appointment-navigation). Presentation approval does not select a calendar library, finalize broader accessibility targets, or resolve other lifecycle/product questions.

### 6.7 Historical cleanup

Automatically delete eligible demo bookings and their associated activity/message logs thirty days after scheduled end, including unmarked records. Cancellation retains scheduled end; do not substitute cancellation time, resend time, or last-edit time as the confirmed retention anchor.

Preserve future appointments and shop configuration, including permanent first-booking time-zone locking and historical profile archival semantics. Do not perform full resets. No cleanup cadence, elapsed-versus-calendar day policy, schema cascade, or late-provider-event reconciliation has been selected.

**Traceability:** FR-012, FR-016, FR-064; BR-024, BR-028, BR-046; NFR-013; PI-005.

## 7. API contracts, Server Actions, and data flows

### 7.1 Established logical operation contracts

The names below describe operations, not selected URLs, exported functions, DTO properties, HTTP status enums, or Server Actions. Only customer cancellation's POST method and clean 404 behavior for invalid/unknown shop hosts are established. Framework-native actions versus route handlers remains OTQ-013.

| Operation | Required meaning of inputs/authority | Required result and failure semantics | Traceability |
| --- | --- | --- | --- |
| Public shop/catalog/availability read | Valid resolved shop; selected service/barber/date context for slot query. | Correct shop details/offerings/eligible starts with zone and repeated-time distinction; clean 404 for invalid/unknown shop host. No global owner/customer-list authority. | FR-007, FR-022–FR-024; NFR-001, NFR-011. |
| Public create | Resolved published shop; selected service/barber/start; name/email; conditional phone/consent; bot/rate eligibility. | Confirmed booking/saved details/manage link; quota/delivery failure reported separately. Slot conflict rejects creation. | FR-025–FR-030, FR-058–FR-059, FR-063. |
| Link view | Valid current booking capability and correct shop scope. | Only linked current details and permissible view/change condition. Read access is non-mutating; invalid/expired authority denied. | FR-041, FR-045–FR-046; NFR-002. |
| Customer cancel | POST, explicit confirmation, valid capability, current confirmed state and original-start cutoff. | Cancelled state, retained scheduled interval/link, available-channel update, owner alert for customer action. Messaging failure cannot roll back. | FR-042, FR-048–FR-049, FR-057. |
| Customer replace | Valid capability; old-booking cutoff; proposed service/barber/start passing public constraints; explicit confirmation. | One committed replacement with correct snapshot policy and stable link, or unchanged original. | FR-043–FR-044; BR-018–BR-020. |
| Owner calendar/details | Google principal and own-shop authorization; selected day/week/barber filter. | Own-shop appointments/current recorded details; no cross-owner access. | FR-031–FR-032; NFR-001. |
| Owner appointment/configuration mutation | Authorized own shop; relevant input/action; current booking/configuration and actor-specific gates. | Accepted owner operation respecting availability/conflicts/history guards; no self-alert; failure leaves protected booking state consistent. | FR-005–FR-021, FR-033–FR-037; BR-014–BR-016, BR-021–BR-024. |
| Owner contact correction/resend | Own-shop appointment authority; corrected data or explicit resend request. | Revocation/new link and cleared phone consent when applicable; resend follows budget; no public lookup. Auto-send/name-only rules unresolved. | FR-039–FR-040; BR-028, BR-033; PI-006, PI-009. |
| Protected job invocation | Verified secret header; caller cron-job.org on ten-minute cadence. | Only authorized claim/process work, with current state, retry and budget guards. Exact request/response protocol unspecified. | FR-053–FR-060; NFR-003, NFR-010. |
| Provider outcome ingestion | Attributable provider evidence correlated to the right attempted notification. | Accurate acceptance/delivery/failure evidence, not booking state reactivation or an invented success. Interface/mechanism unspecified. | FR-056; NFR-007–NFR-008; OTQ-012. |

No request field may independently prove owner authority, override stored service values without an accepted policy, change the shop context, or transfer a capability to a different booking. Exact payload validation/serialization and status mapping are unresolved, not implicit REST conventions.

### 7.2 Confirmed data-flow outcomes

1. **Create:** establish shop/caller → validate current rules → commit confirmed reservation/snapshot and first-booking lock consistently → expose confirmation/link → handle eligible delivery and its evidence without rollback. Notification work capture/dispatch mechanics remain unconfirmed.
2. **Replace:** establish current capability/owner authority → validate current state and old cutoff if customer → validate replacement → commit a valid replacement or retain original → preserve ordinary link identity → supersede obsolete unsent work and reconsider reminder eligibility.
3. **Contact correction:** authorize owner → change contact and revoke previous authority consistently → issue new link and clear phone consent → execute the separately confirmed resend capability when requested. Whether saving alone sends is unresolved.
4. **Address edit:** authorize owner → retain new address despite messaging failure → target future confirmed bookings for agreed updates → record outcome per applicable channel/budget.
5. **Reminder/retry:** authorize job → identify/claim due eligible work → reapply current state/consent/test/budget/attempt eligibility → perform permitted provider attempt → record actual outcome. Unknown dispatch/claim recovery policy is not chosen.

These are behavioral dependencies, not a new transaction/outbox implementation or mandated call order for independent validation steps.

**Traceability:** FR-012, FR-028, FR-039–FR-044, FR-050–FR-060; BR-018–BR-019, BR-024, BR-028, BR-033, BR-036–BR-044; NFR-003–NFR-008.

## 8. Validation rules and error handling

### 8.1 Confirmed validation

| Area | Required checks | Undefined details |
| --- | --- | --- |
| Authority/scope | Current owner-to-shop or capability-to-booking/shop authorization; correct job secret for processing. | Session/capability/host verification mechanisms and wire error protocol. |
| Shop | Unique non-reserved permanent subdomain using the Phase 01 grammar/list in PRD OQ-008; required publication fields/pairing/hours; valid IANA zone and permanent post-first-booking lock. | Additional address/contact rules, detailed readiness, future system/shop-host handling. |
| Service/contact | Duration integer ≥30; non-negative USD ≤two decimals; name/email required public; name required manual; phone for WhatsApp consent; email format without identity verification. | Upper bounds, field lengths/normalization/uniqueness, phone/address country rules, exact decimal input grammar. |
| Appointment | Actor-specific notice/horizon/grid; actual full-duration availability; no-overnight; protected overlap; original cutoff and snapshot/hidden-service rules for replacement. | Grid anchor, DST boundary conversion, exact midnight and lifecycle equality policies, stale quote strategy. |
| State/history | Current permitted state transition; future original-slot restore; post-end attendance; archive/eligibility/settings conflict guards. | Started/ended owner edits, “upcoming” guard predicate, “original” terminology after multiple changes. |
| Notification | Current channel/consent/test eligibility, due reminder context, attempts/budget/suppression, genuine provider evidence. | Provider-specific errors, unknown outcomes, retry timing, template/recipient configuration, manual resend attempt identity. |
| Abuse/privacy | Public limits/bot checks, global send cap, expiry/revocation, historical deletion anchor. | Window/reset/key rules, unspecified probe/resend thresholds, expiry/retention day arithmetic. |

**Traceability:** FR-006, FR-009, FR-012–FR-027, FR-033–FR-046, FR-051–FR-064; BR-004–BR-014, BR-018–BR-033, BR-037–BR-048; NFR-001–NFR-013.

### 8.2 Confirmed error/result meanings

- Slot lost/conflict: friendly selection of another time; no overlapping booking, no lost original on replacement.
- Customer inside cutoff: deny mutation and show current shop contact details; exactly twelve hours is allowed.
- Invalid/expired/revoked/wrong-scope capability: no unauthorized booking access or mutation; exact presentation is unconfirmed.
- Unknown/invalid shop host: clean 404. Reserved system host behavior beyond reservation is unresolved.
- Configuration/retirement conflict: reject the edit and surface affected appointments for explicit resolution.
- Provider failure/budget skip/unavailable channel: keep committed appointment/address change; report the actual failure/skip and manage link independently.
- API acceptance without delivery evidence: do not claim confirmed delivery. Unknown outcomes cannot be fabricated as success/failure beyond known evidence.
- Public rate/bot rejection: enforce the agreed server boundary. Exact status/body/retry guidance and attempt-accounting sequence are unconfirmed.

Only established messages/behaviors are binding. Do not invent HTTP 400/401/403/409/429 mappings, a common error envelope, endpoint naming, or provider-error classifications as approved contracts.

**Traceability:** FR-007, FR-021, FR-029–FR-030, FR-044, FR-046, FR-054–FR-060, FR-063; NFR-004–NFR-010, NFR-012.

## 9. State transitions, concurrency, and consistency

### 9.1 Confirmed booking transitions

| Existing logical state | Operation/actor | Established guard | Result / effects |
| --- | --- | --- | --- |
| No booking | Valid public or owner creation | Caller-specific creation rules, current eligibility/availability/conflicts. | confirmed; saved service details, manage authority, lock zone; agreed confirmation/channel work. |
| confirmed | Customer reschedule | Current capability; existing start ≥12 hours away; replacement public rules and correct snapshot policy. | confirmed with committed replacement or intact original on failure; stable ordinary link; customer/owner messages and revised reminder eligibility. |
| confirmed | Owner move | Own-shop authority, availability/conflicts and service policy; late-state rules unconfirmed. | Accepted replacement remains confirmed; customer update, owner activity rather than self-email. |
| confirmed | Customer cancellation | POST/confirmation; current capability; existing start ≥12 hours away. | cancelled; reservation released; retained schedule/link; customer update and owner alert. |
| confirmed | Owner cancellation | Own-shop authority; cutoff bypass; already-started/ended cases unresolved. | cancelled when permitted; customer update and owner activity; no self-alert. |
| cancelled | Owner restoration | Original retained future valid slot, active/eligible barber, no conflict, applicable original-service exception. | confirmed; preserve agreed booking details/link; update and reminder eligibility. |
| confirmed, past/unmarked | Owner attendance marking | After scheduled end; exact equality boundary unresolved. | completed or no-show; activity only, no customer notification. |
| completed / no-show | Owner attendance correction | After scheduled end; own-shop authority. | no-show / completed; recorded correction, no reactivation or customer message. |
| Existing booking | Owner contact correction | Own-shop authority; contact-correction definition unresolved. | Keep appointment state; revoke/issue capability; phone change clears consent. |

A cancelled/past customer view is read-only. Opening a link cannot trigger a state transition. No automatic completed/no-show inference exists. No pending state, attendance-triggered reactivation, fully historical creation, or new restore time is introduced. Unlisted transitions are not authorized by this table; needed late-state behavior is PI-014.

**Traceability:** FR-028, FR-034–FR-037, FR-039, FR-042–FR-046; BR-002, BR-018–BR-020, BR-027–BR-032.

### 9.2 Required concurrent-operation outcomes

These outcomes follow the approved invariants. They do not select isolation level, lock granularity, version fields, advisory locks, retries, or transaction API.

| Competing operations | Required safe outcome | Traceability |
| --- | --- | --- |
| Overlapping same-barber creates/replacements | They cannot both commit conflicting occupied intervals; rejected replacement keeps the current original intact. | FR-029, FR-044; BR-015–BR-018; NFR-005–NFR-006. |
| Simultaneous different-barber reservations | Do not impose an unintended shop-wide single-capacity conflict when both are otherwise valid. | BR-001, BR-016. |
| Booking versus hours/closure/block edit | Combined committed state must not accept a booking outside valid availability or silently invalidate a protected appointment. Revalidation/coordination must preserve both guards. | FR-021–FR-022; BR-009, BR-022; NFR-004. |
| Booking versus barber archival/eligibility removal | Do not commit a combination that strands a protected future confirmed booking with retired/ineligible resource. | FR-015; BR-021. |
| First booking versus time-zone edit | Accept a consistent zone before first booking or reject post-creation editing; never create in one zone and leave the shop migrated after first creation. | FR-012; BR-024–BR-025. |
| Restoration versus replacement booking | Do not displace/overlap the booking that now occupies the retained original interval. | FR-035; BR-015, BR-030. |
| Revocation/cancellation versus stale guest mutation | A stale client cannot restore cancelled authority/state or authorize a different booking by submitting old data. Current permitted state governs the authoritative write. | FR-039, FR-042–FR-046; NFR-001–NFR-002. |
| Two provider-send decisions with one daily unit remaining | Hard global count cannot permit two additional attempts; skipped work is truthful and reservations remain usable. | FR-058–FR-060; NFR-010. |
| Overlapping job invocations | Claim/current-state handling must not treat the same pending work as unrelated fresh initial sends; recovery/unknown outcomes remain best effort, not exactly-once. | FR-053–FR-055; BR-039–BR-041. |
| Delayed provider result versus later booking/contact change | Evidence belongs to the attempt actually made, not a newer schedule/contact. It must not fabricate new delivery or reactivate booking state. | FR-039, FR-055–FR-056; NFR-007–NFR-008. |

Database overlap protection alone does not establish the mechanism for settings/catalog races. Application-only availability checking before an unconstrained insert cannot satisfy database overlap protection. A reschedule cannot be implemented as a committed cancellation followed by a fallible replacement without preserving the agreed original-on-failure behavior.

The product response to simultaneous conflicting edits of the same booking, stale clients, repeated POST requests, or a lost success response is not completely defined. Optimistic rejection versus serialized acceptance/last-write policy and request replay identity remain OTQ-019/PI-015. Do not silently call best-effort messaging permission to weaken appointment consistency.

## 10. Security, privacy, and abuse prevention

The required security outcomes are independent owner/shop authorization, one-booking capabilities, no mutation on read, secret-authorized jobs, authoritative server/database rules, verified-recipient/consent WhatsApp restriction, public bot/rate controls, global send budget, and scheduled historical cleanup.

Public forms, identifiers, claimed actor flags, and email addresses are not authority. A successful routing match cannot authorize owner data. Cross-shop references must not grant access. Provider submission/recording must respect the trusted budget/eligibility boundary rather than letting a public caller directly designate itself a privileged sender.

Public availability exposes eligible starts, not permission to retrieve the owner calendar/customer list. A valid bearer link deliberately grants its holder the linked booking, including if forwarded. Contact changes revoke old authority, and expired/deleted booking access must not be reconstructed by public email lookup.

Fixed controls:

| Control | Confirmed limit/scope |
| --- | --- |
| Public create, IP | Five attempts per IP per hour. |
| Public create, email/shop | Three attempts per email per shop per hour. |
| Customer change, manage link | Ten attempts per manage link per hour. |
| Additional controls | Server-side bot protection; invalid-link IP protection; strict messaging endpoint limits. Threshold/window/key rules not established. |
| Outbound messaging | 100 provider-send attempts daily across the demo, including retries, owner alerts, and resends; no new-booking shutdown at exhaustion. |
| Booking/log retention | Thirty days after scheduled end; future/configuration preserved. Deadline arithmetic unconfirmed. |

Counter/key normalization, trusted IP extraction, rate storage, bot provider, secret/capability handling, origin/CSRF defenses, provider outcome authentication, log redaction, and deletion cascades are unconfirmed choices. This document does not select token hashing, cookie flags, an RLS implementation, or specific security middleware.

Explicit opt-in exists, but consent withdrawal/external opt-out handling was not defined; see PI-017. No new customer preference action is granted here. Data visible in provider accounts is distinct from application booking/log deletion; no provider-side retention guarantee or legal compliance claim was agreed.

**Traceability:** FR-001–FR-004, FR-026–FR-027, FR-039–FR-046, FR-053, FR-058–FR-064; BR-017, BR-027–BR-029, BR-033–BR-034, BR-043–BR-048; NFR-001–NFR-005, NFR-009–NFR-010, NFR-013.

## 11. External integrations and failure handling

### 11.1 Google and hosting dependencies

Google is the only owner provider. Vercel wildcard shop routing is required. Actual root-domain ownership/DNS, OAuth client/callback configuration, deployment/runtime, and namespace/session policies have not been verified or selected. Do not mistake the illustrative trimtime.com addresses for deployed assets.

**Traceability:** FR-001, FR-006–FR-008; BR-048; NFR-001; PRD OQ-002, OQ-016.

### 11.2 Email and WhatsApp eligibility

For customer event/reminder work, use email when recorded and additional WhatsApp when explicit consent, phone, and verified test-recipient scope permit. Manual bookings may have no channel; that is not delivery success. Non-test public visitors must clearly see WhatsApp unavailable.

Resend real delivery requires appropriate sender/account configuration, which is not claimed to exist. Meta sender/template/token capabilities likewise remain unverified. Exact API versions, URLs, SDK/fetch choice, template parameters, sender identity, test allowlist representation, quotas beyond the agreed app budget, and external protocol behavior are unconfirmed.

Success evidence for WhatsApp must cover actual booking confirmation, update, and reminder templates with real booking details/manage links and eligible recipients. A generic hello_world request, API acceptance alone, invented “delivered” result, or production onboarding is not a substitute. If test capabilities cannot support the goal, document the limitation and do not mark that portion complete.

**Traceability:** FR-025–FR-026, FR-033, FR-047–FR-048, FR-061; BR-033–BR-034, BR-049; NFR-007, NFR-015; OTQ-011.

### 11.3 Required outcome semantics

| Observation | Confirmed treatment |
| --- | --- |
| No permitted channel / test restriction / budget skip | Record accurate unavailability/skip reason; no provider send or delivered claim; no automatic next-day budget replay. |
| Actual provider attempt | Count it under the daily attempt cap, including failed attempts/retries; track result for the right notification/channel. |
| Provider accepts request | Record acceptance, not confirmed delivery. |
| Provider supplies attributable delivery evidence | Report the evidenced delivery for that attempt; do not attach it to a different booking revision/contact. |
| Transient failure | Eligible bounded retry, up to the agreed total, subject to current state, budget, and reminder future guard. |
| Permanent failure | Stop automatic retries immediately; keep committed business state and expose failure. |
| Unknown/delayed/in-flight result | Do not fabricate certainty. Treatment/reconciliation and timeout classification remain unresolved; duplicates/out-of-order delivery are acknowledged. |

These labels are logical observations, not selected database status enums or provider wire-event names. A failed channel does not by itself retry a successful other channel. Absence of delivery evidence does not establish a transient error; the approved error/timeout policy must decide what constitutes retryable failure.

**Traceability:** FR-054–FR-060; BR-040–BR-044; NFR-006–NFR-010; OTQ-010–OTQ-012, OTQ-018.

## 12. Background jobs, notifications, and scheduling

### 12.1 Event/channel matrix

| Confirmed event | Customer message behavior | Owner message behavior | Reminder effects |
| --- | --- | --- | --- |
| Customer creates | Confirmation through recorded email and eligible opted-in test WhatsApp. | Email owner. | New reminder only if start is >24 actual hours away. |
| Owner manually creates | Confirmation through available recorded channels; absent contact means no claimed send. | Activity, no self-email. | Same >24-hour eligibility; owner's booking-window exemption does not alter reminder time. |
| Customer reschedules | Updated details; same/new-service snapshot rule. | Email owner. | Suppress obsolete pending work; qualify replacement schedule when >24 hours away. |
| Owner moves/cancels/restores | Update through available channels; failures leave committed state. | Activity, no self-email. | Cancellation prevents due sends; movement/restoration applies agreed eligibility, current-state, and original-slot rules. |
| Customer cancels | Cancellation update through available channels. | Email owner. | No reminder while cancelled. |
| Shop address changes | Notify future confirmed bookings only. | No owner-action self-alert required. | Address edit is not an approved new appointment schedule; no automatic reminder-reset policy is invented. |
| Shop name/contact-only edit | Current details change; no mass notification. | No customer-action alert. | No new schedule/reminder policy established. |
| Attendance marking/correction | No message. | Recorded activity, no self-alert. | No reactivation; past reminders prohibited. |
| Owner contact correction | Whether save itself sends is unresolved; explicit resend capability exists. | No customer-action alert. | Clear phone consent, revoke old links, and suppress obsolete unsent work. Exact reminder identity implications remain unconfirmed. |
| Explicit owner resend | Protected confirmation/manage-link resend within budget. | No self-alert required. | Definition/reset of notification attempt identity is OTQ-018; no unapproved duplicate reminder reset. |

**Traceability:** FR-033, FR-035–FR-040, FR-047–FR-052, FR-055, FR-060; BR-028, BR-032–BR-038, BR-041, BR-044.

### 12.2 Reminder predicates

Eligibility is evaluated at creation/rescheduling/restoration: more than twenty-four actual hours remain. When eligible, the due instant is start minus twenty-four elapsed hours. At exactly twenty-four or less, only confirmation/update is newly generated.

Once a reminder was eligible, due processing does not require that more than twenty-four hours still remain; that would prevent the reminder from ever becoming due. Its current appointment must be confirmed and still future, due instant reached, and current schedule not already processed as required. A reminder due before a scheduler interruption may still be eligible while the unchanged appointment remains future; no extra lateness window was accepted.

Rescheduling supersedes pending old reminder work and can produce a new schedule reminder even after an earlier schedule was reminded. Budget-skipped work is terminal for automatic next-day replay; owner resending is separately budget-bound. Exact schedule/event identity, restoration identity, and channel-processing markers are implementation choices with PI-009/OTQ-009/OTQ-018 dependencies.

**Traceability:** FR-051–FR-055, FR-060; BR-037–BR-041, BR-044; AC-023–AC-026.

### 12.3 Protected job contract and processing envelope

cron-job.org invokes the protected job every ten minutes. Verify the secret header before claim/send work. Claim eligible due work; apply current confirmed/future/schedule, channel/consent/test, retry-bound, suppression, and budget checks before a permitted attempt. Never attempt a reminder at/after appointment start. Log the actual outcome; eligible transient failures can retry up to three total attempts per notification/channel, initial included.

No selected endpoint URL, HTTP method, header name, lease timeout, batch size, claim SQL, concurrency lock, dispatch duration, or retry-backoff sequence exists. Claim crash recovery, reservations of budget units, and unknown provider results must be settled before durable job execution can be implemented. A claim is not provider acceptance or confirmed delivery.

External sends must not roll back committed appointment/address state. A job cannot solve unknown outcomes by claiming exactly-once delivery or resending a successful channel just because another channel failed.

**Traceability:** FR-053–FR-060; BR-039–BR-044; NFR-003, NFR-006–NFR-010; OTQ-008–OTQ-012, OTQ-018.

### 12.4 Cleanup envelope

Cleanup uses scheduled end as the historical deadline anchor and deletes associated booking/activity/message records while retaining future appointments and configuration. The original requirement does not specify that cleanup shares the reminder endpoint, a separate job, or a daily cadence. No such architecture is selected.

Expired links cannot gain renewed authority simply because a confirmation is resent, and configuration must retain evidence of permanent zone locking after historical deletion. Late provider results must not be treated as permission to recreate deleted bookings or claim a newer delivery; the correlation/deletion mechanism remains OTQ-012/OTQ-014.

**Traceability:** FR-012, FR-045, FR-056, FR-064; BR-024, BR-028, BR-046; NFR-002, NFR-007, NFR-013.

## 13. Performance, reliability, and operational constraints

- The experience targets confirmation under one minute, with no account/email-code step and immediate on-screen link. A measurement protocol, device/network profile, sample size, latency percentile, and pass rate are not established.
- The ten-minute scheduled cadence is a processing requirement, not a promise that a reminder is delivered exactly at the due instant. Retries/provider delay/outage can occur.
- Appointment consistency and shared budget/rate correctness remain requirements under concurrent requests. Best-effort notifications do not relax them.
- A messaging outage or budget exhaustion must not become an appointment outage. Accepted bookings remain confirmed/manageable with truthful messaging disclosure.
- There is no selected cache TTL, query index set, worker batch size, region, hosting tier, connection pool, backup policy, deployment pipeline, or uptime/load SLO. If availability is cached, an implementation still must perform authoritative write-time validation.
- A per-process counter alone cannot establish a global limit when multiple instances serve requests. The shared enforcement mechanism must be selected and tested.
- API/account credentials, real domain/sender configuration, Google callback setup, and actual WhatsApp template capability are operational dependencies, not completed setup.
- No production readiness/business outcome claim follows from document generation or a generic provider test.

**Traceability:** FR-008, FR-028–FR-029, FR-053–FR-064; BR-018, BR-039–BR-049; NFR-004–NFR-015; PRD OQ-001–OQ-004, OQ-014–OQ-016.

## 14. Testing strategy and acceptance scenarios

### 14.1 Required verification levels

Vitest is used for unit and database integration tests; Playwright covers rendered journeys, and local database integration uses disposable PostgreSQL. Phase 00 verifies the harness only; feature-specific fixtures and acceptance evidence are added with each behavior. The following test levels follow the required behavior:

1. Controlled-clock/value tests for elapsed notice/cutoff/reminder equality, local date horizon, duration/price rules, DST distinction, and unresolved day arithmetic after decision.
2. Database/integration concurrency tests for same-barber conflicts, lossless replacement, restoration, first-booking zone lock, settings/catalog races, and shared budget/rate enforcement.
3. Authorization/routing tests for owner isolation, shared shop protection, invalid/system shop names, capability scope/revocation, and protected job authorization.
4. Customer/owner rendered journeys for required details/forms/filters/QR/disclosures and non-mutating link reads.
5. Actual provider tests with approved accounts/recipients for booking-template payloads, email/WhatsApp evidence, retry/failure/skip cases, and scheduled reminders. Simulated failures cannot alone prove real template support or delivery.
6. Retention tests ensuring linked logs disappear while future/configuration/zone-lock evidence survive, including handling delayed provider evidence under the selected policy.

**Traceability:** NFR-001–NFR-015; PRD AC-001–AC-030 and EC-001–EC-026.

### 14.2 Acceptance traceability

Each row specifies required verification behavior and preserves the corresponding PRD scenario, rather than inventing a testing library or implementation.

| PRD scenario | Technical verification and relevant edge cases | Requirements |
| --- | --- | --- |
| AC-001 | Google-only owner flow, one shop/multiple profiles, cross-owner denial, and shared-demo protection. | FR-001–FR-004, FR-014, FR-062; BR-001; NFR-001. |
| AC-002 | Authoritative unique/reserved slug checks, permanence warning, wildcard shop routing, clean unknown/invalid 404, independent authorization. | FR-005–FR-008; BR-048; NFR-001. |
| AC-003 | Readiness publication, link/QR generation, unpublication while existing token operations/notifications survive. EC-024. | FR-009–FR-011; BR-047. |
| AC-004 | First-create/zone-edit race and permanent lock after cancellation/cleanup. EC-024. | FR-012; BR-024. |
| AC-005 | Shared service eligibility/value checks, duration integer/minimum, zero/negative/excess-decimal prices. | FR-013–FR-014; BR-003–BR-005. |
| AC-006 | Weekly copy, breaks/days off/closures, dated replacement, shop limits, and rejected invalidating edits. EC-009–EC-010. | FR-018–FR-021; BR-009, BR-022–BR-023. |
| AC-007 | Grid with non-grid-multiple duration, complete interval fit, adjacency and no-overnight; resolve grid/midnight gaps first. EC-008. | FR-022; BR-004, BR-006, BR-008–BR-009, BR-016. |
| AC-008 | One-hour equality, local dates day 0/+30/+31, query/write/replacement consistency, DST date transitions. EC-006. | FR-022, FR-043; BR-010–BR-011, BR-025; NFR-004, NFR-011. |
| AC-009 | Repeated/nonexistent instants and actual elapsed service/reminder time; availability-boundary policy required. EC-007. | FR-023; BR-025–BR-026; NFR-011. |
| AC-010 | Explicit selection, name/email/conditional phone consent, format without ownership/OTP, repeated email within limits. | FR-024–FR-027; BR-002, BR-017, BR-033. |
| AC-011 | Immediate confirmed/link result, cutoff/delivery disclosures, same-barber concurrent prevention versus different-barber parallel success. EC-001–EC-002. | FR-028–FR-030; BR-015–BR-016; NFR-005, NFR-012. |
| AC-012 | Existing-shop versus no-shop landing; today/all-barber calendar, day/week filter and six navigation items; details Dialog versus standalone direct/refresh; URL/context/Back/Forward; dirty-form dismissal; updated edit state, keyboard/phone behavior, stale-slot cleanup, and own-shop authorization. See §14.3. | FR-031–FR-032, FR-038. |
| AC-013 | Exact-minute ongoing/manual entries, no ended creation, owner window exceptions but no availability exception, missing-channel honesty. EC-008, EC-021. Also verify both creation entry points, slot/barber prefills, standalone direct/refresh, successful return to calendar, and preserved input on failure (§14.3). | FR-033–FR-034; BR-007, BR-009, BR-014, BR-033–BR-034. |
| AC-014 | Config/archive/eligibility conflicts and races; explicit resolution without history deletion. EC-010, EC-013. | FR-015–FR-016, FR-021; BR-021–BR-022. |
| AC-015 | Snapshot preservation, same/different-service comparison, original hidden service exception; stale-quote policy required. EC-011–EC-012. | FR-016–FR-017, FR-043; BR-019–BR-020. |
| AC-016 | Future original-slot restore, rebooked conflict, inactive/ineligible rejection, no displacement, available-channel update. EC-014. | FR-035; BR-030. |
| AC-017 | Post-end manual attendance/corrections, past-unmarked condition, no message/reactivation; equality policy required. EC-023. | FR-036–FR-037; BR-031–BR-032. |
| AC-018 | Capability scope, safe reads, POST cancellation, twelve-hour equality versus denial/contact. EC-004, EC-015, EC-025. | FR-041–FR-042, FR-046; BR-012, BR-027, BR-029; NFR-002. |
| AC-019 | Service/barber/time replacement, valid two-hour target disclosure, race failure preserving original. EC-003, EC-005. | FR-043–FR-044; BR-013, BR-018; NFR-006. |
| AC-020 | Ordinary stable link/current expiry, cancelled/past views, correction revocation/phone consent clearing, protected owner resend/no lookup. EC-015–EC-016. | FR-039–FR-040, FR-045–FR-046; BR-028–BR-029, BR-033; NFR-002. |
| AC-021 | Independent customer email/test WhatsApp channels; customer-only owner alerts; absent/non-test channels and attendance exclusions. EC-021. | FR-026, FR-047–FR-049; BR-034–BR-035. |
| AC-022 | Address update targets future confirmed records, no rollback at failure/cap, no name/contact broadcast. EC-022. | FR-050, FR-057; BR-036, BR-042. |
| AC-023 | >24 versus =24/<24 mutation-time eligibility, revised schedule after prior reminder, obsolete suppression. EC-017–EC-018. | FR-051–FR-052, FR-055; BR-037–BR-038, BR-041. |
| AC-024 | Ten-minute protected caller; invalid secret no protected work; due/confirmed/current/unreminded/future checks and no start/past sends. EC-025. | FR-053; BR-039; NFR-003. |
| AC-025 | Three-attempt bound per channel, permanent stop, successful-other-channel independence, accepted versus delivery, unknown/out-of-order truth and no state rollback. EC-019. | FR-054–FR-057; BR-040–BR-042; NFR-006–NFR-008. |
| AC-026 | Shared cap including retries/alerts/resends, concurrent last-unit consumption, continued booking/link access and no next-day replay. EC-020. | FR-058–FR-060; BR-043–BR-044; NFR-010. |
| AC-027 | Server bot/rate rejection, normalized keys/window definitions, invalid-link and messaging-endpoint protection. | FR-027, FR-063; BR-045; NFR-009. |
| AC-028 | Historical booking/log cleanup including unmarked, future/configuration/zone lock retention; selected day/boundary semantics. EC-024. | FR-064; BR-024, BR-046; NFR-013. |
| AC-029 | Actual three WhatsApp booking-template paths to verified recipients; explicit incomplete limitation rather than generic/production substitute. EC-026. | FR-061; BR-049; NFR-015. |
| AC-030 | Measure customer speed only under defined protocol; do not invent conditions/targets or claim a tested result. | FR-024–FR-028; BR-017; NFR-014. |

All fixed scenarios remain mandatory. Open predicates/protocols must be resolved before claiming their boundary tests complete. Phase 00 harness checks do not verify product behavior; application/database feature behavior, routing, OAuth, provider delivery, cleanup, and performance still require phase-specific evidence.

### 14.3 Owner appointment navigation acceptance

These are future Playwright/browser scenarios, not checks completed by this documentation update. Verify desktop and phone presentations and explicit shop-scoped authorization:

1. Sign in with an existing published or unpublished shop and observe today's all-barber calendar; an owner without a shop enters setup. Exercise the six navigation destinations.
2. Open appointment details from the calendar and verify canonical URL plus retained calendar date/view/filter/scroll. Back closes and Forward reopens; no stale Dialog remains after navigating to another owner section.
3. Open creation through both New appointment and an empty slot. Verify selected date/time, individually filtered barber, explicit selection in all-barber view, and server revalidation of availability.
4. Directly visit and refresh each appointment route: render its standalone page without an unintended calendar overlay or unmatched-slot 404; verify its calendar link.
5. For both clean and dirty forms, exercise close button, Escape, outside click, and Back. Keeping changes retains input and URL; discarding restores calendar context. Verify subsequent Back/Forward history after accepting and declining discard, rather than assuming a routing primitive provides the guard.
6. Successful creation returns to a refreshed calendar from either presentation. Successful edits retain updated details and update the calendar underneath. Validation/conflict failures preserve form/input; committed appointment state follows existing transaction and notification rules.
7. Verify responsive/full-screen Dialog sizing, accessible naming, keyboard focus containment, and focus return. Neither standalone nor intercepted rendering exposes another owner's appointment or grants operation authority from an ID/hostname.

**Traceability:** PRD AC-012–AC-013; FR-031–FR-034, FR-038; NFR-001, NFR-004–NFR-006. Discard/history behavior needs real browser evidence before acceptance can be claimed.

## 15. Confirmed technical decisions and their rationale

| Confirmed decision | Rationale established by the interview | Traceability |
| --- | --- | --- |
| Google-only owner OAuth; guest/link customer authority | Keep owner login narrow and customer journey account/code-free; shop and booking permissions remain explicit. | FR-001–FR-004, FR-041; Q4, Q31–Q32. |
| Host-selected shop plus independent authorization | Preserve per-shop URLs without treating a host as permission. | FR-004, FR-007–FR-008; Q36. |
| Multiple barber calendars, no staff identities | Model simultaneous barber capacity while retaining owner-managed schedule responsibility. | BR-001, BR-016; Q1, Q5, Q10. |
| Authoritative server checks/database conflict backstop | Stale slot queries and competing requests cannot create double bookings. Exact mechanism remains unconfirmed. | NFR-004–NFR-005; Q15–Q17, Q20. |
| UTC instants/IANA display with local-date horizon | Preserve elapsed-time meaning and explicit DST identity while honoring the chosen calendar-date booking window. | BR-010–BR-011, BR-025–BR-026; Q43, Q47, Q55, Q59. |
| Snapshot preservation and intact original on failed replacement | Catalog edits and concurrent replacement failure must not rewrite the agreement or lose the original reservation. | BR-018–BR-020; Q21, Q24, Q41. |
| Stable ordinary capability with contact revocation | Old ordinary confirmations reach current details; corrected contact cannot keep previous authority. | BR-028; Q44, Q51. |
| Both providers with email always/optional test WhatsApp | Demonstrate both integrations without a WhatsApp-first fallback coordinator; preserve truthful demo restriction. | FR-047, FR-061; Q11–Q12, Q30, Q58. |
| Twenty-four elapsed-hour due time and ten-minute protected caller | Automate reminders with bounded cadence and avoid duplicate short-notice messages. | FR-051–FR-054; Q35, Q60. |
| Bounded retries and best effort | Handle transient failures without false delivery/ordering promises; manual resend identity remains unresolved. | FR-054–FR-056; Q35, Q53. |
| Global 100-attempt budget without booking shutdown | Bound outbound demo behavior while preserving confirmed bookings and usable manage links. | FR-058–FR-060; Q50, Q54. |
| Scheduled-end cleanup and enduring time-zone lock | Bound visitor-data/history retention while preserving future appointments and permanent settings constraints. | FR-012, FR-064; Q43, Q49. |

These confirmed decisions do not approve specific schema/types, framework versions, directory boundaries, middleware, Server Actions, provider wire protocols, or new deployment components. Earlier alternatives already rejected in the PRD remain rejected.

## 16. Open Technical Questions

### 16.1 Selection and implementation blockers

The following entries retain their original IDs. Later selections in ARCHITECTURE.md and APP_ROUTES.md narrow them only as explicitly recorded; the owner calendar interaction in §6.6.1 is now selected. Remaining alternatives are unconfirmed. No option is selected by its ordering. “Blocks” identifies the work that cannot be finalized, not a request for another interview.

| ID | Open choice, alternatives, and tradeoffs | Blocks / affected requirements |
| --- | --- | --- |
| OTQ-001 | ARCHITECTURE selects the core stack; package.json and the lockfile own installed versions. Remaining feature-specific form/calendar choices and package/provider fit require verification when those features are introduced; installed specimen dependencies do not establish product-feature acceptance. | Foundation/package contracts; PRD OQ-016; FR-001, FR-013, FR-031–FR-032. |
| OTQ-002 | ARCHITECTURE selects Better Auth database sessions, host-only owner cookies, independent operation authorization, and Proxy surface routing with shared host/origin validation. Hosted callback/forwarding/cookie behavior still requires deployment evidence; Proxy does not establish owner permission. | Auth integration; FR-001–FR-004; NFR-001; PRD OQ-016. |
| OTQ-003 | Remaining physical schema, UTC precision, availability representation, enum spelling, non-catalog money representation, archival/deletion relationships, and durable zone-lock evidence. Phase 02 selects text UUID identifiers, exact PostgreSQL `numeric` catalog values, and retained catalog assignments; normalized availability records versus another representation remain open. | Remaining migrations/storage interfaces; FR-005–FR-023, FR-028, FR-039, FR-064; BR-004–BR-005, BR-019, BR-024–BR-025; PRD OQ-008, OQ-016. |
| OTQ-004 | Database appointment guard and coordination of appointments, blocks, settings, and resource retirement. If the proposed PostgreSQL engine is adopted, an engine-supported interval constraint is an alternative; controlled database write routines/transaction coordination are another class requiring proof of the same backstop. Locking versus serializable/optimistic mechanisms change contention and retry handling. App-only query-then-insert is insufficient. | Safe writes/concurrency; FR-015, FR-021–FR-022, FR-029, FR-035, FR-044; NFR-004–NFR-006; PI-002, PI-015. |
| OTQ-005 | Capability representation, generation/storage/verification, URL placement, revocation, and dynamic expiry. Opaque server-backed tokens versus signed tokens with sufficient current-state/revocation handling have different lookup/key-management tradeoffs; pure fixed-original-expiry behavior cannot meet ordinary rescheduling lifetime. | Manage links; FR-039–FR-046; NFR-002; PRD OQ-009, OQ-016. |
| OTQ-006 | Actual root-domain/DNS, trusted hostname/IP inputs, application/system namespace, preview/local hosts, canonical link origin, and deployment/session host arrangement. Validate intended shop context without allowing forwarded/client input to grant ownership. System-name reservation does not define all system routes. | Hosted routing/OAuth/link scope; FR-004–FR-008, FR-011, FR-041; NFR-001; PRD OQ-002, OQ-008. |
| OTQ-007 | Time library/TZ-data source, authoritative decision-time precision, 15-minute grid anchor, and DST resolution of availability interval boundaries. Wall-clock-quarter versus interval-anchored candidate generation can differ for off-grid openings; handling zero/two boundary instants must be explicit. | Exact slot algorithm/boundary tests; FR-022–FR-023; BR-006, BR-008–BR-013, BR-025–BR-026; PI-004. |
| OTQ-008 | Shared rate/budget persistence and atomic enforcement; fixed versus rolling hour, key normalization, daily reset, trusted IP extraction, unspecified probe/messaging thresholds, and reservation/dispatch accounting. Database-backed versus another shared mechanism trades dependencies/latency; per-instance counters cannot establish global concurrent limits. | Public abuse controls/send gate; FR-058–FR-063; NFR-009–NFR-010; PRD OQ-003; PI-008. |
| OTQ-009 | Notification work capture/correlation and initial dispatch timing. Deriving pending work from booking/attempt evidence versus lightweight persisted intents has different recovery/suppression complexity. No queue/outbox/broker schema is selected; complex infrastructure remains excluded. Schedule/content/contact identities need a definition sufficient for suppression. | Reliable event delivery/retry planning; FR-047–FR-055; NFR-006–NFR-008; PI-009–PI-010. |
| OTQ-010 | Exact job URI/method/header, batch/claim/lease behavior, transient/permanent mapping, retry backoff, crash/unknown-result recovery, and execution bounds. Immediate repeated eligibility versus delayed retry policies alter timing; a claimed item is not delivery proof. | Durable ten-minute worker; FR-053–FR-056; NFR-003, NFR-007–NFR-008; PRD OQ-004; PI-010. |
| OTQ-011 | Provider accounts, Google setup, Resend verified sender, Meta sender/recipients/templates/credentials, API versions, payloads, and real capability tests. Sender identity/account arrangement is unconfirmed. No production WhatsApp expansion or generic template substitute is available by default. | Live integration completion; FR-001, FR-026, FR-047–FR-050, FR-061; NFR-015; PRD OQ-001–OQ-002, OQ-013. |
| OTQ-012 | Authenticated provider outcome collection/correlation and out-of-order/deletion handling. Provider-supported callbacks versus supported polling are alternatives only after capability verification; event authentication/deduplication and evidence-to-attempt binding are unconfirmed. Neither can invent delivered status. | Accurate message status/failure evidence; FR-039, FR-055–FR-056, FR-064; NFR-007–NFR-008, NFR-013; PRD OQ-004. |
| OTQ-013 | Remaining transport/runtime entry points, proposed page paths and technical endpoint routes, request/response types, error mapping, and read/write interfaces. Approved owner paths are listed in APP_ROUTES.md; ARCHITECTURE §2.1 selects intercepted/parallel routes for calendar-opened appointments. ARCHITECTURE selects Server Action adapters for feature operations; exact HTTP integration contracts and error mappings remain open. POST customer cancellation and clean unknown-shop 404 stay fixed; unselected verbs, paths, and statuses remain unconfirmed. | Final API/Server Action contracts; FR-024–FR-046, FR-053; BR-027; NFR-003–NFR-004; PRD OQ-016. |
| OTQ-014 | Link/retention day arithmetic, boundary equality, cleanup cadence/relationships, and late-message/log reconciliation. Elapsed-day versus local-calendar policies differ across DST; neither has been chosen outside the settled horizon/elapsed intervals. Resending cannot replace scheduled end with a new deadline anchor. | Expiry and cleanup implementation; FR-045–FR-046, FR-064; NFR-002, NFR-013; PRD OQ-009; PI-005. |
| OTQ-015 | Product-dependent field/readiness/stale-offer/contact/template/activity contracts. Retaining a validated quote versus reconfirming current values differs in agreement/conflict handling; auto-send versus explicit resend differs in contact-correction effects; public/owner hidden-service permissions cannot be invented. | Form/command completeness; FR-009, FR-013–FR-017, FR-025, FR-038–FR-040, FR-043, FR-049–FR-050; PI-001, PI-006–PI-007, PI-011–PI-013. |
| OTQ-016 | Exact allowed owner operations on started/ended/cancelled records, protected “upcoming” predicate, original-service/slot meaning after multiple changes, and schedule restriction edits/reopening. Broader current-interval protection versus future-start-only guards has different operational effects; no hidden override is approved. | Complete state/availability mutation protocol; FR-015, FR-020–FR-021, FR-034–FR-037, FR-046; PI-002–PI-003, PI-014. |
| OTQ-017 | Remaining calendar implementation, week conventions, broader browser/device/accessibility targets, tooling configuration, speed benchmark, pilot and numeric outcome metrics. Calendar hierarchy, six navigation items, responsive appointment Dialogs, standalone direct/refresh views, history/discard, prefilling, and save outcomes are selected in §6.6.1; ARCHITECTURE selects the routing mechanism and test tools. FullCalendar versus custom grid remains unselected; package fit versus custom rendering/testing ownership must be assessed without inventing licensing/API facts. | UI/quality acceptance; FR-031–FR-032; NFR-012, NFR-014; PRD OQ-014–OQ-016; PI-016. |
| OTQ-018 | **Potential source mismatch/ambiguity:** PRD FR-054 says three total attempts per notification/channel; BR-040 and AC-025 qualify the bound as automatic. Interview Q35 accepts “three total attempts”; Q51/Q54 permit owner resending but do not define notification identity/counter reset. Counting resend within the original cap versus a distinct resend notification changes allowed sends. Neither interpretation is selected. | Resend/retry state/counters; FR-040, FR-054, FR-060; BR-040, BR-043–BR-044; AC-025–AC-026; PI-009. |
| OTQ-019 | Repeated request/lost-response handling and concurrent edits of the same booking. Request idempotency/recovery versus explicit conflict/owner assistance, and stale-write rejection versus accepted serial ordering, have different UX/data needs. No key/version schema or customer recovery permission is approved. | Mutation/confirmation recovery; FR-028, FR-040, FR-042–FR-044; BR-018; NFR-002, NFR-006; PI-015. |
| OTQ-020 | WhatsApp consent withdrawal/external opt-out handling and re-consent evidence. Owner-assisted changes versus a newly authorized link-holder preference action differ in permissions/UI; neither is established. Provider-specific obligations/protocols require verification without treating them as already implemented product behavior. | Complete consent lifecycle before unsupported behavior is added; FR-026, FR-039, FR-047; BR-033–BR-034; PI-017. |

### 16.2 Source comparison and readiness

No definite conflict between the available latest explicitly confirmed product decisions and the approved PRD was identified during the source review. Where earlier accepted recommendation text is unavailable, the PRD supplies the product requirement and no missing technical choice is reconstructed. Earlier alternatives to multiple-barber capacity, both-channel messaging, service/barber/time management, the local-date horizon, and continued booking at budget exhaustion are not reinstated.

OTQ-018 records a potential retry/resend source mismatch rather than silently interpreting the added “automatic” qualification. Its associated PRD Issue is PI-009. Other entries are unresolved choices/gaps, not evidence that approved constraints should be discarded.

Implementation cannot be finalized until foundational stack/schema/auth/capability contracts, race-safe persistence/enforcement, slot/deadline semantics, rate/reset policy, notification worker/protocol/counter behavior, and affected product policies are chosen. Actual domain/sender/template feasibility separately blocks live hosted/integration completion. UI/pilot/service-level details block claims of the corresponding acceptance outcomes.

This identifies blockers; it neither starts a new interview nor authorizes application implementation.

## 17. PRD Issues

These document-local issues include acknowledged PRD open matters and additional gaps exposed when translating them into executable contracts. The original translation preserved its PRD snapshot; the later authorized owner-workflow amendment is recorded above. These issues preserve fixed requirements, explain missing decisions, and reference Open Technical Questions where an implementation choice or source comparison is involved.

| ID | Gap/ambiguity and why it matters | Affected PRD requirements / missing decision |
| --- | --- | --- |
| PI-001 | **Stale catalog offer.** Price/duration/eligibility can change between selection and commitment. Picking current values silently could change the customer's agreement; retaining an old value requires an approved validity policy. | FR-013–FR-017, FR-022, FR-028, FR-043–FR-044; BR-019–BR-020; NFR-004, NFR-006; OQ-006. Decide stale quote/eligibility response and reconfirmation; OTQ-015. |
| PI-002 | **Protected edit set.** “Upcoming,” “future confirmed,” and all-appointment availability rules do not define whether an ongoing interval or a cancelled retained interval blocks hours/retirement edits. This affects race guards and historical/ongoing correctness. | FR-015, FR-021, FR-033–FR-034; BR-009, BR-021–BR-022; NFR-004; OQ-010–OQ-011. Define affected-state/start/end predicates while preserving confirmed future protection; OTQ-004, OTQ-016. |
| PI-003 | **Restriction precedence/reopening.** Overrides replace recurring schedules, but edit behavior combining overrides, separate days off, closures, breaks, and blocks is not fully defined. A replacement must not become an implicit override of hard restrictions. | FR-018–FR-022; BR-009, BR-022–BR-023; OQ-011. Define combination/edit/reopening semantics; OTQ-016. |
| PI-004 | **Slot and interval boundaries.** The grid is fixed at fifteen minutes but its anchor for off-grid openings is not explicit. DST slot identity is fixed, while working-interval boundaries in gaps/folds and exact-midnight completion remain undefined. These choices can change valid slots. | FR-022–FR-023; BR-006, BR-008–BR-011, BR-025–BR-026; NFR-011; OQ-010. Define grid anchor and availability-boundary/midnight resolution; OTQ-007. |
| PI-005 | **Expiry/retention arithmetic.** Seven days and thirty days after end do not specify elapsed versus local-calendar arithmetic/equality across DST. Retention linkage/cadence also needs operational definition. | FR-045–FR-046, FR-064; BR-028, BR-046; NFR-002, NFR-013; OQ-009. Decide exact deadline boundaries without changing anchors; OTQ-014. |
| PI-006 | **Contact correction effects.** Name-only edit scope, save-triggered message versus separate resend, and renewed-consent capture are unspecified. Revocation and phone-consent clearing are fixed, but their full action contract is not. | FR-039–FR-040, FR-045, FR-047; BR-028, BR-033–BR-034; OQ-005. Define contact-edit categories and send/re-consent behavior; OTQ-015, OTQ-020. |
| PI-007 | **Hidden service on new manual booking.** Permission for an existing booking to retain its hidden original service does not establish permission for new owner-created hidden-service appointments. | FR-017, FR-033–FR-035; BR-020; OQ-007. Define owner-create service eligibility without broadening the existing exception silently; OTQ-015. |
| PI-008 | **Limit accounting definitions.** The numerical limits/cap are fixed, but hour/day boundaries, normalization, rejected-request counting, invalid-link/messaging thresholds, and uncertain/reserved dispatch accounting are incomplete. Equivalent implementations can otherwise admit different workloads. | FR-027, FR-058–FR-063; BR-043–BR-045; NFR-009–NFR-010; OQ-003. Define window/reset/key/count semantics and remaining thresholds; OTQ-008. |
| PI-009 | **Retry/resend and schedule identity.** Three total attempts versus the PRD's automatic qualification does not define owner resend counter identity/reset. “One reminder per schedule” likewise needs enough schedule/restoration identity to avoid unintended replay or permanent suppression. | FR-040, FR-051–FR-055, FR-060; BR-037–BR-040, BR-044; AC-025; OQ-004. Clarify counter/event identity and scope; source ambiguity is OTQ-018, with work correlation in OTQ-009. |
| PI-010 | **Failure/recovery classification.** Transient/permanent, pending/unknown, leased-but-unsent, and accepted-but-not-delivered outcomes lack exact policy. A default timeout could cause duplicate sends or false reporting. | FR-053–FR-056; BR-040–BR-041; NFR-007–NFR-008; OQ-004. Define retryable classes, timing, claim recovery, and evidence reconciliation; OTQ-010–OTQ-012. |
| PI-011 | **Recipient/template definitions.** Owner alert recipient configuration and exact customer template coverage/wording for cancellation, restoration, and address change are incomplete. Actual provider tests cannot be finalized from purpose labels alone. | FR-047–FR-050, FR-061; BR-034–BR-036, BR-049; OQ-001, OQ-013. Define recipient/template contracts and verify test capability; OTQ-011, OTQ-015. |
| PI-012 | **Activity/preferences scope.** General settings/profile audit coverage and the original “reminder preferences” setting are undefined. Additional preferences cannot be assumed to disable fixed channels/timing/bounds. | FR-038, FR-047, FR-051–FR-054; BR-034–BR-040; OQ-012. Define any remaining activity/preference scope or explicitly defer it; OTQ-015. |
| PI-013 | **Validation/readiness completeness.** Phase 01 slug syntax/reserved labels and required trimmed shop contact/address text are selected under PRD OQ-008. Additional phone/address handling/geography, field bounds/name uniqueness, catalog upper bounds, and detailed usable-hour publication checks remain open. Database/API validation contracts cannot be finalized by inventing constraints. | FR-005–FR-006, FR-009, FR-013–FR-014, FR-025; BR-004–BR-005, BR-033, BR-047–BR-048; OQ-008. Define missing validation/readiness rules; OTQ-003, OTQ-015. |
| PI-014 | **Lifecycle permissions/terminology.** Owner cancel/move behavior for started/ended/cancelled records, end equality, expired/deleted/unpublished presentation, and “original” service/slot after multiple changes are not fully explicit. An assumed state transition could bypass future-only restoration or recreate history. | FR-017, FR-034–FR-037, FR-040–FR-046; BR-020, BR-028–BR-032; OQ-010. Define allowed late-state operations and original/retained terminology; OTQ-016. |
| PI-015 | **Request replay and conflicting edits.** Lost create responses, repeated POSTs, and two in-flight changes of the same booking lack a selected user-facing outcome/recovery policy. Email may fail and public lookup is excluded, so a lost manage-link response can require owner assistance unless a different authorized mechanism is chosen. | FR-028, FR-040, FR-042–FR-044; BR-018, BR-027; NFR-002, NFR-006. Define duplicate/replay/stale-edit behavior without weakening intact originals or adding public email lookup; OTQ-019. |
| PI-016 | **Quality/business measurement.** Under-one-minute protocol, accessibility/browser/device targets, load/uptime/performance criteria, and pilot/outcome metrics are undefined. Claims or test thresholds cannot be fabricated. | FR-031–FR-032; NFR-012, NFR-014; AC-030; OQ-014–OQ-015. Define the measurement/quality boundary before declaring those outcomes achieved; OTQ-017. |
| PI-017 | **Consent withdrawal lifecycle.** Explicit WhatsApp opt-in and phone-change clearing are specified, but customer withdrawal/external opt-out and renewed-consent handling without phone change are not. Adding a preference mutation would expand current link permissions unless approved. | FR-026, FR-039, FR-047; BR-027, BR-033–BR-034. Define who can withdraw/re-record consent and how it affects pending work; OTQ-020. |

### 17.1 Document verification boundary

The complete PRD and available interview were reviewed before drafting. Final verification after context compaction checks the preserved review findings against the saved documents; unavailable recommendation wording is not reconstructed. All existing FR/BR/NFR requirements, AC scenarios, and EC cases are traced in the technical behavior/testing sections. Latest horizon, messaging-budget, owner-entry, snapshot, contact-revocation, and test-only WhatsApp decisions are preserved.

The PRD's acknowledged open matters remain open except for explicitly narrowed decisions recorded in ARCHITECTURE.md, APP_ROUTES.md, and §6.6.1. Newly exposed protocol/lifecycle ambiguities and the potential retry/resend source mismatch are recorded above and in Section 16. No exact physical schema, API DTO/route, lock algorithm, token implementation, framework version, or provider protocol is asserted without approval.

Document generation provides no live implementation/test evidence. The original drafting pass verified its unchanged PRD snapshot. The authorized 2026-10-14 workflow amendment updates PRD, SPEC, ARCHITECTURE, and AGENTS.md and adds APP_ROUTES.md; document verification checks route status, stable requirement/question IDs, local references, and cross-document consistency. Runtime acceptance still requires the specified browser and integration evidence.
