# TrimTime — Application Pages and Routes

**Date:** 2026-10-14

**Status:** Route authority and current implementation snapshot. The `trimtime.com` examples do not confirm domain ownership, DNS, or deployment provisioning.

## 1. Authority and status

[PRD.md](PRD.md) owns journeys and product rules; [SPEC.md](SPEC.md#66-owner-appointments-attendance-and-recovery) owns interaction contracts; [ARCHITECTURE.md](ARCHITECTURE.md#21-owner-appointment-navigation) owns routing mechanisms. This inventory is the single reference for page names, URL paths, and their decision status.

- **Approved:** Owner calendar, appointment, and five management-navigation paths explicitly selected on 2026-10-14; `/sign-in` and `/setup` selected in the approved Phase 01 plan and retained by the approved Proxy refactor.
- **Proposed:** Suggested paths retained for planning; their required capabilities are documented, but these paths have not been approved.
- The host responsibilities are approved. Customer manage-token placement is still proposed. Other forms, tabs, and page/modal boundaries remain open except for the approved owner appointment interaction.

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
| Customer           | Shop booking flow                               | `https://{shop}.trimtime.com/`                          | Proposed    |
| Customer           | Manage linked booking                           | `https://{shop}.trimtime.com/manage/{token}`            | Proposed    |

`{shop}` identifies the requested public shop, `{appointmentId}` identifies an owner appointment, and `{token}` represents one booking's capability. None grants owner permission; server operations independently enforce authority and shop scope.

**Implementation snapshot (2026-10-22):** `/services` and `/barbers` are implemented as owner-authenticated, shop-required pages and internally served from the `/owner/services` and `/owner/barbers` destinations. The owner navigation currently exposes Today, Services, Barbers, and Settings; Calendar, Availability, and Activity remain approved target destinations but are not linked until their workflows exist. The snapshot records local route behavior, not hosted deployment evidence.

## 3. Page boundaries and conditional flows

- Owners with a shop enter the calendar after sign-in; owners without a shop enter setup at `/setup`.
- Owner appointment routes open as responsive shadcn Dialogs when reached from the calendar, and as standalone pages on direct visits or refreshes. The full navigation/save/dismissal contract is in [SPEC §6.6.1](SPEC.md#661-owner-calendar-interaction-contract).
- The approved target owner navigation is Calendar, Services, Barbers, Availability, Activity, and Settings. Current implemented navigation exposes Today (the draft-shop dashboard), Services, Barbers, and Settings; unavailable Calendar, Availability, and Activity destinations are not linked. The supplied screenshot is illustrative; summary counters, bell, profile actions, and detailed visual styling are deferred.
- Public booking steps and confirmation are required views; separate URLs for them are not selected. Customer cancellation and rescheduling are required flows; separate URLs for them are not selected. Service/barber forms, availability edits, and QR sharing do not imply additional standalone routes.
- Unknown/invalid shop hosts return a clean 404. Known unpublished-shop, expired/revoked-link, and deleted-record presentation remains open under PRD OQ-010, while existing manage links survive unpublication.
- Owner authentication uses `/api/auth/**`, including `/api/auth/callback/google`, on the owner host. The protected job and provider outcome entry points remain technical interfaces with paths still open. Reserved system names do not imply pages.

Customer accounts, staff dashboards, payments, public booking lookup/recovery, and a general administrator surface remain outside the documented scope.

## 4. Maintenance

Keep approved and proposed entries distinct. When a route or page boundary changes, record the explicit decision here and update affected journey, interaction, and architecture references. Route approval does not establish runtime acceptance; follow the PRD/SPEC verification scenarios before claiming implemented behavior.

Owner public paths are mapped to internal `/owner` destinations by a host-conditioned Next.js `beforeFiles` rewrite after Proxy validation; `/owner` is not a public URL. Public paths in the inventory remain canonical. The design-system specimen remains available on the configured marketing and owner hosts.
