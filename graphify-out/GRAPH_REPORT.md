# Graph Report - trimtime  (2026-11-04)

## Corpus Check
- 425 files · ~331,910 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 8 file(s) not represented in the graph (top: .css 3, .example 1, (none) 1)

## Summary
- 1842 nodes · 6548 edges · 85 communities (75 shown, 10 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 34 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `455a6e6b`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- dispatch.ts
- bookings/actions.ts
- manage-booking-preview.tsx
- dropdown-menu.tsx
- design-system/page.tsx
- Button
- index.ts
- public-mutations.ts
- owner-calendar.tsx
- notifications/queries.ts
- replace.ts
- fixtures.ts
- recovery.ts
- scheduling-calendar.tsx
- schedule-draft.ts
- pg
- package.json
- customer-replacement.integration.test.ts
- shops/mutations.ts
- booking-flow.tsx
- ref_node_crypto
- dispatch.integration.test.ts
- react
- availability/queries.ts
- appointment-operations.tsx
- BookingFlow
- components.json
- move.ts
- hashSecret
- availability/actions.ts
- dated-overrides.ts
- db
- readOwnerContext
- dependencies
- scripts
- compilerOptions
- owner-calendar-context.tsx
- owner-management-nav.tsx
- availability/schemas.ts
- bookings/types.ts
- appointments/[appointmentId]/page.tsx
- reminder-migrations.test.ts
- appointment-form.tsx
- vitest
- setup/page.tsx
- server/auth.ts
- AppointmentOperationsForm
- db
- phase10-notifications.spec.ts
- barbers/page.tsx
- notification-recovery-migrations.test.ts
- booking-step-contact.tsx
- TrimTimeLogo
- getOwnShop
- owner-activity.test.ts
- phase11-notifications.spec.ts
- DateAvailabilityManagement
- catalog/mutations.ts
- test-e2e.mjs
- phase12-notifications.spec.ts
- attendance-migrations.test.ts
- availability/types.ts
- mailpit-double.mjs
- customer-cancellation-migrations.test.ts
- customer-replacement-migrations.test.ts
- owner-restoration-migrations.test.ts
- shop/page.tsx
- customer.ts
- bookings/tests/operations.integration.test.ts
- eslint.config.mjs
- MemoryStorage
- publication-controls.tsx
- server/config.ts
- allowBuilds
- phase14-retries.spec.ts
- e2e-device-matrix.test.ts
- fixed-clock.mjs
- catalog/actions.ts
- barbers/actions.ts
- phase08-calendar.spec.ts
- next

## God Nodes (most connected - your core abstractions)
1. `Button()` - 90 edges
2. `vitest` - 86 edges
3. `react` - 82 edges
4. `DesignSystemPage()` - 57 edges
5. `readOwnerContext()` - 55 edges
6. `test` - 55 edges
7. `next` - 55 edges
8. `ownerOrigin` - 50 edges
9. `drizzle-orm` - 50 edges
10. `server-only` - 47 edges

## Surprising Connections (you probably didn't know these)
- `submit()` --indirect_call--> `date()`  [INFERRED]
  app/design-system/scheduling-calendar.tsx → features/notifications/components/owner-activity.tsx
- `BookingProtectionError` --references--> `BookingConflict`  [EXTRACTED]
  features/bookings/protection.ts → lib/action-result.ts
- `methodNotAllowed()` --calls--> `classifyHost()`  [EXTRACTED]
  app/api/jobs/notifications/retry/route.ts → server/hosts.ts
- `POST()` --calls--> `classifyHost()`  [EXTRACTED]
  app/api/jobs/notifications/retry/route.ts → server/hosts.ts
- `createOwnerBookingAction()` --calls--> `readOwnerContext()`  [EXTRACTED]
  features/bookings/actions.ts → server/owner-context.ts

## Import Cycles
- 2-file cycle: `features/availability/queries.ts -> features/shops/queries.ts -> features/availability/queries.ts`

## Communities (85 total, 10 thin omitted)

### Community 0 - "dispatch.ts"
Cohesion: 0.06
Nodes (66): DELETE(), GET(), HEAD(), json(), matchesSecret(), maxDuration, methodNotAllowed(), OPTIONS() (+58 more)

### Community 1 - "bookings/actions.ts"
Cohesion: 0.28
Nodes (20): cancelCustomerBookingAction(), cancelOwnerBookingAction(), createOwnerBookingAction(), createPublicBookingAction(), customerCancellationToken(), getBookingSlotsAction(), getCustomerReplacementChoicesAction(), getCustomerReplacementSlotsAction() (+12 more)

### Community 2 - "manage-booking-preview.tsx"
Cohesion: 0.06
Nodes (45): dayRowCommonClasses, EventCalendarViewProps, EventCalendarViews(), filledRightTriangle(), getShortDayCellBottomClass(), geistMono, inter, manrope (+37 more)

### Community 3 - "dropdown-menu.tsx"
Cohesion: 0.12
Nodes (18): ActionLink(), CalendarTime(), Home(), questions, SampleAppointment(), workflow, MarketingBookingDialog(), MarketingBookingPreview() (+10 more)

### Community 4 - "design-system/page.tsx"
Cohesion: 0.08
Nodes (42): accents, DesignSystemPage(), Exhibit(), Flower(), neutrals, SchedulingCalendar, SectionHeading(), sections (+34 more)

### Community 5 - "Button"
Cohesion: 0.11
Nodes (55): AppointmentContent(), InterceptedAppointmentPage(), BookingConflictList(), OwnerArchiveDialog(), OwnerDiscardDialog(), Badge(), badgeVariants, Button() (+47 more)

### Community 6 - "index.ts"
Cohesion: 0.16
Nodes (26): db, pool, account, accountRelations, session, sessionRelations, user, userRelations (+18 more)

### Community 7 - "public-mutations.ts"
Cohesion: 0.13
Nodes (24): localDate(), OwnerCalendarContent(), OwnerPage(), Search, validDate(), publicRateEvents, publicRateKeys, resolveScheduleForDate() (+16 more)

### Community 8 - "owner-calendar.tsx"
Cohesion: 0.16
Nodes (18): AppointmentEntry(), getDate(), InterceptedNewAppointmentPage(), Search, today(), AppointmentLinkLoading(), AppointmentLoading(), addDays() (+10 more)

### Community 9 - "notifications/queries.ts"
Cohesion: 0.67
Nodes (4): ActivityContent(), ActivityPage(), getOwnBookingActivity(), getOwnNotificationActivity()

### Community 10 - "replace.ts"
Cohesion: 0.16
Nodes (18): ChangeOfferResolution, ChangeOfferSnapshot, findShopChangeReplay(), matchesReviewedOffer(), resolveChangeOffer(), ReviewedChangeOffer, ShopChangeReplayRow, cancelCustomerBooking() (+10 more)

### Community 11 - "fixtures.ts"
Cohesion: 0.21
Nodes (9): cancelBlockedRequest(), captureState(), createFixtureAuth(), Database, marketingOrigin, openOwnerNavigation(), ownerOrigin, Owners (+1 more)

### Community 12 - "recovery.ts"
Cohesion: 0.09
Nodes (31): BookingFailureDisposition, BookingPayload, clearPendingAttempt(), clearPendingRecovery(), clearPendingWarning(), isRecoveryKey(), PENDING_BOOKING_RETENTION_MS, PENDING_BOOKING_STORAGE_KEY (+23 more)

### Community 13 - "scheduling-calendar.tsx"
Cohesion: 0.13
Nodes (29): appointmentStart(), BARBERS, createDemoWeek(), dateLabel(), DemoAppointment, SERVICES, SHOP_TIME_ZONE, shopDateTime() (+21 more)

### Community 14 - "schedule-draft.ts"
Cohesion: 0.17
Nodes (18): saveBarberDateScheduleAction(), saveShopDateScheduleAction(), handleOverrideChange(), DateOverrideDraft, dateRangeDrafts(), useDateOverrideDraft(), save(), DraftDay (+10 more)

### Community 15 - "pg"
Cohesion: 0.12
Nodes (9): pg, @playwright/test, chooseBookingOptions(), Owner, createBooking(), budgetDay, makeBooking(), prepareShop() (+1 more)

### Community 16 - "package.json"
Cohesion: 0.08
Nodes (31): devDependencies, jsqr@1.4.0, @playwright/test@^1.64.1, shadcn@^4.21.4, tailwindcss@^4, @tailwindcss/turbopack@^4, @types/node@^24, @types/pg@^8.23.1 (+23 more)

### Community 17 - "customer-replacement.integration.test.ts"
Cohesion: 0.10
Nodes (21): bookingInput(), createBooking(), waitForBlockedCancellation(), bookingInput(), createBooking(), rateEventCount(), barrierPidCache, describeUnrelatedWaiters() (+13 more)

### Community 18 - "shops/mutations.ts"
Cohesion: 0.12
Nodes (24): checkSubdomainAvailability(), updateOwnShop(), validationError(), evaluatePublicationReadiness(), PUBLICATION_REQUIREMENTS, PublicationBarberFacts, publicationNotReadyMessage(), PublicationReadiness (+16 more)

### Community 19 - "booking-flow.tsx"
Cohesion: 0.18
Nodes (19): BookingReceipt(), BookingRecoveryNotice(), headings, RecoveryNoticeKind, BookingStepBarbers(), BookingStepServices(), BookingStepSlots(), groups (+11 more)

### Community 20 - "ref_node_crypto"
Cohesion: 0.21
Nodes (8): createOwnerAppointment(), createPastOwnerAppointment(), getOwnerManageToken(), poisonOwnerAppointmentRead(), restoreOwnerAppointmentRead(), setFixtureAppointmentEnd(), mailpitCompose, createOwnerAppointmentForCatalog()

### Community 21 - "dispatch.integration.test.ts"
Cohesion: 0.08
Nodes (17): MailpitTransportResult, booking(), captured, SendInput, shiftScheduleTo(), candidatesFor(), processOwned(), reserveAdjacentBudgetDays() (+9 more)

### Community 22 - "react"
Cohesion: 0.07
Nodes (40): Input(), Label(), availabilityTabs, BarberTimeBlockEditor(), BlockDraft, TimeBoundaryField(), AvailabilityDateManagementHandle, ExceptionView (+32 more)

### Community 23 - "availability/queries.ts"
Cohesion: 0.12
Nodes (25): AvailabilityContent(), AvailabilityPage(), barberDateSchedules, barberSchedules, shopDateSchedules, shopSchedules, timeBlocks, dateBounds() (+17 more)

### Community 24 - "appointment-operations.tsx"
Cohesion: 0.14
Nodes (19): MoveBarber, MoveService, StartChoice, Values, AppointmentOperationsProps, localParts(), Mode, OperationFailureResult (+11 more)

### Community 25 - "BookingFlow"
Cohesion: 0.21
Nodes (20): BookingFlow(), changeDate(), clearRecovery(), clearStartAt(), currentPayload(), expireAttempt(), handleFailure(), persistWarning() (+12 more)

### Community 26 - "components.json"
Cohesion: 0.09
Nodes (21): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+13 more)

### Community 27 - "move.ts"
Cohesion: 0.23
Nodes (21): bookingChanges, fitsScheduleInterval(), BookingTransaction, findOccupyingInterval(), channelState(), stageCustomerChangeNotifications(), stageCustomerReminder(), suppressSupersededNotificationWork() (+13 more)

### Community 28 - "hashSecret"
Cohesion: 0.22
Nodes (11): createBearerSecret(), decryptCapability(), encryptCapability(), hashSecret(), key(), persistBookingCreation(), addChange(), createBooking() (+3 more)

### Community 29 - "availability/actions.ts"
Cohesion: 0.15
Nodes (20): createTimeBlockAction(), denied(), getBlockBoundaryChoicesAction(), getOwnDateAvailabilityAction(), ownerContext(), previewOwnSlotsAction(), reloadOwnSchedulesAction(), removeTimeBlockAction() (+12 more)

### Community 30 - "dated-overrides.ts"
Cohesion: 0.27
Nodes (18): saveBarberDateSchedule(), saveDateSchedule(), saveShopDateSchedule(), blockValidationError(), denied(), findActiveBarber(), LockedShop, lockOwnerShop() (+10 more)

### Community 31 - "db"
Cohesion: 0.10
Nodes (20): environment, healthcheck, image, ports, volumes, POSTGRES_DB, POSTGRES_PASSWORD, POSTGRES_USER (+12 more)

### Community 33 - "readOwnerContext"
Cohesion: 0.27
Nodes (22): owner(), saveBarber(), fixture(), fixture(), fixture(), saveService(), fixture(), fixture() (+14 more)

### Community 34 - "dependencies"
Cohesion: 0.10
Nodes (21): dependencies, @base-ui/react@^1.9.0, @better-auth/drizzle-adapter@1.7.12, class-variance-authority@^0.7.1, cn@^0.4.0, drizzle-orm@^0.45.4, @fullcalendar/react@7.1.2, lucide-react@^1.56.0 (+13 more)

### Community 35 - "scripts"
Cohesion: 0.10
Nodes (20): scripts, build, check, db:dev:down, db:dev:stop, db:dev:up, db:migrate, db:test:down (+12 more)

### Community 36 - "compilerOptions"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib (+11 more)

### Community 37 - "owner-calendar-context.tsx"
Cohesion: 0.18
Nodes (14): OwnerLayout(), findVisibleOwnerAppointmentDialog(), OWNER_APPOINTMENT_DETAILS_DIALOG_ATTRIBUTES, OWNER_APPOINTMENT_DIALOG_ATTRIBUTE, OWNER_APPOINTMENT_DIALOG_SELECTOR, OWNER_APPOINTMENT_ENTRY_DIALOG_ATTRIBUTES, AppointmentRouteCommitObserver(), Context (+6 more)

### Community 38 - "owner-management-nav.tsx"
Cohesion: 0.25
Nodes (9): destinations, OwnerManagementNav(), Sheet(), SheetClose(), SheetContent(), SheetOverlay(), SheetPortal(), SheetTitle() (+1 more)

### Community 39 - "availability/schemas.ts"
Cohesion: 0.12
Nodes (16): blockBoundarySchema, createTimeBlockSchema, dateScheduleSchema, dateSchema, getDateAvailabilitySchema, PreviewSlotsInput, previewSlotsSchema, range (+8 more)

### Community 40 - "bookings/types.ts"
Cohesion: 0.09
Nodes (23): cancelCustomerBookingSchema, cancelOwnerBookingSchema, CreateOwnerBookingInput, createOwnerBookingSchema, CreatePublicBookingInput, createPublicBookingSchema, moveOwnerBookingSchema, PublicBookingContact (+15 more)

### Community 41 - "appointments/[appointmentId]/page.tsx"
Cohesion: 0.19
Nodes (13): AppointmentContent(), AppointmentPage(), Search, validDate(), AppointmentDetails(), AppointmentOperationsReadError(), dateTime(), Detail() (+5 more)

### Community 42 - "reminder-migrations.test.ts"
Cohesion: 0.18
Nodes (10): applyMigrations(), pool, applyCurrentMigrations(), createMigrationFixture(), Journal, journalPath, prepareMigrations(), schemaThrough0015() (+2 more)

### Community 43 - "appointment-form.tsx"
Cohesion: 0.15
Nodes (17): AppointmentEntry(), getDate(), NewAppointmentPage(), Search, today(), AppointmentForm(), AppointmentFormContent(), submit() (+9 more)

### Community 44 - "vitest"
Cohesion: 0.20
Nodes (4): getTestDatabaseUrl(), vitest, openTestDatabase(), withE2eBudget()

### Community 45 - "setup/page.tsx"
Cohesion: 0.22
Nodes (12): OwnerManagementFrame(), OwnerManagementLayout(), SetupContent(), SetupPage(), SignInContent(), SignInPage(), SignInProps, OwnerAuthControls() (+4 more)

### Community 46 - "server/auth.ts"
Cohesion: 0.22
Nodes (9): GET(), guard(), POST(), better-auth@1.7.12, better-auth, auth, auth, ownerAuthOptions (+1 more)

### Community 47 - "AppointmentOperationsForm"
Cohesion: 0.16
Nodes (25): refreshOwnerAppointmentAction(), AppointmentAttendanceForm(), refreshAndReview(), retry(), send(), submit(), AppointmentOperationsForm(), applyFailure() (+17 more)

### Community 50 - "db"
Cohesion: 0.13
Nodes (14): environment, healthcheck, image, ports, tmpfs, POSTGRES_DB, POSTGRES_PASSWORD, POSTGRES_USER (+6 more)

### Community 51 - "phase10-notifications.spec.ts"
Cohesion: 0.10
Nodes (5): loadShopDate(), nextAction(), resolveBoundary(), mailpitCompose, MailpitMessage

### Community 52 - "barbers/page.tsx"
Cohesion: 0.32
Nodes (9): BarbersContent(), BarbersPage(), ServicesContent(), ServicesPage(), getOwnBarbers(), getOwnOfferingChoices(), getOwnServices(), DesignPreviewNotice() (+1 more)

### Community 53 - "notification-recovery-migrations.test.ts"
Cohesion: 0.18
Nodes (8): createMigrationFixture(), expectRecoveryConstraints(), failureAt, freshSchemaName(), insertConstraintProbeRows(), Journal, journalPath, MigrationFixture

### Community 55 - "booking-step-contact.tsx"
Cohesion: 0.35
Nodes (8): BookingStepContact(), BookingMessage, BookingMessageAction, bookingMessageOffersAnotherTime(), BookingContact, BookingService, contactMarkup(), service

### Community 56 - "TrimTimeLogo"
Cohesion: 0.25
Nodes (9): Arrangement, LogoArt(), LogoShowcase(), surfaces, dimensions, LockupTreatment, LogoConfiguration, TrimTimeLogo() (+1 more)

### Community 57 - "getOwnShop"
Cohesion: 0.36
Nodes (8): SettingsContent(), SettingsPage(), ShopSharing(), getOwnPublicationReadiness(), getOwnSettingsDetails(), getOwnShop(), createShopQrSvg(), getCanonicalShopUrl()

### Community 58 - "owner-activity.test.ts"
Cohesion: 0.20
Nodes (8): shop, BookingChangeActivityRow, BookingChangeActivityView, NotificationActivityRow, NotificationActivityView, NotificationStatus, react-dom@19.3.0, react-dom

### Community 59 - "phase11-notifications.spec.ts"
Cohesion: 0.20
Nodes (3): getValidatedOwnedMailpit(), MailpitMessage, setOwnedMailpit()

### Community 60 - "DateAvailabilityManagement"
Cohesion: 0.08
Nodes (26): AvailabilityManagement(), applyNavigation(), changeSection(), handleAddDateClick(), handleEditException(), navigate(), DateAvailabilityManagement(), addBlock() (+18 more)

### Community 61 - "catalog/mutations.ts"
Cohesion: 0.16
Nodes (13): copyShopScheduleToBarber(), archiveBarber(), validationError(), saveBarberSchema, BookingProtectionError, protectedBookingConflicts(), archiveService(), setServiceOffered() (+5 more)

### Community 63 - "test-e2e.mjs"
Cohesion: 0.18
Nodes (12): compose, run(), verifyOwnedTestDatabase(), verifyTestContainer(), acquireE2eDirectory(), compose, main(), run() (+4 more)

### Community 64 - "phase12-notifications.spec.ts"
Cohesion: 0.22
Nodes (4): getValidatedOwnedMailpit(), MailpitMessage, restoreJourney(), setOwnedMailpit()

### Community 66 - "attendance-migrations.test.ts"
Cohesion: 0.18
Nodes (7): baselineMigrations, AppliedMigration, ExpectedMigration, MigrationJournal, readAppliedMigrations(), readExpectedMigrations(), withExpectedTags()

### Community 67 - "availability/types.ts"
Cohesion: 0.33
Nodes (6): hasUsableRecurringHours(), MinuteRange, OccupiedInterval, ScheduleView, Slot, WeeklySchedule

### Community 68 - "mailpit-double.mjs"
Cohesion: 0.39
Nodes (4): createMailpitDouble(), json(), readJson(), recipientBehavior()

### Community 72 - "shop/page.tsx"
Cohesion: 0.43
Nodes (6): display, metadata, PublicShopContent(), PublicShopPage(), ShopFooter(), getPublicShop()

### Community 73 - "customer.ts"
Cohesion: 0.17
Nodes (18): getRetainedBookingOfferings(), isCustomerChangeCutoffPassed(), isCustomerManageLinkValid(), ManagedBookingViewRow, toManagedBookingView(), getCustomerReplacementChoices(), getCustomerReplacementSlots(), getManagedBooking() (+10 more)

### Community 74 - "bookings/tests/operations.integration.test.ts"
Cohesion: 0.52
Nodes (6): expectOwnerBookingUnmoved(), input(), moveInput(), queueShopOperations(), run(), setupCancelled()

### Community 75 - "eslint.config.mjs"
Cohesion: 0.33
Nodes (5): eslintConfig, eslint@^9, eslint-config-next@16.4.2, eslint, eslint-config-next

### Community 77 - "publication-controls.tsx"
Cohesion: 0.36
Nodes (6): PublicationControls(), save(), PUBLICATION_UNKNOWN_FEEDBACK, PublicationFeedback, publicationFeedbackFromError(), ActionError

### Community 78 - "server/config.ts"
Cohesion: 0.25
Nodes (6): { marketingOrigin, appOrigin }, nextConfig, canonicalOrigin(), Environment, resolveServerOrigins(), ServerOrigins

### Community 79 - "allowBuilds"
Cohesion: 0.40
Nodes (4): allowBuilds, sharp, unrs-resolver, minimumReleaseAgeExclude

### Community 80 - "phase14-retries.spec.ts"
Cohesion: 0.16
Nodes (5): loadShopDate(), nextAction(), resolveBoundary(), seedOwnerAppointment(), RetryFixture

### Community 81 - "e2e-device-matrix.test.ts"
Cohesion: 0.50
Nodes (3): ListedSuite, listedTests(), visit()

### Community 89 - "catalog/actions.ts"
Cohesion: 0.61
Nodes (7): archiveServiceAction(), authorize(), denied(), fields(), refresh(), saveServiceAction(), setServiceOfferedAction()

### Community 93 - "barbers/actions.ts"
Cohesion: 0.62
Nodes (6): archiveBarberAction(), authorize(), denied(), fields(), refresh(), saveBarberAction()

### Community 96 - "next"
Cohesion: 0.26
Nodes (7): metadata, config, proxy(), next, shopNotFound(), shopUnavailable(), publicShopExists

## Knowledge Gaps
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vitest` connect `vitest` to `dispatch.ts`, `bookings/actions.ts`, `manage-booking-preview.tsx`, `public-mutations.ts`, `replace.ts`, `recovery.ts`, `schedule-draft.ts`, `package.json`, `customer-replacement.integration.test.ts`, `shops/mutations.ts`, `dispatch.integration.test.ts`, `availability/queries.ts`, `appointment-operations.tsx`, `move.ts`, `hashSecret`, `availability/actions.ts`, `readOwnerContext`, `owner-calendar-context.tsx`, `availability/schemas.ts`, `bookings/types.ts`, `appointments/[appointmentId]/page.tsx`, `reminder-migrations.test.ts`, `appointment-form.tsx`, `notification-recovery-migrations.test.ts`, `booking-step-contact.tsx`, `getOwnShop`, `owner-activity.test.ts`, `DateAvailabilityManagement`, `catalog/mutations.ts`, `test-e2e.mjs`, `attendance-migrations.test.ts`, `availability/types.ts`, `mailpit-double.mjs`, `customer-cancellation-migrations.test.ts`, `customer-replacement-migrations.test.ts`, `owner-restoration-migrations.test.ts`, `customer.ts`, `bookings/tests/operations.integration.test.ts`, `publication-controls.tsx`, `server/config.ts`, `e2e-device-matrix.test.ts`, `next`?**
  _High betweenness centrality (0.120) - this node is a cross-community bridge._
- **Should `dispatch.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.055077452667814115 - nodes in this community are weakly interconnected._
- **Why does `react` connect `react` to `manage-booking-preview.tsx`, `dropdown-menu.tsx`, `design-system/page.tsx`, `Button`, `public-mutations.ts`, `owner-calendar.tsx`, `notifications/queries.ts`, `scheduling-calendar.tsx`, `schedule-draft.ts`, `package.json`, `booking-flow.tsx`, `availability/queries.ts`, `appointment-operations.tsx`, `availability/actions.ts`, `dependencies`, `owner-calendar-context.tsx`, `owner-management-nav.tsx`, `appointments/[appointmentId]/page.tsx`, `appointment-form.tsx`, `setup/page.tsx`, `AppointmentOperationsForm`, `barbers/page.tsx`, `booking-step-contact.tsx`, `getOwnShop`, `owner-activity.test.ts`, `shop/page.tsx`, `publication-controls.tsx`?**
  _High betweenness centrality (0.097) - this node is a cross-community bridge._
- **Should `manage-booking-preview.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.0629399585921325 - nodes in this community are weakly interconnected._
- **Why does `next` connect `next` to `bookings/actions.ts`, `manage-booking-preview.tsx`, `dropdown-menu.tsx`, `design-system/page.tsx`, `Button`, `public-mutations.ts`, `owner-calendar.tsx`, `notifications/queries.ts`, `package.json`, `booking-flow.tsx`, `react`, `availability/queries.ts`, `appointment-operations.tsx`, `availability/actions.ts`, `readOwnerContext`, `dependencies`, `owner-calendar-context.tsx`, `owner-management-nav.tsx`, `appointments/[appointmentId]/page.tsx`, `appointment-form.tsx`, `setup/page.tsx`, `AppointmentOperationsForm`, `barbers/page.tsx`, `TrimTimeLogo`, `getOwnShop`, `shop/page.tsx`, `publication-controls.tsx`, `server/config.ts`, `catalog/actions.ts`, `barbers/actions.ts`?**
  _High betweenness centrality (0.073) - this node is a cross-community bridge._
- **Should `dropdown-menu.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.11827956989247312 - nodes in this community are weakly interconnected._
- **Should `design-system/page.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.08215488215488216 - nodes in this community are weakly interconnected._