# Scheduling-calendar specimen

Date: 2026-10-14. Surface: `/design-system`, Components → Scheduling calendar.

This is a fictional-data UI exploration. It does not select a production calendar library or implement the owner dashboard, appointment routes, authorization, persistence, notifications, booking validation, or browser history behavior.

## Dependency and compatibility findings

- Installed the [official FullCalendar shadcn monarch registry](https://fullcalendar.io/docs/shadcn) with pnpm into the exploration folder. Retained its `EventCalendarViews` source and removed its unused demo, toolbar, icon wrappers, and duplicate Button/Tabs files. The specimen uses the existing shadcn/Base UI Button, Select, Dialog, Input, Field, and Badge components.
- Pinned `@fullcalendar/react` **7.1.2** and its required `temporal-polyfill` peer **1.0.5**. The calendar package declares React and React DOM peers `^17 || ^18 || ^19`, plus `temporal-polyfill ^1.0.1`. The installed React/React DOM **19.3.0**, Next.js **16.4.0**, Base UI **1.9.0**, and Tailwind 4 setup passed compilation and production-browser checks.
- Both selected packages are MIT licensed. FullCalendar's copied-source notice is retained in `app/design-system/calendar/LICENSE.fullcalendar.md`. Only standard time-grid and interaction plugins are imported. No Premium or resource-column package/license is used. See [FullCalendar licensing](https://fullcalendar.io/license) and [React integration](https://fullcalendar.io/docs/react).
- The `dayMinWidth` option triggered a runtime request for an additional scroll-grid module. Removed it; a specimen-local CSS scroll wrapper supplies phone scrolling. This keeps the existing official integration and avoids an unnecessary addon.
- FullCalendar v7 uses `slotHeaderInterval` and `slotHeaderFormat`; the specimen uses those current names.
- The first install resolved polyfill 1.0.6 and automatically added a release-age exception. Reconciled the manifest/lockfile to compatible 1.0.5 and removed that exception. `pnpm-workspace.yaml` is unchanged at handoff.

## Implemented behavior

Today's combined day view and all barbers are the defaults. Day/week, Previous, Next, Today, and an individual barber filter work locally. Sunday Studio is explicitly fictional and displays `America/New_York`. Fixture dates are computed once from the initial shop-zone week, with three barbers, simultaneous appointments, 30/45/75-minute services, and three unavailable periods. Navigating outside that initial week starts empty.

Appointment cards show time, customer, service, and barber; week view abbreviates customer surnames and the haircut label to preserve readability. Full barber names remain visible. Full recorded details and time ranges remain in the accessible appointment label and details Dialog. Dragging and resizing are disabled.

Empty slots and New appointment open a demo creation form. Slot clicks prefill shop-zone date/time and an individually filtered barber. All-barber view leaves barber selection empty and requires an explicit choice. Submission adds a local specimen entry, closes the Dialog, and announces that reloading resets the data. The form does not check appointment conflicts, availability, hours, notice, or horizon rules. Basic required fields and time-zone conversion are UI safeguards, not real booking validation.

## Verification evidence

Final checks passed:

| Check | Result |
| --- | --- |
| `pnpm lint` | Passed |
| `pnpm exec tsc --noEmit --incremental false` | Passed |
| `pnpm build` | Passed without warnings; `/design-system` prerendered |
| Production browser, desktop 1440 px | Day/week, navigation, filter, appointment details, creation form |
| Production browser, phone 390 px | Day/week, filter, both Dialogs, contained horizontal scroll |
| Phone overflow | Page width 390 px; calendar viewport 348 px, week content 1060 px |
| Appointment labels | No event content exceeded its card height after compact week styling |
| Keyboard details | Enter opened details; Escape closed them and returned focus to the appointment |
| Slot prefill | Clicking 09:30 on October 14 with Alex selected populated `2026-10-14`, `09:30`, Alex Rivera |
| All-barber creation | Barber remained “Choose a barber”; explicit keyboard selection enabled creation |
| Local creation | “Demo Guest” rendered at 16:45–17:30; Dialog closed and focus returned to New appointment |
| Time-zone presentation | Browser zone was Africa/Algiers; calendar and prefills used America/New_York |

The automation tool could not type directly into Chrome's segmented native time input. The local creation check used the native input value setter plus input/change events to enter 16:45; the controlled form and resulting appointment reflected that value. Native picker touch behavior on a physical phone was not tested.

Screenshots from the production build:

- [Desktop day](desktop-day.png), [desktop week](desktop-week.png)
- [Desktop details](desktop-details.png), [desktop creation with explicit barber selection](desktop-creation-all-barbers.png)
- [Phone day](phone-day.png), [phone week](phone-week.png), [phone filtered day](phone-day-filtered.png)
- [Phone details](phone-details.png), [phone creation in all-barber view](phone-creation-all-barbers.png), [phone slot-prefilled creation](phone-creation-prefilled.png)

## Files changed in this task

- `app/design-system/page.tsx`: dynamically loads and places the specimen within Components.
- `app/design-system/scheduling-calendar.tsx`: focused calendar, local state, controls, and both Dialog presentations.
- `app/design-system/scheduling-calendar.css`: specimen and Dialog styling; responsive scrolling.
- `app/design-system/calendar/demo-schedule.ts`: fictional fixtures and shop-zone conversions.
- `app/design-system/calendar/event-calendar-views.tsx`: copied official shadcn integration source, with provenance comment.
- `app/design-system/calendar/LICENSE.fullcalendar.md`: upstream MIT notice.
- `app/design-system/playground.css`: corrected one leftover `:global(...)` selector to valid ordinary CSS; preserved its intended pressed-button styling.
- `package.json`, `pnpm-lock.yaml`: the two calendar dependencies and their required transitives.
- This report and the linked screenshots.

Existing global theme, shared UI source, route/product/architecture documents, and unrelated uncommitted changes were preserved. The calendar library's structural stylesheet is imported only through the exploration component; custom calendar styles use the `tt-schedule` namespace.

## Remaining limits

- Entries are in-memory and reset on reload; only the initial displayed week has seeded appointments.
- Empty-grid slots are pointer entry points. New appointment supplies the equivalent keyboard path with editable date/time fields; custom arrow-key slot navigation is not implemented.
- Long customer/service names and physical-device native pickers have not had a separate exhaustive pass.
- Production scheduling, concurrency, authorization, owner appointment routes, notification delivery, interception, unsaved-change guards, and browser Back/Forward behavior remain unimplemented and unverified by this specimen.
