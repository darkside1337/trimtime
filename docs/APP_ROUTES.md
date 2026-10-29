# TrimTime — Application Pages and Routes

**Date:** 2026-10-14

**Status:** Route authority and current implementation snapshot. The `trimtime.com` examples do not confirm domain ownership, DNS, or deployment provisioning.

## 1. Authority and status

[PRD.md](PRD.md) owns journeys and product rules; [SPEC.md](SPEC.md#66-owner-appointments-attendance-and-recovery) owns interaction contracts; [ARCHITECTURE.md](ARCHITECTURE.md#21-owner-appointment-navigation) owns routing mechanisms. This inventory is the single reference for page names, URL paths, and their decision status.

- **Approved:** Owner calendar, appointment, and five management-navigation paths explicitly selected on 2026-10-14; `/sign-in` and `/setup` selected in the approved Phase 01 plan; public shop root `https://{shop}.{configured-domain}/` approved in Phase 05 on 2026-10-22.
- **Proposed:** Suggested paths retained for planning; their required capabilities are documented, but these paths have not been approved.
- The host responsibilities and Phase 06 customer manage-token placement are approved. Other forms, tabs, and page/modal boundaries remain open except for the approved owner appointment interaction.

## 2. Page inventory

| Group              | Page / view                                     | URL                                                     | Path status |
| ------------------ | ----------------------------------------------- | ------------------------------------------------------- | ----------- |
| Public             | Marketing homepage                              | `https://trimtime.com/`                                 | Proposed    |
| Owner access       | Google sign-in                                  | `https://app.trimtime.com/sign-in`                      | Approved    |
| Owner setup        | Create and prepare shop                         | `https://app.trimtime.com/setup`                        | Approved    |
| Owner dashboard    | Today's calendar; day/week and barber filters   | `https://app.trimtime.com/`                             | Approved    |
| Owner appointments | Add walk-in / phone appointment                 | `https://app.trimtime.com/appointments/new`             | Approved    |
| Owner appointments | Appointment details and operations              | `https://app.trimtime.com/appointments/{appointmentId}` | Approved    |
| Owner catalog      | Services management                             | `https://app.trimtime.com/services`                     | Approved    |
| Owner team         | Barber profiles and service assignments         | `https://app.trimtime.com/barbers`                      | Approved    |
| Owner scheduling   | Shop/barber availability and time blocks        | `https://app.trimtime.com/availability`                 | Approved    |
| Owner settings     | Shop details, publication, booking link, and QR | `https://app.trimtime.com/settings`                     | Approved    |
| Owner activity     | Booking activity and message status             | `https://app.trimtime.com/activity`                     | Approved    |
| Customer           | Public shop and availability preview            | `https://{shop}.{configured-domain}/`                   | Approved    |
| Customer           | Manage linked booking                           | `https://{shop}.{configured-domain}/manage/{token}`     | Approved    |

`{shop}` identifies the requested public shop, `{appointmentId}` identifies an owner appointment, and `{token}` represents one booking's capability. The manage link is booking-scoped and uses the same configured public shop host. None grants owner permission; server operations independently enforce authority and shop scope.

**Implementation snapshot (2026-10-27):** `/`, internally served from `/owner`, is the persisted own-shop calendar; `/appointments/new` and `/appointments/{appointmentId}` are the approved owner creation/details paths. Calendar and appointment pages require owner authentication and an existing shop, and reads/writes derive scope from the signed-in owner. Calendar controls retain date, day/week view, and barber filter in the URL. Appointment-entry links carry calendar return date/view/filter separately from editable slot date/time/barber hints, so save and cancel restore the originating filtered calendar. Calendar navigation opens details/creation in an intercepted Dialog slot; direct visits and refreshes use standalone pages. Activity at `/activity`, internally served from `/owner/activity`, reads own-shop notification work and attempt/capture evidence. Calendar read failures retain validated context for retry. Calendar and Activity are no longer design previews. A real local Mailpit capture verified the received correlation header; local capture does not establish hosted ingress or inbox delivery. Phase 08 local acceptance passed on 2026-10-27; hosted, physical-device and dedicated screen-reader evidence remains unverified.

**Wave C entry snapshot (2026-10-23):** The existing marketing homepage renders the approved full composition with labeled fictional calendar/booking examples. Its Create a shop links use the configured owner origin and `/sign-in`; Try booking opens a preview notice and the existing same-page booking section, not a new customer route. Sign-in preserves Google authentication and existing owner/shop redirects. Setup at `/setup` offers an in-memory review of actual entered values; only the explicit final Create shop confirmation invokes the existing create operation. The entered URL name and configured canonical address are shown separately, without claiming availability, publication or hosted routing. Route approval statuses above are unchanged.

## 3. Page boundaries and conditional flows

- Owners with a shop enter the calendar after sign-in; owners without a shop enter setup at `/setup`.
- Owner appointment routes open as responsive shadcn Dialogs when reached from the calendar, and as standalone pages on direct visits or refreshes. The full navigation/save/dismissal contract is in [SPEC §6.6.1](SPEC.md#661-owner-calendar-interaction-contract).
- Implemented owner navigation is Calendar, Services, Barbers, Availability, Activity, and Settings. Calendar, appointment details/creation, and Activity read persisted own-shop data; creation writes use server-side ownership and scheduling checks. Activity reads actual notification records and evidence; deferred resend/export controls remain unavailable. Route implementation does not by itself establish all Phase 08 browser, accessibility, or integration acceptance.
- Public booking steps and confirmation are required views; separate URLs for them are not selected. Customer cancellation and rescheduling are required flows; separate URLs for them are not selected. Service/barber forms, availability edits, and QR sharing do not imply additional standalone routes.
- Unknown/invalid shop hosts return a clean HTTP 404. A known unpublished shop returns HTTP 200 with its name, public contact, time zone and fictional-demo notice; offerings and starts are hidden (Phase 05 resolution of PRD OQ-010). The Phase 06 manage route is a booking-scoped view; it is read-only except for explicit Phase 10 cancellation and Phase 11 replacement Server Action POSTs, and expired, revoked, or deleted capabilities use the same unavailable result.
- Owner authentication uses `/api/auth/**`, including `/api/auth/callback/google`, on the owner host. The protected job and provider outcome entry points remain technical interfaces with paths still open. Reserved system names do not imply pages.

Customer accounts, staff dashboards, payments, public booking lookup/recovery, and a general administrator surface remain outside the documented scope.

**Phase 06 route selection (2026-10-25):** The approved manage path is `/manage/{token}` on the resolved shop host. It is a read-only booking-scoped view; direct path approval does not establish production ingress or public acceptance.

**Phase 07 route selection (2026-10-26):** Activity and Manage status refresh use the existing `GET` pages. No new route was introduced for sending, provider callbacks, or writing status evidence. Local capture and read-only refresh evidence do not establish hosted routing or inbox delivery.

**Phase 08 route implementation (2026-10-27):** The canonical appointment paths above now have intercepted and standalone presentations. Calendar query state is represented in `date`, `view`, and optional `barber` parameters; appointments use the existing `/appointments/{appointmentId}` path. No public booking or customer-management route changed.

**Phase 09 route implementation (2026-10-27):** Owner move/cancel actions remain on the existing appointment details route and reuse its Dialog/standalone presentations. Recent owner change events and customer-message status appear on the existing Activity route; resource/schedule conflict resolution links return to the owning Services, Barbers, or Availability page. No route was added. Automated local coverage exists, while the required executor walkthrough and Mailpit cancellation/outage evidence remain pending.

**Phase 10 route implementation (2026-10-29):** The existing `/manage/{token}` route on the resolved public shop host now supports explicit customer cancellation through a Server Action POST that requires the matching shop host/origin and a valid booking capability. GET and HEAD remain non-mutating; cancelled and past records remain view-only on the same path. No new public or REST route was added.

**Phase 11 route implementation (2026-10-29):** The existing `/manage/{token}` route on the resolved public shop host now supports capability-scoped replacement queries and explicit replacement via Server Action POSTs enforcing matching shop host/origin. Live catalog choices and 15-minute slot availability replace earlier sample preview components on the same page; review discloses immediate cutoff when moving within 12 hours. GET and HEAD remain non-mutating; invalid/expired links show generic unavailable feedback. No new public or REST route was added.

## 4. Maintenance

Keep approved and proposed entries distinct. When a route or page boundary changes, record the explicit decision here and update affected journey, interaction, and architecture references. Route approval does not establish runtime acceptance; follow the PRD/SPEC verification scenarios before claiming implemented behavior.

Owner public paths are mapped to internal `/owner` destinations by a host-conditioned Next.js `beforeFiles` rewrite after Proxy validation; `/owner` is not a public URL. Public paths in the inventory remain canonical. The design-system specimen remains available on the configured marketing and owner hosts.
